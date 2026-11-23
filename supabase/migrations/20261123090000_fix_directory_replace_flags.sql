-- Fix finalize_directory_replace: a "replace" import flagged every active member that was not
-- linked to an employee_directory row (employee_directory_id is null) as "left_directory" and set
-- their association status to inactive. That hit members the admin added by hand and anyone who
-- was never in the association file, on every monthly import.
--
-- New rules, applied after the batch is upserted:
--   1. Directory rows missing from the batch become inactive (unchanged).
--   2. Only members LINKED to a directory row that is now inactive or archived are flagged.
--   3. Members flagged "left_directory" whose linked row is active again are un-flagged.
-- The migration also repairs rows the old function flagged wrongly (unlinked members).

create or replace function public.finalize_directory_replace(p_club_id uuid, p_batch_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deactivated integer := 0;
  v_flagged integer := 0;
  v_restored integer := 0;
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
    from public.employee_directory d
    where m.club_id = p_club_id
      and m.archived_at is null
      and m.status = 'active'
      and m.employee_match_status <> 'mismatch'
      and d.id = m.employee_directory_id
      and (d.membership_status <> 'active' or d.archived_at is not null)
    returning m.id
  )
  select count(*) into v_flagged from flagged;

  with restored as (
    update public.members m
    set employee_match_status = 'matched',
        employee_match_checked_at = now(),
        employee_match_detail = (coalesce(m.employee_match_detail, '{}'::jsonb) - 'reason' - 'flagged_at' - 'batch_id')
          || jsonb_build_object('restored_at', now(), 'batch_id', p_batch_id),
        association_membership_status = d.membership_status,
        updated_by = auth.uid()
    from public.employee_directory d
    where m.club_id = p_club_id
      and m.archived_at is null
      and m.employee_match_detail ->> 'reason' = 'left_directory'
      and d.id = m.employee_directory_id
      and d.membership_status = 'active'
      and d.archived_at is null
    returning m.id
  )
  select count(*) into v_restored from restored;

  return json_build_object('deactivated', v_deactivated, 'flagged', v_flagged, 'restored', v_restored);
end;
$$;

revoke all on function public.finalize_directory_replace(uuid, uuid) from public, anon;
grant execute on function public.finalize_directory_replace(uuid, uuid) to authenticated, service_role;

-- Repair: undo flags the old function put on members that were never linked to a directory row.
update public.members m
set employee_match_status = 'not_checked',
    employee_match_detail = coalesce(m.employee_match_detail, '{}'::jsonb) - 'reason' - 'flagged_at' - 'batch_id',
    association_membership_status = null
where m.employee_directory_id is null
  and m.employee_match_detail ->> 'reason' = 'left_directory';
