-- Phase 2–3: membership lifecycle, annual fee terms, PDPA consent and แต้มสะสม (loyalty points).
--
-- 1. Club membership settings: auto-approve on/off, annual fee (0 = none), term length, renewal
--    notice and the grace period for members who left the association directory.
-- 2. members: lifecycle statuses (expired / suspended / resigned on top of the existing values),
--    external applicants with a sponsor member, membership expiry date, PDPA consent.
-- 3. membership_terms + a payment_records trigger: an approved 'membership_fee' payment activates
--    its term and extends members.membership_expires_at; a refund undoes it.
-- 4. run_membership_daily(): expire memberships, queue renewal reminders (deduped), suspend
--    members whose directory row left more than the grace period ago (called by the cron route).
-- 5. Points ledger (point_txns, append-only, balance = sum) with rules per club, automatic awards
--    from lessons / events / scorecards / referrals (unique source key → never twice), manual
--    adjustments with a reason, rewards and redemptions.
-- 6. member_data_requests: PDPA deletion requests that admins resolve.
--
-- Wording: loyalty points are "แต้มสะสม" in every text below; "แต้มต่อ" means handicap.

-- ---------- helpers ----------
create or replace function public._bangkok_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;

-- "15 ส.ค. 2569" for notification texts (the UI rule: no ISO or dd/mm/yyyy).
create or replace function public._thai_date(p_date date)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_date is null then null else
    extract(day from p_date)::integer::text || ' ' ||
    (array['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month from p_date)::integer] || ' ' ||
    (extract(year from p_date)::integer + 543)::text
  end;
$$;

create or replace function public._try_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
begin
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

grant execute on function public._bangkok_today() to authenticated, service_role;
grant execute on function public._thai_date(date) to authenticated, service_role;
revoke all on function public._try_timestamptz(text) from public, anon;
grant execute on function public._try_timestamptz(text) to authenticated, service_role;

-- Staff who may manage members (same list as the members RLS write policy).
create or replace function public._is_member_admin(p_club uuid)
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
      and ur.role_key in ('platform_owner', 'club_admin', 'committee')
  );
$$;

-- Any staff role of the club (read access to lists and ledgers).
create or replace function public._is_club_staff(p_club uuid)
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
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'finance_officer', 'tournament_director', 'scoring_officer', 'auditor')
  );
$$;

revoke all on function public._is_member_admin(uuid) from public, anon;
revoke all on function public._is_club_staff(uuid) from public, anon;
grant execute on function public._is_member_admin(uuid) to authenticated, service_role;
grant execute on function public._is_club_staff(uuid) to authenticated, service_role;

-- ---------- 1. club membership settings ----------
create table if not exists public.club_membership_settings (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  auto_approve boolean not null default true,
  annual_fee numeric(12,2) not null default 0 check (annual_fee >= 0 and annual_fee <= 100000),
  term_months integer not null default 12 check (term_months between 1 and 36),
  renewal_notice_days integer not null default 30 check (renewal_notice_days between 1 and 120),
  directory_grace_days integer not null default 30 check (directory_grace_days between 0 and 365),
  privacy_policy_version text not null default '2026-11',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

drop trigger if exists set_club_membership_settings_updated_at on public.club_membership_settings;
create trigger set_club_membership_settings_updated_at
before update on public.club_membership_settings
for each row execute function public.set_updated_at();

alter table public.club_membership_settings enable row level security;
grant select, insert, update on public.club_membership_settings to authenticated;
grant all on public.club_membership_settings to service_role;

drop policy if exists "membership_settings_select_club" on public.club_membership_settings;
create policy "membership_settings_select_club"
on public.club_membership_settings
for select
to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.club_id = club_membership_settings.club_id and ur.user_id = (select auth.uid()))
  or exists (select 1 from public.members m where m.club_id = club_membership_settings.club_id and m.user_id = (select auth.uid()))
);

drop policy if exists "membership_settings_write_by_owner" on public.club_membership_settings;
create policy "membership_settings_write_by_owner"
on public.club_membership_settings
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = club_membership_settings.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = club_membership_settings.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin')
  )
);

-- Missing row = defaults. Keep in sync with src/lib/membership/settings.ts.
create or replace function public.membership_settings_for(p_club uuid)
returns public.club_membership_settings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.club_membership_settings;
begin
  select * into v from public.club_membership_settings where club_id = p_club;
  if v.club_id is null then
    v.club_id := p_club;
    v.auto_approve := true;
    v.annual_fee := 0;
    v.term_months := 12;
    v.renewal_notice_days := 30;
    v.directory_grace_days := 30;
    v.privacy_policy_version := '2026-11';
    v.updated_at := now();
  end if;
  return v;
end;
$$;

revoke all on function public.membership_settings_for(uuid) from public, anon;
grant execute on function public.membership_settings_for(uuid) to authenticated, service_role;

