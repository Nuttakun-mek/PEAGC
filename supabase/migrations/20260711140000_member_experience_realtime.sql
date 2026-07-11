alter table public.lesson_slots
add column if not exists booked_count integer not null default 0;

create or replace function public.refresh_lesson_slot_booked_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_slot uuid;
begin
  affected_slot := coalesce(new.slot_id, old.slot_id);
  update public.lesson_slots
  set booked_count = (
    select count(*)::integer from public.lesson_bookings
    where slot_id = affected_slot and status <> 'cancelled'
  )
  where id = affected_slot;

  if tg_op = 'UPDATE' and old.slot_id is distinct from new.slot_id then
    update public.lesson_slots
    set booked_count = (
      select count(*)::integer from public.lesson_bookings
      where slot_id = old.slot_id and status <> 'cancelled'
    )
    where id = old.slot_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_slot_booked_count on public.lesson_bookings;
create trigger refresh_slot_booked_count
after insert or update or delete on public.lesson_bookings
for each row execute function public.refresh_lesson_slot_booked_count();

update public.lesson_slots ls
set booked_count = (
  select count(*)::integer from public.lesson_bookings lb
  where lb.slot_id = ls.id and lb.status <> 'cancelled'
);

create table if not exists public.club_announcements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  summary text,
  category text not null default 'general',
  image_url text,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  is_pinned boolean not null default false,
  status text not null default 'published' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists public.golf_hole_scores (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_registration_id uuid not null references public.event_registrations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  hole_number integer not null check (hole_number between 1 and 18),
  par integer not null check (par between 3 and 6),
  strokes integer not null check (strokes between 1 and 20),
  putts integer check (putts between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  unique (event_registration_id, hole_number)
);

create table if not exists public.member_awards (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  title text not null,
  award_type text not null default 'achievement',
  awarded_at date not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.club_announcements enable row level security;
alter table public.golf_hole_scores enable row level security;
alter table public.member_awards enable row level security;
grant select on public.club_announcements, public.golf_hole_scores, public.member_awards to authenticated;
grant all on public.club_announcements, public.golf_hole_scores, public.member_awards to service_role;

create policy "announcements_read_by_club" on public.club_announcements for select to authenticated
using (exists (select 1 from public.user_roles ur where ur.club_id = club_announcements.club_id and ur.user_id = (select auth.uid())));
create policy "hole_scores_read_own_or_admin" on public.golf_hole_scores for select to authenticated
using (
  exists (select 1 from public.members m where m.id = golf_hole_scores.member_id and m.user_id = (select auth.uid()))
  or exists (select 1 from public.user_roles ur where ur.club_id = golf_hole_scores.club_id and ur.user_id = (select auth.uid()) and ur.role_key in ('platform_owner','club_admin','committee'))
);
create policy "awards_read_own_or_admin" on public.member_awards for select to authenticated
using (
  exists (select 1 from public.members m where m.id = member_awards.member_id and m.user_id = (select auth.uid()))
  or exists (select 1 from public.user_roles ur where ur.club_id = member_awards.club_id and ur.user_id = (select auth.uid()))
);

do $$ begin
  alter publication supabase_realtime add table public.lesson_slots;
exception when duplicate_object then null;
end $$;
