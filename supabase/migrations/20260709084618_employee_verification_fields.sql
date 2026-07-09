alter table public.members
add column if not exists employee_code text,
add column if not exists department text,
add column if not exists affiliation text,
add column if not exists verified_at timestamptz,
add column if not exists verified_by uuid references auth.users(id),
add column if not exists verification_note text;

alter table public.members
drop constraint if exists members_status_check;

alter table public.members
add constraint members_status_check
check (
  status in (
    'pending_verification',
    'active',
    'inactive',
    'guest',
    'archived'
  )
);

create index if not exists members_club_employee_code_idx
on public.members (club_id, employee_code)
where employee_code is not null;

drop policy if exists "members_insert_own_profile" on public.members;
drop policy if exists "members_update_own_profile" on public.members;

create policy "members_insert_own_profile"
on public.members
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status in ('pending_verification', 'guest')
);

create policy "members_update_own_profile"
on public.members
for update
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and status in ('pending_verification', 'guest')
);
