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
- Regions: the Supabase project runs in AWS `ap-northeast-1` (Tokyo), so `vercel.json` pins Vercel Functions to `hnd1` (Tokyo). Every page makes several sequential Supabase calls; with functions in the default `iad1` (US East) each call crossed the Pacific (~150 ms). Check the live region with `curl -sI https://peagc.vercel.app/login | grep x-vercel-id` (`sin1::hnd1::…` = edge Singapore, function Tokyo)

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
- `docs/STAGING_AND_BACKUP.md` - UAT/staging setup, test data scripts, daily database backup (Thai)
- `docs/DATABASE_FOUNDATION_DRAFT.sql` - Supabase foundation schema draft
- `supabase/migrations` - versioned Supabase database migrations
- `.env.example` - required environment variable template

## Design System

Follows the UX/UI audit of 23 Nov 2026. Reuse these instead of per-page hex colours, icons and date code:

- Brand marks: `public/brand/peagc-crest.png` (club crest, used for the sidebar, login, member card, favicon, app icons and share preview) and `public/brand/pea-logo.png` (PEA corporate mark, used only where the organisation is meant). Render them with `ClubCrest` / `PeaLogo` from `src/components/brand.tsx`. App icons live in `src/app/icon.png`, `apple-icon.png`, `favicon.ico`, `opengraph-image.png` and `public/icons/` (manifest in `src/app/manifest.ts`).
- Tokens: `src/app/globals.css` `@theme` — `brand-*`, `gold-500` (decoration / dark text only), `gold-700` (gold button with white text), `ink`, `ink-muted`, `ink-subtle`, `line`, `canvas`, status `success|warning|danger|info|neutral` (+ `-bg`), and the type scale (`text-xs` 13px is the smallest; inputs are 16px). Only Sarabun 400/500/600 are loaded.
- Status colours: `src/lib/status.ts` + `StatusBadge` (`src/components/ui/status-badge.tsx`). Plum is for buttons and the crest, never for status.
- Page chrome: `PageHeader`, button/field class strings in `src/components/ui/styles.ts`, collapsible create forms in `CreatePanel`.
- Formatting: `src/lib/display.ts` — `formatThaiDateShort` (lists), `formatThaiDateLong` (detail pages), `formatThaiDateTime`, `formatThaiTime`, `formatFee` (0 → "ฟรี"), `formatBaht`, `formatPhone` / `phoneHref`.
- Icons: one Lucide icon per meaning in `src/lib/icons.ts`. Admin menu groups and badges: `src/lib/nav.ts`.

## Phase 2–3 (audit 23 Nov 2026)

Built from the UX/UI audit's phases 2–3 (LINE login/notifications were dropped by the club for now).