-- ---------- 2. members: lifecycle, sponsor, expiry, consent ----------
-- Status values so far: foundation ('active','inactive','guest','archived') and
-- 20260709084618 ('pending_verification' + the same four). Keep all of them.
--   pending_verification รอตรวจ · active ใช้งาน (ใกล้หมดอายุ is derived from membership_expires_at)
--   expired หมดอายุ · suspended ระงับ · resigned พ้นสภาพ/ลาออก · inactive / guest / archived (unchanged)
alter table public.members drop constraint if exists members_status_check;
alter table public.members
  add constraint members_status_check
  check (status in (
    'pending_verification', 'active', 'inactive', 'guest', 'archived',
    'expired', 'suspended', 'resigned'
  ));

alter table public.members
  add column if not exists applicant_type text not null default 'staff',
  add column if not exists sponsor_member_id uuid references public.members(id) on delete set null,
  add column if not exists membership_expires_at date,
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists pdpa_consent_at timestamptz,
  add column if not exists pdpa_policy_version text,
  add column if not exists photo_consent boolean not null default false,
  add column if not exists photo_consent_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'members_applicant_type_check') then
    alter table public.members
      add constraint members_applicant_type_check check (applicant_type in ('staff', 'external'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'members_sponsor_not_self_check') then
    alter table public.members
      add constraint members_sponsor_not_self_check check (sponsor_member_id is null or sponsor_member_id <> id);
  end if;
end $$;

create index if not exists members_sponsor_idx
on public.members (sponsor_member_id)
where sponsor_member_id is not null;

create index if not exists members_club_expiry_idx
on public.members (club_id, membership_expires_at)
where archived_at is null and membership_expires_at is not null;

create index if not exists members_club_status_idx
on public.members (club_id, status)
where archived_at is null;

create or replace function public.stamp_member_status_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_member_status_change on public.members;
create trigger stamp_member_status_change
before update of status on public.members
for each row execute function public.stamp_member_status_change();

-- ---------- 3. membership terms (annual fee) ----------
create table if not exists public.membership_terms (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  term_months integer not null default 12 check (term_months between 1 and 36),
  fee numeric(12,2) not null default 0 check (fee >= 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'cancelled')),
  payment_record_id uuid references public.payment_records(id) on delete set null,
  note text,
  activated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  check (period_end >= period_start)
);

create unique index if not exists membership_terms_one_pending_key
on public.membership_terms (member_id)
where status = 'pending_payment';

create index if not exists membership_terms_member_idx
on public.membership_terms (member_id, period_end desc);

create index if not exists membership_terms_club_status_idx
on public.membership_terms (club_id, status, created_at desc);

drop trigger if exists set_membership_terms_updated_at on public.membership_terms;
create trigger set_membership_terms_updated_at
before update on public.membership_terms
for each row execute function public.set_updated_at();

alter table public.membership_terms enable row level security;
grant select, insert, update on public.membership_terms to authenticated;
grant all on public.membership_terms to service_role;

drop policy if exists "membership_terms_select_own_or_staff" on public.membership_terms;
create policy "membership_terms_select_own_or_staff"
on public.membership_terms
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = membership_terms.member_id and m.user_id = (select auth.uid()))
  or public._is_club_staff(club_id)
);

drop policy if exists "membership_terms_write_by_admin" on public.membership_terms;
create policy "membership_terms_write_by_admin"
on public.membership_terms
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = membership_terms.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'finance_officer')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = membership_terms.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'committee', 'finance_officer')
  )
);

-- Member asks to pay the annual fee: returns the open (pending_payment) term, creating it when
-- needed. Renewal opens within renewal_notice_days of expiry, after expiry, or when the member has
-- never paid. The period is recomputed when the payment is approved.
create or replace function public.request_membership_term()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_settings public.club_membership_settings;
  v_term public.membership_terms;
  v_today date := public._bangkok_today();
  v_start date;
  v_end date;
begin
  select * into v_member
  from public.members
  where user_id = auth.uid() and archived_at is null
  order by created_at
  limit 1
  for update;
  if v_member.id is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_member.status not in ('active', 'expired') then
    raise exception 'MEMBER_NOT_APPROVED' using errcode = 'P0001';
  end if;

  v_settings := public.membership_settings_for(v_member.club_id);
  if v_settings.annual_fee <= 0 then
    raise exception 'NO_FEE' using errcode = 'P0001';
  end if;

  select * into v_term from public.membership_terms
  where member_id = v_member.id and status = 'pending_payment';
  if v_term.id is not null then
    return json_build_object(
      'term_id', v_term.id, 'fee', v_term.fee, 'period_start', v_term.period_start,
      'period_end', v_term.period_end, 'payment_record_id', v_term.payment_record_id, 'created', false
    );
  end if;

  if v_member.membership_expires_at is not null
     and v_member.membership_expires_at > v_today + v_settings.renewal_notice_days then
    raise exception 'NOT_DUE_YET' using errcode = 'P0001';
  end if;

  v_start := greatest(v_today, coalesce(v_member.membership_expires_at + 1, v_today));
  v_end := (v_start + make_interval(months => v_settings.term_months))::date - 1;

  insert into public.membership_terms (
    club_id, member_id, period_start, period_end, term_months, fee, status, created_by, updated_by
  ) values (
    v_member.club_id, v_member.id, v_start, v_end, v_settings.term_months, v_settings.annual_fee,
    'pending_payment', auth.uid(), auth.uid()
  )
  returning * into v_term;

  return json_build_object(
    'term_id', v_term.id, 'fee', v_term.fee, 'period_start', v_term.period_start,
    'period_end', v_term.period_end, 'payment_record_id', null, 'created', true
  );
