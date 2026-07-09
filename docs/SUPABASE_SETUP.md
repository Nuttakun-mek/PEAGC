# Supabase Setup

## Project

- Supabase project URL: `https://dlaeluakeqcbizvmosdg.supabase.co`
- Local env file: `.env.local`
- Template env file: `.env.example`
- Migration directory: `supabase/migrations`

## Environment Variables

Create `.env.local` from `.env.example` and fill the real values:

```bash
cp .env.example .env.local
```

Required public values:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
```

Required server-only values:

```bash
SUPABASE_SECRET_KEY=
SUPABASE_JWKS_URL=
DATABASE_URL=
```

Never commit `.env.local` or any real secret value.

## Migrations

Create a migration with the Supabase CLI:

```bash
npx supabase migration new migration_name
```

Dry-run before pushing:

```bash
npx supabase db push --db-url "$DATABASE_URL" --dry-run
```

Push to remote:

```bash
npx supabase db push --db-url "$DATABASE_URL" --yes
```

## Current Remote Status

The foundation migration has been pushed to the remote database.

Created foundation tables:

- `clubs`
- `profiles`
- `role_catalog`
- `user_roles`
- `member_types`
- `members`
- `events`
- `event_registrations`
- `payment_records`
- `files`
- `audit_logs`

Seeded roles:

- `platform_owner`
- `club_admin`
- `committee`
- `finance_officer`
- `tournament_director`
- `scoring_officer`
- `member`
- `auditor`

## Security Notes

- Public keys can be used in browser code only when prefixed with `NEXT_PUBLIC_`.
- `SUPABASE_SECRET_KEY` must only be used from server-only code.
- RLS is enabled on foundation tables.
- Explicit `GRANT` statements are included in migrations because new Supabase projects no longer expose new public tables to the Data API automatically.
- Rotate any secret key or database password that was pasted into chat, email, screenshots, issue trackers, or other shared surfaces before production.
