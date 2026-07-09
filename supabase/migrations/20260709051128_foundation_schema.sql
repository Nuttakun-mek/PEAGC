-- PEAGC Foundation Schema Draft
-- Purpose: starting point for Supabase migration planning.
-- Convert this draft into a Supabase CLI migration after the project is linked.

create extension if not exists "pgcrypto";

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text not null,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone text,
  line_id text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_catalog (
  key text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null references public.role_catalog(key),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (club_id, user_id, role_key)
);

create table if not exists public.member_types (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_type_id uuid references public.member_types(id),
  member_code text,
  full_name text not null,
  nickname text,
  phone text,
  line_id text,
  email text,
  organization text,
  avatar_url text,
  handicap numeric(4,1),
  skill_level text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'guest', 'archived')),
  joined_at date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  archived_at timestamptz,
  unique (club_id, member_code)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  event_type text not null default 'golf_round',
  venue text,
  event_date date not null,
  tee_off_time time,
  capacity integer,
  member_price numeric(12,2) not null default 0,
  guest_price numeric(12,2) not null default 0,
  includes text,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed', 'completed', 'cancelled', 'archived')),
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  archived_at timestamptz
);

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid references public.members(id),
  guest_name text,
  registration_type text not null default 'single'
    check (registration_type in ('single', 'group', 'team', 'guest')),
  status text not null default 'registered'
    check (
      status in (
        'draft',
        'registered',
        'pending_payment',
        'payment_review',
        'paid',
        'cancelled',
        'waitlist',
        'checked_in',
        'no_show'
      )
    ),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_registration_id uuid not null references public.event_registrations(id) on delete cascade,
  amount numeric(12,2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'review', 'approved', 'rejected', 'refunded')),
  slip_file_id uuid,
  transferred_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  bucket text not null,
  object_path text not null,
  category text not null,
  mime_type text,
  size_bytes bigint,
  checksum text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (bucket, object_path)
);

alter table public.payment_records
  add constraint payment_records_slip_file_id_fkey
  foreign key (slip_file_id) references public.files(id);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.role_catalog (key, name, description)
values
  ('platform_owner', 'Platform Owner', 'Full system owner'),
  ('club_admin', 'Club Admin', 'Club administrator'),
  ('committee', 'Committee', 'Club committee member'),
  ('finance_officer', 'Finance Officer', 'Payment and finance reviewer'),
  ('tournament_director', 'Tournament Director', 'Competition publisher'),
  ('scoring_officer', 'Scoring Officer', 'Score entry and verification'),
  ('member', 'Member', 'Club member'),
  ('auditor', 'Auditor', 'Read-only audit reviewer')
on conflict (key) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

create trigger set_clubs_updated_at
before update on public.clubs
for each row execute function public.set_updated_at();

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_member_types_updated_at
before update on public.member_types
for each row execute function public.set_updated_at();

create trigger set_members_updated_at
before update on public.members
for each row execute function public.set_updated_at();

create trigger set_events_updated_at
before update on public.events
for each row execute function public.set_updated_at();

create trigger set_event_registrations_updated_at
before update on public.event_registrations
for each row execute function public.set_updated_at();

create trigger set_payment_records_updated_at
before update on public.payment_records
for each row execute function public.set_updated_at();

alter table public.clubs enable row level security;
alter table public.profiles enable row level security;
alter table public.role_catalog enable row level security;
alter table public.user_roles enable row level security;
alter table public.member_types enable row level security;
alter table public.members enable row level security;
alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.payment_records enable row level security;
alter table public.files enable row level security;
alter table public.audit_logs enable row level security;

grant select on public.role_catalog to authenticated;
grant select on public.clubs to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update on public.member_types to authenticated;
grant select, insert, update on public.members to authenticated;
grant select, insert, update on public.events to authenticated;
grant select, insert, update on public.event_registrations to authenticated;
grant select, insert, update on public.payment_records to authenticated;
grant select, insert on public.files to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant all on all tables in schema public to service_role;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = (select auth.uid()));

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "user_roles_select_own"
on public.user_roles
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "role_catalog_select_authenticated"
on public.role_catalog
for select
to authenticated
using (true);

create policy "clubs_select_assigned"
on public.clubs
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = clubs.id
      and ur.user_id = (select auth.uid())
  )
);

create policy "member_types_select_by_club"
on public.member_types
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = member_types.club_id
      and ur.user_id = (select auth.uid())
  )
);

create policy "member_types_write_by_admin"
on public.member_types
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = member_types.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = member_types.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
);

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
  )
);

create policy "members_write_by_admin"
on public.members
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = members.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = members.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);

create policy "events_select_by_club"
on public.events
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = events.club_id
      and ur.user_id = (select auth.uid())
  )
);

create policy "events_write_by_admin"
on public.events
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = events.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = events.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);

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
  )
);

create policy "registrations_write_by_admin"
on public.event_registrations
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = event_registrations.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = event_registrations.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);

create policy "payments_select_by_finance"
on public.payment_records
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = payment_records.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'finance_officer', 'auditor')
  )
);

create policy "payments_write_by_finance"
on public.payment_records
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = payment_records.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'finance_officer')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = payment_records.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'finance_officer')
  )
);

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
  )
);

create policy "files_insert_by_club"
on public.files
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = files.club_id
      and ur.user_id = (select auth.uid())
  )
);

create policy "audit_logs_insert_by_club"
on public.audit_logs
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = audit_logs.club_id
      and ur.user_id = (select auth.uid())
  )
);

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
      and ur.role_key in ('platform_owner', 'club_admin', 'auditor')
  )
);
