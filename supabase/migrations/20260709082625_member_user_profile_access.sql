alter table public.members
add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists members_club_user_unique_idx
on public.members (club_id, user_id);

create policy "clubs_select_active_for_authenticated"
on public.clubs
for select
to authenticated
using (status = 'active' and archived_at is null);

create policy "members_select_own_profile"
on public.members
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "members_insert_own_profile"
on public.members
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status in ('active', 'guest')
);

create policy "members_update_own_profile"
on public.members
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
