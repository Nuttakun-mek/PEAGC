-- Launch plan: open the golf course booking system first and open other parts one by one.
--   * club_modules: admin on/off switch per member-facing module
--     (defaults: lessons ON, events / scores / news OFF until an admin opens them)
--   * DB-level guard so a closed module cannot take new bookings/registrations even
--     through direct API calls (staff are exempt so they can prepare content)
--   * lesson notifications: waitlist promotion, capacity increase, slot cancellation
--   * in-app notification inbox (read_at + mark-read RPC)

-- ---------- modules ----------
create table if not exists public.club_modules (
  club_id uuid not null references public.clubs(id) on delete cascade,
  module_key text not null check (module_key in ('lessons', 'events', 'scores', 'news')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (club_id, module_key)
);

drop trigger if exists set_club_modules_updated_at on public.club_modules;
create trigger set_club_modules_updated_at
before update on public.club_modules
for each row execute function public.set_updated_at();

alter table public.club_modules enable row level security;
grant select, insert, update on public.club_modules to authenticated;
grant all on public.club_modules to service_role;

create policy "club_modules_select_club"
on public.club_modules
for select
to authenticated
using (
  exists (
    select 1 from public.members m
    where m.club_id = club_modules.club_id and m.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.user_roles ur
    where ur.club_id = club_modules.club_id and ur.user_id = (select auth.uid())
  )
);

create policy "club_modules_write_by_club_admin"
on public.club_modules
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = club_modules.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = club_modules.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
);

-- Missing row = launch default. Keep in sync with src/lib/modules.ts.
create or replace function public.club_module_enabled(p_club_id uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select enabled from public.club_modules where club_id = p_club_id and module_key = p_module),
    p_module = 'lessons'
  );
$$;

grant execute on function public.club_module_enabled(uuid, text) to authenticated, service_role;

-- Trigger guard: TG_ARGV[0] is the module key. Service role (no auth.uid()) and club staff
-- pass through; members get MODULE_DISABLED.
create or replace function public.enforce_club_module()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.club_module_enabled(new.club_id, tg_argv[0]) then
    return new;
  end if;
  if exists (
    select 1 from public.user_roles ur
    where ur.club_id = new.club_id
      and ur.user_id = auth.uid()
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'finance_officer', 'tournament_director')
  ) then
    return new;
  end if;
  raise exception 'MODULE_DISABLED' using errcode = 'P0001';
end;
$$;

drop trigger if exists enforce_lessons_module on public.lesson_bookings;
create trigger enforce_lessons_module
before insert or update of slot_id on public.lesson_bookings
for each row execute function public.enforce_club_module('lessons');

drop trigger if exists enforce_events_module on public.event_registrations;
create trigger enforce_events_module
before insert on public.event_registrations
for each row execute function public.enforce_club_module('events');

-- ---------- notifications ----------
alter table public.member_notifications
  drop constraint if exists member_notifications_notification_type_check;
alter table public.member_notifications
  add constraint member_notifications_notification_type_check
  check (notification_type in (
    'member_approved', 'member_rejected', 'lesson_reminder', 'event_update', 'lesson_update'
  ));

alter table public.member_notifications
  add column if not exists read_at timestamptz;

create index if not exists member_notifications_unread_idx
on public.member_notifications (member_id, created_at desc)
where read_at is null;

create or replace function public.mark_my_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.member_notifications n
  set read_at = now()
  from public.members m
  where m.id = n.member_id
    and m.user_id = auth.uid()
    and n.read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_my_notifications_read() from public, anon;
grant execute on function public.mark_my_notifications_read() to authenticated;