- **Lessons v2** (`20261123093000_lessons_v2.sql`, `src/lib/lessons/**`): coaches (login = `coach` role), venues and bays, packages + append-only credit ledger, credit taken in the same transaction as the seat, refund before the cutoff / late cancel keeps the credit, waitlist offers that must be confirmed (2 h, instant within 3 h), QR check-in, automatic no-show, "งดเรียนทั้งวัน" with refunds, coach notes. Admin: `/admin/lessons` (ปฏิทิน · คอร์สและแพ็กเกจ · ผู้สอนและสถานที่ · กติกา · ประกาศ, slot drawer, creation wizard with conflict preview, printable QR). Coach portal: `/coach`. Members: `/member/lessons`, `/member/check-in?token=`.
- **Membership and แต้มสะสม** (`20261123094000_membership_points.sql`): auto-approve when the employee code and name match an active association row, lifecycle (ใช้งาน / ใกล้หมดอายุ / หมดอายุ / ระงับ / ลาออก), optional annual fee (`membership_terms`, PromptPay + slip), PDPA consent + data export/deletion request (`/privacy`, `/member/membership`), points ledger awarded by triggers, rewards and redemptions (`/admin/points`).
- **Payments and files** (`20261123091000_phase2_foundation.sql`, `20261123095000_payments_files.sql`): `payment_records.purpose` (event / lesson_package / membership_fee), PromptPay QR with the amount (`src/lib/promptpay.ts`), client-side image compression, magic-byte checks, duplicate-slip blocking (sha256 + bank reference), optional SlipOK auto-check (`SLIPOK_BRANCH_ID`, `SLIPOK_API_KEY`), receipts `/receipts/[paymentId]` (RC2569-000123), slip retention.
- **Platform** (`20261123092000_platform.sql`): role-based admin menus and page guards (`src/lib/auth/roles.ts`, `requireAdminArea`), Ctrl+K palette, member 360 `/admin/members/[memberId]`, edit log `/admin/audit` (`recordAudit` in `src/lib/audit.ts`), directory import preview, monthly revenue chart, UAT badge (`NEXT_PUBLIC_APP_ENV`), `docs/STAGING_AND_BACKUP.md`, daily DB backup workflow.
- **Events and scoring** (`20261123097000_golf_courses_handicap.sql`): courses and tees (par / SI / rating / slope), แต้มต่อชมรม (WHS-style) + Handicap Index ทางการ, auto flights, tee sheet, public event page with share image `/events/[eventId]`, live leaderboard, prizes, keypad score entry, player → marker confirmation, OCR sum checks.
- **Fixes**: `20261123090000_fix_directory_replace_flags.sql` (replace imports no longer flag members who were never linked to the directory), `20261123098000_scope_club_read_policies.sql` (coaches and `member`-role rows can no longer read every member, registration, notification or file).
- **Crons** (`vercel.json`, all need `CRON_SECRET`): `/api/cron/lessons` (offers, no-shows, credit expiry), `/api/cron/membership` (expiry, reminders, directory grace, points expiry), `/api/cron/payments` (slip retention).
- **Applying the migrations**: `npx supabase db push --db-url "$MIGRATION_DATABASE_URL"`, or paste `supabase/snippets/uat-apply-2026-11-23.sql` (all eight in one transaction, records the versions) into the SQL Editor. Until then the new screens show "ฐานข้อมูลยังไม่ได้อัปเดต" and the old flows keep working.

## Notes

- Do not commit real secrets.
- OCR and advanced Rule Builder are intentionally out of the first MVP.
- Critical data such as payments, scores, rules, and published results must be audit logged.
- Remote project `dlaeluakeqcbizvmosdg` (checked 2026-11-15): migrations through `20260711143000` are applied; `20261106090000` onward (lesson FCFS/waitlist, association directory, event pairing/check-in, module switch, competition/OCR, member-code fix) must be applied **before** deploying this code — the app reads their columns and RPCs, and without them lesson slots, the association directory and member sign-up fail. Apply them with `npx supabase db push --db-url "$MIGRATION_DATABASE_URL"` (session pooler URL), or paste the migration files in order into the Supabase SQL Editor and insert their versions into `supabase_migrations.schema_migrations`. Admin pages now show a red "ฐานข้อมูลยังไม่ได้อัปเดต" banner when a query hits a missing column/table instead of rendering an empty list.
- QA round 2 (2026-11-16): `supabase/migrations/20261116090000_unique_member_employee_code.sql` adds a unique index so one employee code belongs to one non-archived member (case and spaces ignored) and syncs `profiles.display_name` to the member's full name. The app already refuses duplicates without it; apply it with the other migrations.
- Before go-live run `node scripts/cleanup-test-data.mjs` (dry run lists TEST/UAT/E2E rows), then `--apply` to archive them; `--ban=email,...` also blocks sign-in for named test accounts. A JSON copy of every archived row is written first (git-ignored).
- Test-account passwords are no longer in the repository. `scripts/seed-e2e-members.mjs` and `scripts/verify-e2e.mjs` read `E2E_*_PASSWORD` from `.env.local`. Passwords that were committed earlier stay in git history, so change those accounts' passwords (`/account/password` while signed in).
- Password reset: `/forgot-password` sends a Supabase recovery link to `/auth/confirm?next=/account/password`. Add the production URL to Supabase Auth → URL Configuration → Redirect URLs, and configure custom SMTP (Auth → SMTP) — the built-in mailer only delivers to project team addresses and is heavily rate limited.
- `scripts/repair-corrupted-thai.mjs` repairs the seeded test accounts whose Thai text was stored as `???` (dry run by default, `--apply` to write). New input is guarded: forms and the directory import reject text that is already `???`/`�`, and CSV uploads saved by Thai Excel (Windows-874) are decoded correctly.
- Sarabun is bundled from `src/app/fonts/` via `next/font/local` (OFL licence included) so builds do not depend on reaching Google Fonts.
- Unit tests: `npm test` (Vitest).
