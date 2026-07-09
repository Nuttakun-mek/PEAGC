create unique index if not exists clubs_active_short_name_unique_idx
on public.clubs (short_name)
where archived_at is null;