end;
$$;

revoke all on function public.request_membership_term() from public, anon;
grant execute on function public.request_membership_term() to authenticated, service_role;

-- Approved membership_fee payment → term active, expiry extended, member notified.
-- Refunded (or rejected after approval) → term cancelled, expiry recomputed from other terms.
create or replace function public.membership_fee_payment_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_term public.membership_terms;
  v_member public.members;
  v_today date := public._bangkok_today();
  v_start date;
  v_end date;
  v_max date;
begin
  if new.reference_id is null then
    return null;
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    select * into v_term from public.membership_terms where id = new.reference_id for update;
    if v_term.id is null or v_term.status = 'active' then
      return null;
    end if;
    select * into v_member from public.members where id = v_term.member_id for update;
    if v_member.id is null then
      return null;
    end if;

    -- Pay early: the new year starts the day after the current one ends. Lapsed: starts today.
    v_start := greatest(v_today, coalesce(v_member.membership_expires_at + 1, v_today));
    v_end := (v_start + make_interval(months => v_term.term_months))::date - 1;

    update public.membership_terms
    set status = 'active',
        period_start = v_start,
        period_end = v_end,
        payment_record_id = new.id,
        activated_at = now(),
        cancelled_at = null,
        updated_by = coalesce(auth.uid(), updated_by)
    where id = v_term.id;

    update public.members
    set membership_expires_at = greatest(coalesce(membership_expires_at, v_end), v_end),
        status = case when status = 'expired' then 'active' else status end,
        status_reason = case when status = 'expired' then null else status_reason end,
        updated_at = now()
    where id = v_member.id;

    insert into public.member_notifications (
      club_id, member_id, channel, notification_type, subject, body, status, metadata, created_by
    ) values (
      v_term.club_id, v_member.id, 'system', 'membership_renewed',
      'ต่ออายุสมาชิกแล้ว',
      'ชำระค่าบำรุงเรียบร้อย บัตรสมาชิกใช้ได้ถึง ' || public._thai_date(v_end),
      'queued',
      jsonb_build_object('term_id', v_term.id, 'payment_id', new.id, 'period_end', v_end, 'link', '/member/membership'),
      auth.uid()
    );

    insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
    values (
      v_term.club_id, auth.uid(), 'membership_term.activated', 'membership_terms', v_term.id,
      jsonb_build_object('status', v_term.status, 'membership_expires_at', v_member.membership_expires_at),
      jsonb_build_object('status', 'active', 'period_start', v_start, 'period_end', v_end),
      jsonb_build_object('payment_id', new.id, 'member_id', v_member.id, 'source', 'payment_records.trigger')
    );
  elsif tg_op = 'UPDATE' and old.status = 'approved' and new.status in ('refunded', 'rejected') then
    update public.membership_terms
    set status = 'cancelled', cancelled_at = now(), updated_by = coalesce(auth.uid(), updated_by)
    where id = new.reference_id and status = 'active'
    returning * into v_term;

    if v_term.id is not null then
      select max(period_end) into v_max
      from public.membership_terms
      where member_id = v_term.member_id and status = 'active';

      update public.members
      set membership_expires_at = v_max, updated_at = now()
      where id = v_term.member_id;

      insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, after_data, metadata)
      values (
        v_term.club_id, auth.uid(), 'membership_term.cancelled', 'membership_terms', v_term.id,
        jsonb_build_object('status', 'cancelled', 'membership_expires_at', v_max),
        jsonb_build_object('payment_id', new.id, 'payment_status', new.status, 'source', 'payment_records.trigger')
      );
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists membership_fee_payment_changed on public.payment_records;
create trigger membership_fee_payment_changed
after insert or update of status on public.payment_records
for each row
when (new.purpose = 'membership_fee')
execute function public.membership_fee_payment_changed();

-- ---------- 4. daily lifecycle job ----------
create or replace function public.run_membership_daily(p_today date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, public._bangkok_today());
  v_expired integer := 0;
  v_reminded integer := 0;
  v_suspended integer := 0;
  v_resumed integer := 0;
