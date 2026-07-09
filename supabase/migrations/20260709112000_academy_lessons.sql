create table if not exists public.lesson_programs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  coach_name text,
  level text not null default 'all'
    check (level in ('all', 'beginner', 'intermediate', 'advanced')),
  price numeric(12,2) not null default 0,
  description text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  archived_at timestamptz
);

create table if not exists public.lesson_slots (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  program_id uuid not null references public.lesson_programs(id) on delete cascade,
  title text not null,
  coach_name text,
  venue text,
  lesson_date date not null,
  start_time time not null,
  end_time time not null,
  capacity integer not null default 1 check (capacity > 0),
  status text not null default 'open'
    check (status in ('draft', 'open', 'closed', 'completed', 'cancelled', 'archived')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  archived_at timestamptz,
  check (end_time > start_time)
);

create table if not exists public.lesson_bookings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  slot_id uuid not null references public.lesson_slots(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  status text not null default 'booked'
    check (status in ('booked', 'cancelled', 'attended', 'no_show')),
  booked_at timestamptz not null default now(),
  checked_in_at timestamptz,
  attendance_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create unique index if not exists lesson_bookings_one_active_member_slot
on public.lesson_bookings (slot_id, member_id)
where status <> 'cancelled';

create index if not exists lesson_slots_club_date_idx
on public.lesson_slots (club_id, lesson_date, start_time)
where archived_at is null;

create index if not exists lesson_bookings_slot_status_idx
on public.lesson_bookings (slot_id, status);

drop trigger if exists set_lesson_programs_updated_at on public.lesson_programs;
create trigger set_lesson_programs_updated_at
before update on public.lesson_programs
for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_slots_updated_at on public.lesson_slots;
create trigger set_lesson_slots_updated_at
before update on public.lesson_slots
for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_bookings_updated_at on public.lesson_bookings;
create trigger set_lesson_bookings_updated_at
before update on public.lesson_bookings
for each row execute function public.set_updated_at();

alter table public.lesson_programs enable row level security;
alter table public.lesson_slots enable row level security;
alter table public.lesson_bookings enable row level security;

grant select, insert, update on public.lesson_programs to authenticated;
grant select, insert, update on public.lesson_slots to authenticated;
grant select, insert, update on public.lesson_bookings to authenticated;
grant all on public.lesson_programs to service_role;
grant all on public.lesson_slots to service_role;
grant all on public.lesson_bookings to service_role;

create policy "lesson_programs_select_available"
on public.lesson_programs
for select
to authenticated
using (
  archived_at is null
  and (
    status = 'active'
    or exists (
      select 1
      from public.user_roles ur
      where ur.club_id = lesson_programs.club_id
        and ur.user_id = (select auth.uid())
    )
  )
);

create policy "lesson_programs_write_by_admin"
on public.lesson_programs
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_programs.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_programs.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);

create policy "lesson_slots_select_available"
on public.lesson_slots
for select
to authenticated
using (
  archived_at is null
  and (
    status = 'open'
    or exists (
      select 1
      from public.user_roles ur
      where ur.club_id = lesson_slots.club_id
        and ur.user_id = (select auth.uid())
    )
  )
);

create policy "lesson_slots_write_by_admin"
on public.lesson_slots
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_slots.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_slots.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);

create policy "lesson_bookings_select_own_or_admin"
on public.lesson_bookings
for select
to authenticated
using (
  exists (
    select 1
    from public.members m
    where m.id = lesson_bookings.member_id
      and m.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_bookings.club_id
      and ur.user_id = (select auth.uid())
  )
);

create policy "lesson_bookings_insert_own_open_slot"
on public.lesson_bookings
for insert
to authenticated
with check (
  status = 'booked'
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and exists (
    select 1
    from public.members m
    where m.id = lesson_bookings.member_id
      and m.club_id = lesson_bookings.club_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.archived_at is null
  )
  and exists (
    select 1
    from public.lesson_slots ls
    where ls.id = lesson_bookings.slot_id
      and ls.club_id = lesson_bookings.club_id
      and ls.status = 'open'
      and ls.archived_at is null
  )
);

create policy "lesson_bookings_update_by_admin"
on public.lesson_bookings
for update
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_bookings.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_bookings.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);
