-- Sprint 5: event operations.
--   * atomic event registration (row lock on the event) with automatic waitlist
--   * waitlist auto-promotion when a seat frees up or capacity grows
--   * pairing groups (tee time / start hole / group size) with capacity enforcement
--   * check-in timestamp + no-show
--   * RLS fix: finance officers could approve payments but their registration status
--     update was silently filtered out by RLS (0 rows). Tournament directors need
--     update access for pairing and check-in.

-- ---------- pairing groups ----------
create table if not exists public.event_pairing_groups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  group_no integer not null check (group_no > 0),
  tee_time time,
  start_hole smallint not null default 1 check (start_hole between 1 and 18),
  capacity smallint not null default 4 check (capacity between 1 and 8),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  unique (event_id, group_no)
);

create index if not exists event_pairing_groups_event_idx
on public.event_pairing_groups (event_id, group_no);

drop trigger if exists set_event_pairing_groups_updated_at on public.event_pairing_groups;
create trigger set_event_pairing_groups_updated_at
before update on public.event_pairing_groups
for each row execute function public.set_updated_at();

alter table public.event_pairing_groups enable row level security;
grant select, insert, update, delete on public.event_pairing_groups to authenticated;
grant all on public.event_pairing_groups to service_role;

create policy "pairing_groups_select_by_club"
on public.event_pairing_groups
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = event_pairing_groups.club_id
      and ur.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.members m
    where m.club_id = event_pairing_groups.club_id
      and m.user_id = (select auth.uid())
      and m.archived_at is null
  )
);

create policy "pairing_groups_write_by_event_staff"
on public.event_pairing_groups
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = event_pairing_groups.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'tournament_director')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = event_pairing_groups.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'tournament_director')
  )
);

-- ---------- registration columns ----------
alter table public.event_registrations
  add column if not exists pairing_group_id uuid references public.event_pairing_groups(id) on delete set null,
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_in_by uuid references auth.users(id),
  add column if not exists promoted_at timestamptz;

create index if not exists event_registrations_event_status_idx
on public.event_registrations (event_id, status, created_at);

create index if not exists event_registrations_pairing_group_idx
on public.event_registrations (pairing_group_id)
where pairing_group_id is not null;

-- Group capacity: the group row lock serializes concurrent assignments to one group.
create or replace function public.enforce_pairing_group_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.event_pairing_groups;
  v_count integer;
begin
  if new.pairing_group_id is null then
    return new;
  end if;
  if new.status in ('cancelled', 'waitlist') then
    -- a seat-less registration never sits in a group
    new.pairing_group_id := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.pairing_group_id is not distinct from old.pairing_group_id then
    return new;
  end if;

  select * into v_group from public.event_pairing_groups where id = new.pairing_group_id for update;
  if v_group.id is null or v_group.event_id <> new.event_id then
    raise exception 'PAIRING_GROUP_MISMATCH' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
  from public.event_registrations
  where pairing_group_id = new.pairing_group_id
    and id <> new.id
    and status not in ('cancelled', 'waitlist');

  if v_count >= v_group.capacity then
    raise exception 'PAIRING_GROUP_FULL' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_pairing_group_capacity on public.event_registrations;
create trigger enforce_pairing_group_capacity
before insert or update of pairing_group_id, status on public.event_registrations
for each row execute function public.enforce_pairing_group_capacity();

-- ---------- RLS: who may update registrations ----------
-- Finance updates status after payment review; tournament directors pair and check in.
create policy "registrations_update_by_finance_and_tournament"
on public.event_registrations
for update
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = event_registrations.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('finance_officer', 'tournament_director')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = event_registrations.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('finance_officer', 'tournament_director')
  )
);

