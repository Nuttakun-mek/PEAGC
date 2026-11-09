-- MVP 2: competition scoring + Smart Score OCR.
--
-- Score data is layered and never overwritten:
--   score_entries          raw cards (manual / OCR / imported), append-only
--   verified_scores        the one approved card per player, pointing at its entry
--   leaderboard_snapshots  each publication frozen as JSON, append-only
-- Rules are data: competitions.rules (jsonb) + competition_rule_versions history.
-- Scorecard photos are kept in the private `scorecards` bucket for audit.
--
-- Also fixes: members could not read club news (policy only admitted staff).

-- ---------- helpers ----------
create or replace function public._is_scoring_staff(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.club_id = p_club
      and ur.user_id = auth.uid()
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'tournament_director', 'scoring_officer')
  );
$$;

grant execute on function public._is_scoring_staff(uuid) to authenticated;

-- ---------- competitions ----------
create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_id uuid not null unique references public.events(id) on delete cascade,
  name text not null,
  rules jsonb not null,
  rule_version integer not null default 1,
  status text not null default 'setup' check (status in ('setup', 'scoring', 'published', 'archived')),
  published_version integer,
  published_at timestamptz,
  published_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

drop trigger if exists set_competitions_updated_at on public.competitions;
create trigger set_competitions_updated_at
before update on public.competitions
for each row execute function public.set_updated_at();

create table if not exists public.competition_rule_versions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  version integer not null,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (competition_id, version)
);

-- Every rules change bumps the version and is kept.
create or replace function public.competition_rules_versioned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.rules is not distinct from old.rules then
      return new;
    end if;
    new.rule_version := old.rule_version + 1;
  end if;
  return new;
end;
$$;

create or replace function public.competition_rules_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.rule_version <> old.rule_version then
    insert into public.competition_rule_versions (club_id, competition_id, version, rules, created_by)
    values (new.club_id, new.id, new.rule_version, new.rules, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists competition_rules_versioned on public.competitions;
create trigger competition_rules_versioned
before update of rules on public.competitions
for each row execute function public.competition_rules_versioned();

drop trigger if exists competition_rules_history on public.competitions;
create trigger competition_rules_history
after insert or update of rules on public.competitions
for each row execute function public.competition_rules_history();

-- ---------- files / OCR ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scorecards', 'scorecards', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create table if not exists public.scorecard_ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  file_id uuid not null references public.files(id),
  status text not null default 'processing'
    check (status in ('processing', 'needs_review', 'confirmed', 'failed', 'discarded')),
  model text,
  notation text check (notation in ('absolute', 'relative')),
  extracted jsonb,
  error text,
  usage jsonb,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists scorecard_ocr_jobs_competition_idx
on public.scorecard_ocr_jobs (competition_id, created_at desc);

drop trigger if exists set_scorecard_ocr_jobs_updated_at on public.scorecard_ocr_jobs;
create trigger set_scorecard_ocr_jobs_updated_at
before update on public.scorecard_ocr_jobs
for each row execute function public.set_updated_at();

-- ---------- score layers ----------
create table if not exists public.score_entries (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  event_registration_id uuid not null references public.event_registrations(id) on delete cascade,
  source text not null check (source in ('manual', 'ocr', 'import')),
  ocr_job_id uuid references public.scorecard_ocr_jobs(id),
  strokes smallint[] not null check (cardinality(strokes) = 18),
  pickups boolean[] not null default array_fill(false, array[18]) check (cardinality(pickups) = 18),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists score_entries_registration_idx
on public.score_entries (event_registration_id, created_at desc);

create table if not exists public.verified_scores (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  event_registration_id uuid not null references public.event_registrations(id) on delete cascade,
  score_entry_id uuid not null references public.score_entries(id),
  verified_at timestamptz not null default now(),
  verified_by uuid references auth.users(id),
  unique (competition_id, event_registration_id)
);

create table if not exists public.leaderboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  version integer not null,
  rule_version integer not null,
  rows jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id),
  unique (competition_id, version)
);

-- ---------- RLS ----------
alter table public.competitions enable row level security;
alter table public.competition_rule_versions enable row level security;
alter table public.scorecard_ocr_jobs enable row level security;
alter table public.score_entries enable row level security;
alter table public.verified_scores enable row level security;
alter table public.leaderboard_snapshots enable row level security;

grant select, insert, update on public.competitions to authenticated;
grant select on public.competition_rule_versions to authenticated;
grant select, insert, update on public.scorecard_ocr_jobs to authenticated;
grant select, insert on public.score_entries to authenticated;          -- append-only
grant select, insert, update on public.verified_scores to authenticated;
grant select, insert on public.leaderboard_snapshots to authenticated;  -- append-only
grant all on public.competitions, public.competition_rule_versions, public.scorecard_ocr_jobs,
  public.score_entries, public.verified_scores, public.leaderboard_snapshots to service_role;

