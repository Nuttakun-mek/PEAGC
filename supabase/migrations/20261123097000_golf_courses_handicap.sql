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