-- ---------- seat accounting ----------
-- Statuses that hold a seat against events.capacity.
create or replace function public._event_seat_status(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status not in ('cancelled', 'no_show', 'waitlist', 'draft');
$$;

create or replace function public._event_seats_taken(p_event_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.event_registrations
  where event_id = p_event_id
    and public._event_seat_status(status);
$$;

-- Promote the oldest waitlisted registrations into free seats. Caller must hold the
-- event row lock. Returns how many were promoted.
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
          ' วันที่ ' || to_char(v_event.event_date, 'DD/MM/YYYY') || ' แล้ว คุณได้รับการเลื่อนจากรายชื่อสำรอง' ||
          case when v_event.member_price > 0 then ' กรุณาชำระเงินและแนบหลักฐานในระบบ' else '' end,
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

-- Fires after a seat is released (cancel / no-show / pushed back to waitlist).
create or replace function public.event_registration_release_seat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._event_seat_status(old.status) and not public._event_seat_status(new.status) then
    -- no-show is recorded on the day; don't backfill the field with waitlisters then
    if new.status = 'no_show' then
      return null;
    end if;
    perform 1 from public.events where id = new.event_id for update;
    perform public._promote_event_waitlist(new.event_id);
  end if;
  return null;
end;
$$;

drop trigger if exists event_registration_release_seat on public.event_registrations;
create trigger event_registration_release_seat
after update of status on public.event_registrations
for each row execute function public.event_registration_release_seat();

-- Fires when an admin raises capacity (or removes the limit) or (re)opens the event.
create or replace function public.event_capacity_promote_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only capacity changes or (re)opening promote; closing an event or moving it along on the
  -- day (after no-shows) must not pull waitlisters into seats.
  if (new.capacity is distinct from old.capacity and new.status in ('open', 'closed'))
     or (new.status = 'open' and old.status is distinct from 'open') then
    perform public._promote_event_waitlist(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists event_capacity_promote_waitlist on public.events;
create trigger event_capacity_promote_waitlist
after update of capacity, status on public.events
for each row execute function public.event_capacity_promote_waitlist();

-- ---------- member RPC ----------
-- Atomic self-registration. The event row lock serializes concurrent registrants so
-- capacity can never be oversold; a full event puts the member on the waitlist.
create or replace function public.register_for_event(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_member public.members;
  v_status text;
  v_registration_id uuid;
  v_waitlist_position integer := null;
begin
  select * into v_event from public.events where id = p_event_id and archived_at is null for update;
  if v_event.id is null then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  select * into v_member
  from public.members
  where user_id = auth.uid() and club_id = v_event.club_id and archived_at is null
  limit 1;
  if v_member.id is null or v_member.status <> 'active' then
    raise exception 'MEMBER_NOT_APPROVED';
  end if;

  if v_event.status <> 'open'
     or v_event.event_date < (now() at time zone 'Asia/Bangkok')::date
     or not public._lesson_target_match(v_event.target_work_lines, v_member.work_line)
     or not public._lesson_target_match(v_event.target_bureaus, v_member.bureau)
     or not public._lesson_target_match(v_event.target_divisions, v_member.division)
     or not public._lesson_target_match(v_event.target_departments, v_member.department)
     or not public._lesson_target_match(v_event.target_sections, v_member.section) then
    raise exception 'EVENT_CLOSED';
  end if;

  if exists (
    select 1 from public.event_registrations
    where event_id = v_event.id and member_id = v_member.id
      and status not in ('cancelled', 'no_show')
  ) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  if v_event.capacity is not null and v_event.capacity > 0
     and public._event_seats_taken(v_event.id) >= v_event.capacity then
    v_status := 'waitlist';
  elsif v_event.member_price > 0 then
    v_status := 'pending_payment';
  else
    v_status := 'registered';
  end if;

  insert into public.event_registrations (
    club_id, event_id, member_id, registration_type, status, created_by, updated_by
  ) values (
    v_event.club_id, v_event.id, v_member.id, 'single', v_status, auth.uid(), auth.uid()
  )
  returning id into v_registration_id;

  if v_status = 'waitlist' then
    select count(*)::integer into v_waitlist_position
    from public.event_registrations
    where event_id = v_event.id and status = 'waitlist'
      and (created_at, id) <= (select created_at, id from public.event_registrations where id = v_registration_id);
  end if;

  insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, after_data, metadata)
  values (
    v_event.club_id, auth.uid(), 'event_registration.created_by_member', 'event_registrations', v_registration_id,
    jsonb_build_object('status', v_status),
    jsonb_build_object('event_id', v_event.id, 'source', 'member.portal')
  );

  return json_build_object(
    'registration_id', v_registration_id,
    'status', v_status,
    'waitlist_position', v_waitlist_position
  );
end;
$$;

revoke all on function public.register_for_event(uuid) from public, anon;
grant execute on function public.register_for_event(uuid) to authenticated;

revoke all on function public._promote_event_waitlist(uuid) from public, anon, authenticated;
revoke all on function public._event_seats_taken(uuid) from public, anon, authenticated;

-- Seat availability for the member portal. Members can only read their own registrations
-- under RLS, so expose aggregate counts (no names) for events in the caller's club.
create or replace function public.event_seat_counts(p_event_ids uuid[])
returns table (event_id uuid, capacity integer, seats integer, waitlist integer)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         e.capacity,
         count(r.id) filter (where public._event_seat_status(r.status))::integer,
         count(r.id) filter (where r.status = 'waitlist')::integer
  from public.events e
  left join public.event_registrations r on r.event_id = e.id
  where e.id = any(p_event_ids)
    and e.archived_at is null
    and (
      exists (select 1 from public.members m
              where m.club_id = e.club_id and m.user_id = auth.uid() and m.archived_at is null)
      or exists (select 1 from public.user_roles ur
                 where ur.club_id = e.club_id and ur.user_id = auth.uid())
    )
  group by e.id, e.capacity;
$$;

revoke all on function public.event_seat_counts(uuid[]) from public, anon;
grant execute on function public.event_seat_counts(uuid[]) to authenticated;
