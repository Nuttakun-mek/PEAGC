# PEAGC

PEA Golf Club (PEAGC) is a Thai-first responsive web application for golf club operations: members, events, registration, payment review, pairing, competition scoring, and future academy workflows.

## Current Scope

This repository is starting with Foundation + MVP 1.

- Foundation: Next.js App Router, TypeScript, Tailwind CSS, responsive admin shell
- Auth: Supabase SSR clients, Google/magic-link login, temporary bypass, protected setup bootstrap
- MVP 1: Login/member onboarding, profile with avatar upload, employee verification with employee database import, targeted Event/Lesson publishing by unit, self-registration, lesson slot booking/reschedule, Payment Review, score history, approval notification queue, and Lesson/Academy booking foundation started; Pairing, Check-in, Excel Export next
- Later: Basic Competition, Rule Builder, Smart Score OCR, Academy, Finance, Sponsor, Analytics

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase PostgreSQL/Auth/Storage planned
- Deployed on Vercel (team PEA Golf Club, project `peagc`): https://peagc.vercel.app — env vars are set in the Vercel project; deploy with `vercel deploy --prod --scope pea-gc` or connect the GitHub repo for automatic deploys

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3555](http://localhost:3555).

## Project Files

- `src/app/page.tsx` - PEAGC dashboard shell
- `src/app/login` - Supabase magic-link login
- `src/app/member` - member portal preview
- `src/app/admin` - admin portal preview
- `src/app/admin/employees` - association member directory: monthly Excel (.xlsx) or CSV upload with replace mode, import history, stale-data warning, and the verification source for sign-ups
- `src/app/api/directory/check` - live employee-code lookup used by the sign-up form (masked result, signed-in users only)
- `src/lib/directory/import.ts` - header mapping, status normalisation, and row parsing for the directory upload (Vitest tests)
- `src/components/member-card.tsx`, `status-banner.tsx`, `employee-code-checker.tsx` - member UX building blocks (digital member card, toned feedback banners, live code check)
- `src/app/admin/events` - admin event list, search, create, and edit workflow
- `src/app/admin/payments` - finance/admin payment review queue for event registrations
- `src/app/admin/lessons` - lesson program, lesson slot, bulk slot generator, booking window/announcement settings, FCFS roster with waitlist, attendance, and CSV export (`/admin/lessons/export`)
- `src/lib/lessons/booking.ts` - pure helpers for the lesson booking flow (booking phase, queue position, Bangkok time, slot plan generator) with Vitest tests
- `src/app/admin/members` - admin member list, search, add, and edit workflow
- `src/app/member/actions.ts` - member self-registration server action for open events
- `src/app/profile` - member personal profile form
- `supabase/migrations/20260709143000_member_profile_targets_slot_changes.sql` - avatar storage, unit-targeted publishing, and lesson booking change history
- `supabase/migrations/20261106090000_lesson_fcfs_waitlist.sql` - lesson booking window, FCFS queue with waitlist, per-member limit, cancel cutoff, announcement acknowledgement, and booking RPCs
- `supabase/migrations/20261106120000_association_member_directory.sql` - association member fields, monthly import batches, replace-mode finalizer
- `docs/superpowers/specs/2026-11-06-lesson-fcfs-waitlist-design.md` - design notes for the lesson FCFS/waitlist port from the pea-golf-web prototype
- `src/app/setup` - one-time club admin bootstrap
- `docs/PROJECT_KICKOFF_PLAN.md` - project kickoff plan from the source PRD
- `docs/SUPABASE_SETUP.md` - Supabase environment and migration workflow
- `docs/DATABASE_FOUNDATION_DRAFT.sql` - Supabase foundation schema draft
- `supabase/migrations` - versioned Supabase database migrations
- `.env.example` - required environment variable template

## Notes

- Do not commit real secrets.
- OCR and advanced Rule Builder are intentionally out of the first MVP.
- Critical data such as payments, scores, rules, and published results must be audit logged.
- Supabase foundation migration has been pushed to the remote project.
- Lesson/Academy tables and RLS have been pushed to the remote project.
- Remote project `dlaeluakeqcbizvmosdg` still needs every migration from `20260709143000` onward (8 files, through the lesson FCFS/waitlist and association directory changes). Apply them with `npx supabase db push --db-url "$MIGRATION_DATABASE_URL"` (session pooler URL), or paste the migration files in order into the Supabase SQL Editor and insert their versions into `supabase_migrations.schema_migrations`.
- Sarabun is bundled from `src/app/fonts/` via `next/font/local` (OFL licence included) so builds do not depend on reaching Google Fonts.
- Unit tests: `npm test` (Vitest).
