create unique index if not exists event_registrations_one_active_member_registration
on public.event_registrations (event_id, member_id)
where member_id is not null
  and status not in ('cancelled', 'no_show');

grant select, insert, update on public.event_registrations to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'event_registrations'
      and policyname = 'registrations_select_own'
  ) then
    create policy "registrations_select_own"
    on public.event_registrations
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.members m
        where m.id = event_registrations.member_id
          and m.user_id = (select auth.uid())
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'event_registrations'
      and policyname = 'registrations_insert_own_for_open_event'
  ) then
    create policy "registrations_insert_own_for_open_event"
    on public.event_registrations
    for insert
    to authenticated
    with check (
      created_by = (select auth.uid())
      and updated_by = (select auth.uid())
      and registration_type = 'single'
      and status in ('registered', 'pending_payment', 'waitlist')
      and exists (
        select 1
        from public.members m
        where m.id = event_registrations.member_id
          and m.club_id = event_registrations.club_id
          and m.user_id = (select auth.uid())
          and m.status = 'active'
          and m.archived_at is null
      )
      and exists (
        select 1
        from public.events e
        where e.id = event_registrations.event_id
          and e.club_id = event_registrations.club_id
          and e.status = 'open'
          and e.archived_at is null
      )
    );
  end if;
end $$;
