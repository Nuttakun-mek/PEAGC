-- One-shot apply for the UAT project: migrations 20261116090000 and the eight of 23 Nov 2026, in order,
-- in ONE transaction. Paste into Supabase Dashboard -> SQL Editor -> Run. If anything fails, nothing is applied.
-- It also records each version in supabase_migrations.schema_migrations so a later
-- `supabase db push` does not run them again. Generated from supabase/migrations; do not edit.

begin;

-- ====================================================================
-- 20261116090000_unique_member_employee_code
-- ====================================================================
-- QA round 2:
-- 1) One employee code = one member. The admin forms and the sign-up flow already refuse a code
--    another (not archived) member holds; this index makes the rule hold for every writer too.
--    Codes compare without case and spaces, like the forms ("uat 001" = "UAT001"). Archived
--    members keep their old code without blocking anyone.
-- 2) One display name per person: profiles follow the member's full name, so the header, the
--    member card and the admin lists no longer show two different names for the same account.

do $$
begin
  if exists (
    select 1
    from public.members
    where archived_at is null
      and nullif(btrim(employee_code), '') is not null
    group by club_id, upper(regexp_replace(employee_code, '\s+', '', 'g'))
    having count(*) > 1
  ) then
    raise exception 'members has duplicate employee codes among non-archived rows; archive or fix them before applying this migration';
  end if;
end $$;

create unique index if not exists members_club_employee_code_active_key
  on public.members (club_id, upper(regexp_replace(employee_code, '\s+', '', 'g')))
  where archived_at is null
    and nullif(btrim(employee_code), '') is not null;

update public.profiles p
set display_name = m.full_name,
    updated_at = now()
from public.members m
where m.user_id = p.id
  and m.archived_at is null
  and nullif(btrim(m.full_name), '') is not null
  and p.display_name is distinct from m.full_name;

insert into supabase_migrations.schema_migrations (version, name) values ('20261116090000', 'unique_member_employee_code') on conflict (version) do nothing;

-- ====================================================================
-- 20261123090000_fix_directory_replace_flags
-- ====================================================================
-- Fix finalize_directory_replace: a "replace" import flagged every active member that was not
-- linked to an employee_directory row (employee_directory_id is null) as "left_directory" and set
-- their association status to inactive. That hit members the admin added by hand and anyone who
-- was never in the association file, on every monthly import.
--
-- New rules, applied after the batch is upserted:
--   1. Directory rows missing from the batch become inactive (unchanged).
--   2. Only members LINKED to a directory row that is now inactive or archived are flagged.
--   3. Members flagged "left_directory" whose linked row is active again are un-flagged.
-- The migration also repairs rows the old function flagged wrongly (unlinked members).

create or replace function public.finalize_directory_replace(p_club_id uuid, p_batch_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deactivated integer := 0;
  v_flagged integer := 0;
  v_restored integer := 0;
begin
  if not exists (
    select 1 from public.user_roles ur
    where ur.club_id = p_club_id
      and ur.user_id = auth.uid()
      and ur.role_key in ('platform_owner', 'club_admin')
  ) then
    raise exception 'NOT_ADMIN';
  end if;

  with changed as (
    update public.employee_directory d
    set membership_status = 'inactive',
        updated_by = auth.uid()
    where d.club_id = p_club_id
      and d.archived_at is null
      and d.membership_status <> 'inactive'
      and (d.import_batch_id is distinct from p_batch_id)
    returning d.id
  )
  select count(*) into v_deactivated from changed;

  with flagged as (
    update public.members m
    set employee_match_status = 'mismatch',
        employee_match_checked_at = now(),
        employee_match_detail = coalesce(m.employee_match_detail, '{}'::jsonb)
          || jsonb_build_object('reason', 'left_directory', 'flagged_at', now(), 'batch_id', p_batch_id),
        association_membership_status = 'inactive',
        updated_by = auth.uid()
    from public.employee_directory d
    where m.club_id = p_club_id
      and m.archived_at is null
      and m.status = 'active'
      and m.employee_match_status <> 'mismatch'
      and d.id = m.employee_directory_id
      and (d.membership_status <> 'active' or d.archived_at is not null)
    returning m.id
  )
  select count(*) into v_flagged from flagged;

  with restored as (
    update public.members m
    set employee_match_status = 'matched',
        employee_match_checked_at = now(),
        employee_match_detail = (coalesce(m.employee_match_detail, '{}'::jsonb) - 'reason' - 'flagged_at' - 'batch_id')
          || jsonb_build_object('restored_at', now(), 'batch_id', p_batch_id),
        association_membership_status = d.membership_status,
        updated_by = auth.uid()
    from public.employee_directory d
    where m.club_id = p_club_id
      and m.archived_at is null
      and m.employee_match_detail ->> 'reason' = 'left_directory'
      and d.id = m.employee_directory_id
      and d.membership_status = 'active'
      and d.archived_at is null
    returning m.id
  )
  select count(*) into v_restored from restored;

  return json_build_object('deactivated', v_deactivated, 'flagged', v_flagged, 'restored', v_restored);
end;
$$;

revoke all on function public.finalize_directory_replace(uuid, uuid) from public, anon;
grant execute on function public.finalize_directory_replace(uuid, uuid) to authenticated, service_role;

-- Repair: undo flags the old function put on members that were never linked to a directory row.
update public.members m
set employee_match_status = 'not_checked',
    employee_match_detail = coalesce(m.employee_match_detail, '{}'::jsonb) - 'reason' - 'flagged_at' - 'batch_id',
    association_membership_status = null
where m.employee_directory_id is null
  and m.employee_match_detail ->> 'reason' = 'left_directory';

insert into supabase_migrations.schema_migrations (version, name) values ('20261123090000', 'fix_directory_replace_flags') on conflict (version) do nothing;

-- ====================================================================
-- 20261123091000_phase2_foundation
-- ====================================================================
-- Phase 2 foundation shared by the lessons, membership/points and payments work.
--
-- 1. A "coach" role: sees and checks in only the lesson slots they teach.
-- 2. payment_records is no longer events-only. `purpose` says what the money is for and
--    `reference_id` points at the row it pays for (the table depends on purpose):
--      event           -> event_registration_id (required, unchanged)
--      lesson_package  -> reference_id = lesson_enrollments.id
--      membership_fee  -> reference_id = membership_terms.id
--      other           -> free text in description
--    Each feature adds its own "on approved" trigger filtered by purpose.
-- 3. Slip de-duplication fields: sha256 of the uploaded file and the bank transaction reference
--    read from the slip QR. The same reference can never be approved twice.
-- 4. Club payment settings (PromptPay ID shown as a QR with the exact amount).

insert into public.role_catalog (key, name, description)
values ('coach', 'Coach', 'Lesson coach: own slots, roster and check-in only')
on conflict (key) do nothing;

alter table public.payment_records
  alter column event_registration_id drop not null;

alter table public.payment_records
  add column if not exists purpose text not null default 'event',
  add column if not exists member_id uuid references public.members(id) on delete set null,
  add column if not exists reference_id uuid,
  add column if not exists description text,
  add column if not exists slip_sha256 text,
  add column if not exists slip_transaction_ref text,
  add column if not exists verification jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_records_purpose_check') then
    alter table public.payment_records
      add constraint payment_records_purpose_check
      check (purpose in ('event', 'lesson_package', 'membership_fee', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_records_event_registration_check') then
    alter table public.payment_records
      add constraint payment_records_event_registration_check
      check (purpose <> 'event' or event_registration_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_records_reference_check') then
    alter table public.payment_records
      add constraint payment_records_reference_check
      check (purpose not in ('lesson_package', 'membership_fee') or reference_id is not null);
  end if;
end $$;

-- Backfill the payer for existing event payments.
update public.payment_records p
set member_id = r.member_id
from public.event_registrations r
where p.event_registration_id = r.id
  and p.member_id is null
  and r.member_id is not null;

create index if not exists payment_records_club_purpose_status_idx
on public.payment_records (club_id, purpose, status, created_at desc);

create index if not exists payment_records_member_created_idx
on public.payment_records (member_id, created_at desc);

create index if not exists payment_records_reference_idx
on public.payment_records (reference_id)
where reference_id is not null;

create index if not exists payment_records_slip_sha256_idx
on public.payment_records (club_id, slip_sha256)
where slip_sha256 is not null;

-- One bank transfer can pay for one thing only.
create unique index if not exists payment_records_slip_transaction_ref_key
on public.payment_records (club_id, slip_transaction_ref)
where slip_transaction_ref is not null and status <> 'rejected';

-- Members can read their own payments (all purposes).
drop policy if exists "payments_select_own_member" on public.payment_records;
create policy "payments_select_own_member"
on public.payment_records
for select
to authenticated
using (
  exists (
    select 1
    from public.members m
    where m.id = payment_records.member_id
      and m.user_id = (select auth.uid())
  )
);

create table if not exists public.club_payment_settings (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  promptpay_id text,
  account_name text,
  bank_name text,
  bank_account_no text,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (promptpay_id is null or promptpay_id ~ '^[0-9]{10}$|^[0-9]{13}$|^[0-9]{15}$')
);

create trigger set_club_payment_settings_updated_at
before update on public.club_payment_settings
for each row execute function public.set_updated_at();

alter table public.club_payment_settings enable row level security;
grant select, insert, update on public.club_payment_settings to authenticated;

drop policy if exists "club_payment_settings_select_by_club" on public.club_payment_settings;
create policy "club_payment_settings_select_by_club"
on public.club_payment_settings
for select
to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.club_id = club_payment_settings.club_id and ur.user_id = (select auth.uid()))
  or exists (select 1 from public.members m where m.club_id = club_payment_settings.club_id and m.user_id = (select auth.uid()) and m.archived_at is null)
);

drop policy if exists "club_payment_settings_write_by_finance" on public.club_payment_settings;
create policy "club_payment_settings_write_by_finance"
on public.club_payment_settings
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = club_payment_settings.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'finance_officer')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = club_payment_settings.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'finance_officer')
  )
);

-- 5. Notification types used by the phase 2 features (one list here so feature migrations do not
--    overwrite each other's check constraint).
alter table public.member_notifications
  drop constraint if exists member_notifications_notification_type_check;
alter table public.member_notifications
  add constraint member_notifications_notification_type_check
  check (notification_type in (
    'member_approved', 'member_rejected', 'lesson_reminder', 'event_update', 'lesson_update',
    'lesson_offer', 'lesson_closure', 'lesson_credit', 'coach_note',
    'membership_expiring', 'membership_renewed', 'payment_update', 'points_update', 'event_reminder'
  ));

insert into supabase_migrations.schema_migrations (version, name) values ('20261123091000', 'phase2_foundation') on conflict (version) do nothing;

-- ====================================================================
-- 20261123092000_platform
-- ====================================================================
-- Platform (phase 2-3, track "platform"): audit log access, staff names for the audit page,
-- directory import previews, and indexes for search and reports.
--
-- 1. audit_logs
--    - read: platform_owner, club_admin, committee, auditor of the club (committee was missing;
--      the role-based menu gives committee the audit page).
--    - insert: any staff of the club, but only as themselves (actor_user_id = auth.uid()), so a
--      row cannot be written in someone else's name. Service-role and security-definer writers
--      are not affected by RLS.
--    - append-only: no UPDATE/DELETE grant or policy for authenticated (unchanged).
--    - indexes for the audit page filters and the member 360 history.
-- 2. club_staff_names(club_id): display names of the club's staff for the audit page (profiles
--    are readable only by their owner, so staff names cannot be read directly).
-- 3. directory_import_previews: a parsed monthly directory file waiting for "ยืนยันนำเข้า".
--    Holds the parsed rows for one hour so the confirm step does not re-upload the file or carry
--    thousands of rows through hidden inputs.
-- 4. Indexes for the admin search (members by code/phone) and the monthly revenue report.

-- ---------- 1. audit_logs ----------
drop policy if exists "audit_logs_select_by_admin" on public.audit_logs;
create policy "audit_logs_select_by_admin"
on public.audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = audit_logs.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'auditor')
  )
);

drop policy if exists "audit_logs_insert_by_club" on public.audit_logs;
create policy "audit_logs_insert_by_club"
on public.audit_logs
for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_roles ur
    where ur.club_id = audit_logs.club_id
      and ur.user_id = (select auth.uid())
  )
);

revoke update, delete on public.audit_logs from authenticated, anon;

create index if not exists audit_logs_club_created_idx
on public.audit_logs (club_id, created_at desc);

create index if not exists audit_logs_club_entity_idx
on public.audit_logs (club_id, entity_type, entity_id, created_at desc);

create index if not exists audit_logs_club_actor_idx
on public.audit_logs (club_id, actor_user_id, created_at desc);

create index if not exists audit_logs_entity_id_idx
on public.audit_logs (entity_id)
where entity_id is not null;

