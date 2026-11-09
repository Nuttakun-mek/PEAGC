# PEAGC

PEA Golf Club (PEAGC) is a Thai-first responsive web application for golf club operations: members, events, registration, payment review, pairing, competition scoring, and future academy workflows.

## Current Scope

This repository is starting with Foundation + MVP 1.

- Foundation: Next.js App Router, TypeScript, Tailwind CSS, responsive admin shell
- Auth: Supabase SSR clients, Google/magic-link login, temporary bypass, protected setup bootstrap
- MVP 1: Login/member onboarding, profile with avatar upload, employee verification with employee database import, targeted Event/Lesson publishing by unit, atomic self-registration with automatic waitlist and auto-promotion, lesson slot booking/reschedule, Payment Review, participant/unpaid/pairing CSV exports, Pairing / Tee Time (tee-time or shotgun, split tee, auto-assign by registration/handicap/balanced), Check-in and no-show, score history, approval notification queue, Basic Competition (MVP 2: Stroke Gross/Net, Stableford, System 36, flights, countback, verify → publish, prizes), Smart Score OCR (Claude vision, human review board, photo history), finance & usage reports, per-module on/off switches
- Later: Basic Competition, Rule Builder, Smart Score OCR, Academy, Finance, Sponsor, Analytics

## Launch Plan: modules open one at a time

The club launches with **golf course booking only**; other member-facing parts are opened by an admin when ready, from **`/admin/settings` (เปิด/ปิดระบบ)**.

| Module key | What members get | Launch default |
| --- | --- | --- |
| `lessons` | course catalog, slot booking, waitlist, reschedule, cancel, calendar link | **on** |
| `events` | event sign-up (with waitlist), payment proof upload, tee time / group | off |
| `scores` | score history, hole-by-hole scores, awards | off |
| `news` | club news on the member page | off |

Member accounts, association-directory verification, and profiles are always on. A closed module is hidden from members, its member server actions refuse, and a DB trigger (`enforce_club_module`) blocks new bookings/registrations even through direct API calls. Club staff are exempt so they can prepare courses, slots and events before opening. Only `platform_owner` / `club_admin` can flip a switch; every change is audit logged.

## Scoring and Smart Score OCR

Scores are never overwritten. Every card typed or scanned becomes a new row in `score_entries` (insert-only for app users); a scorer then marks one entry per player as verified (`verified_scores`). Only verified cards reach the leaderboard, and each publication is frozen in `leaderboard_snapshots` together with the rule version it used. Rule changes are kept in `competition_rule_versions`.

