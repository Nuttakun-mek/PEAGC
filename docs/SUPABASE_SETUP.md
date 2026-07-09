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
MIGRATION_DATABASE_URL=
BOOTSTRAP_SETUP_TOKEN=
BOOTSTRAP_ALLOW_REPEAT=false
AUTH_BYPASS_ENABLED=false
```

Never commit `.env.local` or any real secret value.

## First Admin Bootstrap

Use `/setup` only for the first system administrator.

1. Set `BOOTSTRAP_SETUP_TOKEN` in `.env.local`.
2. Open `/setup`.
3. Enter the setup token, club name, admin email, display name, and initial password.
4. The action creates or reuses the Auth user, creates or reuses the club, assigns `club_admin`, creates default member types, and writes audit logs.

By default, setup is one-time only. After any `club_admin` exists, repeat setup is blocked unless `BOOTSTRAP_ALLOW_REPEAT=true` is explicitly set in server env.

## Google Login

The app includes a Google login button powered by Supabase OAuth.

Before it works outside local UI testing:

1. Enable Google in Supabase Dashboard > Authentication > Providers.
2. Create Google OAuth credentials in Google Auth Platform.
3. Add the app origin to Authorized JavaScript origins.
4. Add the Supabase callback URL from the Google provider page to Authorized redirect URIs.
5. Add local and deployed URLs to Supabase Auth URL configuration.

## Temporary Auth Bypass

Set `AUTH_BYPASS_ENABLED=true` only in development or preview environments when you need to inspect screens without logging in.

When enabled, `/login` shows shortcut buttons for:

- `/member?bypass=member`
- `/admin?bypass=admin`

Set `AUTH_BYPASS_ENABLED=false` before go live.

## Migrations

Create a migration with the Supabase CLI:

```bash
npx supabase migration new migration_name
```

Dry-run before pushing:

```bash
npx supabase db push --db-url "$MIGRATION_DATABASE_URL" --dry-run
```

Push to remote:

```bash
npx supabase db push --db-url "$MIGRATION_DATABASE_URL" --yes
```

Use the session pooler URL for `MIGRATION_DATABASE_URL` because schema changes can fail on the transaction pooler with prepared statement conflicts.

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

Additional migration:

- Unique active club short name index on `clubs.short_name`
- `members.user_id` for linking member profiles to Supabase Auth users
- Own-profile RLS policies for authenticated users

## Security Notes

- Public keys can be used in browser code only when prefixed with `NEXT_PUBLIC_`.
- `SUPABASE_SECRET_KEY` must only be used from server-only code.
- RLS is enabled on foundation tables.
- Explicit `GRANT` statements are included in migrations because new Supabase projects no longer expose new public tables to the Data API automatically.
- Rotate any secret key or database password that was pasted into chat, email, screenshots, issue trackers, or other shared surfaces before production.
