-- Association (สมาคมใหญ่) member directory: monthly Excel upload used to verify sign-ups.
-- Extends employee_directory with association fields, records each import batch, and lets
-- a "replace" import deactivate rows missing from the newest file.

alter table public.employee_directory
add column if not exists member_type text,
add column if not exists association_member_code text,
add column if not exists membership_status text not null default 'active'
  check (membership_status in ('active', 'inactive', 'suspended', 'unknown')),
add column if not exists import_batch_id uuid;

create index if not exists employee_directory_club_association_code_idx
on public.employee_directory (club_id, association_member_code)
where association_member_code is not null;

create index if not exists employee_directory_club_membership_idx
on public.employee_directory (club_id, membership_status)
where archived_at is null;

alter table public.members
add column if not exists association_member_code text,
add column if not exists association_member_type text,
add column if not exists association_membership_status text;

-- ---------- import batches ----------
create table if not exists public.directory_imports (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  file_name text not null,
  file_type text not null default 'csv',
  mode text not null default 'merge' check (mode in ('merge', 'replace')),
  row_count integer not null default 0,
  imported_count integer not null default 0,
  deactivated_count integer not null default 0,
  flagged_member_count integer not null default 0,
  skipped_count integer not null default 0,
  note text,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id)
);

create index if not exists directory_imports_club_time_idx
on public.directory_imports (club_id, imported_at desc);

alter table public.directory_imports enable row level security;
grant select, insert on public.directory_imports to authenticated;
grant all on public.directory_imports to service_role;

drop policy if exists "directory_imports_select_by_admin" on public.directory_imports;
create policy "directory_imports_select_by_admin"
on public.directory_imports
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = directory_imports.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);

drop policy if exists "directory_imports_insert_by_admin" on public.directory_imports;
create policy "directory_imports_insert_by_admin"
on public.directory_imports
for insert
to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = directory_imports.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
);

-- ---------- replace-mode helper ----------
-- After a full monthly upload, rows of this club that were not part of the batch are no
-- longer members of the association. They are kept (for history) but marked inactive, and
-- approved members linked to them are flagged for admin review.
create or replace function public.finalize_directory_replace(p_club_id uuid, p_batch_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deactivated integer := 0;
  v_flagged integer := 0;
begin
  if not exists (
    select 1 from public.user_roles ur
    where ur.club_id = p_club_id
      and ur.user_id = auth.uid()
      and ur.role_key in ('platform_owner', 'club_admin')
  ) then
    raise exception 'NOT_ADMIN';
  end if;

  with changed as (
    update public.employee_directory d
    set membership_status = 'inactive',
        updated_by = auth.uid()
    where d.club_id = p_club_id
      and d.archived_at is null
      and d.membership_status <> 'inactive'
      and (d.import_batch_id is distinct from p_batch_id)
    returning d.id
  )
  select count(*) into v_deactivated from changed;

  with flagged as (
    update public.members m
    set employee_match_status = 'mismatch',
        employee_match_checked_at = now(),
        employee_match_detail = coalesce(m.employee_match_detail, '{}'::jsonb)
          || jsonb_build_object('reason', 'left_directory', 'flagged_at', now(), 'batch_id', p_batch_id),
        association_membership_status = 'inactive',
        updated_by = auth.uid()
    where m.club_id = p_club_id
      and m.archived_at is null
      and m.status = 'active'
      and m.employee_match_status <> 'mismatch'
      and (
        m.employee_directory_id is null
        or exists (
          select 1 from public.employee_directory d
          where d.id = m.employee_directory_id
            and (d.membership_status <> 'active' or d.archived_at is not null)
        )
      )
    returning m.id
  )
  select count(*) into v_flagged from flagged;

  return json_build_object('deactivated', v_deactivated, 'flagged', v_flagged);
end;
$$;

revoke all on function public.finalize_directory_replace(uuid, uuid) from public, anon;
grant execute on function public.finalize_directory_replace(uuid, uuid) to authenticated, service_role;