begin
  -- 4a. memberships past their end date
  with changed as (
    update public.members m
    set status = 'expired', status_reason = 'membership_expired', updated_at = now()
    where m.status = 'active'
      and m.archived_at is null
      and m.membership_expires_at is not null
      and m.membership_expires_at < v_today
    returning m.id, m.club_id, m.membership_expires_at
  ), logged as (
    insert into public.audit_logs (club_id, action, entity_type, entity_id, before_data, after_data, metadata)
    select c.club_id, 'member.expired', 'members', c.id,
           jsonb_build_object('status', 'active'),
           jsonb_build_object('status', 'expired', 'membership_expires_at', c.membership_expires_at),
           jsonb_build_object('source', 'cron.membership')
    from changed c
    returning 1
  )
  select count(*) into v_expired from logged;

  -- 4b. renewal reminder once per expiry date
  with due as (
    select m.id, m.club_id, m.membership_expires_at
    from public.members m
    where m.status = 'active'
      and m.archived_at is null
      and m.membership_expires_at is not null
      and m.membership_expires_at >= v_today
      and m.membership_expires_at <= v_today + (public.membership_settings_for(m.club_id)).renewal_notice_days
      and not exists (
        select 1 from public.member_notifications n
        where n.member_id = m.id
          and n.notification_type = 'membership_expiring'
          and n.metadata ->> 'expires_at' = m.membership_expires_at::text
      )
  ), inserted as (
    insert into public.member_notifications (club_id, member_id, channel, notification_type, subject, body, status, metadata)
    select d.club_id, d.id, 'system', 'membership_expiring',
           'สมาชิกใกล้หมดอายุ',
           'บัตรสมาชิกใช้ได้ถึง ' || public._thai_date(d.membership_expires_at) || ' ต่ออายุได้ที่หน้าสมาชิก',
           'queued',
           jsonb_build_object('expires_at', d.membership_expires_at, 'link', '/member/membership')
    from due d
    returning 1
  )
  select count(*) into v_reminded from inserted;

  -- 4c. left the association directory and the grace period is over → suspended
  with changed as (
    update public.members m
    set status = 'suspended', status_reason = 'left_directory', updated_at = now()
    where m.status = 'active'
      and m.archived_at is null
      and m.employee_match_detail ->> 'reason' = 'left_directory'
      and public._try_timestamptz(m.employee_match_detail ->> 'flagged_at') is not null
      and public._try_timestamptz(m.employee_match_detail ->> 'flagged_at')
          + make_interval(days => (public.membership_settings_for(m.club_id)).directory_grace_days) <= now()
    returning m.id, m.club_id
  ), logged as (
    insert into public.audit_logs (club_id, action, entity_type, entity_id, before_data, after_data, metadata)
    select c.club_id, 'member.suspended', 'members', c.id,
           jsonb_build_object('status', 'active'),
           jsonb_build_object('status', 'suspended', 'status_reason', 'left_directory'),
           jsonb_build_object('source', 'cron.membership')
    from changed c
    returning 1
  )
  select count(*) into v_suspended from logged;

  -- 4d. back in the directory (a later import cleared the flag) → active again
  with changed as (
    update public.members m
    set status = 'active', status_reason = null, updated_at = now()
    where m.status = 'suspended'
      and m.archived_at is null
      and m.status_reason = 'left_directory'
      and m.employee_match_status = 'matched'
      and (m.employee_match_detail ->> 'reason') is distinct from 'left_directory'
      and (m.membership_expires_at is null or m.membership_expires_at >= v_today)
    returning m.id, m.club_id
  ), logged as (
    insert into public.audit_logs (club_id, action, entity_type, entity_id, before_data, after_data, metadata)
    select c.club_id, 'member.resumed', 'members', c.id,
           jsonb_build_object('status', 'suspended', 'status_reason', 'left_directory'),
           jsonb_build_object('status', 'active'),
           jsonb_build_object('source', 'cron.membership')
    from changed c
    returning 1
  )
  select count(*) into v_resumed from logged;

  return json_build_object(
    'today', v_today, 'expired', v_expired, 'reminded', v_reminded,
    'suspended', v_suspended, 'resumed', v_resumed
  );
end;
$$;

revoke all on function public.run_membership_daily(date) from public, anon, authenticated;
grant execute on function public.run_membership_daily(date) to service_role;

-- ---------- 5. แต้มสะสม (points) ----------
create table if not exists public.point_rules (
  club_id uuid not null references public.clubs(id) on delete cascade,
  reason text not null
    check (reason in ('attend_lesson', 'event_checkin', 'scorecard_on_time', 'referral', 'staff_award', 'no_show')),
  points integer not null check (points between -1000 and 1000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (club_id, reason)
);

drop trigger if exists set_point_rules_updated_at on public.point_rules;
create trigger set_point_rules_updated_at
before update on public.point_rules
for each row execute function public.set_updated_at();

alter table public.point_rules enable row level security;
grant select, insert, update on public.point_rules to authenticated;
grant all on public.point_rules to service_role;

drop policy if exists "point_rules_select_club" on public.point_rules;
create policy "point_rules_select_club"
on public.point_rules
for select
to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.club_id = point_rules.club_id and ur.user_id = (select auth.uid()))
  or exists (select 1 from public.members m where m.club_id = point_rules.club_id and m.user_id = (select auth.uid()))
);

drop policy if exists "point_rules_write_by_admin" on public.point_rules;
create policy "point_rules_write_by_admin"
on public.point_rules
for all
to authenticated
using (public._is_member_admin(club_id))
with check (public._is_member_admin(club_id));

