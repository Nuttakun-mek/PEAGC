-- Payments & files (UX/UI audit phase 2–3, Nov 2026):
--
-- 1. files: width/height of images and `deleted_at` when the stored object was removed
--    (slip retention). `checksum` already holds the sha256 computed by the app.
-- 2. payment-proofs bucket: 10 MB limit (audit: PDF up to 10 MB; photos are shrunk on the phone).
-- 3. club_payment_settings: automatic slip check switch and slip retention days (PDPA, default 365).
-- 4. Receipts: an approved payment gets a receipt number per club per Buddhist year,
--    "RC2569-000123", assigned atomically by a trigger (counter row locked by the upsert), issued
--    once and never changed or re-used, even if the payment is later refunded.
-- 5. The same slip file (sha256) can back only one approved payment per club. The same bank
--    transaction reference is already unique (payment_records_slip_transaction_ref_key).
-- 6. payment_slip_files_due_for_purge(): slip files of settled payments older than the club's
--    retention days, for the daily cron (service role only). Pending/review slips are never listed.

-- 1. files ------------------------------------------------------------------------------------
alter table public.files
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'files_dimensions_check') then
    alter table public.files
      add constraint files_dimensions_check
      check ((width is null or width > 0) and (height is null or height > 0));
  end if;
end $$;

create index if not exists files_club_checksum_idx
on public.files (club_id, checksum)
where checksum is not null;

create index if not exists files_live_bucket_created_idx
on public.files (bucket, created_at)
where deleted_at is null;

create index if not exists payment_records_slip_file_idx
on public.payment_records (slip_file_id)
where slip_file_id is not null;

-- 2. storage ----------------------------------------------------------------------------------
update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'payment-proofs';

-- 3. club payment settings --------------------------------------------------------------------
alter table public.club_payment_settings
  add column if not exists auto_verify boolean not null default true,
  add column if not exists slip_retention_days integer not null default 365;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_payment_settings_retention_check') then
    alter table public.club_payment_settings
      add constraint club_payment_settings_retention_check
      check (slip_retention_days between 30 and 3650);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_payment_settings_text_check') then
    alter table public.club_payment_settings
      add constraint club_payment_settings_text_check
      check (
        coalesce(char_length(account_name), 0) <= 120
        and coalesce(char_length(bank_name), 0) <= 120
        and coalesce(char_length(bank_account_no), 0) <= 30
        and coalesce(char_length(note), 0) <= 500
      );
  end if;
end $$;

-- 4. receipts ---------------------------------------------------------------------------------
alter table public.payment_records
  add column if not exists receipt_no text,
  add column if not exists receipt_issued_at timestamptz;

create unique index if not exists payment_records_receipt_no_key
on public.payment_records (club_id, receipt_no)
where receipt_no is not null;

-- One counter row per club and Buddhist year. Written only by the trigger below.
create table if not exists public.payment_receipt_counters (
  club_id uuid not null references public.clubs(id) on delete cascade,
  be_year integer not null check (be_year between 2500 and 2700),
  last_no integer not null default 0 check (last_no >= 0),
  updated_at timestamptz not null default now(),
  primary key (club_id, be_year)
);

alter table public.payment_receipt_counters enable row level security;
revoke all on public.payment_receipt_counters from anon, authenticated;
grant select on public.payment_receipt_counters to authenticated;
grant all on public.payment_receipt_counters to service_role;

drop policy if exists "payment_receipt_counters_select_by_finance" on public.payment_receipt_counters;
create policy "payment_receipt_counters_select_by_finance"
on public.payment_receipt_counters
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.club_id = payment_receipt_counters.club_id
      and ur.user_id = (select auth.uid())
      and ur.role_key in ('platform_owner', 'club_admin', 'finance_officer', 'auditor')
  )
);

-- "RC2569-000123": club-wide running number per Buddhist year of the approval (Bangkok time).
create or replace function public.format_receipt_no(p_be_year integer, p_no integer)
returns text
language sql
immutable
set search_path = public
as $$
  select 'RC' || p_be_year::text || '-' || lpad(p_no::text, 6, '0');
$$;

revoke all on function public.format_receipt_no(integer, integer) from public, anon;
grant execute on function public.format_receipt_no(integer, integer) to authenticated, service_role;

-- BEFORE INSERT OR UPDATE on payment_records. Security definer so the counter (no write policy)
-- can be advanced for whoever approves: finance staff through RLS or the service role
-- (automatic slip check). Callers cannot set or change receipt fields themselves.
create or replace function public.assign_payment_receipt_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer;
  v_no integer;
