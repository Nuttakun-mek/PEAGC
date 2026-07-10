insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-avatars',
  'member-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "member_avatars_public_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'member-avatars');

alter table public.events
add column if not exists target_work_lines text[] not null default '{}'::text[],
add column if not exists target_bureaus text[] not null default '{}'::text[],
add column if not exists target_divisions text[] not null default '{}'::text[],
add column if not exists target_departments text[] not null default '{}'::text[],
add column if not exists target_sections text[] not null default '{}'::text[];

alter table public.lesson_slots
add column if not exists target_work_lines text[] not null default '{}'::text[],
add column if not exists target_bureaus text[] not null default '{}'::text[],
add column if not exists target_divisions text[] not null default '{}'::text[],
add column if not exists target_departments text[] not null default '{}'::text[],
add column if not exists target_sections text[] not null default '{}'::text[],
add column if not exists allow_member_reschedule boolean not null default true,
add column if not exists reschedule_cutoff_hours integer not null default 12;

create table if not exists public.lesson_booking_change_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  booking_id uuid not null references public.lesson_bookings(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  from_slot_id uuid not null references public.lesson_slots(id) on delete cascade,
  to_slot_id uuid not null references public.lesson_slots(id) on delete cascade,
  request_type text not null default 'member_reschedule'
    check (request_type in ('member_reschedule', 'admin_reschedule')),
  status text not null default 'approved'
    check (status in ('requested', 'approved', 'rejected', 'cancelled')),
  note text,
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists lesson_booking_change_requests_booking_idx
on public.lesson_booking_change_requests (booking_id, created_at desc);

drop trigger if exists set_lesson_booking_change_requests_updated_at on public.lesson_booking_change_requests;
create trigger set_lesson_booking_change_requests_updated_at
before update on public.lesson_booking_change_requests
for each row execute function public.set_updated_at();

alter table public.lesson_booking_change_requests enable row level security;

grant select, insert, update on public.lesson_booking_change_requests to authenticated;
grant all on public.lesson_booking_change_requests to service_role;

create policy "lesson_booking_changes_select_own_or_admin"
on public.lesson_booking_change_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.members m
    where m.id = lesson_booking_change_requests.member_id
      and m.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_booking_change_requests.club_id
      and ur.user_id = (select auth.uid())
  )
);

create policy "lesson_booking_changes_insert_own"
on public.lesson_booking_change_requests
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.members m
    where m.id = lesson_booking_change_requests.member_id
      and m.club_id = lesson_booking_change_requests.club_id
      and m.user_id = (select auth.uid())
  )
);

create policy "lesson_booking_changes_update_by_admin"
on public.lesson_booking_change_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_booking_change_requests.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = lesson_booking_change_requests.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);