-- Audit defaults (page 20–21). Keep in sync with src/lib/points/rules.ts.
create or replace function public._point_rule_default(p_reason text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_reason
    when 'attend_lesson' then 10
    when 'event_checkin' then 30
    when 'scorecard_on_time' then 5
    when 'referral' then 50
    when 'staff_award' then 20
    when 'no_show' then -10
    else null
  end;
$$;

-- Points for a rule now; null when the club turned the rule off.
create or replace function public.point_rule_points(p_club uuid, p_reason text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.club_id is null then public._point_rule_default(p_reason)
    when r.enabled then r.points
    else null
  end
  from (select 1) one
  left join public.point_rules r on r.club_id = p_club and r.reason = p_reason;
$$;

revoke all on function public.point_rule_points(uuid, text) from public, anon;
grant execute on function public.point_rule_points(uuid, text) to authenticated, service_role;

-- The ledger. Balance = sum(delta). Rows are never updated or deleted (trigger below); a mistake
-- is corrected with a new 'adjust' row. Automatic rows carry their source so the unique key makes
-- a second award for the same lesson/registration/member impossible.
create table if not exists public.point_txns (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  delta integer not null check (delta <> 0 and delta between -100000 and 100000),
  reason text not null check (reason in (
    'attend_lesson', 'event_checkin', 'scorecard_on_time', 'referral', 'staff_award',
    'no_show', 'redemption', 'expiry', 'adjust'
  )),
  source_type text,
  source_id uuid,
  note text,
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint point_txns_source_key unique (source_type, source_id, reason)
);

create index if not exists point_txns_member_created_idx
on public.point_txns (member_id, created_at);

create index if not exists point_txns_club_created_idx
on public.point_txns (club_id, created_at desc);

create index if not exists point_txns_due_idx
on public.point_txns (expires_at)
where delta > 0;

-- Positive rows expire 12 months after they were earned; negative rows never expire.
create or replace function public.point_txns_set_expiry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.delta > 0 then
    new.expires_at := coalesce(new.expires_at, coalesce(new.created_at, now()) + interval '12 months');
  else
    new.expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists point_txns_set_expiry on public.point_txns;
create trigger point_txns_set_expiry
before insert on public.point_txns
for each row execute function public.point_txns_set_expiry();

create or replace function public.point_txns_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Deleting the member or the club (test-data cleanup) may cascade; nothing else may delete.
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.members where id = old.member_id)
    or not exists (select 1 from public.clubs where id = old.club_id)
  ) then
    return old;
  end if;
  raise exception 'POINT_LEDGER_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

drop trigger if exists point_txns_append_only on public.point_txns;
create trigger point_txns_append_only
before update or delete on public.point_txns
for each row execute function public.point_txns_append_only();

alter table public.point_txns enable row level security;
grant select on public.point_txns to authenticated;
grant all on public.point_txns to service_role;

drop policy if exists "point_txns_select_own_or_staff" on public.point_txns;
create policy "point_txns_select_own_or_staff"
on public.point_txns
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = point_txns.member_id and m.user_id = (select auth.uid()))
  or public._is_club_staff(club_id)
);