create policy "competitions_select_club" on public.competitions for select to authenticated
using (
  public._is_scoring_staff(club_id)
  or exists (select 1 from public.user_roles ur where ur.club_id = competitions.club_id and ur.user_id = (select auth.uid()))
  or (status = 'published' and exists (
    select 1 from public.members m where m.club_id = competitions.club_id and m.user_id = (select auth.uid())
  ))
);
create policy "competitions_write_staff" on public.competitions for all to authenticated
using (public._is_scoring_staff(club_id)) with check (public._is_scoring_staff(club_id));

create policy "rule_versions_select_staff" on public.competition_rule_versions for select to authenticated
using (public._is_scoring_staff(club_id));

create policy "ocr_jobs_staff" on public.scorecard_ocr_jobs for all to authenticated
using (public._is_scoring_staff(club_id)) with check (public._is_scoring_staff(club_id));

create policy "score_entries_select" on public.score_entries for select to authenticated
using (
  public._is_scoring_staff(club_id)
  or exists (
    select 1 from public.event_registrations r join public.members m on m.id = r.member_id
    where r.id = score_entries.event_registration_id and m.user_id = (select auth.uid())
  )
);
create policy "score_entries_insert_staff" on public.score_entries for insert to authenticated
with check (public._is_scoring_staff(club_id) and created_by = (select auth.uid()));

create policy "verified_scores_select" on public.verified_scores for select to authenticated
using (
  public._is_scoring_staff(club_id)
  or exists (
    select 1 from public.event_registrations r join public.members m on m.id = r.member_id
    where r.id = verified_scores.event_registration_id and m.user_id = (select auth.uid())
  )
);
create policy "verified_scores_write_staff" on public.verified_scores for all to authenticated
using (public._is_scoring_staff(club_id)) with check (public._is_scoring_staff(club_id));

create policy "snapshots_select" on public.leaderboard_snapshots for select to authenticated
using (
  public._is_scoring_staff(club_id)
  or exists (select 1 from public.members m where m.club_id = leaderboard_snapshots.club_id and m.user_id = (select auth.uid()))
  or exists (select 1 from public.user_roles ur where ur.club_id = leaderboard_snapshots.club_id and ur.user_id = (select auth.uid()))
);
create policy "snapshots_insert_staff" on public.leaderboard_snapshots for insert to authenticated
with check (public._is_scoring_staff(club_id) and published_by = (select auth.uid()));

-- Verified scores must reference an entry of the same registration + competition.
create or replace function public.verified_score_matches_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.score_entries e
    where e.id = new.score_entry_id
      and e.event_registration_id = new.event_registration_id
      and e.competition_id = new.competition_id
  ) then
    raise exception 'SCORE_ENTRY_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists verified_score_matches_entry on public.verified_scores;
create trigger verified_score_matches_entry
before insert or update on public.verified_scores
for each row execute function public.verified_score_matches_entry();

-- ---------- storage: scoring staff read/write scorecard photos ----------
create policy "scorecards_staff_read" on storage.objects for select to authenticated
using (
  bucket_id = 'scorecards'
  and public._is_scoring_staff(((storage.foldername(name))[1])::uuid)
);
create policy "scorecards_staff_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'scorecards'
  and public._is_scoring_staff(((storage.foldername(name))[1])::uuid)
);

-- ---------- hole score history for members: allow scoring staff to read too ----------
drop policy if exists "hole_scores_read_own_or_admin" on public.golf_hole_scores;
create policy "hole_scores_read_own_or_admin" on public.golf_hole_scores for select to authenticated
using (
  exists (select 1 from public.members m where m.id = golf_hole_scores.member_id and m.user_id = (select auth.uid()))
  or public._is_scoring_staff(club_id)
);

-- ---------- news fix: members can read published club news ----------
create policy "announcements_read_by_member" on public.club_announcements for select to authenticated
using (
  status = 'published'
  and exists (
    select 1 from public.members m
    where m.club_id = club_announcements.club_id and m.user_id = (select auth.uid()) and m.archived_at is null
  )
);

-- ---------- performance: indexes for hot member/admin queries ----------
create index if not exists lesson_slots_open_upcoming_idx
on public.lesson_slots (club_id, lesson_date, start_time)
where status = 'open' and archived_at is null;

create index if not exists lesson_bookings_member_active_idx
on public.lesson_bookings (member_id, booked_at desc)
where status <> 'cancelled';

create index if not exists event_registrations_member_active_idx
on public.event_registrations (member_id, created_at desc)
where status not in ('cancelled', 'no_show');

create index if not exists payment_records_registration_idx
on public.payment_records (event_registration_id, created_at desc);

create index if not exists events_club_status_date_idx
on public.events (club_id, status, event_date)
where archived_at is null;

create index if not exists members_user_idx
on public.members (user_id)
where archived_at is null;

create index if not exists user_roles_user_idx
on public.user_roles (user_id, role_key);

create index if not exists club_announcements_feed_idx
on public.club_announcements (club_id, status, is_pinned desc, published_at desc);
