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
