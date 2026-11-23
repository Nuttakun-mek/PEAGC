-- Platform (phase 2-3, track "platform"): audit log access, staff names for the audit page,
-- directory import previews, and indexes for search and reports.
--
-- 1. audit_logs
--    - read: platform_owner, club_admin, committee, auditor of the club (committee was missing;
--      the role-based menu gives committee the audit page).
--    - insert: any staff of the club, but only as themselves (actor_user_id = auth.uid()), so a
--      row cannot be written in someone else's name. Service-role and security-definer writers
--      are not affected by RLS.
--    - append-only: no UPDATE/DELETE grant or policy for authenticated (unchanged).
--    - indexes for the audit page filters and the member 360 history.
-- 2. club_staff_names(club_id): display names of the club's staff for the audit page (profiles
--    are readable only by their owner, so staff names cannot be read directly).
-- 3. directory_import_previews: a parsed monthly directory file waiting for "ยืนยันนำเข้า".
--    Holds the parsed rows for one hour so the confirm step does not re-upload the file or carry
--    thousands of rows through hidden inputs.
-- 4. Indexes for the admin search (members by code/phone) and the monthly revenue report.

-- ---------- 1. audit_logs ----------
drop policy if exists "audit_logs_select_by_admin" on public.audit_logs;
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
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'auditor')
  )
);

drop policy if exists "audit_logs_insert_by_club" on public.audit_logs;
create policy "audit_logs_insert_by_club"
on public.audit_logs
for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and exists (
    select 1
    from public.user_roles ur
    where ur.club_id = audit_logs.club_id
      and ur.user_id = (select auth.uid())
  )
);

revoke update, delete on public.audit_logs from authenticated, anon;

create index if not exists audit_logs_club_created_idx
on public.audit_logs (club_id, created_at desc);

create index if not exists audit_logs_club_entity_idx
on public.audit_logs (club_id, entity_type, entity_id, created_at desc);

create index if not exists audit_logs_club_actor_idx
on public.audit_logs (club_id, actor_user_id, created_at desc);

create index if not exists audit_logs_entity_id_idx
on public.audit_logs (entity_id)
where entity_id is not null;

-- ---------- 2. staff names ----------
create or replace function public.club_staff_names(p_club_id uuid)
returns table (user_id uuid, display_name text, role_keys text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    ur.user_id,
    coalesce(
      nullif(btrim(max(m.full_name)), ''),
      nullif(btrim(max(p.display_name)), '')
    ) as display_name,
    array_agg(distinct ur.role_key order by ur.role_key) as role_keys
  from public.user_roles ur
  left join public.profiles p on p.id = ur.user_id
  left join public.members m
    on m.user_id = ur.user_id
   and m.club_id = ur.club_id
   and m.archived_at is null
  where ur.club_id = p_club_id
    and exists (
      select 1
      from public.user_roles me
      where me.club_id = p_club_id
        and me.user_id = auth.uid()
        and me.role_key in (
          'platform_owner', 'club_admin', 'committee', 'finance_officer',
          'tournament_director', 'scoring_officer', 'auditor'
        )
    )
  group by ur.user_id;
$$;

revoke all on function public.club_staff_names(uuid) from public, anon;
grant execute on function public.club_staff_names(uuid) to authenticated, service_role;

-- ---------- 3. directory import previews ----------
create table if not exists public.directory_import_previews (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  file_name text not null,
  file_type text not null default 'csv' check (file_type in ('csv', 'xlsx')),
  mode text not null default 'merge' check (mode in ('merge', 'replace')),
  row_count integer not null default 0 check (row_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  -- Parsed DirectoryRow[] (src/lib/directory/import.ts), already normalised.
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  status text not null default 'preview' check (status in ('preview', 'applying', 'applied', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  applied_at timestamptz,
  applied_import_id uuid references public.directory_imports(id) on delete set null
);

create index if not exists directory_import_previews_club_created_idx
on public.directory_import_previews (club_id, created_at desc);

alter table public.directory_import_previews enable row level security;
grant select, insert, update, delete on public.directory_import_previews to authenticated;
grant all on public.directory_import_previews to service_role;

drop policy if exists "directory_import_previews_by_admin" on public.directory_import_previews;
create policy "directory_import_previews_by_admin"
on public.directory_import_previews
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = directory_import_previews.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = directory_import_previews.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
);

-- ---------- 4. search and report indexes ----------
create index if not exists members_club_member_code_idx
on public.members (club_id, member_code)
where archived_at is null;

create index if not exists members_club_employee_code_idx
on public.members (club_id, employee_code)
where archived_at is null and employee_code is not null;

create index if not exists payment_records_club_reviewed_idx
on public.payment_records (club_id, reviewed_at)
where status = 'approved';
