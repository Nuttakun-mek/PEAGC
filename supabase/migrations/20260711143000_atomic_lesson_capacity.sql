create or replace function public.enforce_lesson_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  slot_capacity integer;
  active_count integer;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  select capacity into slot_capacity
  from public.lesson_slots
  where id = new.slot_id
  for update;

  select count(*)::integer into active_count
  from public.lesson_bookings
  where slot_id = new.slot_id
    and status <> 'cancelled'
    and id <> new.id;

  if active_count >= slot_capacity then
    raise exception 'lesson_slot_full' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_lesson_slot_capacity on public.lesson_bookings;
create trigger enforce_lesson_slot_capacity
before insert or update of slot_id, status on public.lesson_bookings
for each row execute function public.enforce_lesson_slot_capacity();
