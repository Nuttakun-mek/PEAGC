create table if not exists public.employee_directory (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  employee_code text not null,
  full_name text not null,
  email text,
  department text,
  affiliation text,
  employment_status text not null default 'active'
    check (employment_status in ('active', 'inactive', 'retired', 'unknown')),
  source text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  archived_at timestamptz,
  unique (club_id, employee_code)
);

create trigger set_employee_directory_updated_at
before update on public.employee_directory
for each row execute function public.set_updated_at();

alter table public.employee_directory enable row level security;

grant select, insert, update on public.employee_directory to authenticated;
grant all on public.employee_directory to service_role;

create policy "employee_directory_select_by_admin"
on public.employee_directory
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = employee_directory.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);

create policy "employee_directory_write_by_admin"
on public.employee_directory
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = employee_directory.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = employee_directory.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
);

alter table public.members
add column if not exists employee_directory_id uuid references public.employee_directory(id) on delete set null,
add column if not exists employee_match_status text not null default 'not_checked'
  check (employee_match_status in ('not_checked', 'matched', 'mismatch', 'not_found')),
add column if not exists employee_match_checked_at timestamptz,
add column if not exists employee_match_detail jsonb not null default '{}'::jsonb;

create index if not exists members_employee_directory_id_idx
on public.members (employee_directory_id)
where employee_directory_id is not null;