-- Award by rule, at most once per (source_type, source_id, reason). Returns the new row id or null.
create or replace function public._award_points(
  p_club uuid,
  p_member uuid,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_note text default null,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer;
  v_id uuid;
begin
  if p_member is null or p_club is null then
    return null;
  end if;
  v_points := public.point_rule_points(p_club, p_reason);
  if v_points is null or v_points = 0 then
    return null;
  end if;
  insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
  values (
    p_club, p_member, v_points, p_reason, p_source_type, p_source_id, p_note,
    case when exists (select 1 from auth.users u where u.id = p_actor) then p_actor else null end
  )
  on conflict (source_type, source_id, reason) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Undo an automatic award once (attendance corrected, check-in undone). The reversal row keeps the
-- original reason so monthly totals net out; source_type 'reversal:<type>' keeps it unique.
create or replace function public._reverse_points(
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.point_txns;
  v_id uuid;
begin
  select * into v_original from public.point_txns
  where source_type = p_source_type and source_id = p_source_id and reason = p_reason;
  if v_original.id is null then
    return null;
  end if;
  insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
  values (
    v_original.club_id, v_original.member_id, -v_original.delta, p_reason, 'reversal:' || p_source_type, p_source_id,
    'ยกเลิกรายการเดิม',
    case when exists (select 1 from auth.users u where u.id = p_actor) then p_actor else null end
  )
  on conflict (source_type, source_id, reason) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public._award_points(uuid, uuid, text, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public._reverse_points(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public._award_points(uuid, uuid, text, text, uuid, text, uuid) to service_role;
grant execute on function public._reverse_points(text, text, uuid, uuid) to service_role;

-- 5a. lessons: attended +, no-show −
create or replace function public.points_on_lesson_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'attended' then
    perform public._reverse_points('attend_lesson', 'lesson_booking', new.id, auth.uid());
  elsif tg_op = 'UPDATE' and old.status = 'no_show' then
    perform public._reverse_points('no_show', 'lesson_booking', new.id, auth.uid());
  end if;
  if new.status = 'attended' then
    perform public._award_points(new.club_id, new.member_id, 'attend_lesson', 'lesson_booking', new.id, null, auth.uid());
  elsif new.status = 'no_show' then
    perform public._award_points(new.club_id, new.member_id, 'no_show', 'lesson_booking', new.id, null, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists points_on_lesson_booking on public.lesson_bookings;
create trigger points_on_lesson_booking
after insert or update of status on public.lesson_bookings
for each row execute function public.points_on_lesson_booking();

-- Scorecard deadline: 24 hours after the round ends (tee-off + 6 hours; 18:00 when the event has
-- no tee-off time), Bangkok time.
create or replace function public._scorecard_deadline(p_event_date date, p_tee_off time)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select ((p_event_date + coalesce(p_tee_off, time '12:00'))::timestamp at time zone 'Asia/Bangkok')
         + interval '6 hours' + interval '24 hours';
$$;

grant execute on function public._scorecard_deadline(date, time) to authenticated, service_role;

create or replace function public._award_scorecard_on_time(p_registration uuid, p_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.event_registrations;
  v_event public.events;
begin
  select * into v_reg from public.event_registrations where id = p_registration;
  if v_reg.id is null or v_reg.member_id is null then
    return null;
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  if v_event.id is null or p_at > public._scorecard_deadline(v_event.event_date, v_event.tee_off_time) then
    return null;
  end if;
  return public._award_points(v_reg.club_id, v_reg.member_id, 'scorecard_on_time', 'event_registration', v_reg.id, v_event.name, auth.uid());
end;
$$;

revoke all on function public._award_scorecard_on_time(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public._award_scorecard_on_time(uuid, timestamptz) to service_role;

-- 5b. events: check-in +, no-show −, scorecard submitted on time +
create or replace function public.points_on_event_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.member_id is null then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.checked_in_at is not null and new.checked_in_at is null then
    perform public._reverse_points('event_checkin', 'event_registration', new.id, auth.uid());
  end if;
  if new.checked_in_at is not null and (tg_op = 'INSERT' or old.checked_in_at is null) then
    perform public._award_points(new.club_id, new.member_id, 'event_checkin', 'event_registration', new.id, null, auth.uid());
  end if;

  if tg_op = 'UPDATE' and old.status = 'no_show' and new.status is distinct from 'no_show' then
    perform public._reverse_points('no_show', 'event_registration', new.id, auth.uid());
  end if;
  if new.status = 'no_show' and (tg_op = 'INSERT' or old.status is distinct from 'no_show') then
    perform public._award_points(new.club_id, new.member_id, 'no_show', 'event_registration', new.id, null, auth.uid());
  end if;

  if new.score_status = 'submitted'
     and (tg_op = 'INSERT' or old.score_status in ('not_entered', 'draft')) then
    perform public._award_scorecard_on_time(new.id, now());
  end if;
  return null;
end;
$$;

drop trigger if exists points_on_event_registration on public.event_registrations;
create trigger points_on_event_registration
after insert or update of checked_in_at, status, score_status on public.event_registrations
for each row execute function public.points_on_event_registration();

-- First card recorded for the player (manual entry, OCR or import) counts as "submitted".
create or replace function public.points_on_score_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.score_entries e
    where e.event_registration_id = new.event_registration_id
      and e.id <> new.id
      and e.created_at < new.created_at
  ) then
    perform public._award_scorecard_on_time(new.event_registration_id, new.created_at);
  end if;
  return null;
end;
$$;

drop trigger if exists points_on_score_entry on public.score_entries;
create trigger points_on_score_entry
after insert on public.score_entries
for each row execute function public.points_on_score_entry();

-- 5c. referral: the sponsor earns when the member they vouched for becomes active.
create or replace function public.points_on_member_activated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active'
     and new.sponsor_member_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform public._award_points(new.club_id, new.sponsor_member_id, 'referral', 'member', new.id, new.full_name, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists points_on_member_activated on public.members;
create trigger points_on_member_activated
after insert or update of status on public.members
for each row execute function public.points_on_member_activated();

-- 5d. manual award / deduction (reason required, audit-logged)
create or replace function public.admin_adjust_points(
  p_member uuid,
  p_delta integer,
  p_reason text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_member from public.members where id = p_member for update;
  if v_member.id is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public._is_member_admin(v_member.club_id) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;
  if p_reason not in ('staff_award', 'adjust') then
    raise exception 'INVALID_REASON' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 10000 or (p_reason = 'staff_award' and p_delta < 0) then
    raise exception 'INVALID_POINTS' using errcode = 'P0001';
  end if;
  if v_note is null then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
  values (v_member.club_id, v_member.id, p_delta, p_reason, 'manual', null, v_note, auth.uid())
  returning id into v_id;

  insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, after_data, metadata)
  values (
    v_member.club_id, auth.uid(), 'points.adjusted', 'point_txns', v_id,
    jsonb_build_object('member_id', v_member.id, 'delta', p_delta, 'reason', p_reason, 'note', v_note),
    jsonb_build_object('source', 'admin.points')
  );

  insert into public.member_notifications (club_id, member_id, channel, notification_type, subject, body, status, metadata, created_by)
  values (
    v_member.club_id, v_member.id, 'system', 'points_update',
    case when p_delta > 0 then 'ได้รับแต้มสะสม +' || p_delta else 'ปรับแต้มสะสม ' || p_delta end,
    v_note,
    'queued',
    jsonb_build_object('point_txn_id', v_id, 'delta', p_delta, 'link', '/member#points'),
    auth.uid()
  );

  return v_id;
end;
$$;

revoke all on function public.admin_adjust_points(uuid, integer, text, text) from public, anon;
grant execute on function public.admin_adjust_points(uuid, integer, text, text) to authenticated, service_role;

-- 5e. monthly leaderboard (points earned in the month; reversals net out). Names only, no contact
-- data, so members can see the top list.
create or replace function public.point_leaderboard(p_club uuid, p_month date default null, p_limit integer default 10)
returns table (
  member_id uuid,
  full_name text,
  nickname text,
  member_code text,
  avatar_url text,
  points bigint,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select date_trunc('month', coalesce(p_month, public._bangkok_today()))::date as month_start
  ), totals as (
    select t.member_id, sum(t.delta)::bigint as points
    from public.point_txns t, bounds b
    where t.club_id = p_club
      and t.reason in ('attend_lesson', 'event_checkin', 'scorecard_on_time', 'referral', 'staff_award')
      and (t.created_at at time zone 'Asia/Bangkok')::date >= b.month_start
      and (t.created_at at time zone 'Asia/Bangkok')::date < (b.month_start + interval '1 month')::date
    group by t.member_id
    having sum(t.delta) > 0
  )
  select m.id, m.full_name, m.nickname, m.member_code, m.avatar_url, tt.points,
         rank() over (order by tt.points desc)
  from totals tt
  join public.members m on m.id = tt.member_id
  where m.archived_at is null
    and (
      auth.uid() is null
      or public._is_club_staff(p_club)
      or exists (select 1 from public.members me where me.club_id = p_club and me.user_id = auth.uid() and me.archived_at is null)
    )
  order by tt.points desc, m.full_name
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

revoke all on function public.point_leaderboard(uuid, date, integer) from public, anon;
grant execute on function public.point_leaderboard(uuid, date, integer) to authenticated, service_role;

-- 5f. rewards and redemptions
create table if not exists public.point_rewards (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text,
  cost integer not null check (cost between 1 and 100000),
  stock integer check (stock is null or stock >= 0),
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists point_rewards_club_status_idx
on public.point_rewards (club_id, status, cost);

drop trigger if exists set_point_rewards_updated_at on public.point_rewards;
create trigger set_point_rewards_updated_at
before update on public.point_rewards
for each row execute function public.set_updated_at();

alter table public.point_rewards enable row level security;
grant select, insert, update on public.point_rewards to authenticated;
grant all on public.point_rewards to service_role;

drop policy if exists "point_rewards_select_club" on public.point_rewards;
create policy "point_rewards_select_club"
on public.point_rewards
for select
to authenticated
using (
  public._is_club_staff(club_id)
  or (
    status = 'active'
    and exists (select 1 from public.members m where m.club_id = point_rewards.club_id and m.user_id = (select auth.uid()))
  )
);

drop policy if exists "point_rewards_write_by_admin" on public.point_rewards;
create policy "point_rewards_write_by_admin"
on public.point_rewards
for all
to authenticated
using (public._is_member_admin(club_id))
with check (public._is_member_admin(club_id));

create table if not exists public.point_redemptions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  reward_id uuid not null references public.point_rewards(id),
  reward_name text not null,
  cost integer not null check (cost > 0),
  status text not null default 'requested' check (status in ('requested', 'fulfilled', 'cancelled')),
  note text,
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  fulfilled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancel_reason text,
  updated_at timestamptz not null default now()
);

create index if not exists point_redemptions_club_status_idx
on public.point_redemptions (club_id, status, requested_at desc);

create index if not exists point_redemptions_member_idx
on public.point_redemptions (member_id, requested_at desc);

drop trigger if exists set_point_redemptions_updated_at on public.point_redemptions;
create trigger set_point_redemptions_updated_at
before update on public.point_redemptions
for each row execute function public.set_updated_at();

alter table public.point_redemptions enable row level security;
grant select on public.point_redemptions to authenticated;
grant all on public.point_redemptions to service_role;

drop policy if exists "point_redemptions_select_own_or_staff" on public.point_redemptions;
create policy "point_redemptions_select_own_or_staff"
on public.point_redemptions
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = point_redemptions.member_id and m.user_id = (select auth.uid()))
  or public._is_club_staff(club_id)
);

-- Member redeems a reward: reward row lock (stock) + member row lock (balance) in one transaction.
create or replace function public.redeem_point_reward(p_reward uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward public.point_rewards;
  v_member public.members;
  v_balance integer;
  v_id uuid;
begin
  select * into v_reward from public.point_rewards where id = p_reward for update;
  if v_reward.id is null or v_reward.status <> 'active' then
    raise exception 'REWARD_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_member from public.members
  where user_id = auth.uid() and club_id = v_reward.club_id and archived_at is null
  limit 1
  for update;
  if v_member.id is null or v_member.status <> 'active' then
    raise exception 'MEMBER_NOT_APPROVED' using errcode = 'P0001';
  end if;

  if v_reward.stock is not null and v_reward.stock <= 0 then
    raise exception 'OUT_OF_STOCK' using errcode = 'P0001';
  end if;

  select coalesce(sum(delta), 0)::integer into v_balance from public.point_txns where member_id = v_member.id;
  if v_balance < v_reward.cost then
    raise exception 'POINTS_NOT_ENOUGH' using errcode = 'P0001';
  end if;

  insert into public.point_redemptions (club_id, member_id, reward_id, reward_name, cost, status)
  values (v_reward.club_id, v_member.id, v_reward.id, v_reward.name, v_reward.cost, 'requested')
  returning id into v_id;

  insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
  values (v_reward.club_id, v_member.id, -v_reward.cost, 'redemption', 'point_redemption', v_id, v_reward.name, auth.uid());

  if v_reward.stock is not null then
    update public.point_rewards set stock = stock - 1 where id = v_reward.id;
  end if;

  return json_build_object('redemption_id', v_id, 'balance', v_balance - v_reward.cost);
end;
$$;

revoke all on function public.redeem_point_reward(uuid) from public, anon;
grant execute on function public.redeem_point_reward(uuid) to authenticated;

-- Staff mark a redemption handed over or cancel it; the member may cancel their own request.
-- Cancelling refunds the points (an 'adjust' row tied to the redemption) and returns the stock.
create or replace function public.set_point_redemption_status(p_redemption uuid, p_status text, p_note text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.point_redemptions;
  v_is_staff boolean;
  v_is_owner boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_status not in ('fulfilled', 'cancelled') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  select * into v_row from public.point_redemptions where id = p_redemption for update;
  if v_row.id is null then
    raise exception 'REDEMPTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_is_staff := public._is_member_admin(v_row.club_id);
  v_is_owner := exists (select 1 from public.members m where m.id = v_row.member_id and m.user_id = auth.uid());
  if not v_is_staff and not (v_is_owner and p_status = 'cancelled') then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'REDEMPTION_CLOSED' using errcode = 'P0001';
  end if;

  if p_status = 'fulfilled' then
    update public.point_redemptions
    set status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid(), note = coalesce(v_note, note)
    where id = v_row.id;
  else
    update public.point_redemptions
    set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_note
    where id = v_row.id;

    insert into public.point_txns (club_id, member_id, delta, reason, source_type, source_id, note, created_by)
    values (v_row.club_id, v_row.member_id, v_row.cost, 'adjust', 'point_redemption', v_row.id,
            'คืนแต้มสะสม ยกเลิกการแลก ' || v_row.reward_name, auth.uid())
    on conflict (source_type, source_id, reason) do nothing;

    update public.point_rewards set stock = stock + 1 where id = v_row.reward_id and stock is not null;
  end if;

  if v_is_staff then
    insert into public.audit_logs (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata)
    values (
      v_row.club_id, auth.uid(), 'point_redemption.' || p_status, 'point_redemptions', v_row.id,
      jsonb_build_object('status', v_row.status),
      jsonb_build_object('status', p_status, 'note', v_note),
      jsonb_build_object('member_id', v_row.member_id, 'source', 'admin.points')
    );

    insert into public.member_notifications (club_id, member_id, channel, notification_type, subject, body, status, metadata, created_by)
    values (
      v_row.club_id, v_row.member_id, 'system', 'points_update',
      case when p_status = 'fulfilled' then 'รับของรางวัลแล้ว' else 'ยกเลิกการแลกของรางวัล' end,
      case when p_status = 'fulfilled'
        then v_row.reward_name
        else v_row.reward_name || ' คืนแต้มสะสม ' || v_row.cost || ' แต้มสะสมแล้ว' || coalesce(' (' || v_note || ')', '')
      end,
      'queued',
      jsonb_build_object('redemption_id', v_row.id, 'link', '/member#points'),
      auth.uid()
    );
  end if;

  return json_build_object('redemption_id', v_row.id, 'status', p_status);
end;
$$;

revoke all on function public.set_point_redemption_status(uuid, text, text) from public, anon;
grant execute on function public.set_point_redemption_status(uuid, text, text) to authenticated, service_role;

-- ---------- 6. PDPA data requests ----------
create table if not exists public.member_data_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  request_type text not null default 'delete' check (request_type in ('delete')),
  status text not null default 'open' check (status in ('open', 'done', 'rejected')),
  note text,
  resolution_note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create unique index if not exists member_data_requests_one_open_key
on public.member_data_requests (member_id, request_type)
where status = 'open';

create index if not exists member_data_requests_club_status_idx
on public.member_data_requests (club_id, status, created_at desc);

alter table public.member_data_requests enable row level security;
grant select, insert, update on public.member_data_requests to authenticated;
grant all on public.member_data_requests to service_role;

drop policy if exists "data_requests_select_own_or_admin" on public.member_data_requests;
create policy "data_requests_select_own_or_admin"
on public.member_data_requests
for select
to authenticated
using (
  exists (select 1 from public.members m where m.id = member_data_requests.member_id and m.user_id = (select auth.uid()))
  or public._is_member_admin(club_id)
);

drop policy if exists "data_requests_insert_own" on public.member_data_requests;
create policy "data_requests_insert_own"
on public.member_data_requests
for insert
to authenticated
with check (
  status = 'open'
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.members m
    where m.id = member_data_requests.member_id
      and m.club_id = member_data_requests.club_id
      and m.user_id = (select auth.uid())
  )
);

drop policy if exists "data_requests_update_by_admin" on public.member_data_requests;
create policy "data_requests_update_by_admin"
on public.member_data_requests
for update
to authenticated
using (public._is_member_admin(club_id))
with check (public._is_member_admin(club_id));