create or replace function public._notify_lesson_member(
  p_booking_id uuid,
  p_subject text,
  p_body text,
  p_trigger text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  select b.id, b.club_id, b.member_id, m.email, m.full_name, s.id as slot_id
  into v
  from public.lesson_bookings b
  join public.members m on m.id = b.member_id
  join public.lesson_slots s on s.id = b.slot_id
  where b.id = p_booking_id;

  if v.id is null then
    return;
  end if;

  insert into public.member_notifications (
    club_id, member_id, channel, notification_type, recipient, subject, body, status, metadata
  ) values (
    v.club_id, v.member_id,
    case when v.email is null then 'system' else 'email' end,
    'lesson_update', v.email, p_subject,
    'เรียน ' || coalesce(v.full_name, 'สมาชิก') || ' ' || p_body,
    'queued',
    jsonb_build_object('booking_id', v.id, 'slot_id', v.slot_id, 'trigger', p_trigger)
  );
end;
$$;

create or replace function public._lesson_slot_label(p_slot public.lesson_slots)
returns text
language sql
immutable
as $$
  select p_slot.title || ' วันที่ ' || to_char(p_slot.lesson_date, 'DD/MM/YYYY') ||
         ' เวลา ' || to_char(p_slot.start_time, 'HH24:MI') || '-' || to_char(p_slot.end_time, 'HH24:MI') || ' น.';
$$;

-- A confirmed seat left slot X (cancelled or moved away): the booking that is now in the
-- last confirmed position was on the waitlist a moment ago -> tell them.
create or replace function public.lesson_booking_seat_released()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.lesson_slots;
  v_old_position integer;
  v_promoted uuid;
begin
  if old.status = 'cancelled' then
    return null;
  end if;
  if not (new.status = 'cancelled' or new.slot_id is distinct from old.slot_id) then
    return null;
  end if;

  select * into v_slot from public.lesson_slots where id = old.slot_id;
  if v_slot.id is null or v_slot.status <> 'open' or v_slot.archived_at is not null
     or public._lesson_slot_start(v_slot.lesson_date, v_slot.start_time) <= now() then
    return null;
  end if;

  select count(*)::integer + 1 into v_old_position
  from public.lesson_bookings
  where slot_id = old.slot_id and status <> 'cancelled' and queue_seq < old.queue_seq;

  if v_old_position > v_slot.capacity then
    return null; -- a waitlisted booking left; nobody gains a seat
  end if;

  select id into v_promoted
  from public.lesson_bookings
  where slot_id = old.slot_id and status <> 'cancelled'
  order by queue_seq
  offset v_slot.capacity - 1
  limit 1;

  if v_promoted is not null and v_promoted <> old.id then
    perform public._notify_lesson_member(
      v_promoted,
      'ได้ที่นั่งเรียนแล้ว: ' || v_slot.title,
      'คุณได้รับการเลื่อนจากคิวสำรองเป็นผู้เรียนรอบ ' || public._lesson_slot_label(v_slot),
      'lesson.waitlist_promoted'
    );
  end if;
  return null;
end;
$$;

drop trigger if exists lesson_booking_seat_released on public.lesson_bookings;
create trigger lesson_booking_seat_released
after update of status, slot_id on public.lesson_bookings
for each row execute function public.lesson_booking_seat_released();

-- Slot changes made by admins: capacity raised -> notify newly confirmed;
-- slot cancelled -> cancel its bookings and notify everyone booked.
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
    for v_row in
      select id from public.lesson_bookings
      where slot_id = new.id and status = 'booked'
    loop
      perform public._notify_lesson_member(
        v_row.id,
        'ยกเลิกรอบเรียน: ' || new.title,
        'ชมรมขอแจ้งยกเลิกรอบเรียน ' || public._lesson_slot_label(new) ||
          ' การจองของคุณถูกยกเลิกแล้ว สามารถเลือกจองรอบอื่นได้ในระบบ',
        'lesson.slot_cancelled'
      );
    end loop;
    update public.lesson_bookings
    set status = 'cancelled',
        attendance_note = coalesce(attendance_note, 'ชมรมยกเลิกรอบเรียน'),
        updated_by = coalesce(auth.uid(), updated_by)
    where slot_id = new.id and status = 'booked';
    return null;
  end if;

  if new.status = 'open' and new.capacity > old.capacity
     and public._lesson_slot_start(new.lesson_date, new.start_time) > now() then
    for v_row in
      select id from public.lesson_bookings
      where slot_id = new.id and status <> 'cancelled'
      order by queue_seq
      offset old.capacity
      limit new.capacity - old.capacity
    loop
      perform public._notify_lesson_member(
        v_row.id,
        'ได้ที่นั่งเรียนแล้ว: ' || new.title,
        'ชมรมเพิ่มที่นั่ง คุณได้รับการเลื่อนจากคิวสำรองเป็นผู้เรียนรอบ ' || public._lesson_slot_label(new),
        'lesson.capacity_increased'
      );
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists lesson_slot_changed on public.lesson_slots;
create trigger lesson_slot_changed
after update of status, capacity on public.lesson_slots
for each row execute function public.lesson_slot_changed();

revoke all on function public._notify_lesson_member(uuid, text, text, text) from public, anon, authenticated;