-- ---------- 2. staff names ----------
create or replace function public.club_staff_names(p_club_id uuid)
returns table (user_id uuid, display_name text, role_keys text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    ur.user_id,
    coalesce(
      nullif(btrim(max(m.full_name)), ''),
      nullif(btrim(max(p.display_name)), '')
    ) as display_name,
    array_agg(distinct ur.role_key order by ur.role_key) as role_keys
  from public.user_roles ur
  left join public.profiles p on p.id = ur.user_id
  left join public.members m
    on m.user_id = ur.user_id
   and m.club_id = ur.club_id
   and m.archived_at is null
  where ur.club_id = p_club_id
    and exists (
      select 1
      from public.user_roles me
      where me.club_id = p_club_id
        and me.user_id = auth.uid()
        and me.role_key in (
          'platform_owner', 'club_admin', 'committee', 'finance_officer',
          'tournament_director', 'scoring_officer', 'auditor'
        )
    )
  group by ur.user_id;
$$;

revoke all on function public.club_staff_names(uuid) from public, anon;
grant execute on function public.club_staff_names(uuid) to authenticated, service_role;

-- ---------- 3. directory import previews ----------
create table if not exists public.directory_import_previews (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  file_name text not null,
  file_type text not null default 'csv' check (file_type in ('csv', 'xlsx')),
  mode text not null default 'merge' check (mode in ('merge', 'replace')),
  row_count integer not null default 0 check (row_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  -- Parsed DirectoryRow[] (src/lib/directory/import.ts), already normalised.
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  status text not null default 'preview' check (status in ('preview', 'applying', 'applied', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  applied_at timestamptz,
  applied_import_id uuid references public.directory_imports(id) on delete set null
);

create index if not exists directory_import_previews_club_created_idx
on public.directory_import_previews (club_id, created_at desc);

alter table public.directory_import_previews enable row level security;
grant select, insert, update, delete on public.directory_import_previews to authenticated;
grant all on public.directory_import_previews to service_role;

drop policy if exists "directory_import_previews_by_admin" on public.directory_import_previews;
create policy "directory_import_previews_by_admin"
on public.directory_import_previews
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = directory_import_previews.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = directory_import_previews.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
);

-- ---------- 4. search and report indexes ----------
create index if not exists members_club_member_code_idx
on public.members (club_id, member_code)
where archived_at is null;

create index if not exists members_club_employee_code_idx
on public.members (club_id, employee_code)
where archived_at is null and employee_code is not null;

create index if not exists payment_records_club_reviewed_idx
on public.payment_records (club_id, reviewed_at)
where status = 'approved';

insert into supabase_migrations.schema_migrations (version, name) values ('20261123092000', 'platform') on conflict (version) do nothing;

-- ====================================================================
-- 20261123093000_lessons_v2
-- ====================================================================
-- Lessons v2 (phase 2-3, track "lessons-db"): coaches, venues, packages + credit ledger,
-- explicit waitlist with timed offers, QR / coach check-in, automatic no-shows, closures,
-- coach notes and admin tools. Extends the FCFS booking RPCs from 20261106090000.
--
-- Booking statuses (lesson_bookings.status):
--   booked          holds a seat; a credit is deducted when the course requires a package
--   waitlist        คิวสำรอง, no seat, no credit (was implicit "booked beyond capacity" before)
--   offered         a seat freed up and is held for this member until offer_expires_at
--   attended        checked in (QR, coach or staff) -> points trigger +10
--   no_show         still 'booked' 30 min after the end -> points trigger -10
--   cancelled       cancelled before the cutoff, by staff, or the slot was cancelled -> credit back
--   late_cancelled  cancelled after the cutoff -> credit NOT returned
--   closed          the club closed the day (close_lesson_day) -> credit back
-- Seats taken = booked + offered + attended + no_show.
--
-- Credits are a ledger (lesson_credit_txns, append-only, balance = sum(delta) per enrollment).
-- The credit for a booking is settled by one trigger on lesson_bookings so every path (RPCs,
-- admin edits, slot cancellation, closures) keeps the ledger right:
--   * entering 'booked' in a course with requires_package -> -1 from the usable enrollment that
--     expires soonest (and covers the course and the lesson date) or NO_CREDIT;
--   * entering waitlist / offered / cancelled / closed -> whatever the booking holds comes back;
--   * attended / no_show / late_cancelled keep the deduction.
--
-- Waitlist offers: when a seat frees up the first waitlisted booking becomes 'offered' for
-- offer_window_hours (default 2, never past the start). If the lesson starts within
-- offer_instant_hours (default 3) it is booked at once instead (when the member has a credit).
-- An offer that expires goes back to the END of the queue and the seat is offered to the next
-- person; a second expired offer (or a full waitlist / started lesson) drops it from the queue
-- ('cancelled'). Offers expire lazily inside the booking RPCs and in the daily cron.
--
-- Check-in tokens live in lesson_checkin_tokens, not on lesson_slots: members can read
-- lesson_slots rows, so a token column there would let anyone check in from home.

-- ---------- 0. small helpers ----------
create or replace function public._lesson_th_date(p_date date)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_date is null then null else
    extract(day from p_date)::integer::text || ' ' ||
    (array['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month from p_date)::integer] || ' ' ||
    (extract(year from p_date)::integer + 543)::text
  end;
$$;

create or replace function public._lesson_th_datetime(p_at timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select case when p_at is null then null else
    public._lesson_th_date((p_at at time zone 'Asia/Bangkok')::date) || ' ' ||
    to_char(p_at at time zone 'Asia/Bangkok', 'HH24:MI') || ' น.'
  end;
$$;

create or replace function public._lesson_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;

-- Last second of a Bangkok calendar day ("ใช้ได้ถึง 22 ม.ค. 2570").
create or replace function public._lesson_end_of_day(p_date date)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select (p_date + time '23:59:59') at time zone 'Asia/Bangkok';
$$;

create or replace function public._lesson_seat_status(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status in ('booked', 'offered', 'attended', 'no_show');
$$;

-- "รอบ ... วันที่ 3 ธ.ค. 2569 เวลา 16:30-17:30 น." (replaces the dd/mm/yyyy version).
create or replace function public._lesson_slot_label(p_slot public.lesson_slots)
returns text
language sql
immutable
as $$
  select p_slot.title || ' วันที่ ' || public._lesson_th_date(p_slot.lesson_date) ||
         ' เวลา ' || to_char(p_slot.start_time, 'HH24:MI') || '-' || to_char(p_slot.end_time, 'HH24:MI') || ' น.';
$$;

-- ---------- 1. role helpers (also used by RLS policies) ----------
-- Lesson staff = may change lesson data (same roles as the existing lesson write policies).
create or replace function public._lesson_is_staff(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.club_id = p_club
      and ur.user_id = auth.uid()
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  );
$$;

-- Read-only staff view (reports, finance, auditors...). Coaches and plain members are excluded:
-- coaches only see their own slots' bookings.
create or replace function public._lesson_can_view(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.club_id = p_club
      and ur.user_id = auth.uid()
      and ur.role_key not in ('coach', 'member')
  );
$$;

create or replace function public._lesson_is_coach_user(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.club_id = p_club
      and ur.user_id = auth.uid()
      and ur.role_key = 'coach'
  );
$$;

create or replace function public._lesson_is_member_of(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.club_id = p_club
      and m.user_id = auth.uid()
      and m.archived_at is null
  );
$$;

-- ---------- 2. tables ----------
create table if not exists public.lesson_coaches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  nickname text,
  phone text,
  user_id uuid references auth.users(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  bio text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create unique index if not exists lesson_coaches_club_user_key
on public.lesson_coaches (club_id, user_id)
where user_id is not null and archived_at is null;

create index if not exists lesson_coaches_club_idx
on public.lesson_coaches (club_id, status)
where archived_at is null;

create table if not exists public.lesson_venues (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  address text,
  bay_count integer not null default 1 check (bay_count between 1 and 500),
  capacity_per_bay integer not null default 1 check (capacity_per_bay between 1 and 100),
  note text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists lesson_venues_club_idx
on public.lesson_venues (club_id, status)
where archived_at is null;

create table if not exists public.lesson_closures (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  closure_date date not null,
  venue_id uuid references public.lesson_venues(id) on delete set null,
  reason text not null check (length(trim(reason)) > 0),
  slots_cancelled integer not null default 0,
  bookings_closed integer not null default 0,
  members_notified integer not null default 0,
  credits_refunded integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists lesson_closures_club_date_idx
on public.lesson_closures (club_id, closure_date desc);

create table if not exists public.lesson_packages (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  program_id uuid references public.lesson_programs(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  credits integer not null check (credits between 1 and 1000),
  valid_days integer not null check (valid_days between 1 and 3650),
  price numeric(12,2) not null default 0 check (price >= 0),
  max_per_member integer check (max_per_member is null or max_per_member > 0),
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists lesson_packages_club_idx
on public.lesson_packages (club_id, status, sort_order)
where archived_at is null;

create table if not exists public.lesson_enrollments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  package_id uuid references public.lesson_packages(id) on delete set null,
  -- copied from the package: null = credits work for any course
  program_id uuid references public.lesson_programs(id) on delete set null,
  package_name text not null,
  credits_total integer not null check (credits_total >= 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  valid_days integer not null check (valid_days > 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'expired', 'cancelled')),
  source text not null default 'purchase' check (source in ('purchase', 'free', 'admin_grant')),
  starts_at timestamptz,
  expires_at timestamptz,
  payment_record_id uuid references public.payment_records(id) on delete set null,
  expiry_warned_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  check (status not in ('active', 'expired') or (starts_at is not null and expires_at is not null))
);

create index if not exists lesson_enrollments_member_idx
on public.lesson_enrollments (member_id, status, expires_at);

create index if not exists lesson_enrollments_club_status_idx
on public.lesson_enrollments (club_id, status, expires_at);

create index if not exists lesson_enrollments_payment_idx
on public.lesson_enrollments (payment_record_id)
where payment_record_id is not null;

-- ---------- 3. columns on existing lesson tables ----------
alter table public.lesson_programs
  add column if not exists requires_package boolean not null default false,
  add column if not exists default_coach_id uuid references public.lesson_coaches(id) on delete set null,
  add column if not exists default_venue_id uuid references public.lesson_venues(id) on delete set null;

alter table public.lesson_slots
  add column if not exists coach_id uuid references public.lesson_coaches(id) on delete set null,
  add column if not exists venue_id uuid references public.lesson_venues(id) on delete set null,
  add column if not exists bay_label text,
  add column if not exists closure_id uuid references public.lesson_closures(id) on delete set null,
  add column if not exists seats_taken integer not null default 0,
  add column if not exists waitlist_count integer not null default 0;

create index if not exists lesson_slots_coach_date_idx
on public.lesson_slots (coach_id, lesson_date, start_time)
where coach_id is not null and archived_at is null;

create index if not exists lesson_slots_venue_date_idx
on public.lesson_slots (venue_id, lesson_date, start_time)
where venue_id is not null and archived_at is null;

alter table public.lesson_bookings
  add column if not exists offered_at timestamptz,
  add column if not exists offer_expires_at timestamptz,
  add column if not exists offer_count integer not null default 0,
  add column if not exists cancelled_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;

alter table public.lesson_bookings drop constraint if exists lesson_bookings_status_check;
alter table public.lesson_bookings
  add constraint lesson_bookings_status_check
  check (status in ('booked', 'waitlist', 'offered', 'attended', 'no_show', 'cancelled', 'late_cancelled', 'closed'));

alter table public.lesson_bookings drop constraint if exists lesson_bookings_offer_check;
alter table public.lesson_bookings
  add constraint lesson_bookings_offer_check
  check (status <> 'offered' or offer_expires_at is not null);

drop index if exists public.lesson_bookings_one_active_member_slot;
create unique index lesson_bookings_one_active_member_slot
on public.lesson_bookings (slot_id, member_id)
where status not in ('cancelled', 'late_cancelled', 'closed');

create index if not exists lesson_bookings_offer_expiry_idx
on public.lesson_bookings (offer_expires_at)
where status = 'offered';

create index if not exists lesson_bookings_member_status_idx
on public.lesson_bookings (member_id, status);

-- Club rules (defaults from the UX/UI audit, page 19). max_bookings_per_member is
-- "จองล่วงหน้าค้างได้พร้อมกัน" (booked + waitlist + offered rounds that have not started).
alter table public.lesson_booking_settings
  add column if not exists change_cutoff_hours integer not null default 12 check (change_cutoff_hours between 0 and 720),
  add column if not exists offer_window_hours integer not null default 2 check (offer_window_hours between 0 and 168),
  add column if not exists offer_instant_hours integer not null default 3 check (offer_instant_hours between 0 and 168),
  add column if not exists no_show_limit integer not null default 2 check (no_show_limit between 0 and 100),
  add column if not exists no_show_window_days integer not null default 30 check (no_show_window_days between 1 and 365),
  add column if not exists no_show_block_days integer not null default 7 check (no_show_block_days between 0 and 365),
  add column if not exists credit_expiry_warning_days integer not null default 7 check (credit_expiry_warning_days between 0 and 365),
  add column if not exists employee_priority_days integer not null default 2 check (employee_priority_days between 0 and 60),
  add column if not exists reminder_hours integer not null default 24 check (reminder_hours between 0 and 168),
  add column if not exists max_bookings_per_week integer not null default 0 check (max_bookings_per_week between 0 and 50),
  add column if not exists auto_no_show boolean not null default true;

-- ---------- 4. ledger, notes, check-in tokens ----------
create table if not exists public.lesson_credit_txns (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  enrollment_id uuid not null references public.lesson_enrollments(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null
    check (reason in ('purchase', 'booking', 'refund', 'late_cancel', 'closure', 'expired', 'adjust')),
  booking_id uuid references public.lesson_bookings(id) on delete set null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists lesson_credit_txns_enrollment_idx
on public.lesson_credit_txns (enrollment_id, created_at);

create index if not exists lesson_credit_txns_member_idx
on public.lesson_credit_txns (member_id, created_at desc);

create index if not exists lesson_credit_txns_booking_idx
on public.lesson_credit_txns (booking_id)
where booking_id is not null;

create table if not exists public.lesson_coach_notes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  booking_id uuid references public.lesson_bookings(id) on delete set null,
  member_id uuid not null references public.members(id) on delete cascade,
  coach_id uuid references public.lesson_coaches(id) on delete set null,
  note text not null check (length(trim(note)) > 0),
  skill_level text check (skill_level is null or skill_level in ('beginner', 'intermediate', 'advanced')),
  video_url text check (video_url is null or video_url ~* '^https?://'),
  visible_to_member boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists lesson_coach_notes_member_idx
on public.lesson_coach_notes (member_id, created_at desc);

create index if not exists lesson_coach_notes_booking_idx
on public.lesson_coach_notes (booking_id)
where booking_id is not null;

create table if not exists public.lesson_checkin_tokens (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),
  club_id uuid not null references public.clubs(id) on delete cascade,
  slot_id uuid unique references public.lesson_slots(id) on delete cascade,
  venue_id uuid unique references public.lesson_venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  check (num_nonnulls(slot_id, venue_id) = 1)
);

-- Remaining credits per enrollment (RLS of the caller applies: members see their own).
create or replace view public.lesson_enrollment_balances
with (security_invoker = true)
as
select
  e.id as enrollment_id,
  e.club_id,
  e.member_id,
  e.package_id,
  e.program_id,
  e.package_name,
  e.credits_total,
  e.price,
  e.status,
  e.source,
  e.starts_at,
  e.expires_at,
  e.payment_record_id,
  e.created_at,
  coalesce(t.balance, 0)::integer as credits_remaining,
  coalesce(t.used, 0)::integer as credits_used,
  (e.status = 'active' and e.expires_at > now() and coalesce(t.balance, 0) > 0) as usable
from public.lesson_enrollments e
left join (
  select
    enrollment_id,
    sum(delta) as balance,
    -sum(delta) filter (where reason in ('booking', 'refund', 'closure', 'late_cancel')) as used
  from public.lesson_credit_txns
  group by enrollment_id
) t on t.enrollment_id = e.id;

-- ---------- 5. updated_at triggers ----------
drop trigger if exists set_lesson_coaches_updated_at on public.lesson_coaches;
create trigger set_lesson_coaches_updated_at
before update on public.lesson_coaches
for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_venues_updated_at on public.lesson_venues;
create trigger set_lesson_venues_updated_at
before update on public.lesson_venues
for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_packages_updated_at on public.lesson_packages;
create trigger set_lesson_packages_updated_at
before update on public.lesson_packages
for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_enrollments_updated_at on public.lesson_enrollments;
create trigger set_lesson_enrollments_updated_at
before update on public.lesson_enrollments
for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_coach_notes_updated_at on public.lesson_coach_notes;
create trigger set_lesson_coach_notes_updated_at
before update on public.lesson_coach_notes
for each row execute function public.set_updated_at();

-- ---------- 6. ledger guards ----------
-- Append-only: direct UPDATE/DELETE is refused. Foreign-key actions (cascade delete of a
-- member/club, booking_id set null) run inside the RI trigger, i.e. at trigger depth > 1.
create or replace function public.lesson_credit_txns_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  raise exception 'LEDGER_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

drop trigger if exists lesson_credit_txns_append_only on public.lesson_credit_txns;
create trigger lesson_credit_txns_append_only
before update or delete on public.lesson_credit_txns
for each row execute function public.lesson_credit_txns_append_only();

-- A balance can never go below zero.
create or replace function public.lesson_credit_txns_check_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.delta < 0 and (
    select coalesce(sum(delta), 0) from public.lesson_credit_txns where enrollment_id = new.enrollment_id
  ) < 0 then
    raise exception 'INSUFFICIENT_CREDIT' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

drop trigger if exists lesson_credit_txns_check_balance on public.lesson_credit_txns;
create trigger lesson_credit_txns_check_balance
after insert on public.lesson_credit_txns
for each row execute function public.lesson_credit_txns_check_balance();

-- ---------- 7. coach helpers (need lesson_coaches) ----------
create or replace function public._lesson_my_coach_id(p_club uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.lesson_coaches c
  where c.club_id = p_club
    and c.user_id = auth.uid()
    and c.archived_at is null
    and c.status = 'active'
  limit 1;
$$;

-- True when the caller is the (active) coach of the slot and holds the 'coach' role.
create or replace function public._lesson_is_slot_coach(p_slot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lesson_slots s
    join public.lesson_coaches c on c.id = s.coach_id
    join public.user_roles ur on ur.club_id = s.club_id and ur.user_id = c.user_id and ur.role_key = 'coach'
    where s.id = p_slot_id
      and c.user_id = auth.uid()
      and c.archived_at is null
      and c.status = 'active'
  );
$$;

create or replace function public._lesson_member_has_booking(p_slot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lesson_bookings b
    join public.members m on m.id = b.member_id
    where b.slot_id = p_slot_id
      and m.user_id = auth.uid()
  );
$$;

-- Display names on the old text columns stay in sync with the picked coach / venue, so pages that
-- still read coach_name / venue keep showing the right thing.
create or replace function public.lesson_slot_fill_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.coach_id is not null and (tg_op = 'INSERT' or new.coach_id is distinct from old.coach_id) then
    select c.full_name || coalesce(' (' || nullif(trim(c.nickname), '') || ')', '')
    into new.coach_name
    from public.lesson_coaches c
    where c.id = new.coach_id;
  end if;
  if new.venue_id is not null
     and (tg_op = 'INSERT' or new.venue_id is distinct from old.venue_id or new.bay_label is distinct from old.bay_label) then
    select v.name || coalesce(' · ช่อง ' || nullif(trim(new.bay_label), ''), '')
    into new.venue
    from public.lesson_venues v
    where v.id = new.venue_id;
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_slot_fill_names on public.lesson_slots;
create trigger lesson_slot_fill_names
before insert or update of coach_id, venue_id, bay_label on public.lesson_slots
for each row execute function public.lesson_slot_fill_names();

create or replace function public.lesson_program_fill_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_coach_id is not null
     and (tg_op = 'INSERT' or new.default_coach_id is distinct from old.default_coach_id) then
    select c.full_name || coalesce(' (' || nullif(trim(c.nickname), '') || ')', '')
    into new.coach_name
    from public.lesson_coaches c
    where c.id = new.default_coach_id;
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_program_fill_names on public.lesson_programs;
create trigger lesson_program_fill_names
before insert or update of default_coach_id on public.lesson_programs
for each row execute function public.lesson_program_fill_names();

-- ---------- 8. data: the implicit waitlist becomes status 'waitlist' ----------
-- Before v2 every queued booking was 'booked' and position > capacity meant waitlisted.
-- Triggers are off for this one-time rewrite (no notifications, no capacity re-checks).
alter table public.lesson_bookings disable trigger user;

with ranked as (
  select
    b.id,
    row_number() over (partition by b.slot_id order by b.queue_seq) as position,
    s.capacity
  from public.lesson_bookings b
  join public.lesson_slots s on s.id = b.slot_id
  where b.status <> 'cancelled'
)
update public.lesson_bookings b
set status = 'waitlist'
from ranked r
where r.id = b.id
  and b.status = 'booked'
  and r.position > r.capacity;

alter table public.lesson_bookings enable trigger user;

-- ---------- 9. counters on lesson_slots ----------
-- booked_count keeps its meaning for the member board (everyone in the queue, seats + waitlist);
-- seats_taken and waitlist_count feed the calendar fill colours.
create or replace function public._lesson_refresh_slot_counts(p_slot_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.lesson_slots s
  set booked_count = c.active,
      seats_taken = c.seats,
      waitlist_count = c.waitlist
  from (
    select
      count(*) filter (where status in ('booked', 'offered', 'waitlist', 'attended', 'no_show'))::integer as active,
      count(*) filter (where status in ('booked', 'offered', 'attended', 'no_show'))::integer as seats,
      count(*) filter (where status = 'waitlist')::integer as waitlist
    from public.lesson_bookings
    where slot_id = p_slot_id
  ) c
  where s.id = p_slot_id
    and (s.booked_count, s.seats_taken, s.waitlist_count) is distinct from (c.active, c.seats, c.waitlist);
$$;

create or replace function public.refresh_lesson_slot_booked_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'DELETE' then
    perform public._lesson_refresh_slot_counts(new.slot_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.slot_id is distinct from new.slot_id) then
    perform public._lesson_refresh_slot_counts(old.slot_id);
  end if;
  return coalesce(new, old);
end;
$$;

update public.lesson_slots s
set booked_count = coalesce(c.active, 0),
    seats_taken = coalesce(c.seats, 0),
    waitlist_count = coalesce(c.waitlist, 0)
from public.lesson_slots s2
left join (
  select
    slot_id,
    count(*) filter (where status in ('booked', 'offered', 'waitlist', 'attended', 'no_show'))::integer as active,
    count(*) filter (where status in ('booked', 'offered', 'attended', 'no_show'))::integer as seats,
    count(*) filter (where status = 'waitlist')::integer as waitlist
  from public.lesson_bookings
  group by slot_id
) c on c.slot_id = s2.id
where s.id = s2.id;

-- ---------- 10. settings + notifications ----------
create or replace function public._lesson_settings(p_club uuid)
returns public.lesson_booking_settings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.lesson_booking_settings;
begin
  select * into v from public.lesson_booking_settings where club_id = p_club;
  if v.club_id is null then
    v.club_id := p_club;
    v.max_bookings_per_member := 0;
    v.cancel_cutoff_hours := 0;
    v.announcement_version := 0;
    v.announcement_title := '';
    v.announcement_body := '';
    v.change_cutoff_hours := 12;
    v.offer_window_hours := 2;
    v.offer_instant_hours := 3;
    v.no_show_limit := 2;
    v.no_show_window_days := 30;
    v.no_show_block_days := 7;
    v.credit_expiry_warning_days := 7;
    v.employee_priority_days := 2;
    v.reminder_hours := 24;
    v.max_bookings_per_week := 0;
    v.auto_no_show := true;
  end if;
  return v;
end;
$$;

-- One in-app notification row (channel 'system', shown in the member inbox).
create or replace function public._lesson_notify(
  p_club uuid,
  p_member uuid,
  p_type text,
  p_subject text,
  p_body text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_member is null then
    return;
  end if;
  insert into public.member_notifications (
    club_id, member_id, channel, notification_type, recipient, subject, body, status, metadata, created_by
  ) values (
    p_club, p_member, 'system', p_type, null, p_subject, p_body, 'queued',
    jsonb_build_object('link', '/member#lessons') || coalesce(p_metadata, '{}'::jsonb),
    auth.uid()
  );
end;
$$;

-- ---------- 11. credits ----------
-- Usable enrollment for one lesson: active, covers the course (or any course), still valid at the
-- lesson start, credits left. Soonest expiry first; course-specific before any-course on a tie.
-- Locks the candidate rows so two bookings cannot spend the same credit.
create or replace function public._lesson_pick_enrollment(
  p_member_id uuid,
  p_program_id uuid,
  p_club_id uuid,
  p_lesson_start timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_remaining integer;
begin
  for v_id in
    select e.id
    from public.lesson_enrollments e
    where e.member_id = p_member_id
      and e.club_id = p_club_id
      and e.status = 'active'
      and e.expires_at > greatest(now(), p_lesson_start)
      and (e.program_id is null or e.program_id = p_program_id)
    order by e.expires_at, (e.program_id is null), e.created_at, e.id
    for update
  loop
    select coalesce(sum(delta), 0) into v_remaining
    from public.lesson_credit_txns
    where enrollment_id = v_id;
    if v_remaining > 0 then
      return v_id;
    end if;
  end loop;
  return null;
end;
$$;

-- Credit currently held by a booking (net deduction), per enrollment.
create or replace function public._lesson_booking_credit_hold(p_booking_id uuid)
returns table (enrollment_id uuid, held integer)
language sql
stable
security definer
set search_path = public
as $$
  select t.enrollment_id, (-sum(t.delta))::integer
  from public.lesson_credit_txns t
  where t.booking_id = p_booking_id
  group by t.enrollment_id
  having sum(t.delta) < 0;
$$;

create or replace function public._lesson_enrollment_balance(p_enrollment_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta), 0)::integer from public.lesson_credit_txns where enrollment_id = p_enrollment_id;
$$;

-- Bring a booking's credit in line with its status and slot (see header).
create or replace function public._lesson_settle_credit(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.lesson_bookings;
  v_slot public.lesson_slots;
  v_requires boolean;
  v_start timestamptz;
  v_hold_enrollment uuid;
  v_held integer;
  v_covers boolean;
  v_pick uuid;
begin
  select * into v_booking from public.lesson_bookings where id = p_booking_id;
  if v_booking.id is null or v_booking.status in ('attended', 'no_show', 'late_cancelled') then
    return;
  end if;

  select * into v_slot from public.lesson_slots where id = v_booking.slot_id;
  select coalesce(p.requires_package, false) into v_requires
  from public.lesson_programs p where p.id = v_slot.program_id;
  v_requires := coalesce(v_requires, false);
  v_start := public._lesson_slot_start(v_slot.lesson_date, v_slot.start_time);

  select h.enrollment_id, h.held into v_hold_enrollment, v_held
  from public._lesson_booking_credit_hold(v_booking.id) h
  limit 1;

  if v_booking.status = 'booked' and v_requires then
    if v_hold_enrollment is not null then
      select (e.program_id is null or e.program_id = v_slot.program_id) and e.expires_at > v_start
      into v_covers
      from public.lesson_enrollments e
      where e.id = v_hold_enrollment;
      if coalesce(v_covers, false) then
        return;
      end if;
      insert into public.lesson_credit_txns (club_id, enrollment_id, member_id, delta, reason, booking_id, note, created_by)
      values (v_booking.club_id, v_hold_enrollment, v_booking.member_id, v_held, 'refund', v_booking.id,
              'ย้ายไปรอบที่ใช้เครดิตนี้ไม่ได้', auth.uid());
    end if;

    v_pick := public._lesson_pick_enrollment(v_booking.member_id, v_slot.program_id, v_slot.club_id, v_start);
    if v_pick is null then
      raise exception 'NO_CREDIT' using errcode = 'P0001';
    end if;
    insert into public.lesson_credit_txns (club_id, enrollment_id, member_id, delta, reason, booking_id, created_by)
    values (v_booking.club_id, v_pick, v_booking.member_id, -1, 'booking', v_booking.id, auth.uid());
    return;
  end if;

  -- waitlist / offered / cancelled / closed, or a booking in a course without packages
  if v_hold_enrollment is not null then
    insert into public.lesson_credit_txns (club_id, enrollment_id, member_id, delta, reason, booking_id, created_by)
    values (v_booking.club_id, v_hold_enrollment, v_booking.member_id, v_held,
            case when v_booking.status = 'closed' then 'closure' else 'refund' end,
            v_booking.id, auth.uid());
  end if;
end;
$$;

create or replace function public.lesson_booking_credit_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.slot_id is not distinct from new.slot_id then
    return null;
  end if;
  perform public._lesson_settle_credit(new.id);
  return null;
end;
$$;

drop trigger if exists lesson_booking_credit_sync on public.lesson_bookings;
create trigger lesson_booking_credit_sync
after insert or update of status, slot_id on public.lesson_bookings
for each row execute function public.lesson_booking_credit_sync();

-- ---------- 12. capacity (seats and waitlist counted separately) ----------
create or replace function public.enforce_lesson_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.lesson_slots;
  v_count integer;
  v_moved boolean;
begin
  v_moved := tg_op = 'INSERT' or new.slot_id is distinct from old.slot_id;

  if new.status in ('booked', 'offered')
     and (v_moved or not public._lesson_seat_status(old.status)) then
    select * into v_slot from public.lesson_slots where id = new.slot_id for update;
    select count(*)::integer into v_count
    from public.lesson_bookings
    where slot_id = new.slot_id
      and public._lesson_seat_status(status)
      and id <> new.id;
    if v_count >= v_slot.capacity then
      raise exception 'lesson_slot_full' using errcode = 'P0001';
    end if;
  elsif new.status = 'waitlist' and (v_moved or old.status is distinct from 'waitlist') then
    select * into v_slot from public.lesson_slots where id = new.slot_id for update;
    select count(*)::integer into v_count
    from public.lesson_bookings
    where slot_id = new.slot_id
      and status = 'waitlist'
      and id <> new.id;
    if v_count >= v_slot.waitlist_capacity then
      raise exception 'lesson_slot_full' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Position shown to members: seat holders 1..capacity, waitlist capacity+1.. (unchanged meaning
-- for queueStatus() in src/lib/lessons/booking.ts).
create or replace function public._lesson_queue_position(p_booking_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._lesson_seat_status(me.status) then (
      select count(*)::integer from public.lesson_bookings b
      where b.slot_id = me.slot_id and public._lesson_seat_status(b.status) and b.queue_seq <= me.queue_seq
    )
    when me.status = 'waitlist' then s.capacity + (
      select count(*)::integer from public.lesson_bookings b
      where b.slot_id = me.slot_id and b.status = 'waitlist' and b.queue_seq <= me.queue_seq
    )
  end
  from public.lesson_bookings me
  join public.lesson_slots s on s.id = me.slot_id
  where me.id = p_booking_id;
$$;

-- ---------- 13. waitlist offers ----------
-- Give free seats of a slot to the waitlist (FCFS by queue_seq). Returns how many moved up.
create or replace function public._lesson_fill_seats(p_slot_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.lesson_slots;
  v_settings public.lesson_booking_settings;
  v_start timestamptz;
  v_requires boolean;
  v_taken integer;
  v_booking_id uuid;
  v_member_id uuid;
  v_instant boolean;
  v_expires timestamptz;
  v_count integer := 0;
begin
  select * into v_slot from public.lesson_slots where id = p_slot_id for update;
  if v_slot.id is null or v_slot.status <> 'open' or v_slot.archived_at is not null then
    return 0;
  end if;
  v_start := public._lesson_slot_start(v_slot.lesson_date, v_slot.start_time);
  if v_start <= now() then
    return 0;
  end if;
  v_settings := public._lesson_settings(v_slot.club_id);
  select coalesce(p.requires_package, false) into v_requires
  from public.lesson_programs p where p.id = v_slot.program_id;
  v_requires := coalesce(v_requires, false);

  loop
    select count(*)::integer into v_taken
    from public.lesson_bookings
    where slot_id = v_slot.id and public._lesson_seat_status(status);
    exit when v_taken >= v_slot.capacity;

    select b.id, b.member_id into v_booking_id, v_member_id
    from public.lesson_bookings b
    where b.slot_id = v_slot.id and b.status = 'waitlist'
    order by b.queue_seq
    limit 1
    for update;
    exit when not found;

    v_instant := v_settings.offer_window_hours = 0
      or v_start - now() <= make_interval(hours => v_settings.offer_instant_hours);

    if v_instant and (
      not v_requires
      or public._lesson_pick_enrollment(v_member_id, v_slot.program_id, v_slot.club_id, v_start) is not null
    ) then
      update public.lesson_bookings
      set status = 'booked',
          offered_at = now(),
          offer_expires_at = null,
          updated_by = coalesce(auth.uid(), updated_by)
      where id = v_booking_id;

      perform public._lesson_notify(
        v_slot.club_id, v_member_id, 'lesson_offer',
        'ได้ที่นั่งเรียนแล้ว: ' || v_slot.title,
        'คุณได้ที่นั่งจากคิวสำรอง รอบ ' || public._lesson_slot_label(v_slot) ||
          case when v_requires then ' (ใช้เครดิต 1 ครั้ง)' else '' end,
        jsonb_build_object('booking_id', v_booking_id, 'slot_id', v_slot.id, 'trigger', 'lesson.waitlist_promoted')
      );
    else
      v_expires := least(now() + make_interval(hours => greatest(v_settings.offer_window_hours, 1)), v_start);
      update public.lesson_bookings
      set status = 'offered',
          offered_at = now(),
          offer_expires_at = v_expires,
          offer_count = offer_count + 1,
          updated_by = coalesce(auth.uid(), updated_by)
      where id = v_booking_id;

      perform public._lesson_notify(
        v_slot.club_id, v_member_id, 'lesson_offer',
        'มีที่ว่างให้คุณ: ' || v_slot.title,
        'รอบ ' || public._lesson_slot_label(v_slot) || ' มีที่ว่างจากคิวสำรอง กรุณากดยืนยันภายใน ' ||
          public._lesson_th_datetime(v_expires) || ' หากไม่ยืนยัน ที่นั่งจะส่งต่อให้คนถัดไป',
        jsonb_build_object('booking_id', v_booking_id, 'slot_id', v_slot.id, 'offer_expires_at', v_expires,
                           'trigger', 'lesson.offer')
      );
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- An offer that ran out: back to the end of the queue, or out of the queue when it already had
-- its second chance, the waitlist is full or the lesson has started. Returns 'requeued' /
-- 'dropped' / null (nothing to do). Lock order: slot, then booking.
create or replace function public._lesson_expire_offer(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
  v_slot public.lesson_slots;
  v_booking public.lesson_bookings;
  v_waitlist integer;
  v_drop boolean;
begin
  select slot_id into v_slot_id from public.lesson_bookings where id = p_booking_id;
  if v_slot_id is null then
    return null;
  end if;
  select * into v_slot from public.lesson_slots where id = v_slot_id for update;
  select * into v_booking from public.lesson_bookings where id = p_booking_id for update;
  if v_booking.status is distinct from 'offered'
     or v_booking.slot_id <> v_slot_id
     or v_booking.offer_expires_at > now() then
    return null;
  end if;

  select count(*)::integer into v_waitlist
  from public.lesson_bookings where slot_id = v_slot.id and status = 'waitlist';

  v_drop := v_booking.offer_count >= 2
    or v_waitlist >= v_slot.waitlist_capacity
    or v_slot.status <> 'open'
    or v_slot.archived_at is not null
    or public._lesson_slot_start(v_slot.lesson_date, v_slot.start_time) <= now();

  -- notify first, so the inbox reads in order when the seat is re-offered right away
  perform public._lesson_notify(
    v_booking.club_id, v_booking.member_id, 'lesson_offer',
    'หมดเวลายืนยันที่ว่าง: ' || v_slot.title,
    'คุณไม่ได้ยืนยันที่ว่างรอบ ' || public._lesson_slot_label(v_slot) || ' ภายในเวลา ' ||
      case when v_drop then 'จึงออกจากคิวสำรองของรอบนี้' else 'จึงกลับไปต่อท้ายคิวสำรอง' end,
    jsonb_build_object('booking_id', v_booking.id, 'slot_id', v_slot.id,
                       'trigger', case when v_drop then 'lesson.offer_dropped' else 'lesson.offer_requeued' end)
  );

  if v_drop then
    update public.lesson_bookings
    set status = 'cancelled',
        cancelled_at = now(),
        offer_expires_at = null,
        attendance_note = coalesce(attendance_note, 'ไม่ยืนยันที่ว่างภายในเวลา'),
        updated_by = coalesce(auth.uid(), updated_by)
    where id = v_booking.id;
    return 'dropped';
  end if;

  update public.lesson_bookings
  set status = 'waitlist',
      queue_seq = default,
      offer_expires_at = null,
      updated_by = coalesce(auth.uid(), updated_by)
  where id = v_booking.id;
  return 'requeued';
end;
$$;

create or replace function public._lesson_expire_slot_offers(p_slot_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.lesson_bookings
    where slot_id = p_slot_id and status = 'offered' and offer_expires_at <= now()
    order by offer_expires_at, queue_seq
  loop
    if public._lesson_expire_offer(v_id) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- A seat left slot X (cancel, late cancel, closure, move, expired offer): offer it to the queue.
create or replace function public.lesson_booking_seat_released()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._lesson_seat_status(old.status)
     and (new.slot_id is distinct from old.slot_id or not public._lesson_seat_status(new.status)) then
    perform public._lesson_fill_seats(old.slot_id);
  end if;
  return null;
end;
$$;

-- Slot changes made by staff: cancelled -> its active bookings are cancelled (or 'closed' when the
-- club closed the day) and credits come back; capacity raised or slot (re)opened -> fill seats.
create or replace function public.lesson_slot_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if new.closure_id is not null then
      -- close_lesson_day sends one notification per member itself
      update public.lesson_bookings
      set status = 'closed',
          cancelled_at = now(),
          offer_expires_at = null,
          attendance_note = coalesce(attendance_note, 'ชมรมงดเรียน'),
          updated_by = coalesce(auth.uid(), updated_by)
      where slot_id = new.id and status in ('booked', 'waitlist', 'offered');
    else
      for v_row in
        select id, member_id from public.lesson_bookings
        where slot_id = new.id and status in ('booked', 'waitlist', 'offered')
      loop
        perform public._lesson_notify(
          new.club_id, v_row.member_id, 'lesson_update',
          'ยกเลิกรอบเรียน: ' || new.title,
          'ชมรมขอแจ้งยกเลิกรอบเรียน ' || public._lesson_slot_label(new) ||
            ' การจองของคุณถูกยกเลิกแล้ว (ถ้าใช้เครดิตไว้ได้คืนแล้ว) เลือกจองรอบอื่นได้',
          jsonb_build_object('booking_id', v_row.id, 'slot_id', new.id, 'trigger', 'lesson.slot_cancelled')
        );
      end loop;
      update public.lesson_bookings
      set status = 'cancelled',
          cancelled_at = now(),
          offer_expires_at = null,
          attendance_note = coalesce(attendance_note, 'ชมรมยกเลิกรอบเรียน'),
          updated_by = coalesce(auth.uid(), updated_by)
      where slot_id = new.id and status in ('booked', 'waitlist', 'offered');
    end if;
    return null;
  end if;

  if new.status = 'open' and new.archived_at is null
     and (new.capacity > old.capacity or old.status is distinct from 'open') then
    perform public._lesson_fill_seats(new.id);
  end if;
  return null;
end;
$$;

-- ---------- 14. booking rules ----------
create or replace function public._lesson_no_show_block_until(
  p_member_id uuid,
  p_settings public.lesson_booking_settings
)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(p_settings.no_show_limit, 0) > 0 and count(*) >= p_settings.no_show_limit
      then max(public._lesson_slot_start(s.lesson_date, s.start_time))
           + make_interval(days => coalesce(p_settings.no_show_block_days, 0))
  end
  from public.lesson_bookings b
  join public.lesson_slots s on s.id = b.slot_id
  where b.member_id = p_member_id
    and b.status = 'no_show'
    and public._lesson_slot_start(s.lesson_date, s.start_time)
        > now() - make_interval(days => coalesce(p_settings.no_show_window_days, 30));
$$;

-- Shared checks for booking into p_slot (book, change). p_exclude_booking = the caller's own
-- booking that is being moved. Raises the error codes listed in src/lib/lessons/errors.ts.
create or replace function public._lesson_booking_checks(
  p_member public.members,
  p_slot public.lesson_slots,
  p_settings public.lesson_booking_settings,
  p_exclude_booking uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_open timestamptz;
  v_start timestamptz;
  v_block timestamptz;
  v_requires boolean;
begin
  v_open := p_settings.booking_open_at;
  if v_open is null then
    raise exception 'NOT_OPEN';
  end if;
  if now() < v_open then
    -- PEA employees (matched to the association directory) may book N days earlier
    if coalesce(p_settings.employee_priority_days, 0) > 0
       and now() >= v_open - make_interval(days => p_settings.employee_priority_days) then
      if coalesce(p_member.employee_match_status, '') <> 'matched' then
        raise exception 'PRIORITY_WINDOW';
      end if;
    else
      raise exception 'NOT_OPEN';
    end if;
  end if;
  if p_settings.booking_close_at is not null and now() > p_settings.booking_close_at then
    raise exception 'CLOSED';
  end if;
  if p_settings.announcement_version > 0
     and (p_settings.announcement_title <> '' or p_settings.announcement_body <> '')
     and p_member.lesson_announcement_ack_version < p_settings.announcement_version then
    raise exception 'ANNOUNCEMENT';
  end if;
  if p_slot.id is null or p_slot.archived_at is not null then
    raise exception 'NO_SESSION';
  end if;
  if p_slot.status <> 'open' then
    raise exception 'SESSION_CLOSED';
  end if;
  if not (
    _lesson_target_match(p_slot.target_work_lines, p_member.work_line)
    and _lesson_target_match(p_slot.target_bureaus, p_member.bureau)
    and _lesson_target_match(p_slot.target_divisions, p_member.division)
    and _lesson_target_match(p_slot.target_departments, p_member.department)
    and _lesson_target_match(p_slot.target_sections, p_member.section)
  ) then
    raise exception 'NOT_TARGETED';
  end if;
  v_start := _lesson_slot_start(p_slot.lesson_date, p_slot.start_time);
  if v_start <= now() then
    raise exception 'STARTED';
  end if;
  if exists (
    select 1 from public.lesson_bookings b
    where b.slot_id = p_slot.id
      and b.member_id = p_member.id
      and b.status in ('booked', 'waitlist', 'offered', 'attended', 'no_show')
      and (p_exclude_booking is null or b.id <> p_exclude_booking)
  ) then
    raise exception 'DUPLICATE';
  end if;

  v_block := public._lesson_no_show_block_until(p_member.id, p_settings);
  if v_block is not null and v_block > now() then
    raise exception 'NO_SHOW_BLOCKED' using detail = to_char(v_block at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI');
  end if;

  if p_settings.max_bookings_per_member > 0 then
    select count(*)::integer into v_count
    from public.lesson_bookings b
    join public.lesson_slots s on s.id = b.slot_id
    where b.member_id = p_member.id
      and b.status in ('booked', 'waitlist', 'offered')
      and (p_exclude_booking is null or b.id <> p_exclude_booking)
      and _lesson_slot_start(s.lesson_date, s.start_time) > now();
    if v_count >= p_settings.max_bookings_per_member then
      raise exception 'LIMIT';
    end if;
  end if;

  if coalesce(p_settings.max_bookings_per_week, 0) > 0 then
    select count(*)::integer into v_count
    from public.lesson_bookings b
    join public.lesson_slots s on s.id = b.slot_id
    where b.member_id = p_member.id
      and b.status in ('booked', 'waitlist', 'offered', 'attended', 'no_show')
      and (p_exclude_booking is null or b.id <> p_exclude_booking)
      and date_trunc('week', s.lesson_date::timestamp) = date_trunc('week', p_slot.lesson_date::timestamp);
    if v_count >= p_settings.max_bookings_per_week then
      raise exception 'WEEK_LIMIT';
    end if;
  end if;

  if exists (
    select 1 from public.lesson_bookings b
    join public.lesson_slots s on s.id = b.slot_id
    where b.member_id = p_member.id
      and b.status in ('booked', 'waitlist', 'offered', 'attended', 'no_show')
      and (p_exclude_booking is null or b.id <> p_exclude_booking)
      and s.lesson_date = p_slot.lesson_date
      and s.start_time < p_slot.end_time
      and p_slot.start_time < s.end_time
  ) then
    raise exception 'OVERLAP';
  end if;

  -- a moved booking may keep the credit it already holds; the credit trigger re-checks it
  if p_exclude_booking is null then
    select coalesce(p.requires_package, false) into v_requires
    from public.lesson_programs p where p.id = p_slot.program_id;
    if coalesce(v_requires, false)
       and public._lesson_pick_enrollment(p_member.id, p_slot.program_id, p_slot.club_id, v_start) is null then
      raise exception 'NO_CREDIT';
    end if;
  end if;

  select count(*)::integer into v_count
  from public.lesson_bookings b
  where b.slot_id = p_slot.id
    and public._lesson_seat_status(b.status)
    and (p_exclude_booking is null or b.id <> p_exclude_booking);
  if v_count >= p_slot.capacity then
    select count(*)::integer into v_count
    from public.lesson_bookings b
    where b.slot_id = p_slot.id
      and b.status = 'waitlist'
      and (p_exclude_booking is null or b.id <> p_exclude_booking);
    if v_count >= p_slot.waitlist_capacity then
      raise exception 'FULL';
    end if;
  end if;
end;
$$;

-- ---------- 15. member RPCs (existing names kept) ----------
-- FCFS: slot row lock serializes bookers of one slot; member row lock serializes one person's
-- parallel clicks; the credit is taken by the trigger inside the same transaction.
create or replace function public.book_lesson_slot(p_slot_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.lesson_slots;
  v_member public.members;
  v_settings public.lesson_booking_settings;
  v_booking_id uuid;
  v_position integer;
  v_taken integer;
  v_status text;
  v_enrollment uuid;
begin
  select * into v_slot from public.lesson_slots where id = p_slot_id for update;
  if v_slot.id is null then
    raise exception 'NO_SESSION';
  end if;
  v_member := _lesson_current_member(v_slot.club_id);
  perform 1 from public.members where id = v_member.id for update;
  v_settings := _lesson_settings(v_slot.club_id);

  perform public._lesson_expire_slot_offers(v_slot.id);
  perform _lesson_booking_checks(v_member, v_slot, v_settings, null);

  select count(*)::integer into v_taken
  from public.lesson_bookings
  where slot_id = v_slot.id and public._lesson_seat_status(status);
  v_status := case when v_taken < v_slot.capacity then 'booked' else 'waitlist' end;

  insert into public.lesson_bookings (club_id, slot_id, member_id, status, created_by, updated_by)
  values (v_slot.club_id, v_slot.id, v_member.id, v_status, auth.uid(), auth.uid())
  returning id into v_booking_id;

  v_position := _lesson_queue_position(v_booking_id);
  select h.enrollment_id into v_enrollment from public._lesson_booking_credit_hold(v_booking_id) h limit 1;
  return json_build_object(
    'booking_id', v_booking_id,
    'position', v_position,
    'capacity', v_slot.capacity,
    'waitlisted', v_status = 'waitlist',
    'status', v_status,
    'enrollment_id', v_enrollment,
    'credits_remaining', case when v_enrollment is not null then public._lesson_enrollment_balance(v_enrollment) end
  );
end;
$$;

-- Move own booking to another slot. Seat holders keep their credit; the mover goes to the back of
-- the new queue (seat if one is free, otherwise the waitlist). Seat holders respect the change
-- cutoff; waitlisted / offered bookings can move until the lesson starts.
create or replace function public.change_lesson_booking(p_booking_id uuid, p_slot_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.lesson_bookings;
  v_from public.lesson_slots;
  v_slot public.lesson_slots;
  v_member public.members;
  v_settings public.lesson_booking_settings;
  v_position integer;
  v_taken integer;
  v_status text;
begin
  select * into v_booking from public.lesson_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'NO_BOOKING';
  end if;
  perform 1 from public.lesson_slots where id in (v_booking.slot_id, p_slot_id) order by id for update;

  select * into v_slot from public.lesson_slots where id = p_slot_id;
  if v_slot.id is null then
    raise exception 'NO_SESSION';
  end if;
  v_member := _lesson_current_member(v_slot.club_id);
  perform 1 from public.members where id = v_member.id for update;

  select * into v_booking from public.lesson_bookings
  where id = p_booking_id and member_id = v_member.id and club_id = v_slot.club_id
  for update;
  if v_booking.id is null or v_booking.status not in ('booked', 'waitlist', 'offered') then
    raise exception 'NO_BOOKING';
  end if;
  if v_booking.slot_id = p_slot_id then
    raise exception 'DUPLICATE';
  end if;

  select * into v_from from public.lesson_slots where id = v_booking.slot_id for update;
  v_settings := _lesson_settings(v_slot.club_id);
  if v_booking.status = 'booked' then
    if not coalesce(v_from.allow_member_reschedule, true) then
      raise exception 'CHANGE_CLOSED';
    end if;
    if now() > _lesson_slot_start(v_from.lesson_date, v_from.start_time)
              - make_interval(hours => coalesce(v_from.reschedule_cutoff_hours, v_settings.change_cutoff_hours, 12)) then
      raise exception 'CHANGE_CLOSED';
    end if;
  end if;

  perform public._lesson_expire_slot_offers(v_slot.id);
  perform _lesson_booking_checks(v_member, v_slot, v_settings, v_booking.id);

  select count(*)::integer into v_taken
  from public.lesson_bookings
  where slot_id = v_slot.id and public._lesson_seat_status(status) and id <> v_booking.id;
  v_status := case when v_taken < v_slot.capacity then 'booked' else 'waitlist' end;

  update public.lesson_bookings
  set slot_id = v_slot.id,
      queue_seq = default,
      status = v_status,
      offered_at = null,
      offer_expires_at = null,
      offer_count = 0,
      attendance_note = null,
      checked_in_at = null,
      reminder_sent_at = null,
      updated_by = auth.uid()
  where id = v_booking.id;

  insert into public.lesson_booking_change_requests
    (booking_id, club_id, member_id, from_slot_id, to_slot_id, request_type, status,
     decided_at, decided_by, created_by, updated_by)
  values
    (v_booking.id, v_slot.club_id, v_member.id, v_booking.slot_id, v_slot.id, 'member_reschedule',
     'approved', now(), auth.uid(), auth.uid(), auth.uid());

  v_position := _lesson_queue_position(v_booking.id);
  return json_build_object(
    'booking_id', v_booking.id,
    'position', v_position,
    'capacity', v_slot.capacity,
    'waitlisted', v_status = 'waitlist',
    'status', v_status
  );
end;
$$;

-- Cancel own booking. Before the cutoff -> 'cancelled' (credit back). After the cutoff a seat
-- holder gets CANCEL_LOCKED unless p_accept_late = true -> 'late_cancelled' (credit kept).
-- Waitlisted / offered bookings can always cancel (before the start).
drop function if exists public.cancel_lesson_booking(uuid);
create or replace function public.cancel_lesson_booking(p_booking_id uuid, p_accept_late boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.lesson_bookings;
  v_slot public.lesson_slots;
  v_settings public.lesson_booking_settings;
  v_position integer;
  v_late boolean;
  v_status text;
  v_held_before integer;
  v_held_after integer;
begin
  select * into v_booking from public.lesson_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'NO_BOOKING';
  end if;
  select * into v_slot from public.lesson_slots where id = v_booking.slot_id for update;
  select * into v_booking from public.lesson_bookings where id = p_booking_id for update;
  if not exists (
    select 1 from public.members m
    where m.id = v_booking.member_id and m.user_id = auth.uid()
  ) then
    raise exception 'NO_BOOKING';
  end if;
  if v_booking.status not in ('booked', 'waitlist', 'offered') then
    raise exception 'NO_BOOKING';
  end if;
  if _lesson_slot_start(v_slot.lesson_date, v_slot.start_time) <= now() then
    raise exception 'STARTED';
  end if;

  v_settings := _lesson_settings(v_booking.club_id);
  v_late := v_booking.status = 'booked'
    and now() > _lesson_slot_start(v_slot.lesson_date, v_slot.start_time)
                - make_interval(hours => v_settings.cancel_cutoff_hours);
  if v_late and not coalesce(p_accept_late, false) then
    raise exception 'CANCEL_LOCKED';
  end if;

  v_position := _lesson_queue_position(v_booking.id);
  select coalesce(sum(h.held), 0)::integer into v_held_before from public._lesson_booking_credit_hold(v_booking.id) h;
  v_status := case when v_late then 'late_cancelled' else 'cancelled' end;

  update public.lesson_bookings
  set status = v_status,
      cancelled_at = now(),
      offer_expires_at = null,
      updated_by = auth.uid()
  where id = v_booking.id;

  select coalesce(sum(h.held), 0)::integer into v_held_after from public._lesson_booking_credit_hold(v_booking.id) h;
  return json_build_object(
    'booking_id', v_booking.id,
    'slot_id', v_booking.slot_id,
    'position', v_position,
    'status', v_status,
    'late', v_late,
    'credit_refunded', v_held_before - v_held_after
  );
end;
$$;

-- Accept a waitlist offer: the seat becomes 'booked' and the credit is taken.
create or replace function public.confirm_lesson_offer(p_booking_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.lesson_bookings;
  v_slot public.lesson_slots;
  v_member public.members;
  v_settings public.lesson_booking_settings;
  v_block timestamptz;
  v_enrollment uuid;
begin
  select * into v_booking from public.lesson_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'NO_BOOKING';
  end if;
  select * into v_slot from public.lesson_slots where id = v_booking.slot_id for update;
  v_member := _lesson_current_member(v_slot.club_id);
  perform 1 from public.members where id = v_member.id for update;
  select * into v_booking from public.lesson_bookings where id = p_booking_id for update;
  if v_booking.member_id <> v_member.id then
    raise exception 'NO_BOOKING';
  end if;

  if v_booking.status = 'booked' then
    return json_build_object('booking_id', v_booking.id, 'slot_id', v_slot.id, 'status', 'booked',
                             'already', true, 'position', _lesson_queue_position(v_booking.id),
                             'capacity', v_slot.capacity, 'waitlisted', false);
  end if;
  if v_booking.status <> 'offered' then
    raise exception 'NO_OFFER';
  end if;
  if v_booking.offer_expires_at <= now() then
    raise exception 'OFFER_EXPIRED';
  end if;
  if _lesson_slot_start(v_slot.lesson_date, v_slot.start_time) <= now() then
    raise exception 'STARTED';
  end if;
  if v_slot.archived_at is not null or v_slot.status not in ('open', 'closed') then
    raise exception 'SESSION_CLOSED';
  end if;
  v_settings := _lesson_settings(v_slot.club_id);
  v_block := public._lesson_no_show_block_until(v_member.id, v_settings);
  if v_block is not null and v_block > now() then
    raise exception 'NO_SHOW_BLOCKED' using detail = to_char(v_block at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI');
  end if;

  update public.lesson_bookings
  set status = 'booked',
      offer_expires_at = null,
      updated_by = auth.uid()
  where id = v_booking.id;

  select h.enrollment_id into v_enrollment from public._lesson_booking_credit_hold(v_booking.id) h limit 1;
  return json_build_object(
    'booking_id', v_booking.id,
    'slot_id', v_slot.id,
    'status', 'booked',
    'already', false,
    'position', _lesson_queue_position(v_booking.id),
    'capacity', v_slot.capacity,
    'waitlisted', false,
    'enrollment_id', v_enrollment,
    'credits_remaining', case when v_enrollment is not null then public._lesson_enrollment_balance(v_enrollment) end
  );
end;
$$;

-- Expire offers whose time is up (cron: all clubs; staff or members: their club).
create or replace function public.expire_lesson_offers(p_club_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_result text;
  v_requeued integer := 0;
  v_dropped integer := 0;
begin
  if auth.uid() is not null then
    if p_club_id is null then
      raise exception 'CLUB_REQUIRED';
    end if;
    if not (public._lesson_can_view(p_club_id) or public._lesson_is_member_of(p_club_id)
            or public._lesson_is_coach_user(p_club_id)) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  for v_id in
    select id from public.lesson_bookings
    where status = 'offered'
      and offer_expires_at <= now()
      and (p_club_id is null or club_id = p_club_id)
    order by offer_expires_at, queue_seq
  loop
    v_result := public._lesson_expire_offer(v_id);
    if v_result = 'requeued' then
      v_requeued := v_requeued + 1;
    elsif v_result = 'dropped' then
      v_dropped := v_dropped + 1;
    end if;
  end loop;
  return json_build_object('expired', v_requeued + v_dropped, 'requeued', v_requeued, 'dropped', v_dropped);
end;
$$;

-- Caller's bookings with queue position, status, offer deadline and the enrollment that paid.
drop function if exists public.my_lesson_bookings();
create function public.my_lesson_bookings()
returns table (
  booking_id uuid,
  slot_id uuid,
  queue_position integer,
  capacity integer,
  waitlist_capacity integer,
  status text,
  offer_expires_at timestamptz,
  credit_enrollment_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.slot_id,
    case
      when public._lesson_seat_status(b.status) then (
        select count(*)::integer from public.lesson_bookings o
        where o.slot_id = b.slot_id and public._lesson_seat_status(o.status) and o.queue_seq <= b.queue_seq
      )
      when b.status = 'waitlist' then s.capacity + (
        select count(*)::integer from public.lesson_bookings o
        where o.slot_id = b.slot_id and o.status = 'waitlist' and o.queue_seq <= b.queue_seq
      )
    end,
    s.capacity,
    s.waitlist_capacity,
    b.status,
    b.offer_expires_at,
    (select h.enrollment_id from public._lesson_booking_credit_hold(b.id) h limit 1)
  from public.lesson_bookings b
  join public.lesson_slots s on s.id = b.slot_id
  join public.members m on m.id = b.member_id
  where m.user_id = auth.uid()
    and b.status in ('booked', 'waitlist', 'offered', 'attended', 'no_show');
$$;

-- What the member screen needs to explain the rules to this member.
create or replace function public.my_lesson_overview()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_settings public.lesson_booking_settings;
  v_employee boolean;
  v_open timestamptz;
  v_block timestamptz;
  v_no_shows integer;
  v_active integer;
  v_credits integer;
  v_next timestamptz;
  v_pending integer;
begin
  select * into v_member from public.members
  where user_id = auth.uid() and archived_at is null
  order by created_at
  limit 1;
  if v_member.id is null then
    raise exception 'NOT_MEMBER';
  end if;
  v_settings := _lesson_settings(v_member.club_id);
  v_employee := coalesce(v_member.employee_match_status, '') = 'matched';
  v_open := case
    when v_settings.booking_open_at is null then null
    when v_employee then v_settings.booking_open_at - make_interval(days => coalesce(v_settings.employee_priority_days, 0))
    else v_settings.booking_open_at
  end;
  v_block := public._lesson_no_show_block_until(v_member.id, v_settings);

  select count(*)::integer into v_no_shows
  from public.lesson_bookings b join public.lesson_slots s on s.id = b.slot_id
  where b.member_id = v_member.id and b.status = 'no_show'
    and _lesson_slot_start(s.lesson_date, s.start_time) > now() - make_interval(days => v_settings.no_show_window_days);

  select count(*)::integer into v_active
  from public.lesson_bookings b join public.lesson_slots s on s.id = b.slot_id
  where b.member_id = v_member.id and b.status in ('booked', 'waitlist', 'offered')
    and _lesson_slot_start(s.lesson_date, s.start_time) > now();

  select coalesce(sum(x.balance), 0)::integer, min(x.expires_at)
  into v_credits, v_next
  from (
    select e.expires_at, public._lesson_enrollment_balance(e.id) as balance
    from public.lesson_enrollments e
    where e.member_id = v_member.id and e.status = 'active' and e.expires_at > now()
  ) x
  where x.balance > 0;

  select count(*)::integer into v_pending
  from public.lesson_enrollments e
  where e.member_id = v_member.id and e.status = 'pending_payment';

  return json_build_object(
    'member_id', v_member.id,
    'club_id', v_member.club_id,
    'is_employee', v_employee,
    'booking_open_at', v_open,
    'public_booking_open_at', v_settings.booking_open_at,
    'booking_close_at', v_settings.booking_close_at,
    'blocked_until', case when v_block > now() then v_block end,
    'recent_no_shows', v_no_shows,
    'active_bookings', v_active,
    'max_active_bookings', v_settings.max_bookings_per_member,
    'credits_available', v_credits,
    'next_credit_expiry', v_next,
    'pending_packages', v_pending
  );
end;
$$;

-- ---------- 16. packages ----------
create or replace function public._lesson_activate_enrollment(p_enrollment_id uuid, p_payment_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.lesson_enrollments;
  v_expires timestamptz;
begin
  select * into v_enrollment from public.lesson_enrollments where id = p_enrollment_id for update;
  if v_enrollment.id is null or v_enrollment.status <> 'pending_payment' then
    return false;
  end if;
  v_expires := public._lesson_end_of_day(public._lesson_today() + v_enrollment.valid_days);

  update public.lesson_enrollments
  set status = 'active',
      starts_at = now(),
      expires_at = v_expires,
      payment_record_id = coalesce(p_payment_id, payment_record_id),
      updated_by = coalesce(p_actor, updated_by)
  where id = v_enrollment.id;

  if v_enrollment.credits_total > 0 then
    insert into public.lesson_credit_txns (club_id, enrollment_id, member_id, delta, reason, note, created_by)
    values (v_enrollment.club_id, v_enrollment.id, v_enrollment.member_id, v_enrollment.credits_total,
            'purchase', v_enrollment.package_name, p_actor);
  end if;

  perform public._lesson_notify(
    v_enrollment.club_id, v_enrollment.member_id, 'lesson_credit',
    'แพ็กเกจเรียนพร้อมใช้: ' || v_enrollment.package_name,
    'ได้รับเครดิตเรียน ' || v_enrollment.credits_total || ' ครั้ง ใช้ได้ถึง ' ||
      public._lesson_th_date((v_expires at time zone 'Asia/Bangkok')::date),
    jsonb_build_object('enrollment_id', v_enrollment.id, 'payment_id', p_payment_id, 'trigger', 'lesson.package_activated')
  );
  return true;
end;
$$;

-- Payment refunded (p_cancel) or approval taken back: remaining credits leave the ledger.
create or replace function public._lesson_revoke_enrollment(p_enrollment_id uuid, p_actor uuid, p_cancel boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.lesson_enrollments;
  v_remaining integer;
begin
  select * into v_enrollment from public.lesson_enrollments where id = p_enrollment_id for update;
  if v_enrollment.id is null or v_enrollment.status = 'cancelled' then
    return false;
  end if;
  if v_enrollment.status = 'pending_payment' then
    if p_cancel then
      update public.lesson_enrollments set status = 'cancelled', updated_by = coalesce(p_actor, updated_by)
      where id = v_enrollment.id;
      return true;
    end if;
    return false;
  end if;

  v_remaining := public._lesson_enrollment_balance(v_enrollment.id);
  if v_remaining > 0 then
    insert into public.lesson_credit_txns (club_id, enrollment_id, member_id, delta, reason, note, created_by)
    values (v_enrollment.club_id, v_enrollment.id, v_enrollment.member_id, -v_remaining, 'adjust',
            case when p_cancel then 'คืนเงินค่าแพ็กเกจ' else 'ยกเลิกการอนุมัติชำระเงิน' end, p_actor);
  end if;
  update public.lesson_enrollments
  set status = case when p_cancel then 'cancelled' else 'pending_payment' end,
      updated_by = coalesce(p_actor, updated_by)
  where id = v_enrollment.id;

  perform public._lesson_notify(
    v_enrollment.club_id, v_enrollment.member_id, 'lesson_credit',
    'ยกเลิกแพ็กเกจเรียน: ' || v_enrollment.package_name,
    case when p_cancel
      then 'ชมรมคืนเงินค่าแพ็กเกจแล้ว เครดิตที่เหลือ ' || greatest(v_remaining, 0) || ' ครั้งถูกยกเลิก'
      else 'การชำระเงินกลับไปรอตรวจสอบ เครดิตที่เหลือ ' || greatest(v_remaining, 0) || ' ครั้งถูกระงับไว้ก่อน'
    end,
    jsonb_build_object('enrollment_id', v_enrollment.id, 'trigger', 'lesson.package_revoked')
  );
  return true;
end;
$$;

-- payment_records (purpose 'lesson_package', reference_id = enrollment): approved -> active +
-- credits; refunded -> cancelled, remaining credits removed; approval taken back -> pending again.
create or replace function public.lesson_package_payment_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.reference_id is null then
    return null;
  end if;
  if new.status = 'approved' then
    perform public._lesson_activate_enrollment(new.reference_id, new.id, coalesce(new.reviewed_by, auth.uid()));
  elsif new.status = 'refunded' then
    perform public._lesson_revoke_enrollment(new.reference_id, coalesce(new.reviewed_by, auth.uid()), true);
  elsif tg_op = 'UPDATE' and old.status = 'approved' then
    perform public._lesson_revoke_enrollment(new.reference_id, coalesce(new.reviewed_by, auth.uid()), false);
  end if;
  return null;
end;
$$;

drop trigger if exists lesson_package_payment_status on public.payment_records;
create trigger lesson_package_payment_status
after insert or update of status on public.payment_records
for each row
when (new.purpose = 'lesson_package')
execute function public.lesson_package_payment_changed();

-- Member asks for a package: enrollment 'pending_payment' + payment_records row 'pending'
-- (the slip goes onto that payment row). Free packages activate at once. An open request for
-- the same package is returned instead of creating another one.
create or replace function public.request_lesson_package(p_package_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.lesson_packages;
  v_member public.members;
  v_enrollment uuid;
  v_payment uuid;
  v_count integer;
begin
  select * into v_package from public.lesson_packages where id = p_package_id;
  if v_package.id is null or v_package.status <> 'active' or v_package.archived_at is not null then
    raise exception 'NO_PACKAGE';
  end if;
  v_member := _lesson_current_member(v_package.club_id);
  perform 1 from public.members where id = v_member.id for update;
  if not public.club_module_enabled(v_package.club_id, 'lessons') then
    raise exception 'MODULE_DISABLED';
  end if;

  select e.id, e.payment_record_id into v_enrollment, v_payment
  from public.lesson_enrollments e
  where e.member_id = v_member.id and e.package_id = v_package.id and e.status = 'pending_payment'
  order by e.created_at desc
  limit 1;
  if v_enrollment is not null then
    return json_build_object('enrollment_id', v_enrollment, 'payment_id', v_payment, 'status', 'pending_payment',
                             'amount', v_package.price, 'package_name', v_package.name, 'existing', true);
  end if;

  if v_package.max_per_member is not null then
    select count(*)::integer into v_count
    from public.lesson_enrollments e
    where e.member_id = v_member.id and e.package_id = v_package.id and e.status in ('active', 'expired');
    if v_count >= v_package.max_per_member then
      raise exception 'PACKAGE_LIMIT';
    end if;
  end if;

  insert into public.lesson_enrollments (
    club_id, member_id, package_id, program_id, package_name, credits_total, price, valid_days,
    status, source, created_by, updated_by
  ) values (
    v_package.club_id, v_member.id, v_package.id, v_package.program_id, v_package.name, v_package.credits,
    v_package.price, v_package.valid_days, 'pending_payment',
    case when v_package.price <= 0 then 'free' else 'purchase' end, auth.uid(), auth.uid()
  )
  returning id into v_enrollment;

  if v_package.price <= 0 then
    perform public._lesson_activate_enrollment(v_enrollment, null, auth.uid());
    return json_build_object('enrollment_id', v_enrollment, 'payment_id', null, 'status', 'active',
                             'amount', 0, 'package_name', v_package.name, 'existing', false);
  end if;

  insert into public.payment_records (
    club_id, purpose, member_id, reference_id, amount, status, description, created_by, updated_by
  ) values (
    v_package.club_id, 'lesson_package', v_member.id, v_enrollment, v_package.price, 'pending',
    'แพ็กเกจเรียน: ' || v_package.name, auth.uid(), auth.uid()
  )
  returning id into v_payment;

  update public.lesson_enrollments set payment_record_id = v_payment where id = v_enrollment;

  return json_build_object('enrollment_id', v_enrollment, 'payment_id', v_payment, 'status', 'pending_payment',
                           'amount', v_package.price, 'package_name', v_package.name, 'existing', false);
end;
$$;

-- Daily: active enrollments past expires_at -> 'expired' and their unused credits leave the
-- ledger ('expired'); credits refunded into expired/cancelled enrollments are swept the same
-- way; members get one warning credit_expiry_warning_days before expiry.
create or replace function public.expire_lesson_credits()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
  v_removed integer := 0;
  v_warned integer := 0;
  v_id uuid;
  v_enrollment public.lesson_enrollments;
  v_balance integer;
  v_row record;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  update public.lesson_enrollments e
  set status = 'expired', updated_by = coalesce(auth.uid(), e.updated_by)
  where e.status = 'active'
    and e.expires_at <= now()
    and (auth.uid() is null or public._lesson_is_staff(e.club_id));
  get diagnostics v_expired = row_count;

  for v_id in
    select e.id from public.lesson_enrollments e
    where e.status in ('expired', 'cancelled')
      and (auth.uid() is null or public._lesson_is_staff(e.club_id))
      and public._lesson_enrollment_balance(e.id) > 0
  loop
    select * into v_enrollment from public.lesson_enrollments where id = v_id for update;
    v_balance := public._lesson_enrollment_balance(v_id);
    if v_balance > 0 then
      insert into public.lesson_credit_txns (club_id, enrollment_id, member_id, delta, reason, note, created_by)
      values (v_enrollment.club_id, v_id, v_enrollment.member_id, -v_balance,
              case when v_enrollment.status = 'expired' then 'expired' else 'adjust' end,
              case when v_enrollment.status = 'expired' then 'เครดิตหมดอายุ' else 'แพ็กเกจถูกยกเลิก' end,
              auth.uid());
      v_removed := v_removed + v_balance;
    end if;
  end loop;

  for v_row in
    select e.id, e.club_id, e.member_id, e.package_name, e.expires_at
    from public.lesson_enrollments e
    left join public.lesson_booking_settings st on st.club_id = e.club_id
    where e.status = 'active'
      and e.expiry_warned_at is null
      and coalesce(st.credit_expiry_warning_days, 7) > 0
      and e.expires_at > now()
      and e.expires_at <= now() + make_interval(days => coalesce(st.credit_expiry_warning_days, 7))
      and (auth.uid() is null or public._lesson_is_staff(e.club_id))
  loop
    v_balance := public._lesson_enrollment_balance(v_row.id);
    if v_balance > 0 then
      perform public._lesson_notify(
        v_row.club_id, v_row.member_id, 'lesson_credit',
        'เครดิตเรียนใกล้หมดอายุ',
        'เครดิต ' || v_row.package_name || ' เหลือ ' || v_balance || ' ครั้ง หมดอายุ ' ||
          public._lesson_th_date((v_row.expires_at at time zone 'Asia/Bangkok')::date) || ' จองรอบเรียนก่อนหมดอายุ',
        jsonb_build_object('enrollment_id', v_row.id, 'trigger', 'lesson.credit_expiring')
      );
      v_warned := v_warned + 1;
    end if;
    update public.lesson_enrollments set expiry_warned_at = now() where id = v_row.id;
  end loop;

  return json_build_object('expired', v_expired, 'credits_removed', v_removed, 'warned', v_warned);
end;
$$;

-- ---------- 17. attendance ----------
-- Member scans the QR: a slot token (shown by the coach) or a venue token (printed at the venue).
-- Allowed from 30 minutes before the start until the end of the lesson.
create or replace function public.check_in_lesson(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.lesson_checkin_tokens;
  v_member public.members;
  v_slot public.lesson_slots;
  v_booking public.lesson_bookings;
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is null then
    raise exception 'NOT_MEMBER';
  end if;
  select * into v_token from public.lesson_checkin_tokens where token = trim(coalesce(p_token, ''));
  if v_token.token is null then
    raise exception 'INVALID_TOKEN';
  end if;
  v_member := _lesson_current_member(v_token.club_id);

  if v_token.slot_id is not null then
    select * into v_booking from public.lesson_bookings
    where slot_id = v_token.slot_id and member_id = v_member.id
      and status in ('booked', 'attended')
    order by (status = 'attended') desc
    limit 1
    for update;
    if v_booking.id is null then
      raise exception 'NOT_BOOKED';
    end if;
  else
    select b.* into v_booking
    from public.lesson_bookings b
    join public.lesson_slots s on s.id = b.slot_id
    where s.venue_id = v_token.venue_id
      and b.member_id = v_member.id
      and b.status in ('booked', 'attended')
      and s.archived_at is null
      and now() between _lesson_slot_start(s.lesson_date, s.start_time) - interval '30 minutes'
                    and _lesson_slot_start(s.lesson_date, s.end_time)
    order by _lesson_slot_start(s.lesson_date, s.start_time)
    limit 1
    for update of b;
    if v_booking.id is null then
      raise exception 'NO_BOOKING_NOW';
    end if;
  end if;

  select * into v_slot from public.lesson_slots where id = v_booking.slot_id;
  if v_slot.archived_at is not null or v_slot.status = 'cancelled' then
    raise exception 'SESSION_CLOSED';
  end if;
  v_start := _lesson_slot_start(v_slot.lesson_date, v_slot.start_time);
  v_end := _lesson_slot_start(v_slot.lesson_date, v_slot.end_time);

  if v_booking.status = 'attended' then
    return json_build_object('booking_id', v_booking.id, 'slot_id', v_slot.id, 'title', v_slot.title,
                             'lesson_date', v_slot.lesson_date, 'start_time', v_slot.start_time,
                             'end_time', v_slot.end_time, 'checked_in_at', v_booking.checked_in_at, 'already', true);
  end if;
  if now() < v_start - interval '30 minutes' then
    raise exception 'TOO_EARLY' using detail = to_char(v_start at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI');
  end if;
  if now() > v_end then
    raise exception 'TOO_LATE';
  end if;

  update public.lesson_bookings
  set status = 'attended',
      checked_in_at = now(),
      attendance_note = coalesce(attendance_note, 'เช็กชื่อด้วย QR'),
      updated_by = auth.uid()
  where id = v_booking.id;

  return json_build_object('booking_id', v_booking.id, 'slot_id', v_slot.id, 'title', v_slot.title,
                           'lesson_date', v_slot.lesson_date, 'start_time', v_slot.start_time,
                           'end_time', v_slot.end_time, 'checked_in_at', now(), 'already', false);
end;
$$;

-- Coach of the slot (from 30 minutes before the start) or lesson staff (any time).
-- p_attended: true -> attended, false -> no_show, null -> back to booked (undo).
create or replace function public.mark_lesson_attendance(p_booking_id uuid, p_attended boolean, p_note text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.lesson_bookings;
  v_slot public.lesson_slots;
  v_staff boolean;
  v_coach boolean;
  v_status text;
  v_checked timestamptz;
begin
  select * into v_booking from public.lesson_bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'NO_BOOKING';
  end if;
  select * into v_slot from public.lesson_slots where id = v_booking.slot_id;
  v_staff := auth.uid() is null or public._lesson_is_staff(v_booking.club_id);
  v_coach := public._lesson_is_slot_coach(v_slot.id);
  if not (v_staff or v_coach) then
    raise exception 'FORBIDDEN';
  end if;
  if not v_staff and now() < _lesson_slot_start(v_slot.lesson_date, v_slot.start_time) - interval '30 minutes' then
    raise exception 'TOO_EARLY';
  end if;
  if v_booking.status not in ('booked', 'attended', 'no_show') then
    raise exception 'NOT_BOOKED';
  end if;

  v_status := case when p_attended is null then 'booked' when p_attended then 'attended' else 'no_show' end;
  v_checked := case when v_status = 'attended' then coalesce(v_booking.checked_in_at, now()) end;

  update public.lesson_bookings
  set status = v_status,
      checked_in_at = v_checked,
      attendance_note = coalesce(nullif(trim(p_note), ''), attendance_note),
      updated_by = coalesce(auth.uid(), updated_by)
  where id = v_booking.id;

  insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
  values (
    v_booking.club_id, auth.uid(), 'lesson_booking.attendance_marked', 'lesson_bookings', v_booking.id,
    jsonb_build_object('status', v_booking.status, 'checked_in_at', v_booking.checked_in_at),
    jsonb_build_object('status', v_status, 'checked_in_at', v_checked, 'attendance_note', nullif(trim(p_note), '')),
    jsonb_build_object('source', 'rpc.mark_lesson_attendance', 'as', case when v_staff then 'staff' else 'coach' end,
                       'slot_id', v_slot.id)
  );

  return json_build_object('booking_id', v_booking.id, 'status', v_status, 'checked_in_at', v_checked);
end;
$$;

-- Still 'booked' 30 minutes after the end -> 'no_show' (only lessons from the last
-- p_lookback_days days, so a first run never rewrites old history). Clubs can switch it off
-- with lesson_booking_settings.auto_no_show.
create or replace function public.mark_lesson_no_shows(p_lookback_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  with targets as (
    select b.id
    from public.lesson_bookings b
    join public.lesson_slots s on s.id = b.slot_id
    left join public.lesson_booking_settings st on st.club_id = b.club_id
    where b.status = 'booked'
      and s.archived_at is null
      and s.status in ('open', 'closed', 'completed')
      and coalesce(st.auto_no_show, true)
      and _lesson_slot_start(s.lesson_date, s.end_time) + interval '30 minutes' <= now()
      and s.lesson_date >= public._lesson_today() - greatest(coalesce(p_lookback_days, 7), 0)
      and (auth.uid() is null or public._lesson_is_staff(b.club_id))
    for update of b skip locked
  )
  update public.lesson_bookings b
  set status = 'no_show',
      attendance_note = coalesce(b.attendance_note, 'ไม่ได้เช็กชื่อ'),
      updated_by = coalesce(auth.uid(), b.updated_by)
  from targets t
  where t.id = b.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- QR token for a slot (coach shows it on the phone) or a venue (printed). Created on first use.
create or replace function public.lesson_checkin_token(
  p_slot_id uuid default null,
  p_venue_id uuid default null,
  p_rotate boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid;
  v_token text;
begin
  if num_nonnulls(p_slot_id, p_venue_id) <> 1 then
    raise exception 'TARGET_REQUIRED';
  end if;
  if p_slot_id is not null then
    select club_id into v_club from public.lesson_slots where id = p_slot_id;
    if v_club is null then
      raise exception 'NO_SESSION';
    end if;
    if not (auth.uid() is null or public._lesson_can_view(v_club) or public._lesson_is_slot_coach(p_slot_id)) then
      raise exception 'FORBIDDEN';
    end if;
  else
    select club_id into v_club from public.lesson_venues where id = p_venue_id;
    if v_club is null then
      raise exception 'NO_VENUE';
    end if;
    if not (auth.uid() is null or public._lesson_can_view(v_club) or public._lesson_is_coach_user(v_club)) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  if coalesce(p_rotate, false) then
    delete from public.lesson_checkin_tokens
    where (p_slot_id is not null and slot_id = p_slot_id) or (p_venue_id is not null and venue_id = p_venue_id);
  end if;

  select token into v_token from public.lesson_checkin_tokens
  where (p_slot_id is not null and slot_id = p_slot_id) or (p_venue_id is not null and venue_id = p_venue_id);
  if v_token is not null then
    return v_token;
  end if;

  insert into public.lesson_checkin_tokens (club_id, slot_id, venue_id, created_by)
  values (v_club, p_slot_id, p_venue_id, auth.uid())
  on conflict do nothing
  returning token into v_token;
  if v_token is null then
    select token into v_token from public.lesson_checkin_tokens
    where (p_slot_id is not null and slot_id = p_slot_id) or (p_venue_id is not null and venue_id = p_venue_id);
  end if;
  return v_token;
end;
$$;

-- Roster for the coach portal and the admin side panel (member name, nickname, phone, avatar).
create or replace function public.lesson_slot_roster(p_slot_id uuid)
returns table (
  booking_id uuid,
  member_id uuid,
  booking_status text,
  queue_position integer,
  booked_at timestamptz,
  checked_in_at timestamptz,
  attendance_note text,
  offer_expires_at timestamptz,
  full_name text,
  nickname text,
  phone text,
  avatar_url text,
  skill_level text,
  member_code text,
  employee_code text,
  credit_used boolean,
  last_note text,
  last_note_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_slot public.lesson_slots;
begin
  select * into v_slot from public.lesson_slots where id = p_slot_id;
  if v_slot.id is null then
    raise exception 'NO_SESSION';
  end if;
  if not (auth.uid() is null or public._lesson_can_view(v_slot.club_id) or public._lesson_is_slot_coach(v_slot.id)) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    b.id,
    b.member_id,
    b.status,
    case
      when public._lesson_seat_status(b.status) then
        (row_number() over (partition by public._lesson_seat_status(b.status) order by b.queue_seq))::integer
      when b.status = 'waitlist' then
        v_slot.capacity + (row_number() over (partition by (b.status = 'waitlist') order by b.queue_seq))::integer
    end,
    b.booked_at,
    b.checked_in_at,
    b.attendance_note,
    b.offer_expires_at,
    m.full_name,
    m.nickname,
    m.phone,
    m.avatar_url,
    m.skill_level,
    m.member_code,
    m.employee_code,
    exists (select 1 from public._lesson_booking_credit_hold(b.id)),
    n.note,
    n.created_at
  from public.lesson_bookings b
  join public.members m on m.id = b.member_id
  left join lateral (
    select cn.note, cn.created_at
    from public.lesson_coach_notes cn
    where cn.member_id = b.member_id
    order by cn.created_at desc
    limit 1
  ) n on true
  where b.slot_id = v_slot.id
  order by
    case
      when public._lesson_seat_status(b.status) then 0
      when b.status = 'waitlist' then 1
      else 2
    end,
    b.queue_seq;
end;
$$;

create or replace function public.add_lesson_coach_note(
  p_booking_id uuid,
  p_note text,
  p_skill_level text default null,
  p_video_url text default null,
  p_visible_to_member boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.lesson_bookings;
  v_slot public.lesson_slots;
  v_staff boolean;
  v_coach boolean;
  v_note_id uuid;
begin
  select * into v_booking from public.lesson_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'NO_BOOKING';
  end if;
  select * into v_slot from public.lesson_slots where id = v_booking.slot_id;
  v_staff := auth.uid() is null or public._lesson_is_staff(v_booking.club_id);
  v_coach := public._lesson_is_slot_coach(v_slot.id);
  if not (v_staff or v_coach) then
    raise exception 'FORBIDDEN';
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'NOTE_REQUIRED';
  end if;
  if p_skill_level is not null and p_skill_level not in ('beginner', 'intermediate', 'advanced') then
    raise exception 'INVALID_SKILL';
  end if;
  if nullif(trim(coalesce(p_video_url, '')), '') is not null and trim(p_video_url) !~* '^https?://' then
    raise exception 'INVALID_URL';
  end if;

  insert into public.lesson_coach_notes (
    club_id, booking_id, member_id, coach_id, note, skill_level, video_url, visible_to_member, created_by, updated_by
  ) values (
    v_booking.club_id, v_booking.id, v_booking.member_id,
    case when v_coach then public._lesson_my_coach_id(v_booking.club_id) else v_slot.coach_id end,
    trim(p_note), p_skill_level, nullif(trim(coalesce(p_video_url, '')), ''), coalesce(p_visible_to_member, true),
    auth.uid(), auth.uid()
  )
  returning id into v_note_id;

  if p_skill_level is not null then
    update public.members set skill_level = p_skill_level, updated_by = coalesce(auth.uid(), updated_by)
    where id = v_booking.member_id;
  end if;

  if coalesce(p_visible_to_member, true) then
    perform public._lesson_notify(
      v_booking.club_id, v_booking.member_id, 'coach_note',
      'โน้ตจากผู้สอน: ' || v_slot.title,
      left(trim(p_note), 300),
      jsonb_build_object('note_id', v_note_id, 'booking_id', v_booking.id, 'slot_id', v_slot.id, 'trigger', 'lesson.coach_note')
    );
  end if;
  return v_note_id;
end;
$$;

-- ---------- 18. closures ----------
create or replace function public.close_lesson_day(
  p_date date,
  p_reason text,
  p_venue_id uuid default null,
  p_club_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid := p_club_id;
  v_closure uuid;
  v_slots integer;
  v_bookings integer := 0;
  v_members integer := 0;
  v_refunded integer := 0;
  v_venue_name text;
  v_row record;
begin
  if v_club is null and auth.uid() is not null then
    select ur.club_id into v_club
    from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role_key in ('platform_owner', 'club_admin', 'committee')
    order by ur.created_at
    limit 1;
  end if;
  if v_club is null then
    raise exception 'FORBIDDEN';
  end if;
  if auth.uid() is not null and not public._lesson_is_staff(v_club) then
    raise exception 'FORBIDDEN';
  end if;
  if p_date is null then
    raise exception 'INVALID_DATE';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED';
  end if;
  if p_venue_id is not null then
    select name into v_venue_name from public.lesson_venues where id = p_venue_id and club_id = v_club;
    if v_venue_name is null then
      raise exception 'NO_VENUE';
    end if;
  end if;

  insert into public.lesson_closures (club_id, closure_date, venue_id, reason, created_by)
  values (v_club, p_date, p_venue_id, trim(p_reason), auth.uid())
  returning id into v_closure;

  -- lessons of that day that have not finished yet; the slot trigger closes their bookings
  update public.lesson_slots s
  set status = 'cancelled',
      closure_id = v_closure,
      updated_by = coalesce(auth.uid(), s.updated_by)
  where s.club_id = v_club
    and s.lesson_date = p_date
    and (p_venue_id is null or s.venue_id = p_venue_id)
    and s.archived_at is null
    and s.status in ('draft', 'open', 'closed')
    and _lesson_slot_start(s.lesson_date, s.end_time) > now();
  get diagnostics v_slots = row_count;

  for v_row in
    select b.member_id, count(distinct b.id)::integer as bookings, coalesce(sum(t.delta), 0)::integer as refunded
    from public.lesson_bookings b
    join public.lesson_slots s on s.id = b.slot_id
    left join public.lesson_credit_txns t on t.booking_id = b.id and t.reason = 'closure'
    where s.closure_id = v_closure and b.status = 'closed'
    group by b.member_id
  loop
    perform public._lesson_notify(
      v_club, v_row.member_id, 'lesson_closure',
      'งดเรียนวันที่ ' || public._lesson_th_date(p_date),
      'ชมรมงดเรียนวันที่ ' || public._lesson_th_date(p_date) ||
        coalesce(' ที่ ' || v_venue_name, '') || ' เพราะ' || trim(p_reason) ||
        ' รอบที่คุณจองไว้ ' || v_row.bookings || ' รอบถูกยกเลิก' ||
        case when v_row.refunded > 0 then ' คืนเครดิต ' || v_row.refunded || ' ครั้งแล้ว' else '' end,
      jsonb_build_object('closure_id', v_closure, 'closure_date', p_date, 'trigger', 'lesson.closure')
    );
    v_members := v_members + 1;
    v_bookings := v_bookings + v_row.bookings;
    v_refunded := v_refunded + v_row.refunded;
  end loop;

  update public.lesson_closures
  set slots_cancelled = v_slots,
      bookings_closed = v_bookings,
      members_notified = v_members,
      credits_refunded = v_refunded
  where id = v_closure;

  insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, after_data, metadata)
  values (
    v_club, auth.uid(), 'lesson_day.closed', 'lesson_closures', v_closure,
    jsonb_build_object('closure_date', p_date, 'venue_id', p_venue_id, 'reason', trim(p_reason)),
    jsonb_build_object('slots', v_slots, 'bookings', v_bookings, 'members', v_members, 'credits_refunded', v_refunded,
                       'source', 'rpc.close_lesson_day')
  );

  return json_build_object('closure_id', v_closure, 'slots', v_slots, 'bookings', v_bookings,
                           'members', v_members, 'credits_refunded', v_refunded);
end;
$$;

-- ---------- 19. admin tools ----------
-- Move a member to another round (seat required, credit kept when it still applies).
create or replace function public.admin_move_lesson_booking(p_booking_id uuid, p_target_slot_id uuid, p_note text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.lesson_bookings;
  v_from public.lesson_slots;
  v_target public.lesson_slots;
  v_taken integer;
  v_enrollment uuid;
begin
  select * into v_booking from public.lesson_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'NO_BOOKING';
  end if;
  if auth.uid() is not null and not public._lesson_is_staff(v_booking.club_id) then
    raise exception 'FORBIDDEN';
  end if;
  perform 1 from public.lesson_slots where id in (v_booking.slot_id, p_target_slot_id) order by id for update;
  select * into v_booking from public.lesson_bookings where id = p_booking_id for update;
  if v_booking.status not in ('booked', 'waitlist', 'offered') then
    raise exception 'NO_BOOKING';
  end if;

  select * into v_target from public.lesson_slots where id = p_target_slot_id;
  if v_target.id is null or v_target.club_id <> v_booking.club_id or v_target.archived_at is not null then
    raise exception 'NO_SESSION';
  end if;
  if v_target.status not in ('open', 'closed') then
    raise exception 'SESSION_CLOSED';
  end if;
  if _lesson_slot_start(v_target.lesson_date, v_target.start_time) <= now() then
    raise exception 'STARTED';
  end if;
  if v_target.id = v_booking.slot_id or exists (
    select 1 from public.lesson_bookings b
    where b.slot_id = v_target.id and b.member_id = v_booking.member_id
      and b.status in ('booked', 'waitlist', 'offered', 'attended', 'no_show')
  ) then
    raise exception 'DUPLICATE';
  end if;

  perform public._lesson_expire_slot_offers(v_target.id);
  select count(*)::integer into v_taken
  from public.lesson_bookings
  where slot_id = v_target.id and public._lesson_seat_status(status);
  if v_taken >= v_target.capacity then
    raise exception 'FULL';
  end if;

  select * into v_from from public.lesson_slots where id = v_booking.slot_id;
  update public.lesson_bookings
  set slot_id = v_target.id,
      queue_seq = default,
      status = 'booked',
      offered_at = null,
      offer_expires_at = null,
      offer_count = 0,
      checked_in_at = null,
      reminder_sent_at = null,
      updated_by = coalesce(auth.uid(), updated_by)
  where id = v_booking.id;

  insert into public.lesson_booking_change_requests
    (booking_id, club_id, member_id, from_slot_id, to_slot_id, request_type, status, note,
     decided_at, decided_by, created_by, updated_by)
  values
    (v_booking.id, v_booking.club_id, v_booking.member_id, v_from.id, v_target.id, 'admin_reschedule', 'approved',
     nullif(trim(coalesce(p_note, '')), ''), now(), auth.uid(), auth.uid(), auth.uid());

  insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
  values (
    v_booking.club_id, auth.uid(), 'lesson_booking.moved_by_admin', 'lesson_bookings', v_booking.id,
    jsonb_build_object('slot_id', v_from.id, 'status', v_booking.status),
    jsonb_build_object('slot_id', v_target.id, 'status', 'booked'),
    jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), ''), 'source', 'rpc.admin_move_lesson_booking')
  );

  perform public._lesson_notify(
    v_booking.club_id, v_booking.member_id, 'lesson_update',
    'ย้ายรอบเรียน: ' || v_target.title,
    'ผู้ดูแลย้ายรอบเรียนของคุณจาก ' || public._lesson_slot_label(v_from) || ' เป็น ' || public._lesson_slot_label(v_target),
    jsonb_build_object('booking_id', v_booking.id, 'slot_id', v_target.id, 'from_slot_id', v_from.id,
                       'trigger', 'lesson.moved_by_admin')
  );

  select h.enrollment_id into v_enrollment from public._lesson_booking_credit_hold(v_booking.id) h limit 1;
  return json_build_object('booking_id', v_booking.id, 'from_slot_id', v_from.id, 'to_slot_id', v_target.id,
                           'status', 'booked', 'enrollment_id', v_enrollment);
end;
$$;

-- Manual credit change with a reason (ledger 'adjust' + audit_logs). No enrollment given:
-- a positive delta opens a "เครดิตชดเชย" enrollment (any course, p_valid_days or 60 days);
-- a negative delta comes off the enrollment that expires soonest. p_valid_days on an existing
-- enrollment also extends it (and re-opens an expired one).
create or replace function public.admin_adjust_lesson_credits(
  p_member_id uuid,
  p_enrollment_id uuid,
  p_delta integer,
  p_note text,
  p_valid_days integer default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_enrollment public.lesson_enrollments;
  v_before integer;
  v_txn uuid;
  v_id uuid;
  v_created boolean := false;
  v_expires timestamptz;
begin
  select * into v_member from public.members where id = p_member_id;
  if v_member.id is null then
    raise exception 'NOT_MEMBER';
  end if;
  if auth.uid() is not null and not public._lesson_is_staff(v_member.club_id) then
    raise exception 'FORBIDDEN';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000 then
    raise exception 'INVALID_DELTA';
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'NOTE_REQUIRED';
  end if;
  if p_valid_days is not null and (p_valid_days <= 0 or p_valid_days > 3650) then
    raise exception 'INVALID_DAYS';
  end if;

  if p_enrollment_id is null then
    if p_delta > 0 then
      v_expires := public._lesson_end_of_day(public._lesson_today() + coalesce(p_valid_days, 60));
      insert into public.lesson_enrollments (
        club_id, member_id, package_id, program_id, package_name, credits_total, price, valid_days,
        status, source, starts_at, expires_at, note, created_by, updated_by
      ) values (
        v_member.club_id, v_member.id, null, null, 'เครดิตชดเชย', p_delta, 0, coalesce(p_valid_days, 60),
        'active', 'admin_grant', now(), v_expires, trim(p_note), auth.uid(), auth.uid()
      )
      returning id into v_id;
      v_created := true;
    else
      for v_id in
        select e.id from public.lesson_enrollments e
        where e.member_id = v_member.id and e.status = 'active' and e.expires_at > now()
        order by e.expires_at, e.created_at
        for update
      loop
        exit when public._lesson_enrollment_balance(v_id) >= -p_delta;
        v_id := null;
      end loop;
      if v_id is null then
        raise exception 'INSUFFICIENT_CREDIT';
      end if;
    end if;
  else
    v_id := p_enrollment_id;
  end if;

  select * into v_enrollment from public.lesson_enrollments where id = v_id and member_id = v_member.id for update;
  if v_enrollment.id is null then
    raise exception 'NO_ENROLLMENT';
  end if;
  if v_enrollment.status not in ('active', 'expired') then
    raise exception 'ENROLLMENT_INACTIVE';
  end if;

  v_before := case when v_created then 0 else public._lesson_enrollment_balance(v_enrollment.id) end;
  if v_before + p_delta < 0 then
    raise exception 'INSUFFICIENT_CREDIT';
  end if;

  if p_valid_days is not null and not v_created then
    update public.lesson_enrollments
    set expires_at = public._lesson_end_of_day(public._lesson_today() + p_valid_days),
        status = 'active',
        expiry_warned_at = null,
        updated_by = coalesce(auth.uid(), updated_by)
    where id = v_enrollment.id;
  end if;

  insert into public.lesson_credit_txns (club_id, enrollment_id, member_id, delta, reason, note, created_by)
  values (v_member.club_id, v_enrollment.id, v_member.id, p_delta, 'adjust', trim(p_note), auth.uid())
  returning id into v_txn;

  select * into v_enrollment from public.lesson_enrollments where id = v_enrollment.id;

  insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
  values (
    v_member.club_id, auth.uid(), 'lesson_credit.adjusted', 'lesson_enrollments', v_enrollment.id,
    jsonb_build_object('credits_remaining', v_before),
    jsonb_build_object('credits_remaining', v_before + p_delta, 'expires_at', v_enrollment.expires_at,
                       'status', v_enrollment.status),
    jsonb_build_object('member_id', v_member.id, 'delta', p_delta, 'note', trim(p_note), 'txn_id', v_txn,
                       'created_enrollment', v_created, 'source', 'rpc.admin_adjust_lesson_credits')
  );

  perform public._lesson_notify(
    v_member.club_id, v_member.id, 'lesson_credit',
    'ปรับเครดิตเรียน',
    'ผู้ดูแล' || case when p_delta > 0 then 'เพิ่ม' else 'หัก' end || 'เครดิตเรียน ' || abs(p_delta) ||
      ' ครั้ง (' || trim(p_note) || ') คงเหลือ ' || (v_before + p_delta) || ' ครั้ง ใช้ได้ถึง ' ||
      public._lesson_th_date((v_enrollment.expires_at at time zone 'Asia/Bangkok')::date),
    jsonb_build_object('enrollment_id', v_enrollment.id, 'txn_id', v_txn, 'trigger', 'lesson.credit_adjusted')
  );

  return json_build_object('enrollment_id', v_enrollment.id, 'txn_id', v_txn,
                           'credits_remaining', v_before + p_delta, 'expires_at', v_enrollment.expires_at,
                           'created_enrollment', v_created);
end;
$$;

-- Overlaps for the recurring-slot wizard preview: same coach, or same venue + bay (an empty bay
-- label counts as "the whole venue"). p_items: [{lesson_date, start_time, end_time,
-- coach_id?, venue_id?, bay_label?}] (per-item ids override the p_* defaults).
create or replace function public.lesson_slot_conflicts(
  p_club_id uuid,
  p_items jsonb,
  p_coach_id uuid default null,
  p_venue_id uuid default null,
  p_bay_label text default null,
  p_exclude_slot_id uuid default null
)
returns table (
  item_index integer,
  item_date date,
  item_start time,
  item_end time,
  conflict_kind text,
  conflict_slot_id uuid,
  conflict_title text,
  conflict_start time,
  conflict_end time,
  conflict_coach_id uuid,
  conflict_venue_id uuid,
  conflict_bay_label text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not (public._lesson_can_view(p_club_id) or public._lesson_is_coach_user(p_club_id)) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  with items as (
    select
      (x.ord - 1)::integer as idx,
      (x.item ->> 'lesson_date')::date as d,
      (x.item ->> 'start_time')::time as st,
      (x.item ->> 'end_time')::time as et,
      coalesce(nullif(x.item ->> 'coach_id', '')::uuid, p_coach_id) as coach,
      coalesce(nullif(x.item ->> 'venue_id', '')::uuid, p_venue_id) as venue,
      coalesce(x.item ->> 'bay_label', p_bay_label) as bay
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(item, ord)
  ),
  kinds(kind) as (values ('coach'), ('venue'))
  select
    i.idx, i.d, i.st, i.et, k.kind, s.id, s.title, s.start_time, s.end_time, s.coach_id, s.venue_id, s.bay_label
  from items i
  join public.lesson_slots s
    on s.club_id = p_club_id
   and s.lesson_date = i.d
   and s.start_time < i.et
   and i.st < s.end_time
   and s.archived_at is null
   and s.status <> 'cancelled'
   and (p_exclude_slot_id is null or s.id <> p_exclude_slot_id)
  cross join kinds k
  where (k.kind = 'coach' and i.coach is not null and s.coach_id = i.coach)
     or (k.kind = 'venue' and i.venue is not null and s.venue_id = i.venue
         and coalesce(lower(trim(s.bay_label)), '') = coalesce(lower(trim(i.bay)), ''))
  order by i.idx, k.kind, s.start_time;
end;
$$;

-- Reminder rows for tomorrow's (and the next reminder_hours') lessons, once per booking.
create or replace function public.queue_lesson_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  for v_row in
    select b.id as booking_id, b.club_id, b.member_id, s.id as slot_id
    from public.lesson_bookings b
    join public.lesson_slots s on s.id = b.slot_id
    left join public.lesson_booking_settings st on st.club_id = b.club_id
    where b.status = 'booked'
      and b.reminder_sent_at is null
      and s.archived_at is null
      and s.status in ('open', 'closed')
      and coalesce(st.reminder_hours, 24) > 0
      and _lesson_slot_start(s.lesson_date, s.start_time) > now()
      and (
        _lesson_slot_start(s.lesson_date, s.start_time) <= now() + make_interval(hours => coalesce(st.reminder_hours, 24))
        or s.lesson_date <= public._lesson_today() + 1
      )
      and (auth.uid() is null or public._lesson_is_staff(b.club_id))
    for update of b skip locked
  loop
    perform public._lesson_notify(
      v_row.club_id, v_row.member_id, 'lesson_reminder',
      'เตือนรอบเรียน: ' || (select title from public.lesson_slots where id = v_row.slot_id),
      (select 'คุณมีรอบเรียน ' || public._lesson_slot_label(s) ||
              coalesce(' ที่ ' || nullif(trim(s.venue), ''), '') ||
              coalesce(' ผู้สอน ' || nullif(trim(s.coach_name), ''), '')
       from public.lesson_slots s where s.id = v_row.slot_id),
      jsonb_build_object('booking_id', v_row.booking_id, 'slot_id', v_row.slot_id, 'trigger', 'lesson.reminder')
    );
    update public.lesson_bookings set reminder_sent_at = now() where id = v_row.booking_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------- 20. RLS ----------
alter table public.lesson_coaches enable row level security;
alter table public.lesson_venues enable row level security;
alter table public.lesson_packages enable row level security;
alter table public.lesson_enrollments enable row level security;
alter table public.lesson_credit_txns enable row level security;
alter table public.lesson_closures enable row level security;
alter table public.lesson_coach_notes enable row level security;
alter table public.lesson_checkin_tokens enable row level security;

drop policy if exists "lesson_coaches_select" on public.lesson_coaches;
create policy "lesson_coaches_select"
on public.lesson_coaches
for select
to authenticated
using (
  public._lesson_can_view(club_id)
  or public._lesson_is_coach_user(club_id)
  or user_id = (select auth.uid())
  or (status = 'active' and archived_at is null and public._lesson_is_member_of(club_id))
);

drop policy if exists "lesson_coaches_write_by_staff" on public.lesson_coaches;
create policy "lesson_coaches_write_by_staff"
on public.lesson_coaches
for all
to authenticated
using (public._lesson_is_staff(club_id))
with check (public._lesson_is_staff(club_id));

drop policy if exists "lesson_venues_select" on public.lesson_venues;
create policy "lesson_venues_select"
on public.lesson_venues
for select
to authenticated
using (
  public._lesson_can_view(club_id)
  or public._lesson_is_coach_user(club_id)
  or (status = 'active' and archived_at is null and public._lesson_is_member_of(club_id))
);

drop policy if exists "lesson_venues_write_by_staff" on public.lesson_venues;
create policy "lesson_venues_write_by_staff"
on public.lesson_venues
for all
to authenticated
using (public._lesson_is_staff(club_id))
with check (public._lesson_is_staff(club_id));

drop policy if exists "lesson_packages_select" on public.lesson_packages;
create policy "lesson_packages_select"
on public.lesson_packages
for select
to authenticated
using (
  public._lesson_can_view(club_id)
  or (status = 'active' and archived_at is null and public._lesson_is_member_of(club_id))
);

drop policy if exists "lesson_packages_write_by_staff" on public.lesson_packages;
create policy "lesson_packages_write_by_staff"
on public.lesson_packages
for all
to authenticated
using (public._lesson_is_staff(club_id))
with check (public._lesson_is_staff(club_id));

drop policy if exists "lesson_enrollments_select_own_or_staff" on public.lesson_enrollments;
create policy "lesson_enrollments_select_own_or_staff"
on public.lesson_enrollments
for select
to authenticated
using (
  exists (
    select 1 from public.members m
    where m.id = lesson_enrollments.member_id and m.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.user_roles ur
    where ur.club_id = lesson_enrollments.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "lesson_enrollments_insert_by_staff" on public.lesson_enrollments;
create policy "lesson_enrollments_insert_by_staff"
on public.lesson_enrollments
for insert
to authenticated
with check (public._lesson_is_staff(club_id));

drop policy if exists "lesson_enrollments_update_by_staff" on public.lesson_enrollments;
create policy "lesson_enrollments_update_by_staff"
on public.lesson_enrollments
for update
to authenticated
using (public._lesson_is_staff(club_id))
with check (public._lesson_is_staff(club_id));

-- Ledger: read only; rows are written by the security-definer functions above.
drop policy if exists "lesson_credit_txns_select_own_or_staff" on public.lesson_credit_txns;
create policy "lesson_credit_txns_select_own_or_staff"
on public.lesson_credit_txns
for select
to authenticated
using (
  exists (
    select 1 from public.members m
    where m.id = lesson_credit_txns.member_id and m.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.user_roles ur
    where ur.club_id = lesson_credit_txns.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "lesson_closures_select" on public.lesson_closures;
create policy "lesson_closures_select"
on public.lesson_closures
for select
to authenticated
using (
  public._lesson_can_view(club_id)
  or public._lesson_is_coach_user(club_id)
  or public._lesson_is_member_of(club_id)
);

drop policy if exists "lesson_coach_notes_select" on public.lesson_coach_notes;
create policy "lesson_coach_notes_select"
on public.lesson_coach_notes
for select
to authenticated
using (
  public._lesson_can_view(club_id)
  or (
    visible_to_member
    and exists (
      select 1 from public.members m
      where m.id = lesson_coach_notes.member_id and m.user_id = (select auth.uid())
    )
  )
  or (
    public._lesson_is_coach_user(club_id)
    and (
      coach_id = public._lesson_my_coach_id(club_id)
      or exists (
        select 1 from public.lesson_bookings b
        where b.id = lesson_coach_notes.booking_id and public._lesson_is_slot_coach(b.slot_id)
      )
    )
  )
);

drop policy if exists "lesson_coach_notes_write_by_staff" on public.lesson_coach_notes;
create policy "lesson_coach_notes_write_by_staff"
on public.lesson_coach_notes
for all
to authenticated
using (public._lesson_is_staff(club_id))
with check (public._lesson_is_staff(club_id));

drop policy if exists "lesson_checkin_tokens_select" on public.lesson_checkin_tokens;
create policy "lesson_checkin_tokens_select"
on public.lesson_checkin_tokens
for select
to authenticated
using (
  public._lesson_can_view(club_id)
  or (slot_id is not null and public._lesson_is_slot_coach(slot_id))
  or (venue_id is not null and public._lesson_is_coach_user(club_id))
);

-- Bookings: own, read-only staff, or the coach of the slot (coaches no longer see every booking).
-- Staff checks on the busy tables are inline exists() (hashed once per query) instead of a
-- per-row function call.
drop policy if exists "lesson_bookings_select_own_or_admin" on public.lesson_bookings;
drop policy if exists "lesson_bookings_select_own_staff_or_coach" on public.lesson_bookings;
create policy "lesson_bookings_select_own_staff_or_coach"
on public.lesson_bookings
for select
to authenticated
using (
  exists (
    select 1 from public.members m
    where m.id = lesson_bookings.member_id and m.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.user_roles ur
    where ur.club_id = lesson_bookings.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
  or public._lesson_is_slot_coach(slot_id)
);

drop policy if exists "lesson_booking_changes_select_own_or_admin" on public.lesson_booking_change_requests;
create policy "lesson_booking_changes_select_own_or_admin"
on public.lesson_booking_change_requests
for select
to authenticated
using (
  exists (
    select 1 from public.members m
    where m.id = lesson_booking_change_requests.member_id and m.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.user_roles ur
    where ur.club_id = lesson_booking_change_requests.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);

-- Members also see slots they hold a booking in (an offer on a slot that closed registration).
drop policy if exists "lesson_slots_select_booked_member" on public.lesson_slots;
create policy "lesson_slots_select_booked_member"
on public.lesson_slots
for select
to authenticated
using (public._lesson_member_has_booking(id));

-- ---------- 21. grants ----------
revoke all on table public.lesson_coaches, public.lesson_venues, public.lesson_packages, public.lesson_enrollments,
  public.lesson_credit_txns, public.lesson_closures, public.lesson_coach_notes, public.lesson_checkin_tokens
  from anon;
revoke all on table public.lesson_enrollment_balances from anon;

grant select, insert, update on public.lesson_coaches to authenticated;
grant select, insert, update on public.lesson_venues to authenticated;
grant select, insert, update on public.lesson_packages to authenticated;
grant select, insert, update on public.lesson_enrollments to authenticated;
grant select, insert, update on public.lesson_coach_notes to authenticated;
revoke insert, update, delete on public.lesson_credit_txns from authenticated;
revoke insert, update, delete on public.lesson_closures from authenticated;
revoke insert, update, delete on public.lesson_checkin_tokens from authenticated;
grant select on public.lesson_credit_txns to authenticated;
grant select on public.lesson_closures to authenticated;
grant select on public.lesson_checkin_tokens to authenticated;
grant select on public.lesson_enrollment_balances to authenticated;

grant all on public.lesson_coaches, public.lesson_venues, public.lesson_packages, public.lesson_enrollments,
  public.lesson_credit_txns, public.lesson_closures, public.lesson_coach_notes, public.lesson_checkin_tokens
  to service_role;
grant select on public.lesson_enrollment_balances to service_role;

-- policy helpers: callable by authenticated (RLS evaluates them as the caller)
revoke all on function public._lesson_is_staff(uuid) from public, anon;
revoke all on function public._lesson_can_view(uuid) from public, anon;
revoke all on function public._lesson_is_coach_user(uuid) from public, anon;
revoke all on function public._lesson_is_member_of(uuid) from public, anon;
revoke all on function public._lesson_my_coach_id(uuid) from public, anon;
revoke all on function public._lesson_is_slot_coach(uuid) from public, anon;
revoke all on function public._lesson_member_has_booking(uuid) from public, anon;
grant execute on function public._lesson_is_staff(uuid) to authenticated, service_role;
grant execute on function public._lesson_can_view(uuid) to authenticated, service_role;
grant execute on function public._lesson_is_coach_user(uuid) to authenticated, service_role;
grant execute on function public._lesson_is_member_of(uuid) to authenticated, service_role;
grant execute on function public._lesson_my_coach_id(uuid) to authenticated, service_role;
grant execute on function public._lesson_is_slot_coach(uuid) to authenticated, service_role;
grant execute on function public._lesson_member_has_booking(uuid) to authenticated, service_role;

-- internal helpers and trigger functions: not callable by clients
revoke all on function public._lesson_th_date(date) from public, anon, authenticated;
revoke all on function public._lesson_th_datetime(timestamptz) from public, anon, authenticated;
revoke all on function public._lesson_today() from public, anon, authenticated;
revoke all on function public._lesson_end_of_day(date) from public, anon, authenticated;
revoke all on function public._lesson_seat_status(text) from public, anon, authenticated;
revoke all on function public._lesson_slot_label(public.lesson_slots) from public, anon, authenticated;
revoke all on function public._lesson_refresh_slot_counts(uuid) from public, anon, authenticated;
revoke all on function public._lesson_settings(uuid) from public, anon, authenticated;
revoke all on function public._lesson_notify(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._lesson_pick_enrollment(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._lesson_booking_credit_hold(uuid) from public, anon, authenticated;
revoke all on function public._lesson_enrollment_balance(uuid) from public, anon, authenticated;
revoke all on function public._lesson_settle_credit(uuid) from public, anon, authenticated;
revoke all on function public._lesson_queue_position(uuid) from public, anon, authenticated;
revoke all on function public._lesson_fill_seats(uuid) from public, anon, authenticated;
revoke all on function public._lesson_expire_offer(uuid) from public, anon, authenticated;
revoke all on function public._lesson_expire_slot_offers(uuid) from public, anon, authenticated;
revoke all on function public._lesson_no_show_block_until(uuid, public.lesson_booking_settings) from public, anon, authenticated;
revoke all on function public._lesson_booking_checks(public.members, public.lesson_slots, public.lesson_booking_settings, uuid) from public, anon, authenticated;
revoke all on function public._lesson_activate_enrollment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._lesson_revoke_enrollment(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.lesson_credit_txns_append_only() from public, anon, authenticated;
revoke all on function public.lesson_credit_txns_check_balance() from public, anon, authenticated;
revoke all on function public.lesson_slot_fill_names() from public, anon, authenticated;
revoke all on function public.lesson_program_fill_names() from public, anon, authenticated;
revoke all on function public.refresh_lesson_slot_booked_count() from public, anon, authenticated;
revoke all on function public.lesson_booking_credit_sync() from public, anon, authenticated;
revoke all on function public.enforce_lesson_slot_capacity() from public, anon, authenticated;
revoke all on function public.lesson_booking_seat_released() from public, anon, authenticated;
revoke all on function public.lesson_slot_changed() from public, anon, authenticated;
revoke all on function public.lesson_package_payment_changed() from public, anon, authenticated;

-- client RPCs (each checks the caller inside)
revoke all on function public.book_lesson_slot(uuid) from public, anon;
revoke all on function public.change_lesson_booking(uuid, uuid) from public, anon;
revoke all on function public.cancel_lesson_booking(uuid, boolean) from public, anon;
revoke all on function public.confirm_lesson_offer(uuid) from public, anon;
revoke all on function public.expire_lesson_offers(uuid) from public, anon;
revoke all on function public.my_lesson_bookings() from public, anon;
revoke all on function public.my_lesson_overview() from public, anon;
revoke all on function public.request_lesson_package(uuid) from public, anon;
revoke all on function public.expire_lesson_credits() from public, anon;
revoke all on function public.check_in_lesson(text) from public, anon;
revoke all on function public.mark_lesson_attendance(uuid, boolean, text) from public, anon;
revoke all on function public.mark_lesson_no_shows(integer) from public, anon;
revoke all on function public.lesson_checkin_token(uuid, uuid, boolean) from public, anon;
revoke all on function public.lesson_slot_roster(uuid) from public, anon;
revoke all on function public.add_lesson_coach_note(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.close_lesson_day(date, text, uuid, uuid) from public, anon;
revoke all on function public.admin_move_lesson_booking(uuid, uuid, text) from public, anon;
revoke all on function public.admin_adjust_lesson_credits(uuid, uuid, integer, text, integer) from public, anon;
revoke all on function public.lesson_slot_conflicts(uuid, jsonb, uuid, uuid, text, uuid) from public, anon;
revoke all on function public.queue_lesson_reminders() from public, anon;

grant execute on function public.book_lesson_slot(uuid) to authenticated, service_role;
grant execute on function public.change_lesson_booking(uuid, uuid) to authenticated, service_role;
grant execute on function public.cancel_lesson_booking(uuid, boolean) to authenticated, service_role;
grant execute on function public.confirm_lesson_offer(uuid) to authenticated, service_role;
grant execute on function public.expire_lesson_offers(uuid) to authenticated, service_role;
grant execute on function public.my_lesson_bookings() to authenticated, service_role;
grant execute on function public.my_lesson_overview() to authenticated, service_role;
grant execute on function public.request_lesson_package(uuid) to authenticated, service_role;
grant execute on function public.expire_lesson_credits() to authenticated, service_role;
grant execute on function public.check_in_lesson(text) to authenticated, service_role;
grant execute on function public.mark_lesson_attendance(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.mark_lesson_no_shows(integer) to authenticated, service_role;
grant execute on function public.lesson_checkin_token(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.lesson_slot_roster(uuid) to authenticated, service_role;
grant execute on function public.add_lesson_coach_note(uuid, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.close_lesson_day(date, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.admin_move_lesson_booking(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.admin_adjust_lesson_credits(uuid, uuid, integer, text, integer) to authenticated, service_role;
grant execute on function public.lesson_slot_conflicts(uuid, jsonb, uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.queue_lesson_reminders() to authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261123093000', 'lessons_v2') on conflict (version) do nothing;

-- ====================================================================
-- 20261123094000_membership_points
-- ====================================================================
-- Phase 2–3: membership lifecycle, annual fee terms, PDPA consent and แต้มสะสม (loyalty points).
--
-- 1. Club membership settings: auto-approve on/off, annual fee (0 = none), term length, renewal
--    notice and the grace period for members who left the association directory.
-- 2. members: lifecycle statuses (expired / suspended / resigned on top of the existing values),
--    external applicants with a sponsor member, membership expiry date, PDPA consent.
-- 3. membership_terms + a payment_records trigger: an approved 'membership_fee' payment activates
--    its term and extends members.membership_expires_at; a refund undoes it.
-- 4. run_membership_daily(): expire memberships, queue renewal reminders (deduped), suspend
--    members whose directory row left more than the grace period ago (called by the cron route).
-- 5. Points ledger (point_txns, append-only, balance = sum) with rules per club, automatic awards
--    from lessons / events / scorecards / referrals (unique source key → never twice), manual
--    adjustments with a reason, rewards and redemptions.
-- 6. member_data_requests: PDPA deletion requests that admins resolve.
--
-- Wording: loyalty points are "แต้มสะสม" in every text below; "แต้มต่อ" means handicap.

-- ---------- helpers ----------
create or replace function public._bangkok_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;

-- "15 ส.ค. 2569" for notification texts (the UI rule: no ISO or dd/mm/yyyy).
create or replace function public._thai_date(p_date date)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_date is null then null else
    extract(day from p_date)::integer::text || ' ' ||
    (array['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month from p_date)::integer] || ' ' ||
    (extract(year from p_date)::integer + 543)::text
  end;
$$;

create or replace function public._try_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
begin
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

grant execute on function public._bangkok_today() to authenticated, service_role;
grant execute on function public._thai_date(date) to authenticated, service_role;
revoke all on function public._try_timestamptz(text) from public, anon;
grant execute on function public._try_timestamptz(text) to authenticated, service_role;

-- Staff who may manage members (same list as the members RLS write policy).
create or replace function public._is_member_admin(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.club_id = p_club
      and ur.user_id = auth.uid()
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  );
$$;

-- Any staff role of the club (read access to lists and ledgers).
create or replace function public._is_club_staff(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.club_id = p_club
      and ur.user_id = auth.uid()
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'finance_officer', 'tournament_director', 'scoring_officer', 'auditor')
  );
$$;

revoke all on function public._is_member_admin(uuid) from public, anon;
revoke all on function public._is_club_staff(uuid) from public, anon;
grant execute on function public._is_member_admin(uuid) to authenticated, service_role;
grant execute on function public._is_club_staff(uuid) to authenticated, service_role;

-- ---------- 1. club membership settings ----------
create table if not exists public.club_membership_settings (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  auto_approve boolean not null default true,
  annual_fee numeric(12,2) not null default 0 check (annual_fee >= 0 and annual_fee <= 100000),
  term_months integer not null default 12 check (term_months between 1 and 36),
  renewal_notice_days integer not null default 30 check (renewal_notice_days between 1 and 120),
  directory_grace_days integer not null default 30 check (directory_grace_days between 0 and 365),
  privacy_policy_version text not null default '2026-11',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

drop trigger if exists set_club_membership_settings_updated_at on public.club_membership_settings;
create trigger set_club_membership_settings_updated_at
before update on public.club_membership_settings
for each row execute function public.set_updated_at();

alter table public.club_membership_settings enable row level security;
grant select, insert, update on public.club_membership_settings to authenticated;
grant all on public.club_membership_settings to service_role;

drop policy if exists "membership_settings_select_club" on public.club_membership_settings;
create policy "membership_settings_select_club"
on public.club_membership_settings
for select
to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.club_id = club_membership_settings.club_id and ur.user_id = (select auth.uid()))
  or exists (select 1 from public.members m where m.club_id = club_membership_settings.club_id and m.user_id = (select auth.uid()))
);

drop policy if exists "membership_settings_write_by_owner" on public.club_membership_settings;
create policy "membership_settings_write_by_owner"
on public.club_membership_settings
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = club_membership_settings.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = club_membership_settings.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
);

-- Missing row = defaults. Keep in sync with src/lib/membership/settings.ts.
create or replace function public.membership_settings_for(p_club uuid)
returns public.club_membership_settings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.club_membership_settings;
begin
  select * into v from public.club_membership_settings where club_id = p_club;
  if v.club_id is null then
    v.club_id := p_club;
    v.auto_approve := true;
    v.annual_fee := 0;
    v.term_months := 12;
    v.renewal_notice_days := 30;
    v.directory_grace_days := 30;
    v.privacy_policy_version := '2026-11';
    v.updated_at := now();
  end if;
  return v;
end;
$$;

revoke all on function public.membership_settings_for(uuid) from public, anon;
grant execute on function public.membership_settings_for(uuid) to authenticated, service_role;

-- ---------- 2. members: lifecycle, sponsor, expiry, consent ----------
-- Status values so far: foundation ('active','inactive','guest','archived') and
-- 20260709084618 ('pending_verification' + the same four). Keep all of them.
--   pending_verification รอตรวจ · active ใช้งาน (ใกล้หมดอายุ is derived from membership_expires_at)
--   expired หมดอายุ · suspended ระงับ · resigned พ้นสภาพ/ลาออก · inactive / guest / archived (unchanged)
alter table public.members drop constraint if exists members_status_check;
alter table public.members
  add constraint members_status_check
  check (status in (
    'pending_verification', 'active', 'inactive', 'guest', 'archived',
    'expired', 'suspended', 'resigned'
  ));

alter table public.members
  add column if not exists applicant_type text not null default 'staff',
  add column if not exists sponsor_member_id uuid references public.members(id) on delete set null,
  add column if not exists membership_expires_at date,
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists pdpa_consent_at timestamptz,
  add column if not exists pdpa_policy_version text,
  add column if not exists photo_consent boolean not null default false,
  add column if not exists photo_consent_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'members_applicant_type_check') then
    alter table public.members
      add constraint members_applicant_type_check check (applicant_type in ('staff', 'external'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'members_sponsor_not_self_check') then
    alter table public.members
      add constraint members_sponsor_not_self_check check (sponsor_member_id is null or sponsor_member_id <> id);
  end if;
end $$;

create index if not exists members_sponsor_idx
on public.members (sponsor_member_id)
where sponsor_member_id is not null;

create index if not exists members_club_expiry_idx
on public.members (club_id, membership_expires_at)
where archived_at is null and membership_expires_at is not null;

create index if not exists members_club_status_idx
on public.members (club_id, status)
where archived_at is null;

create or replace function public.stamp_member_status_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_member_status_change on public.members;
create trigger stamp_member_status_change
before update of status on public.members
for each row execute function public.stamp_member_status_change();

-- ---------- 3. membership terms (annual fee) ----------
create table if not exists public.membership_terms (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  term_months integer not null default 12 check (term_months between 1 and 36),
  fee numeric(12,2) not null default 0 check (fee >= 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'cancelled')),
  payment_record_id uuid references public.payment_records(id) on delete set null,
  note text,
  activated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  check (period_end >= period_start)
);

create unique index if not exists membership_terms_one_pending_key
on public.membership_terms (member_id)
where status = 'pending_payment';

create index if not exists membership_terms_member_idx
on public.membership_terms (member_id, period_end desc);

create index if not exists membership_terms_club_status_idx
on public.membership_terms (club_id, status, created_at desc);

drop trigger if exists set_membership_terms_updated_at on public.membership_terms;
create trigger set_membership_terms_updated_at
before update on public.membership_terms
for each row execute function public.set_updated_at();

alter table public.membership_terms enable row level security;
grant select, insert, update on public.membership_terms to authenticated;
grant all on public.membership_terms to service_role;

drop policy if exists "membership_terms_select_own_or_staff" on public.membership_terms;
create policy "membership_terms_select_own_or_staff"
on public.membership_terms
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = membership_terms.member_id and m.user_id = (select auth.uid()))
  or public._is_club_staff(club_id)
);

drop policy if exists "membership_terms_write_by_admin" on public.membership_terms;
create policy "membership_terms_write_by_admin"
on public.membership_terms
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = membership_terms.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'finance_officer')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = membership_terms.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'finance_officer')
  )
);

-- Member asks to pay the annual fee: returns the open (pending_payment) term, creating it when
-- needed. Renewal opens within renewal_notice_days of expiry, after expiry, or when the member has
-- never paid. The period is recomputed when the payment is approved.
create or replace function public.request_membership_term()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_settings public.club_membership_settings;
  v_term public.membership_terms;
  v_today date := public._bangkok_today();
  v_start date;
  v_end date;
begin
  select * into v_member
  from public.members
  where user_id = auth.uid() and archived_at is null
  order by created_at
  limit 1
  for update;
  if v_member.id is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_member.status not in ('active', 'expired') then
    raise exception 'MEMBER_NOT_APPROVED' using errcode = 'P0001';
  end if;

  v_settings := public.membership_settings_for(v_member.club_id);
  if v_settings.annual_fee <= 0 then
    raise exception 'NO_FEE' using errcode = 'P0001';
  end if;

  select * into v_term from public.membership_terms
  where member_id = v_member.id and status = 'pending_payment';
  if v_term.id is not null then
    return json_build_object(
      'term_id', v_term.id, 'fee', v_term.fee, 'period_start', v_term.period_start,
      'period_end', v_term.period_end, 'payment_record_id', v_term.payment_record_id, 'created', false
    );
  end if;

  if v_member.membership_expires_at is not null
     and v_member.membership_expires_at > v_today + v_settings.renewal_notice_days then
    raise exception 'NOT_DUE_YET' using errcode = 'P0001';
  end if;

  v_start := greatest(v_today, coalesce(v_member.membership_expires_at + 1, v_today));
  v_end := (v_start + make_interval(months => v_settings.term_months))::date - 1;

  insert into public.membership_terms (
    club_id, member_id, period_start, period_end, term_months, fee, status, created_by, updated_by
  ) values (
    v_member.club_id, v_member.id, v_start, v_end, v_settings.term_months, v_settings.annual_fee,
    'pending_payment', auth.uid(), auth.uid()
  )
  returning * into v_term;

  return json_build_object(
    'term_id', v_term.id, 'fee', v_term.fee, 'period_start', v_term.period_start,
    'period_end', v_term.period_end, 'payment_record_id', null, 'created', true
  );
end;
$$;

revoke all on function public.request_membership_term() from public, anon;
grant execute on function public.request_membership_term() to authenticated, service_role;

-- Approved membership_fee payment → term active, expiry extended, member notified.
-- Refunded (or rejected after approval) → term cancelled, expiry recomputed from other terms.
create or replace function public.membership_fee_payment_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_term public.membership_terms;
  v_member public.members;
  v_today date := public._bangkok_today();
  v_start date;
  v_end date;
  v_max date;
begin
  if new.reference_id is null then
    return null;
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    select * into v_term from public.membership_terms where id = new.reference_id for update;
    if v_term.id is null or v_term.status = 'active' then
      return null;
    end if;
    select * into v_member from public.members where id = v_term.member_id for update;
    if v_member.id is null then
      return null;
    end if;

    -- Pay early: the new year starts the day after the current one ends. Lapsed: starts today.
    v_start := greatest(v_today, coalesce(v_member.membership_expires_at + 1, v_today));
    v_end := (v_start + make_interval(months => v_term.term_months))::date - 1;

    update public.membership_terms
    set status = 'active',
        period_start = v_start,
        period_end = v_end,
        payment_record_id = new.id,
        activated_at = now(),
        cancelled_at = null,
        updated_by = coalesce(auth.uid(), updated_by)
    where id = v_term.id;

    update public.members
    set membership_expires_at = greatest(coalesce(membership_expires_at, v_end), v_end),
        status = case when status = 'expired' then 'active' else status end,
        status_reason = case when status = 'expired' then null else status_reason end,
        updated_at = now()
    where id = v_member.id;

    insert into public.member_notifications (
      club_id, member_id, channel, notification_type, subject, body, status, metadata, created_by
    ) values (
      v_term.club_id, v_member.id, 'system', 'membership_renewed',
      'ต่ออายุสมาชิกแล้ว',
      'ชำระค่าบำรุงเรียบร้อย บัตรสมาชิกใช้ได้ถึง ' || public._thai_date(v_end),
      'queued',
      jsonb_build_object('term_id', v_term.id, 'payment_id', new.id, 'period_end', v_end, 'link', '/member/membership'),
      auth.uid()
    );

    insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
    values (
      v_term.club_id, auth.uid(), 'membership_term.activated', 'membership_terms', v_term.id,
      jsonb_build_object('status', v_term.status, 'membership_expires_at', v_member.membership_expires_at),
      jsonb_build_object('status', 'active', 'period_start', v_start, 'period_end', v_end),
      jsonb_build_object('payment_id', new.id, 'member_id', v_member.id, 'source', 'payment_records.trigger')
    );
  elsif tg_op = 'UPDATE' and old.status = 'approved' and new.status in ('refunded', 'rejected') then
    update public.membership_terms
    set status = 'cancelled', cancelled_at = now(), updated_by = coalesce(auth.uid(), updated_by)
    where id = new.reference_id and status = 'active'
    returning * into v_term;

    if v_term.id is not null then
      select max(period_end) into v_max
      from public.membership_terms
      where member_id = v_term.member_id and status = 'active';

      update public.members
      set membership_expires_at = v_max, updated_at = now()
      where id = v_term.member_id;

      insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, after_data, metadata)
      values (
        v_term.club_id, auth.uid(), 'membership_term.cancelled', 'membership_terms', v_term.id,
        jsonb_build_object('status', 'cancelled', 'membership_expires_at', v_max),
        jsonb_build_object('payment_id', new.id, 'payment_status', new.status, 'source', 'payment_records.trigger')
      );
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists membership_fee_payment_changed on public.payment_records;
create trigger membership_fee_payment_changed
after insert or update of status on public.payment_records
for each row
when (new.purpose = 'membership_fee')
execute function public.membership_fee_payment_changed();

-- ---------- 4. daily lifecycle job ----------
create or replace function public.run_membership_daily(p_today date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, public._bangkok_today());
  v_expired integer := 0;
  v_reminded integer := 0;
  v_suspended integer := 0;
  v_resumed integer := 0;
begin
  -- 4a. memberships past their end date
  with changed as (
    update public.members m
    set status = 'expired', status_reason = 'membership_expired', updated_at = now()
    where m.status = 'active'
      and m.archived_at is null
      and m.membership_expires_at is not null
      and m.membership_expires_at < v_today
    returning m.id, m.club_id, m.membership_expires_at
  ), logged as (
    insert into public.audit_logs (club_id, action, entity_type, entity_id, before_data, after_data, metadata)
    select c.club_id, 'member.expired', 'members', c.id,
           jsonb_build_object('status', 'active'),
           jsonb_build_object('status', 'expired', 'membership_expires_at', c.membership_expires_at),
           jsonb_build_object('source', 'cron.membership')
    from changed c
    returning 1
  )
  select count(*) into v_expired from logged;

  -- 4b. renewal reminder once per expiry date
  with due as (
    select m.id, m.club_id, m.membership_expires_at
    from public.members m
    where m.status = 'active'
      and m.archived_at is null
      and m.membership_expires_at is not null
      and m.membership_expires_at >= v_today
      and m.membership_expires_at <= v_today + (public.membership_settings_for(m.club_id)).renewal_notice_days
      and not exists (
        select 1 from public.member_notifications n
        where n.member_id = m.id
          and n.notification_type = 'membership_expiring'
          and n.metadata ->> 'expires_at' = m.membership_expires_at::text
      )
  ), inserted as (
    insert into public.member_notifications (club_id, member_id, channel, notification_type, subject, body, status, metadata)
    select d.club_id, d.id, 'system', 'membership_expiring',
           'สมาชิกใกล้หมดอายุ',
           'บัตรสมาชิกใช้ได้ถึง ' || public._thai_date(d.membership_expires_at) || ' ต่ออายุได้ที่หน้าสมาชิก',
           'queued',
           jsonb_build_object('expires_at', d.membership_expires_at, 'link', '/member/membership')
    from due d
    returning 1
  )
  select count(*) into v_reminded from inserted;

  -- 4c. left the association directory and the grace period is over → suspended
  with changed as (
    update public.members m
    set status = 'suspended', status_reason = 'left_directory', updated_at = now()
    where m.status = 'active'
      and m.archived_at is null
      and m.employee_match_detail ->> 'reason' = 'left_directory'
      and public._try_timestamptz(m.employee_match_detail ->> 'flagged_at') is not null
      and public._try_timestamptz(m.employee_match_detail ->> 'flagged_at')
          + make_interval(days => (public.membership_settings_for(m.club_id)).directory_grace_days) <= now()
    returning m.id, m.club_id
  ), logged as (
    insert into public.audit_logs (club_id, action, entity_type, entity_id, before_data, after_data, metadata)
    select c.club_id, 'member.suspended', 'members', c.id,
           jsonb_build_object('status', 'active'),
           jsonb_build_object('status', 'suspended', 'status_reason', 'left_directory'),
           jsonb_build_object('source', 'cron.membership')
    from changed c
    returning 1
  )
  select count(*) into v_suspended from logged;

  -- 4d. back in the directory (a later import cleared the flag) → active again
  with changed as (
    update public.members m
    set status = 'active', status_reason = null, updated_at = now()
    where m.status = 'suspended'
      and m.archived_at is null
      and m.status_reason = 'left_directory'
      and m.employee_match_status = 'matched'
      and (m.employee_match_detail ->> 'reason') is distinct from 'left_directory'
      and (m.membership_expires_at is null or m.membership_expires_at >= v_today)
    returning m.id, m.club_id
  ), logged as (
    insert into public.audit_logs (club_id, action, entity_type, entity_id, before_data, after_data, metadata)
    select c.club_id, 'member.resumed', 'members', c.id,
           jsonb_build_object('status', 'suspended', 'status_reason', 'left_directory'),
           jsonb_build_object('status', 'active'),
           jsonb_build_object('source', 'cron.membership')
    from changed c
    returning 1
  )
  select count(*) into v_resumed from logged;

  return json_build_object(
    'today', v_today, 'expired', v_expired, 'reminded', v_reminded,
    'suspended', v_suspended, 'resumed', v_resumed
  );
end;
$$;

revoke all on function public.run_membership_daily(date) from public, anon, authenticated;
grant execute on function public.run_membership_daily(date) to service_role;

-- ---------- 5. แต้มสะสม (points) ----------
create table if not exists public.point_rules (
  club_id uuid not null references public.clubs(id) on delete cascade,
  reason text not null
    check (reason in ('attend_lesson', 'event_checkin', 'scorecard_on_time', 'referral', 'staff_award', 'no_show')),
  points integer not null check (points between -1000 and 1000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (club_id, reason)
);

drop trigger if exists set_point_rules_updated_at on public.point_rules;
create trigger set_point_rules_updated_at
before update on public.point_rules
for each row execute function public.set_updated_at();

alter table public.point_rules enable row level security;
grant select, insert, update on public.point_rules to authenticated;
grant all on public.point_rules to service_role;

drop policy if exists "point_rules_select_club" on public.point_rules;
create policy "point_rules_select_club"
on public.point_rules
for select
to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.club_id = point_rules.club_id and ur.user_id = (select auth.uid()))
  or exists (select 1 from public.members m where m.club_id = point_rules.club_id and m.user_id = (select auth.uid()))
);

drop policy if exists "point_rules_write_by_admin" on public.point_rules;
create policy "point_rules_write_by_admin"
on public.point_rules
for all
to authenticated
using (public._is_member_admin(club_id))
with check (public._is_member_admin(club_id));

-- Audit defaults (page 20–21). Keep in sync with src/lib/points/rules.ts.
create or replace function public._point_rule_default(p_reason text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_reason
    when 'attend_lesson' then 10
    when 'event_checkin' then 30
    when 'scorecard_on_time' then 5
    when 'referral' then 50
    when 'staff_award' then 20
    when 'no_show' then -10
    else null
  end;
$$;

-- Points for a rule now; null when the club turned the rule off.
create or replace function public.point_rule_points(p_club uuid, p_reason text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.club_id is null then public._point_rule_default(p_reason)
    when r.enabled then r.points
    else null
  end
  from (select 1) one
  left join public.point_rules r on r.club_id = p_club and r.reason = p_reason;
$$;

revoke all on function public.point_rule_points(uuid, text) from public, anon;
grant execute on function public.point_rule_points(uuid, text) to authenticated, service_role;

-- The ledger. Balance = sum(delta). Rows are never updated or deleted (trigger below); a mistake
-- is corrected with a new 'adjust' row. Automatic rows carry their source so the unique key makes
-- a second award for the same lesson/registration/member impossible.
create table if not exists public.point_txns (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  delta integer not null check (delta <> 0 and delta between -100000 and 100000),
  reason text not null check (reason in (
    'attend_lesson', 'event_checkin', 'scorecard_on_time', 'referral', 'staff_award',
    'no_show', 'redemption', 'expiry', 'adjust'
  )),
  source_type text,
  source_id uuid,
  note text,
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint point_txns_source_key unique (source_type, source_id, reason)
);

create index if not exists point_txns_member_created_idx
on public.point_txns (member_id, created_at);

create index if not exists point_txns_club_created_idx
on public.point_txns (club_id, created_at desc);

create index if not exists point_txns_due_idx
on public.point_txns (expires_at)
where delta > 0;

-- Positive rows expire 12 months after they were earned; negative rows never expire.
create or replace function public.point_txns_set_expiry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.delta > 0 then
    new.expires_at := coalesce(new.expires_at, coalesce(new.created_at, now()) + interval '12 months');
  else
    new.expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists point_txns_set_expiry on public.point_txns;
create trigger point_txns_set_expiry
before insert on public.point_txns
for each row execute function public.point_txns_set_expiry();

create or replace function public.point_txns_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Deleting the member or the club (test-data cleanup) may cascade; nothing else may delete.
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.members where id = old.member_id)
    or not exists (select 1 from public.clubs where id = old.club_id)
  ) then
    return old;
  end if;
  raise exception 'POINT_LEDGER_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

drop trigger if exists point_txns_append_only on public.point_txns;
create trigger point_txns_append_only
before update or delete on public.point_txns
for each row execute function public.point_txns_append_only();

alter table public.point_txns enable row level security;
grant select on public.point_txns to authenticated;
grant all on public.point_txns to service_role;

drop policy if exists "point_txns_select_own_or_staff" on public.point_txns;
create policy "point_txns_select_own_or_staff"
on public.point_txns
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = point_txns.member_id and m.user_id = (select auth.uid()))
  or public._is_club_staff(club_id)
);

-- Award by rule, at most once per (source_type, source_id, reason). Returns the new row id or null.
create or replace function public._award_points(
  p_club uuid,
  p_member uuid,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_note text default null,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer;
  v_id uuid;
begin
  if p_member is null or p_club is null then
    return null;
  end if;
  v_points := public.point_rule_points(p_club, p_reason);
  if v_points is null or v_points = 0 then
    return null;
  end if;
  insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
  values (
    p_club, p_member, v_points, p_reason, p_source_type, p_source_id, p_note,
    case when exists (select 1 from auth.users u where u.id = p_actor) then p_actor else null end
  )
  on conflict (source_type, source_id, reason) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Undo an automatic award once (attendance corrected, check-in undone). The reversal row keeps the
-- original reason so monthly totals net out; source_type 'reversal:<type>' keeps it unique.
create or replace function public._reverse_points(
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.point_txns;
  v_id uuid;
begin
  select * into v_original from public.point_txns
  where source_type = p_source_type and source_id = p_source_id and reason = p_reason;
  if v_original.id is null then
    return null;
  end if;
  insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
  values (
    v_original.club_id, v_original.member_id, -v_original.delta, p_reason, 'reversal:' || p_source_type, p_source_id,
    'ยกเลิกรายการเดิม',
    case when exists (select 1 from auth.users u where u.id = p_actor) then p_actor else null end
  )
  on conflict (source_type, source_id, reason) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public._award_points(uuid, uuid, text, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public._reverse_points(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public._award_points(uuid, uuid, text, text, uuid, text, uuid) to service_role;
grant execute on function public._reverse_points(text, text, uuid, uuid) to service_role;

-- 5a. lessons: attended +, no-show −
create or replace function public.points_on_lesson_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'attended' then
    perform public._reverse_points('attend_lesson', 'lesson_booking', new.id, auth.uid());
  elsif tg_op = 'UPDATE' and old.status = 'no_show' then
    perform public._reverse_points('no_show', 'lesson_booking', new.id, auth.uid());
  end if;
  if new.status = 'attended' then
    perform public._award_points(new.club_id, new.member_id, 'attend_lesson', 'lesson_booking', new.id, null, auth.uid());
  elsif new.status = 'no_show' then
    perform public._award_points(new.club_id, new.member_id, 'no_show', 'lesson_booking', new.id, null, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists points_on_lesson_booking on public.lesson_bookings;
create trigger points_on_lesson_booking
after insert or update of status on public.lesson_bookings
for each row execute function public.points_on_lesson_booking();

-- Scorecard deadline: 24 hours after the round ends (tee-off + 6 hours; 18:00 when the event has
-- no tee-off time), Bangkok time.
create or replace function public._scorecard_deadline(p_event_date date, p_tee_off time)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select ((p_event_date + coalesce(p_tee_off, time '12:00'))::timestamp at time zone 'Asia/Bangkok')
         + interval '6 hours' + interval '24 hours';
$$;

grant execute on function public._scorecard_deadline(date, time) to authenticated, service_role;

create or replace function public._award_scorecard_on_time(p_registration uuid, p_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.event_registrations;
  v_event public.events;
begin
  select * into v_reg from public.event_registrations where id = p_registration;
  if v_reg.id is null or v_reg.member_id is null then
    return null;
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  if v_event.id is null or p_at > public._scorecard_deadline(v_event.event_date, v_event.tee_off_time) then
    return null;
  end if;
  return public._award_points(v_reg.club_id, v_reg.member_id, 'scorecard_on_time', 'event_registration', v_reg.id, v_event.name, auth.uid());
end;
$$;

revoke all on function public._award_scorecard_on_time(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public._award_scorecard_on_time(uuid, timestamptz) to service_role;

-- 5b. events: check-in +, no-show −, scorecard submitted on time +
create or replace function public.points_on_event_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.member_id is null then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.checked_in_at is not null and new.checked_in_at is null then
    perform public._reverse_points('event_checkin', 'event_registration', new.id, auth.uid());
  end if;
  if new.checked_in_at is not null and (tg_op = 'INSERT' or old.checked_in_at is null) then
    perform public._award_points(new.club_id, new.member_id, 'event_checkin', 'event_registration', new.id, null, auth.uid());
  end if;

  if tg_op = 'UPDATE' and old.status = 'no_show' and new.status is distinct from 'no_show' then
    perform public._reverse_points('no_show', 'event_registration', new.id, auth.uid());
  end if;
  if new.status = 'no_show' and (tg_op = 'INSERT' or old.status is distinct from 'no_show') then
    perform public._award_points(new.club_id, new.member_id, 'no_show', 'event_registration', new.id, null, auth.uid());
  end if;

  if new.score_status = 'submitted'
     and (tg_op = 'INSERT' or old.score_status in ('not_entered', 'draft')) then
    perform public._award_scorecard_on_time(new.id, now());
  end if;
  return null;
end;
$$;

drop trigger if exists points_on_event_registration on public.event_registrations;
create trigger points_on_event_registration
after insert or update of checked_in_at, status, score_status on public.event_registrations
for each row execute function public.points_on_event_registration();

-- First card recorded for the player (manual entry, OCR or import) counts as "submitted".
create or replace function public.points_on_score_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.score_entries e
    where e.event_registration_id = new.event_registration_id
      and e.id <> new.id
      and e.created_at < new.created_at
  ) then
    perform public._award_scorecard_on_time(new.event_registration_id, new.created_at);
  end if;
  return null;
end;
$$;

drop trigger if exists points_on_score_entry on public.score_entries;
create trigger points_on_score_entry
after insert on public.score_entries
for each row execute function public.points_on_score_entry();

-- 5c. referral: the sponsor earns when the member they vouched for becomes active.
create or replace function public.points_on_member_activated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active'
     and new.sponsor_member_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform public._award_points(new.club_id, new.sponsor_member_id, 'referral', 'member', new.id, new.full_name, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists points_on_member_activated on public.members;
create trigger points_on_member_activated
after insert or update of status on public.members
for each row execute function public.points_on_member_activated();

-- 5d. manual award / deduction (reason required, audit-logged)
create or replace function public.admin_adjust_points(
  p_member uuid,
  p_delta integer,
  p_reason text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_member from public.members where id = p_member for update;
  if v_member.id is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public._is_member_admin(v_member.club_id) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;
  if p_reason not in ('staff_award', 'adjust') then
    raise exception 'INVALID_REASON' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 10000 or (p_reason = 'staff_award' and p_delta < 0) then
    raise exception 'INVALID_POINTS' using errcode = 'P0001';
  end if;
  if v_note is null then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
  values (v_member.club_id, v_member.id, p_delta, p_reason, 'manual', null, v_note, auth.uid())
  returning id into v_id;

  insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, after_data, metadata)
  values (
    v_member.club_id, auth.uid(), 'points.adjusted', 'point_txns', v_id,
    jsonb_build_object('member_id', v_member.id, 'delta', p_delta, 'reason', p_reason, 'note', v_note),
    jsonb_build_object('source', 'admin.points')
  );

  insert into public.member_notifications (club_id, member_id, channel, notification_type, subject, body, status, metadata, created_by)
  values (
    v_member.club_id, v_member.id, 'system', 'points_update',
    case when p_delta > 0 then 'ได้รับแต้มสะสม +' || p_delta else 'ปรับแต้มสะสม ' || p_delta end,
    v_note,
    'queued',
    jsonb_build_object('point_txn_id', v_id, 'delta', p_delta, 'link', '/member#points'),
    auth.uid()
  );

  return v_id;
end;
$$;

revoke all on function public.admin_adjust_points(uuid, integer, text, text) from public, anon;
grant execute on function public.admin_adjust_points(uuid, integer, text, text) to authenticated, service_role;

-- 5e. monthly leaderboard (points earned in the month; reversals net out). Names only, no contact
-- data, so members can see the top list.
create or replace function public.point_leaderboard(p_club uuid, p_month date default null, p_limit integer default 10)
returns table (
  member_id uuid,
  full_name text,
  nickname text,
  member_code text,
  avatar_url text,
  points bigint,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select date_trunc('month', coalesce(p_month, public._bangkok_today()))::date as month_start
  ), totals as (
    select t.member_id, sum(t.delta)::bigint as points
    from public.point_txns t, bounds b
    where t.club_id = p_club
      and t.reason in ('attend_lesson', 'event_checkin', 'scorecard_on_time', 'referral', 'staff_award')
      and (t.created_at at time zone 'Asia/Bangkok')::date >= b.month_start
      and (t.created_at at time zone 'Asia/Bangkok')::date < (b.month_start + interval '1 month')::date
    group by t.member_id
    having sum(t.delta) > 0
  )
  select m.id, m.full_name, m.nickname, m.member_code, m.avatar_url, tt.points,
         rank() over (order by tt.points desc)
  from totals tt
  join public.members m on m.id = tt.member_id
  where m.archived_at is null
    and (
      auth.uid() is null
      or public._is_club_staff(p_club)
      or exists (select 1 from public.members me where me.club_id = p_club and me.user_id = auth.uid() and me.archived_at is null)
    )
  order by tt.points desc, m.full_name
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

revoke all on function public.point_leaderboard(uuid, date, integer) from public, anon;
grant execute on function public.point_leaderboard(uuid, date, integer) to authenticated, service_role;

-- 5f. rewards and redemptions
create table if not exists public.point_rewards (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text,
  cost integer not null check (cost between 1 and 100000),
  stock integer check (stock is null or stock >= 0),
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists point_rewards_club_status_idx
on public.point_rewards (club_id, status, cost);

drop trigger if exists set_point_rewards_updated_at on public.point_rewards;
create trigger set_point_rewards_updated_at
before update on public.point_rewards
for each row execute function public.set_updated_at();

alter table public.point_rewards enable row level security;
grant select, insert, update on public.point_rewards to authenticated;
grant all on public.point_rewards to service_role;

drop policy if exists "point_rewards_select_club" on public.point_rewards;
create policy "point_rewards_select_club"
on public.point_rewards
for select
to authenticated
using (
  public._is_club_staff(club_id)
  or (
    status = 'active'
    and exists (select 1 from public.members m where m.club_id = point_rewards.club_id and m.user_id = (select auth.uid()))
  )
);

drop policy if exists "point_rewards_write_by_admin" on public.point_rewards;
create policy "point_rewards_write_by_admin"
on public.point_rewards
for all
to authenticated
using (public._is_member_admin(club_id))
with check (public._is_member_admin(club_id));

create table if not exists public.point_redemptions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  reward_id uuid not null references public.point_rewards(id),
  reward_name text not null,
  cost integer not null check (cost > 0),
  status text not null default 'requested' check (status in ('requested', 'fulfilled', 'cancelled')),
  note text,
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  fulfilled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancel_reason text,
  updated_at timestamptz not null default now()
);

create index if not exists point_redemptions_club_status_idx
on public.point_redemptions (club_id, status, requested_at desc);

create index if not exists point_redemptions_member_idx
on public.point_redemptions (member_id, requested_at desc);

drop trigger if exists set_point_redemptions_updated_at on public.point_redemptions;
create trigger set_point_redemptions_updated_at
before update on public.point_redemptions
for each row execute function public.set_updated_at();

alter table public.point_redemptions enable row level security;
grant select on public.point_redemptions to authenticated;
grant all on public.point_redemptions to service_role;

drop policy if exists "point_redemptions_select_own_or_staff" on public.point_redemptions;
create policy "point_redemptions_select_own_or_staff"
on public.point_redemptions
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = point_redemptions.member_id and m.user_id = (select auth.uid()))
  or public._is_club_staff(club_id)
);

-- Member redeems a reward: reward row lock (stock) + member row lock (balance) in one transaction.
create or replace function public.redeem_point_reward(p_reward uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward public.point_rewards;
  v_member public.members;
  v_balance integer;
  v_id uuid;
begin
  select * into v_reward from public.point_rewards where id = p_reward for update;
  if v_reward.id is null or v_reward.status <> 'active' then
    raise exception 'REWARD_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_member from public.members
  where user_id = auth.uid() and club_id = v_reward.club_id and archived_at is null
  limit 1
  for update;
  if v_member.id is null or v_member.status <> 'active' then
    raise exception 'MEMBER_NOT_APPROVED' using errcode = 'P0001';
  end if;

  if v_reward.stock is not null and v_reward.stock <= 0 then
    raise exception 'OUT_OF_STOCK' using errcode = 'P0001';
  end if;

  select coalesce(sum(delta), 0)::integer into v_balance from public.point_txns where member_id = v_member.id;
  if v_balance < v_reward.cost then
    raise exception 'POINTS_NOT_ENOUGH' using errcode = 'P0001';
  end if;

  insert into public.point_redemptions (club_id, member_id, reward_id, reward_name, cost, status)
  values (v_reward.club_id, v_member.id, v_reward.id, v_reward.name, v_reward.cost, 'requested')
  returning id into v_id;

  insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
  values (v_reward.club_id, v_member.id, -v_reward.cost, 'redemption', 'point_redemption', v_id, v_reward.name, auth.uid());

  if v_reward.stock is not null then
    update public.point_rewards set stock = stock - 1 where id = v_reward.id;
  end if;

  return json_build_object('redemption_id', v_id, 'balance', v_balance - v_reward.cost);
end;
$$;

revoke all on function public.redeem_point_reward(uuid) from public, anon;
grant execute on function public.redeem_point_reward(uuid) to authenticated;

-- Staff mark a redemption handed over or cancel it; the member may cancel their own request.
-- Cancelling refunds the points (an 'adjust' row tied to the redemption) and returns the stock.
create or replace function public.set_point_redemption_status(p_redemption uuid, p_status text, p_note text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.point_redemptions;
  v_is_staff boolean;
  v_is_owner boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_status not in ('fulfilled', 'cancelled') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  select * into v_row from public.point_redemptions where id = p_redemption for update;
  if v_row.id is null then
    raise exception 'REDEMPTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_is_staff := public._is_member_admin(v_row.club_id);
  v_is_owner := exists (select 1 from public.members m where m.id = v_row.member_id and m.user_id = auth.uid());
  if not v_is_staff and not (v_is_owner and p_status = 'cancelled') then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'REDEMPTION_CLOSED' using errcode = 'P0001';
  end if;

  if p_status = 'fulfilled' then
    update public.point_redemptions
    set status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid(), note = coalesce(v_note, note)
    where id = v_row.id;
  else
    update public.point_redemptions
    set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_note
    where id = v_row.id;

    insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
    values (v_row.club_id, v_row.member_id, v_row.cost, 'adjust', 'point_redemption', v_row.id,
            'คืนแต้มสะสม ยกเลิกการแลก ' || v_row.reward_name, auth.uid())
    on conflict (source_type, source_id, reason) do nothing;

    update public.point_rewards set stock = stock + 1 where id = v_row.reward_id and stock is not null;
  end if;

  if v_is_staff then
    insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
    values (
      v_row.club_id, auth.uid(), 'point_redemption.' || p_status, 'point_redemptions', v_row.id,
      jsonb_build_object('status', v_row.status),
      jsonb_build_object('status', p_status, 'note', v_note),
      jsonb_build_object('member_id', v_row.member_id, 'source', 'admin.points')
    );

    insert into public.member_notifications (club_id, member_id, channel, notification_type, subject, body, status, metadata, created_by)
    values (
      v_row.club_id, v_row.member_id, 'system', 'points_update',
      case when p_status = 'fulfilled' then 'รับของรางวัลแล้ว' else 'ยกเลิกการแลกของรางวัล' end,
      case when p_status = 'fulfilled'
        then v_row.reward_name
        else v_row.reward_name || ' คืนแต้มสะสม ' || v_row.cost || ' แต้มสะสมแล้ว' || coalesce(' (' || v_note || ')', '')
      end,
      'queued',
      jsonb_build_object('redemption_id', v_row.id, 'link', '/member#points'),
      auth.uid()
    );
  end if;

  return json_build_object('redemption_id', v_row.id, 'status', p_status);
end;
$$;

revoke all on function public.set_point_redemption_status(uuid, text, text) from public, anon;
grant execute on function public.set_point_redemption_status(uuid, text, text) to authenticated, service_role;

-- ---------- 6. PDPA data requests ----------
create table if not exists public.member_data_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  request_type text not null default 'delete' check (request_type in ('delete')),
  status text not null default 'open' check (status in ('open', 'done', 'rejected')),
  note text,
  resolution_note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create unique index if not exists member_data_requests_one_open_key
on public.member_data_requests (member_id, request_type)
where status = 'open';

create index if not exists member_data_requests_club_status_idx
on public.member_data_requests (club_id, status, created_at desc);

alter table public.member_data_requests enable row level security;
grant select, insert, update on public.member_data_requests to authenticated;
grant all on public.member_data_requests to service_role;

drop policy if exists "data_requests_select_own_or_admin" on public.member_data_requests;
create policy "data_requests_select_own_or_admin"
on public.member_data_requests
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = member_data_requests.member_id and m.user_id = (select auth.uid()))
  or public._is_member_admin(club_id)
);

drop policy if exists "data_requests_insert_own" on public.member_data_requests;
create policy "data_requests_insert_own"
on public.member_data_requests
for insert
to authenticated
with check (
  status = 'open'
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.members m
    where m.id = member_data_requests.member_id
      and m.club_id = member_data_requests.club_id
      and m.user_id = (select auth.uid())
  )
);

drop policy if exists "data_requests_update_by_admin" on public.member_data_requests;
create policy "data_requests_update_by_admin"
on public.member_data_requests
for update
to authenticated
using (public._is_member_admin(club_id))
with check (public._is_member_admin(club_id));

insert into supabase_migrations.schema_migrations (version, name) values ('20261123094000', 'membership_points') on conflict (version) do nothing;

-- ====================================================================
-- 20261123095000_payments_files
-- ====================================================================
-- Payments & files (UX/UI audit phase 2–3, Nov 2026):
--
-- 1. files: width/height of images and `deleted_at` when the stored object was removed
--    (slip retention). `checksum` already holds the sha256 computed by the app.
-- 2. payment-proofs bucket: 10 MB limit (audit: PDF up to 10 MB; photos are shrunk on the phone).
-- 3. club_payment_settings: automatic slip check switch and slip retention days (PDPA, default 365).
-- 4. Receipts: an approved payment gets a receipt number per club per Buddhist year,
--    "RC2569-000123", assigned atomically by a trigger (counter row locked by the upsert), issued
--    once and never changed or re-used, even if the payment is later refunded.
-- 5. The same slip file (sha256) can back only one approved payment per club. The same bank
--    transaction reference is already unique (payment_records_slip_transaction_ref_key).
-- 6. payment_slip_files_due_for_purge(): slip files of settled payments older than the club's
--    retention days, for the daily cron (service role only). Pending/review slips are never listed.

-- 1. files ------------------------------------------------------------------------------------
alter table public.files
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'files_dimensions_check') then
    alter table public.files
      add constraint files_dimensions_check
      check ((width is null or width > 0) and (height is null or height > 0));
  end if;
end $$;

create index if not exists files_club_checksum_idx
on public.files (club_id, checksum)
where checksum is not null;

create index if not exists files_live_bucket_created_idx
on public.files (bucket, created_at)
where deleted_at is null;

create index if not exists payment_records_slip_file_idx
on public.payment_records (slip_file_id)
where slip_file_id is not null;

-- 2. storage ----------------------------------------------------------------------------------
update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'payment-proofs';

-- 3. club payment settings --------------------------------------------------------------------
alter table public.club_payment_settings
  add column if not exists auto_verify boolean not null default true,
  add column if not exists slip_retention_days integer not null default 365;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_payment_settings_retention_check') then
    alter table public.club_payment_settings
      add constraint club_payment_settings_retention_check
      check (slip_retention_days between 30 and 3650);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_payment_settings_text_check') then
    alter table public.club_payment_settings
      add constraint club_payment_settings_text_check
      check (
        coalesce(char_length(account_name), 0) <= 120
        and coalesce(char_length(bank_name), 0) <= 120
        and coalesce(char_length(bank_account_no), 0) <= 30
        and coalesce(char_length(note), 0) <= 500
      );
  end if;
end $$;

-- 4. receipts ---------------------------------------------------------------------------------
alter table public.payment_records
  add column if not exists receipt_no text,
  add column if not exists receipt_issued_at timestamptz;

create unique index if not exists payment_records_receipt_no_key
on public.payment_records (club_id, receipt_no)
where receipt_no is not null;

-- One counter row per club and Buddhist year. Written only by the trigger below.
create table if not exists public.payment_receipt_counters (
  club_id uuid not null references public.clubs(id) on delete cascade,
  be_year integer not null check (be_year between 2500 and 2700),
  last_no integer not null default 0 check (last_no >= 0),
  updated_at timestamptz not null default now(),
  primary key (club_id, be_year)
);

alter table public.payment_receipt_counters enable row level security;
revoke all on public.payment_receipt_counters from anon, authenticated;
grant select on public.payment_receipt_counters to authenticated;
grant all on public.payment_receipt_counters to service_role;

drop policy if exists "payment_receipt_counters_select_by_finance" on public.payment_receipt_counters;
create policy "payment_receipt_counters_select_by_finance"
on public.payment_receipt_counters
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = payment_receipt_counters.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'finance_officer', 'auditor')
  )
);

-- "RC2569-000123": club-wide running number per Buddhist year of the approval (Bangkok time).
create or replace function public.format_receipt_no(p_be_year integer, p_no integer)
returns text
language sql
immutable
set search_path = public
as $$
  select 'RC' || p_be_year::text || '-' || lpad(p_no::text, 6, '0');
$$;

revoke all on function public.format_receipt_no(integer, integer) from public, anon;
grant execute on function public.format_receipt_no(integer, integer) to authenticated, service_role;

-- BEFORE INSERT OR UPDATE on payment_records. Security definer so the counter (no write policy)
-- can be advanced for whoever approves: finance staff through RLS or the service role
-- (automatic slip check). Callers cannot set or change receipt fields themselves.
create or replace function public.assign_payment_receipt_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer;
  v_no integer;
begin
  if tg_op = 'UPDATE' then
    new.receipt_no := old.receipt_no;
    new.receipt_issued_at := old.receipt_issued_at;
  else
    new.receipt_no := null;
    new.receipt_issued_at := null;
  end if;

  if new.status = 'approved' and new.receipt_no is null then
    v_year := extract(year from (now() at time zone 'Asia/Bangkok'))::integer + 543;

    -- The upsert locks the counter row until this transaction ends, so concurrent approvals in
    -- the same club queue here and every number is used exactly once (a failed statement rolls
    -- its increment back with it).
    insert into public.payment_receipt_counters as c (club_id, be_year, last_no)
    values (new.club_id, v_year, 1)
    on conflict (club_id, be_year)
    do update set last_no = c.last_no + 1, updated_at = now()
    returning c.last_no into v_no;

    new.receipt_no := public.format_receipt_no(v_year, v_no);
    new.receipt_issued_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.assign_payment_receipt_no() from public, anon;
grant execute on function public.assign_payment_receipt_no() to authenticated, service_role;

drop trigger if exists payment_records_assign_receipt_no on public.payment_records;

-- Payments approved before receipts existed get numbers in approval order (once, before the
-- trigger starts guarding the column), and the counters continue after them.
with ranked as (
  select
    p.id,
    p.club_id,
    extract(year from (coalesce(p.reviewed_at, p.updated_at, p.created_at) at time zone 'Asia/Bangkok'))::integer + 543 as be_year,
    row_number() over (
      partition by p.club_id, extract(year from (coalesce(p.reviewed_at, p.updated_at, p.created_at) at time zone 'Asia/Bangkok'))
      order by coalesce(p.reviewed_at, p.updated_at, p.created_at), p.id
    )::integer as n
  from public.payment_records p
  where p.status = 'approved'
    and p.receipt_no is null
)
update public.payment_records p
set
  receipt_no = public.format_receipt_no(
    r.be_year,
    r.n + coalesce((select c.last_no from public.payment_receipt_counters c where c.club_id = r.club_id and c.be_year = r.be_year), 0)
  ),
  receipt_issued_at = coalesce(p.reviewed_at, p.updated_at, p.created_at)
from ranked r
where p.id = r.id;

insert into public.payment_receipt_counters as c (club_id, be_year, last_no)
select
  p.club_id,
  substring(p.receipt_no from 3 for 4)::integer,
  max(substring(p.receipt_no from 8)::integer)
from public.payment_records p
where p.receipt_no ~ '^RC[0-9]{4}-[0-9]{6,}$'
group by p.club_id, substring(p.receipt_no from 3 for 4)::integer
on conflict (club_id, be_year)
do update set last_no = greatest(c.last_no, excluded.last_no), updated_at = now();

create trigger payment_records_assign_receipt_no
before insert or update on public.payment_records
for each row execute function public.assign_payment_receipt_no();

-- 5. one approved payment per slip file -------------------------------------------------------
create unique index if not exists payment_records_slip_sha256_approved_key
on public.payment_records (club_id, slip_sha256)
where slip_sha256 is not null and status = 'approved';

-- 6. slip retention ---------------------------------------------------------------------------
-- Slip files whose payments were settled (approved / rejected / refunded) longer ago than the
-- club's retention days. Files still attached to a pending or in-review payment are never listed.
-- Orphans (replaced by a newer slip) count from their upload time.
create or replace function public.payment_slip_files_due_for_purge(p_limit integer default 500)
returns table (file_id uuid, club_id uuid, bucket text, object_path text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.club_id, f.bucket, f.object_path
  from public.files f
  left join public.club_payment_settings s on s.club_id = f.club_id
  where f.bucket = 'payment-proofs'
    and f.deleted_at is null
    and f.created_at < now() - make_interval(days => coalesce(s.slip_retention_days, 365))
    and not exists (
      select 1
      from public.payment_records p
      where p.slip_file_id = f.id
        and (
          p.status in ('pending', 'review')
          or coalesce(p.reviewed_at, p.updated_at) > now() - make_interval(days => coalesce(s.slip_retention_days, 365))
        )
    )
  order by f.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.payment_slip_files_due_for_purge(integer) from public, anon, authenticated;
grant execute on function public.payment_slip_files_due_for_purge(integer) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261123095000', 'payments_files') on conflict (version) do nothing;

-- ====================================================================
-- 20261123097000_golf_courses_handicap
-- ====================================================================
-- Track 6 (events): golf courses + tees, club handicap inputs, flights, prizes and the
-- two-step scorecard confirmation (player, then marker).
--
--   golf_courses / golf_course_tees  course data per tee: course rating, slope, par and stroke
--                                    index per hole (18 values each; SI is a permutation 1-18)
--   events.course_id/course_tee_id   the course and default tee an event is played on
--   members.official_handicap_index  "Handicap Index ทางการ" (WHS index issued by an authorised
--                                    association), kept apart from the computed "แต้มต่อชมรม"
--   event_pairing_groups.flight      flight label (A/B/C) set by the automatic flight grouping
--   event_prizes                     prizes per event; rows with a member are mirrored into
--                                    member_awards so the member page lists them
--   score_entry_confirmations        append-only "player confirmed" / "marker confirmed" marks on
--                                    a score entry; both together verify the card
--
-- The club handicap itself is computed in the app (src/lib/scoring/handicap.ts) from verified
-- cards of competitions whose rules carry a course rating and slope.

-- ---------- validation helpers ----------
create or replace function public._valid_hole_pars(p smallint[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(cardinality(p) = 18 and array_ndims(p) = 1, false)
     and not exists (select 1 from unnest(p) v where v is null or v < 3 or v > 6);
$$;

create or replace function public._valid_stroke_index(p smallint[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(cardinality(p) = 18 and array_ndims(p) = 1, false)
     and coalesce(
       (select array_agg(v order by v) from unnest(p) v)
         = (select array_agg(g::smallint order by g) from generate_series(1, 18) g),
       false
     );
$$;

-- ---------- courses ----------
create table if not exists public.golf_courses (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  province text check (province is null or length(province) <= 80),
  note text check (note is null or length(note) <= 1000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create unique index if not exists golf_courses_club_name_active_idx
on public.golf_courses (club_id, lower(btrim(name)))
where archived_at is null;

drop trigger if exists set_golf_courses_updated_at on public.golf_courses;
create trigger set_golf_courses_updated_at
before update on public.golf_courses
for each row execute function public.set_updated_at();

create table if not exists public.golf_course_tees (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  course_id uuid not null references public.golf_courses(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  color text check (color is null or color in ('black', 'gold', 'blue', 'white', 'yellow', 'green', 'red', 'silver', 'orange')),
  course_rating numeric(4,1) check (course_rating is null or course_rating between 50 and 90),
  slope_rating smallint check (slope_rating is null or slope_rating between 55 and 155),
  par smallint[] not null check (public._valid_hole_pars(par)),
  stroke_index smallint[] not null check (public._valid_stroke_index(stroke_index)),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create unique index if not exists golf_course_tees_course_name_active_idx
on public.golf_course_tees (course_id, lower(btrim(name)))
where archived_at is null;

create index if not exists golf_course_tees_club_idx on public.golf_course_tees (club_id, course_id);

drop trigger if exists set_golf_course_tees_updated_at on public.golf_course_tees;
create trigger set_golf_course_tees_updated_at
before update on public.golf_course_tees
for each row execute function public.set_updated_at();

-- A tee always belongs to its course's club.
create or replace function public.golf_course_tee_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.club_id into new.club_id from public.golf_courses c where c.id = new.course_id;
  if new.club_id is null then
    raise exception 'COURSE_NOT_FOUND' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists golf_course_tee_club on public.golf_course_tees;
create trigger golf_course_tee_club
before insert or update of course_id, club_id on public.golf_course_tees
for each row execute function public.golf_course_tee_club();

alter table public.golf_courses enable row level security;
alter table public.golf_course_tees enable row level security;
grant select, insert, update, delete on public.golf_courses, public.golf_course_tees to authenticated;
grant all on public.golf_courses, public.golf_course_tees to service_role;

drop policy if exists "golf_courses_select_club" on public.golf_courses;
create policy "golf_courses_select_club" on public.golf_courses for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.club_id = golf_courses.club_id and ur.user_id = (select auth.uid()))
  or exists (
    select 1 from public.members m
    where m.club_id = golf_courses.club_id and m.user_id = (select auth.uid()) and m.archived_at is null
  )
);
drop policy if exists "golf_courses_write_staff" on public.golf_courses;
create policy "golf_courses_write_staff" on public.golf_courses for all to authenticated
using (public._is_scoring_staff(club_id)) with check (public._is_scoring_staff(club_id));

drop policy if exists "golf_course_tees_select_club" on public.golf_course_tees;
create policy "golf_course_tees_select_club" on public.golf_course_tees for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.club_id = golf_course_tees.club_id and ur.user_id = (select auth.uid()))
  or exists (
    select 1 from public.members m
    where m.club_id = golf_course_tees.club_id and m.user_id = (select auth.uid()) and m.archived_at is null
  )
);
drop policy if exists "golf_course_tees_write_staff" on public.golf_course_tees;
create policy "golf_course_tees_write_staff" on public.golf_course_tees for all to authenticated
using (public._is_scoring_staff(club_id)) with check (public._is_scoring_staff(club_id));

-- ---------- events: course + default tee ----------
alter table public.events
  add column if not exists course_id uuid references public.golf_courses(id) on delete set null,
  add column if not exists course_tee_id uuid references public.golf_course_tees(id) on delete set null;

create index if not exists events_course_tee_idx on public.events (course_tee_id) where course_tee_id is not null;

-- The tee decides the course; both must belong to the event's club.
create or replace function public.event_course_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_club uuid;
begin
  if new.course_tee_id is not null then
    select t.course_id, t.club_id into v_course, v_club from public.golf_course_tees t where t.id = new.course_tee_id;
    if v_course is null or v_club <> new.club_id then
      raise exception 'COURSE_TEE_MISMATCH' using errcode = 'P0001';
    end if;
    new.course_id := v_course;
  elsif new.course_id is not null then
    select c.club_id into v_club from public.golf_courses c where c.id = new.course_id;
    if v_club is null or v_club <> new.club_id then
      raise exception 'COURSE_TEE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists event_course_consistency on public.events;
create trigger event_course_consistency
before insert or update of course_id, course_tee_id, club_id on public.events
for each row execute function public.event_course_consistency();

-- ---------- members: official WHS index ----------
alter table public.members
  add column if not exists official_handicap_index numeric(3,1)
    check (official_handicap_index is null or official_handicap_index between -10 and 54),
  add column if not exists official_handicap_updated_at timestamptz;

-- Member (own row) or club staff sets the official index. Writes an audit row.
create or replace function public.set_official_handicap_index(p_member_id uuid, p_index numeric)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_value numeric(3,1);
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  select * into v_member from public.members where id = p_member_id and archived_at is null for update;
  if v_member.id is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_member.user_id is distinct from auth.uid() and not public._is_scoring_staff(v_member.club_id) then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_index is not null and (p_index < -10 or p_index > 54) then
    raise exception 'INVALID_INDEX' using errcode = 'P0001';
  end if;
  v_value := round(p_index, 1);

  update public.members
  set official_handicap_index = v_value,
      official_handicap_updated_at = now(),
      updated_by = auth.uid()
  where id = v_member.id;

  insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
  values (
    v_member.club_id, auth.uid(), 'member.official_handicap_set', 'members', v_member.id,
    jsonb_build_object('official_handicap_index', v_member.official_handicap_index),
    jsonb_build_object('official_handicap_index', v_value),
    jsonb_build_object('source', case when v_member.user_id = auth.uid() then 'member.self' else 'staff' end)
  );

  return json_build_object('member_id', v_member.id, 'official_handicap_index', v_value);
end;
$$;

revoke all on function public.set_official_handicap_index(uuid, numeric) from public, anon;
grant execute on function public.set_official_handicap_index(uuid, numeric) to authenticated, service_role;

-- ---------- pairing groups: flight label ----------
alter table public.event_pairing_groups
  add column if not exists flight text check (flight is null or length(flight) <= 40);

-- ---------- prizes ----------
create table if not exists public.event_prizes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  category text not null check (category in (
    'best_gross', 'best_net', 'best_stableford', 'flight_winner', 'longest_drive', 'nearest_pin', 'special'
  )),
  rank smallint not null default 1 check (rank between 1 and 20),
  flight text check (flight is null or length(flight) <= 40),
  -- special prize name, or the hole for longest drive / nearest to pin ("หลุม 7")
  label text check (label is null or length(label) <= 120),
  member_id uuid references public.members(id) on delete cascade,
  event_registration_id uuid references public.event_registrations(id) on delete set null,
  guest_name text check (guest_name is null or length(guest_name) <= 160),
  note text check (note is null or length(note) <= 500),
  source text not null default 'manual' check (source in ('manual', 'leaderboard')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint event_prizes_winner_check check (member_id is not null or nullif(btrim(guest_name), '') is not null),
  constraint event_prizes_flight_required check (category <> 'flight_winner' or nullif(btrim(flight), '') is not null)
);

create unique index if not exists event_prizes_slot_idx
on public.event_prizes (event_id, category, coalesce(flight, ''), coalesce(label, ''), rank);

create index if not exists event_prizes_member_idx on public.event_prizes (member_id) where member_id is not null;

drop trigger if exists set_event_prizes_updated_at on public.event_prizes;
create trigger set_event_prizes_updated_at
before update on public.event_prizes
for each row execute function public.set_updated_at();

-- Same club as the event; winner must be in that club; a registration must be of that event.
create or replace function public.event_prize_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.event_registrations;
begin
  select e.club_id into new.club_id from public.events e where e.id = new.event_id;
  if new.club_id is null then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if new.event_registration_id is not null then
    select * into v_reg from public.event_registrations where id = new.event_registration_id;
    if v_reg.id is null or v_reg.event_id <> new.event_id then
      raise exception 'PRIZE_WINNER_MISMATCH' using errcode = 'P0001';
    end if;
    if new.member_id is null and v_reg.member_id is not null then
      new.member_id := v_reg.member_id;
    end if;
    if new.member_id is null and new.guest_name is null then
      new.guest_name := v_reg.guest_name;
    end if;
  end if;
  if new.member_id is not null and not exists (
    select 1 from public.members m where m.id = new.member_id and m.club_id = new.club_id
  ) then
    raise exception 'PRIZE_WINNER_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists event_prize_consistency on public.event_prizes;
create trigger event_prize_consistency
before insert or update on public.event_prizes
for each row execute function public.event_prize_consistency();

create or replace function public._event_prize_title(p_category text, p_rank smallint, p_flight text, p_label text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_category
      when 'best_gross' then 'สกอร์รวมดีที่สุด (Best Gross)'
      when 'best_net' then 'สกอร์สุทธิดีที่สุด (Best Net)'
      when 'best_stableford' then 'สเตเบิลฟอร์ดสูงสุด'
      when 'flight_winner' then case when p_rank = 1 then 'ชนะเลิศไฟลท์ ' || coalesce(p_flight, '') else 'ไฟลท์ ' || coalesce(p_flight, '') end
      when 'longest_drive' then 'ไดรฟ์ไกลที่สุด (Longest Drive)'
      when 'nearest_pin' then 'ใกล้ธงที่สุด (Nearest to Pin)'
      else coalesce(nullif(btrim(p_label), ''), 'รางวัลพิเศษ')
    end
    || case when p_category in ('longest_drive', 'nearest_pin') and nullif(btrim(p_label), '') is not null then ' ' || btrim(p_label) else '' end
    || case when p_rank > 1 then ' อันดับ ' || p_rank::text else '' end;
$$;

alter table public.member_awards
  add column if not exists event_prize_id uuid references public.event_prizes(id) on delete cascade;

create unique index if not exists member_awards_event_prize_idx
on public.member_awards (event_prize_id) where event_prize_id is not null;

-- Mirror prize winners (members only) into member_awards for the member page.
create or replace function public.event_prize_mirror_award()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
begin
  delete from public.member_awards where event_prize_id = new.id;
  if new.member_id is not null then
    select * into v_event from public.events where id = new.event_id;
    insert into public.member_awards (club_id, member_id, event_id, title, award_type, awarded_at, note, created_by, event_prize_id)
    values (
      new.club_id, new.member_id, new.event_id,
      public._event_prize_title(new.category, new.rank, new.flight, new.label),
      'competition', v_event.event_date, new.note, coalesce(auth.uid(), new.created_by), new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists event_prize_mirror_award on public.event_prizes;
create trigger event_prize_mirror_award
after insert or update on public.event_prizes
for each row execute function public.event_prize_mirror_award();

alter table public.event_prizes enable row level security;
grant select, insert, update, delete on public.event_prizes to authenticated;
grant all on public.event_prizes to service_role;

drop policy if exists "event_prizes_select_club" on public.event_prizes;
create policy "event_prizes_select_club" on public.event_prizes for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.club_id = event_prizes.club_id and ur.user_id = (select auth.uid()))
  or exists (
    select 1 from public.members m
    where m.club_id = event_prizes.club_id and m.user_id = (select auth.uid()) and m.archived_at is null
  )
);
drop policy if exists "event_prizes_write_staff" on public.event_prizes;
create policy "event_prizes_write_staff" on public.event_prizes for all to authenticated
using (public._is_scoring_staff(club_id)) with check (public._is_scoring_staff(club_id));

-- ---------- scorecard confirmations (player, then marker) ----------
create table if not exists public.score_entry_confirmations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  score_entry_id uuid not null references public.score_entries(id) on delete cascade,
  event_registration_id uuid not null references public.event_registrations(id) on delete cascade,
  role text not null check (role in ('player', 'marker')),
  confirmed_by uuid references auth.users(id),
  confirmed_by_member_id uuid references public.members(id) on delete set null,
  -- true when staff recorded it on the player's / marker's behalf
  recorded_by_staff boolean not null default false,
  created_at timestamptz not null default now(),
  unique (score_entry_id, role)
);

create index if not exists score_entry_confirmations_competition_idx
on public.score_entry_confirmations (competition_id, event_registration_id);

-- Append-only: a confirmation is never edited (a corrected card is a new entry).
create or replace function public.score_entry_confirmations_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'CONFIRMATION_IMMUTABLE' using errcode = 'P0001';
end;
$$;

drop trigger if exists score_entry_confirmations_immutable on public.score_entry_confirmations;
create trigger score_entry_confirmations_immutable
before update on public.score_entry_confirmations
for each row execute function public.score_entry_confirmations_immutable();

alter table public.score_entry_confirmations enable row level security;
grant select on public.score_entry_confirmations to authenticated;
grant all on public.score_entry_confirmations to service_role;

drop policy if exists "score_confirmations_select" on public.score_entry_confirmations;
create policy "score_confirmations_select" on public.score_entry_confirmations for select to authenticated
using (
  public._is_scoring_staff(club_id)
  or exists (
    select 1 from public.event_registrations r join public.members m on m.id = r.member_id
    where r.id = score_entry_confirmations.event_registration_id and m.user_id = (select auth.uid())
  )
);

-- Confirm the latest card of a registration.
--   player: the player themself, or scoring staff on their behalf
--   marker: another player of the same pairing group, or scoring staff; only after the player
-- When both exist the card becomes the verified score (verified_scores upsert).
create or replace function public.confirm_score_entry(p_entry_id uuid, p_role text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.score_entries;
  v_competition public.competitions;
  v_reg public.event_registrations;
  v_member public.members;
  v_staff boolean;
  v_latest uuid;
  v_by_staff boolean;
  v_player boolean;
  v_marker boolean;
  v_verified boolean := false;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_role is null or p_role not in ('player', 'marker') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;

  select * into v_entry from public.score_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- serialise confirmations of one competition
  select * into v_competition from public.competitions where id = v_entry.competition_id for update;
  if v_competition.status = 'archived' then
    raise exception 'COMPETITION_LOCKED' using errcode = 'P0001';
  end if;

  select e.id into v_latest
  from public.score_entries e
  where e.event_registration_id = v_entry.event_registration_id and e.competition_id = v_entry.competition_id
  order by e.created_at desc, e.id desc
  limit 1;
  if v_latest <> v_entry.id then
    raise exception 'ENTRY_SUPERSEDED' using errcode = 'P0001';
  end if;

  select * into v_reg from public.event_registrations where id = v_entry.event_registration_id;
  v_staff := public._is_scoring_staff(v_entry.club_id);
  select * into v_member
  from public.members
  where user_id = auth.uid() and club_id = v_entry.club_id and archived_at is null
  limit 1;

  if p_role = 'player' then
    v_by_staff := v_member.id is null or v_member.id is distinct from v_reg.member_id;
    if v_by_staff and not v_staff then
      raise exception 'NOT_ALLOWED' using errcode = 'P0001';
    end if;
  else
    if not exists (select 1 from public.score_entry_confirmations where score_entry_id = v_entry.id and role = 'player') then
      raise exception 'PLAYER_NOT_CONFIRMED' using errcode = 'P0001';
    end if;
    v_by_staff := not (
      v_member.id is not null
      and v_member.id is distinct from v_reg.member_id
      and v_reg.pairing_group_id is not null
      and exists (
        select 1 from public.event_registrations r
        where r.pairing_group_id = v_reg.pairing_group_id
          and r.member_id = v_member.id
          and r.id <> v_reg.id
          and public._event_seat_status(r.status)
      )
    );
    if v_by_staff and not v_staff then
      raise exception 'NOT_ALLOWED' using errcode = 'P0001';
    end if;
  end if;

  insert into public.score_entry_confirmations (
    club_id, competition_id, score_entry_id, event_registration_id, role, confirmed_by, confirmed_by_member_id, recorded_by_staff
  ) values (
    v_entry.club_id, v_entry.competition_id, v_entry.id, v_entry.event_registration_id, p_role, auth.uid(),
    case when v_by_staff then null else v_member.id end, v_by_staff
  )
  on conflict (score_entry_id, role) do nothing;

  select coalesce(bool_or(role = 'player'), false), coalesce(bool_or(role = 'marker'), false)
  into v_player, v_marker
  from public.score_entry_confirmations
  where score_entry_id = v_entry.id;

  if v_player and v_marker then
    insert into public.verified_scores (club_id, competition_id, event_registration_id, score_entry_id, verified_at, verified_by)
    values (v_entry.club_id, v_entry.competition_id, v_entry.event_registration_id, v_entry.id, now(), auth.uid())
    on conflict (competition_id, event_registration_id)
    do update set score_entry_id = excluded.score_entry_id, verified_at = excluded.verified_at, verified_by = excluded.verified_by;
    v_verified := true;
  end if;

  insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, after_data, metadata)
  values (
    v_entry.club_id, auth.uid(), 'score.confirmed_' || p_role, 'score_entries', v_entry.id,
    jsonb_build_object('role', p_role, 'recorded_by_staff', v_by_staff, 'verified', v_verified),
    jsonb_build_object('registration_id', v_entry.event_registration_id, 'competition_id', v_entry.competition_id, 'source', 'db.confirm_score_entry')
  );

  return json_build_object('player', v_player, 'marker', v_marker, 'verified', v_verified);
end;
$$;

revoke all on function public.confirm_score_entry(uuid, text) from public, anon;
grant execute on function public.confirm_score_entry(uuid, text) to authenticated, service_role;

-- Cards waiting on the caller: their own latest card (player step) and group-mates' cards that
-- the player already confirmed (marker step). Only events of the last 14 days.
create or replace function public.member_pending_score_cards()
returns table (
  score_entry_id uuid,
  event_registration_id uuid,
  event_id uuid,
  event_name text,
  event_date date,
  player_name text,
  is_own boolean,
  strokes smallint[],
  pickups boolean[],
  pars jsonb,
  player_confirmed boolean,
  marker_confirmed boolean,
  entered_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select m.id, m.club_id from public.members m
    where m.user_id = auth.uid() and m.archived_at is null
  ),
  mine as (
    select r.id, r.pairing_group_id from public.event_registrations r join me on me.id = r.member_id
    where public._event_seat_status(r.status)
  ),
  candidates as (
    select r.id as registration_id, (r.member_id = (select id from me limit 1)) as is_own
    from public.event_registrations r
    where r.id in (select id from mine)
       or (r.pairing_group_id is not null
           and r.pairing_group_id in (select pairing_group_id from mine where pairing_group_id is not null)
           and public._event_seat_status(r.status))
  ),
  latest as (
    select distinct on (e.event_registration_id) e.*
    from public.score_entries e
    where e.event_registration_id in (select registration_id from candidates)
    order by e.event_registration_id, e.created_at desc, e.id desc
  )
  select
    l.id, l.event_registration_id, ev.id, ev.name, ev.event_date,
    coalesce(case when mb.nickname is not null and mb.nickname <> '' then mb.full_name || ' (' || mb.nickname || ')' else mb.full_name end, r.guest_name, 'ผู้เล่น'),
    c.is_own, l.strokes, l.pickups, coalesce(comp.rules -> 'pars', '[]'::jsonb),
    exists (select 1 from public.score_entry_confirmations x where x.score_entry_id = l.id and x.role = 'player'),
    exists (select 1 from public.score_entry_confirmations x where x.score_entry_id = l.id and x.role = 'marker'),
    l.created_at
  from latest l
  join candidates c on c.registration_id = l.event_registration_id
  join public.event_registrations r on r.id = l.event_registration_id
  join public.events ev on ev.id = r.event_id
  join public.competitions comp on comp.id = l.competition_id
  left join public.members mb on mb.id = r.member_id
  where comp.status in ('setup', 'scoring', 'published')
    and ev.event_date >= (now() at time zone 'Asia/Bangkok')::date - 14
    and not exists (
      select 1 from public.verified_scores v
      where v.competition_id = l.competition_id and v.event_registration_id = l.event_registration_id and v.score_entry_id = l.id
    )
  order by ev.event_date desc, c.is_own desc, l.created_at;
$$;

revoke all on function public.member_pending_score_cards() from public, anon;
grant execute on function public.member_pending_score_cards() to authenticated, service_role;

-- ---------- wording: waitlist is "คิวสำรอง" ----------
-- Same function as 20261107090000, only the notification text changes.
create or replace function public._promote_event_waitlist(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_free integer;
  v_promoted integer := 0;
  v_row record;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null or v_event.status not in ('open', 'closed') then
    return 0;
  end if;

  if v_event.capacity is null or v_event.capacity <= 0 then
    v_free := 2147483647;
  else
    v_free := v_event.capacity - public._event_seats_taken(p_event_id);
  end if;

  for v_row in
    select r.id, r.member_id, m.full_name, m.email
    from public.event_registrations r
    left join public.members m on m.id = r.member_id
    where r.event_id = p_event_id
      and r.status = 'waitlist'
    order by r.created_at, r.id
    limit greatest(v_free, 0)
  loop
    update public.event_registrations
    set status = case when v_event.member_price > 0 then 'pending_payment' else 'registered' end,
        promoted_at = now(),
        updated_by = coalesce(auth.uid(), updated_by)
    where id = v_row.id;

    if v_row.member_id is not null then
      insert into public.member_notifications (
        club_id, member_id, channel, notification_type, recipient, subject, body, status, metadata
      ) values (
        v_event.club_id,
        v_row.member_id,
        case when v_row.email is null then 'system' else 'email' end,
        'event_update',
        v_row.email,
        'ได้รับสิทธิ์เข้าร่วม ' || v_event.name,
        'เรียน ' || coalesce(v_row.full_name, 'สมาชิก') || ' มีที่ว่างในกิจกรรม ' || v_event.name ||
          ' วันที่ ' || to_char(v_event.event_date, 'DD/MM/YYYY') || ' แล้ว คุณได้เลื่อนจากคิวสำรอง' ||
          case when v_event.member_price > 0 then ' กรุณาชำระเงินและแนบสลิปในหน้าสมาชิก' else '' end,
        'queued',
        jsonb_build_object('event_id', v_event.id, 'registration_id', v_row.id, 'trigger', 'event.waitlist_promoted')
      );
    end if;

    insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
    values (
      v_event.club_id, auth.uid(), 'event_registration.waitlist_promoted', 'event_registrations', v_row.id,
      jsonb_build_object('status', 'waitlist'),
      jsonb_build_object('status', case when v_event.member_price > 0 then 'pending_payment' else 'registered' end),
      jsonb_build_object('event_id', v_event.id, 'source', 'db.waitlist')
    );

    v_promoted := v_promoted + 1;
  end loop;

  return v_promoted;
end;
$$;

revoke all on function public._promote_event_waitlist(uuid) from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261123097000', 'golf_courses_handicap') on conflict (version) do nothing;

-- ====================================================================
-- 20261123098000_scope_club_read_policies
-- ====================================================================
-- Club-wide read policies used to accept ANY user_roles row in the club. The seed script gives
-- regular members a `member` role row, and lessons v2 adds `coach`; with the old policies either
-- could read every member's phone/e-mail/employee code, every notification, every event
-- registration and every file record. Limit the club-wide branch to staff roles. Members keep
-- their own-row policies (members_select_own_profile, registrations_select_own, own
-- notifications/awards below); coaches read their learners through lesson_slot_roster().

drop policy if exists "members_select_by_club" on public.members;
create policy "members_select_by_club"
on public.members
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = members.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "member_notifications_select_own_or_admin" on public.member_notifications;
create policy "member_notifications_select_own_or_admin"
on public.member_notifications
for select
to authenticated
using (
  exists (
    select 1
    from public.members m
    where m.id = member_notifications.member_id
      and m.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.user_roles ur
    where ur.club_id = member_notifications.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "registrations_select_by_club" on public.event_registrations;
create policy "registrations_select_by_club"
on public.event_registrations
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = event_registrations.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "files_select_by_club" on public.files;
create policy "files_select_by_club"
on public.files
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = files.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "awards_read_own_or_admin" on public.member_awards;
create policy "awards_read_own_or_admin"
on public.member_awards
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = member_awards.member_id and m.user_id = (select auth.uid()))
  or exists (
    select 1 from public.user_roles ur
    where ur.club_id = member_awards.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);

insert into supabase_migrations.schema_migrations (version, name) values ('20261123098000', 'scope_club_read_policies') on conflict (version) do nothing;

commit;
