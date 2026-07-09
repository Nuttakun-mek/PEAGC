alter table public.event_registrations
add column if not exists gross_score integer,
add column if not exists net_score numeric(5,1),
add column if not exists stableford_points numeric(5,1),
add column if not exists handicap_used numeric(4,1),
add column if not exists flight text,
add column if not exists overall_rank integer,
add column if not exists score_status text not null default 'not_entered'
  check (score_status in ('not_entered', 'draft', 'submitted', 'verified', 'published')),
add column if not exists score_note text,
add column if not exists scored_at timestamptz,
add column if not exists scored_by uuid references auth.users(id);

create index if not exists event_registrations_member_score_idx
on public.event_registrations (member_id, score_status, created_at desc)
where member_id is not null;

create table if not exists public.member_notifications (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  channel text not null default 'email'
    check (channel in ('email', 'line', 'system')),
  notification_type text not null
    check (notification_type in ('member_approved', 'member_rejected', 'lesson_reminder', 'event_update')),
  recipient text,
  subject text not null,
  body text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'skipped')),
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists member_notifications_member_status_idx
on public.member_notifications (member_id, status, created_at desc);

drop trigger if exists set_member_notifications_updated_at on public.member_notifications;
create trigger set_member_notifications_updated_at
before update on public.member_notifications
for each row execute function public.set_updated_at();

alter table public.member_notifications enable row level security;

grant select, insert, update on public.member_notifications to authenticated;
grant all on public.member_notifications to service_role;

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
  )
);

create policy "member_notifications_write_by_admin"
on public.member_notifications
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = member_notifications.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.club_id = member_notifications.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  )
);