begin
  if tg_op = 'UPDATE' then
    new.receipt_no := old.receipt_no;
    new.receipt_issued_at := old.receipt_issued_at;
  else
    new.receipt_no := null;
    new.receipt_issued_at := null;
  end if;

  if new.status = 'approved' and new.receipt_no is null then
    v_year := extract(year from (now() at time zone 'Asia/Bangkok'))::integer + 543;

    -- The upsert locks the counter row until this transaction ends, so concurrent approvals in
    -- the same club queue here and every number is used exactly once (a failed statement rolls
    -- its increment back with it).
    insert into public.payment_receipt_counters as c (club_id, be_year, last_no)
    values (new.club_id, v_year, 1)
    on conflict (club_id, be_year)
    do update set last_no = c.last_no + 1, updated_at = now()
    returning c.last_no into v_no;

    new.receipt_no := public.format_receipt_no(v_year, v_no);
    new.receipt_issued_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.assign_payment_receipt_no() from public, anon;
grant execute on function public.assign_payment_receipt_no() to authenticated, service_role;

drop trigger if exists payment_records_assign_receipt_no on public.payment_records;

-- Payments approved before receipts existed get numbers in approval order (once, before the
-- trigger starts guarding the column), and the counters continue after them.
with ranked as (
  select
    p.id,
    p.club_id,
    extract(year from (coalesce(p.reviewed_at, p.updated_at, p.created_at) at time zone 'Asia/Bangkok'))::integer + 543 as be_year,
    row_number() over (
      partition by p.club_id, extract(year from (coalesce(p.reviewed_at, p.updated_at, p.created_at) at time zone 'Asia/Bangkok'))
      order by coalesce(p.reviewed_at, p.updated_at, p.created_at), p.id
    )::integer as n
  from public.payment_records p
  where p.status = 'approved'
    and p.receipt_no is null
)
update public.payment_records p
set
  receipt_no = public.format_receipt_no(
    r.be_year,
    r.n + coalesce((select c.last_no from public.payment_receipt_counters c where c.club_id = r.club_id and c.be_year = r.be_year), 0)
  ),
  receipt_issued_at = coalesce(p.reviewed_at, p.updated_at, p.created_at)
from ranked r
where p.id = r.id;

insert into public.payment_receipt_counters as c (club_id, be_year, last_no)
select
  p.club_id,
  substring(p.receipt_no from 3 for 4)::integer,
  max(substring(p.receipt_no from 8)::integer)
from public.payment_records p
where p.receipt_no ~ '^RC[0-9]{4}-[0-9]{6,}$'
group by p.club_id, substring(p.receipt_no from 3 for 4)::integer
on conflict (club_id, be_year)
do update set last_no = greatest(c.last_no, excluded.last_no), updated_at = now();

create trigger payment_records_assign_receipt_no
before insert or update on public.payment_records
for each row execute function public.assign_payment_receipt_no();

-- 5. one approved payment per slip file -------------------------------------------------------
create unique index if not exists payment_records_slip_sha256_approved_key
on public.payment_records (club_id, slip_sha256)
where slip_sha256 is not null and status = 'approved';

-- 6. slip retention ---------------------------------------------------------------------------
-- Slip files whose payments were settled (approved / rejected / refunded) longer ago than the
-- club's retention days. Files still attached to a pending or in-review payment are never listed.
-- Orphans (replaced by a newer slip) count from their upload time.
create or replace function public.payment_slip_files_due_for_purge(p_limit integer default 500)
returns table (file_id uuid, club_id uuid, bucket text, object_path text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.club_id, f.bucket, f.object_path
  from public.files f
  left join public.club_payment_settings s on s.club_id = f.club_id
  where f.bucket = 'payment-proofs'
    and f.deleted_at is null
    and f.created_at < now() - make_interval(days => coalesce(s.slip_retention_days, 365))
    and not exists (
      select 1
      from public.payment_records p
      where p.slip_file_id = f.id
        and (
          p.status in ('pending', 'review')
          or coalesce(p.reviewed_at, p.updated_at) > now() - make_interval(days => coalesce(s.slip_retention_days, 365))
        )
    )
  order by f.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.payment_slip_files_due_for_purge(integer) from public, anon, authenticated;
grant execute on function public.payment_slip_files_due_for_purge(integer) to service_role;
