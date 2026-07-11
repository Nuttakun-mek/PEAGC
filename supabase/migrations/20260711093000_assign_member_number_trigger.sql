create or replace function public.assign_member_code_when_activated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and new.member_code is null then
    new.member_code := public.next_member_code(new.club_id);
  end if;

  return new;
end;
$$;

drop trigger if exists assign_member_code_when_activated on public.members;
create trigger assign_member_code_when_activated
before insert or update of status on public.members
for each row
execute function public.assign_member_code_when_activated();