OCR flow: officer photographs a card → the photo is stored first (private `scorecards` bucket, linked from `files`) → Claude transcribes each cell *as written* plus notation and confidence → `src/lib/ocr/notation.ts` converts marks to strokes against the competition pars and flags anything uncertain → the review board shows photo and grid side by side for correction and player matching → confirm creates `score_entries` with `source = 'ocr'` (the audit log records how many cells the reviewer corrected). Set `ANTHROPIC_API_KEY` in Vercel to enable reading (model `claude-opus-5-5`, server-side refusal fallback on); without it, photos are still stored and the board opens for manual entry beside the photo.

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
- `src/app/admin/events/[eventId]` - event day operations: participant list with check-in / no-show / cancel, pairing board (generate groups, auto-assign, move players, edit tee time / start hole), waitlist view
- `src/app/admin/events/[eventId]/export` - CSV exports: `?type=participants` (everyone + payment state), `?type=unpaid` (follow-up list), `?type=pairing` (tee sheet for the starter)
- `src/lib/events/pairing.ts` - pure helpers for seat accounting, tee sheet planning, auto-assignment strategies (Vitest tests)
- `src/lib/auth/staff.ts` - shared staff-role guard for server actions and route handlers
- `src/lib/csv.ts` - Excel-friendly CSV (BOM, CRLF, formula-injection guard) shared by all exports
- `src/app/admin/events/[eventId]/scoring` - competition rules (versioned), hole-by-hole entry, verify, OCR upload, live leaderboard, publish snapshot, award prizes
- `src/app/admin/events/[eventId]/scoring/ocr/[jobId]` - OCR review board: scorecard photo beside an editable grid; flagged cells highlighted, raw marks shown, name→player matching
- `src/lib/scoring/engine.ts` - pure scoring engine (formats, playing handicap, stroke allocation, stableford, System 36, flights, countback, pickups) with Vitest tests
- `src/lib/ocr/notation.ts` - deterministic golf notation interpreter (digits incl. Thai, +1/-1/E/0 relative cards, `/` ✓ par, B/Bo/DB/Eagle, X/NR/PU pickups, circle/square cross-check) and Thai/Latin name matching, with tests; `src/lib/ocr/claude.ts` - Claude vision transcription (structured output, refusal fallback)
- `src/app/admin/reports` - finance by event (approved/pending/refunded, CSV for accounting), lesson seat utilization per course, event fill/check-in/no-show, member counts (`src/lib/reports`)
- `src/app/admin/settings` - per-module on/off switches for the member portal (`src/lib/modules.ts` catalog + defaults, `src/lib/modules-server.ts` loader/guard)
- `src/app/admin/payments` - finance/admin payment review queue for event registrations
- `src/app/admin/lessons` - lesson program, lesson slot, bulk slot generator, booking window/announcement settings, FCFS roster with waitlist, attendance, and CSV export (`/admin/lessons/export`)
- `src/lib/lessons/booking.ts` - pure helpers for the lesson booking flow (booking phase, queue position, Bangkok time, slot plan generator) with Vitest tests
- `src/app/admin/members` - admin member list, search, add, and edit workflow
- `src/app/member/actions.ts` - member self-registration server action for open events
- `src/app/profile` - member personal profile form
- `supabase/migrations/20260709143000_member_profile_targets_slot_changes.sql` - avatar storage, unit-targeted publishing, and lesson booking change history
- `supabase/migrations/20261106090000_lesson_fcfs_waitlist.sql` - lesson booking window, FCFS queue with waitlist, per-member limit, cancel cutoff, announcement acknowledgement, and booking RPCs
- `supabase/migrations/20261106120000_association_member_directory.sql` - association member fields, monthly import batches, replace-mode finalizer
- `supabase/migrations/20261108090000_competition_scoring_ocr.sql` - competitions + rule version history, append-only `score_entries`, `verified_scores`, append-only `leaderboard_snapshots`, `scorecard_ocr_jobs`, private `scorecards` bucket, member news read policy fix, hot-path indexes
- `supabase/migrations/20261107120000_club_modules_lesson_notifications.sql` - `club_modules` switches + `club_module_enabled()` + module guard triggers, lesson waitlist-promotion / capacity-increase / slot-cancellation notifications (slot cancel also cancels its bookings), in-app inbox (`read_at`, `mark_my_notifications_read()`)
- `supabase/migrations/20261107090000_event_pairing_checkin.sql` - `register_for_event` RPC (event row lock, no overselling, waitlist), waitlist auto-promotion with member notification, pairing groups with capacity trigger, check-in columns, `event_seat_counts` RPC, and the RLS fix that lets finance officers / tournament directors update registration status
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
- Remote project `dlaeluakeqcbizvmosdg` still needs every migration from `20260709143000` onward (11 files, through the lesson FCFS/waitlist, association directory, event pairing/check-in, module switch, and competition/OCR changes). The member event sign-up now calls the `register_for_event` RPC, so `20261107090000` must be applied before deploying this code. Apply them with `npx supabase db push --db-url "$MIGRATION_DATABASE_URL"` (session pooler URL), or paste the migration files in order into the Supabase SQL Editor and insert their versions into `supabase_migrations.schema_migrations`.
- Sarabun is bundled from `src/app/fonts/` via `next/font/local` (OFL licence included) so builds do not depend on reaching Google Fonts.
- Unit tests: `npm test` (Vitest).
