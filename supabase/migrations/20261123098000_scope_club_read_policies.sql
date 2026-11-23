-- Club-wide read policies used to accept ANY user_roles row in the club. The seed script gives
-- regular members a `member` role row, and lessons v2 adds `coach`; with the old policies either
-- could read every member's phone/e-mail/employee code, every notification, every event
-- registration and every file record. Limit the club-wide branch to staff roles. Members keep
-- their own-row policies (members_select_own_profile, registrations_select_own, own
-- notifications/awards below); coaches read their learners through lesson_slot_roster().

drop policy if exists "members_select_by_club" on public.members;
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
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "member_notifications_select_own_or_admin" on public.member_notifications;
create policy "member_notifications_select_own_or_admin"
on public.member_notifications
for select
to authenticated
using (
  exists (
    select 1
    from public.members m
    where m.id = member_notifications.member_id
      and m.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.user_roles ur
    where ur.club_id = member_notifications.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "registrations_select_by_club" on public.event_registrations;
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
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "files_select_by_club" on public.files;
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
      and ur.role_key not in ('coach', 'member')
  )
);

drop policy if exists "awards_read_own_or_admin" on public.member_awards;
create policy "awards_read_own_or_admin"
on public.member_awards
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = member_awards.member_id and m.user_id = (select auth.uid()))
  or exists (
    select 1 from public.user_roles ur
    where ur.club_id = member_awards.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key not in ('coach', 'member')
  )
);
