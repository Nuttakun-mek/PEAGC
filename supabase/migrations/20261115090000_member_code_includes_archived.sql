-- next_member_code() skipped archived members, but the unique constraint
-- members(club_id, member_code) still covers them. When the highest number belonged to an
-- archived member, the "next" code collided with it and approving/creating a member failed.
-- Count every row so a number is never handed out twice.

create or replace function public.next_member_code(target_club_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_club_id::text, 0));

  select coalesce(
    max(substring(member_code from '^PEAGC-([0-9]+)$')::integer),
    0
  ) + 1
  into next_number
  from public.members
  where club_id = target_club_id
    and member_code ~ '^PEAGC-[0-9]+$';

  return 'PEAGC-' || lpad(next_number::text, 4, '0');
end;
$$;

revoke all on function public.next_member_code(uuid) from public;
grant execute on function public.next_member_code(uuid) to authenticated;
grant execute on function public.next_member_code(uuid) to service_role;
