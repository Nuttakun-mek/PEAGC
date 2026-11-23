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
