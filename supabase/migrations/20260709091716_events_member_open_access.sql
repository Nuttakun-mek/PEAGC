create policy "events_select_open_for_authenticated"
on public.events
for select
to authenticated
using (
  status = 'open'
  and archived_at is null
);
