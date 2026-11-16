-- QA round 2:
-- 1) One employee code = one member. The admin forms and the sign-up flow already refuse a code
--    another (not archived) member holds; this index makes the rule hold for every writer too.
--    Codes compare without case and spaces, like the forms ("uat 001" = "UAT001"). Archived
--    members keep their old code without blocking anyone.
-- 2) One display name per person: profiles follow the member's full name, so the header, the
--    member card and the admin lists no longer show two different names for the same account.

do $$
begin
  if exists (
    select 1
    from public.members
    where archived_at is null
      and nullif(btrim(employee_code), '') is not null
    group by club_id, upper(regexp_replace(employee_code, '\s+', '', 'g'))
    having count(*) > 1
  ) then
    raise exception 'members has duplicate employee codes among non-archived rows; archive or fix them before applying this migration';
  end if;
end $$;

create unique index if not exists members_club_employee_code_active_key
  on public.members (club_id, upper(regexp_replace(employee_code, '\s+', '', 'g')))
  where archived_at is null
    and nullif(btrim(employee_code), '') is not null;

update public.profiles p
set display_name = m.full_name,
    updated_at = now()
from public.members m
where m.user_id = p.id
  and m.archived_at is null
  and nullif(btrim(m.full_name), '') is not null
  and p.display_name is distinct from m.full_name;
