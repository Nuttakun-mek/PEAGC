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
    and archived_at is null
    and member_code ~ '^PEAGC-[0-9]+$';

  return 'PEAGC-' || lpad(next_number::text, 4, '0');
end;
$$;

revoke all on function public.next_member_code(uuid) from public;
grant execute on function public.next_member_code(uuid) to authenticated;
grant execute on function public.next_member_code(uuid) to service_role;

do $$
declare
  target_club record;
  target_member record;
  generated_code text;
begin
  for target_club in select id from public.clubs loop
    for target_member in
      select id
      from public.members
      where club_id = target_club.id
        and archived_at is null
        and member_code is null
      order by created_at, id
    loop
      generated_code := public.next_member_code(target_club.id);
      update public.members
      set member_code = generated_code,
          updated_at = now()
      where id = target_member.id;
    end loop;
  end loop;
end;
$$;
