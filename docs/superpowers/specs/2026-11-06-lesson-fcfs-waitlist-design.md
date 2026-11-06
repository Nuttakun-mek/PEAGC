# Lesson booking: FCFS queue, waitlist, booking window, announcement gate

Source of requirements: `pea-golf-web.zip` (single-file prototype `index.html` + `schema.sql`,
"ระบบลงทะเบียนเรียนกอล์ฟ FCFS + คิวสำรอง"). This spec ports the pieces that PEAGC's
lesson module (`/member`, `/admin/lessons`) does not have yet, adapted to PEAGC's
multi-club schema, Supabase Auth, and Next.js server actions.

## Gap analysis

| Prototype feature | PEAGC today | Decision |
|---|---|---|
| Registration window `open_at` / `close_at` with countdown | none; slots bookable whenever `status = open` | **Port** as per-club `lesson_booking_settings` |
| Waitlist (คิวสำรอง) per session, FCFS position, auto-promotion on cancel | hard capacity only, full = reject | **Port**: `lesson_slots.waitlist_capacity`, `lesson_bookings.queue_seq` |
| `max_per_user` upcoming bookings | only "one slot per program per day" | **Port** (0 = unlimited) |
| `cancel_hours` cutoff for confirmed seats | cancel allowed until lesson start | **Port**; waitlisted can always cancel |
| Overlapping-time check on the same day | same program + same day only | **Port** |
| Versioned announcement that must be acknowledged before booking | news feed only (`club_announcements`) | **Port** into settings + `members.lesson_announcement_ack_version` |
| Bulk slot generator (date range × weekdays × time ranges) | one slot per form submit | **Port** |
| Roster per slot with ลำดับ / ตัวจริง / สำรอง + CSV | flat attendance list, no position | **Port** |
| Asia/Bangkok time handling | server actions build `new Date("YYYY-MM-DDTHH:MM")` in server TZ (UTC on Vercel) | **Fix** by moving deadline checks into SQL (`at time zone 'Asia/Bangkok'`) and a shared TS helper |
| Atomic booking under row lock | capacity trigger with `for update` | **Replace** with RPC `book_lesson_slot` (all rules in one transaction) |
| Custom username/password sign-up (pick 2 of emp_id/phone/email/LINE) | Supabase Auth (Google / magic link) + employee verification | **Not ported** – weaker than existing auth |
| Demo mode in localStorage | `?bypass=` demo contexts | Not ported |
| PEA CI palette (#74045F / #C7911B, Prompt) | #722257 / #c69214, Sarabun | Not ported (whole-app restyle is out of scope; noted for later) |

## Data model (one migration)

- `public.lesson_booking_settings` (1 row per club): `club_id` PK → clubs, `booking_open_at`,
  `booking_close_at` (timestamptz, nullable), `max_bookings_per_member int default 2`
  (0 = unlimited), `cancel_cutoff_hours int default 24`, `announcement_title text`,
  `announcement_body text`, `announcement_version int default 0`, audit columns.
  RLS: select for any authenticated user with a `members` or `user_roles` row in the club;
  write for admin roles.
- `lesson_slots.waitlist_capacity int not null default 0`.
- `lesson_bookings.queue_seq bigint generated always as identity` + unique index. FCFS order
  = `queue_seq` among non-cancelled bookings of the slot. Position ≤ capacity = ตัวจริง,
  otherwise สำรองลำดับ (position − capacity).
- `members.lesson_announcement_ack_version int not null default 0`.
- Capacity trigger now allows `capacity + waitlist_capacity`.
- RPCs (security definer, caller = `auth.uid()`):
  - `book_lesson_slot(p_slot_id)` → `{position, capacity, waitlisted}`. Locks member row and slot
    row, then checks in order: member active → settings window (`NOT_OPEN`, `CLOSED`) →
    announcement acknowledged (`ANNOUNCEMENT`) → slot open/not archived (`NO_SESSION`,
    `SESSION_CLOSED`) → unit targeting → not started (`STARTED`) → not already booked
    (`DUPLICATE`) → max per member (`LIMIT`) → time overlap same day (`OVERLAP`) →
    `capacity + waitlist` (`FULL`). Inserts and returns position.
  - `change_lesson_booking(p_booking_id, p_slot_id)` → same checks on the target slot, then moves
    the booking and assigns a fresh `queue_seq` (fair: a mover goes to the back of the new queue).
    Honors `allow_member_reschedule` and `reschedule_cutoff_hours` of the current slot.
  - `cancel_lesson_booking(p_booking_id)` → `CANCEL_LOCKED` if confirmed seat and inside cutoff,
    `STARTED` if lesson began; else sets `cancelled`.
  - `ack_lesson_announcement(p_version)`.
  - `my_lesson_bookings()` → `(booking_id, slot_id, position)` for the caller (positions need all
    rows of the slot, which member RLS hides; hence security definer).
  - Admin rosters are not an RPC: the admin page and the CSV route read `queue_seq` through the admin RLS policies and compute positions in TypeScript.
  - The member direct-insert policy on `lesson_bookings` is dropped so every member booking goes through the RPC.
- Error codes are raised as `raise exception 'CODE'` and mapped in TS to `?status=` keys.

## Member portal (`/member`)

- Load settings + `my_lesson_bookings()` alongside existing slot queries.
- Phase = `unset | before | open | after` computed from settings (client countdown component ticks
  every second; server renders initial text).
- Announcement gate: when `announcement_version > member.lesson_announcement_ack_version` and the
  announcement has content, the booking board is replaced by the announcement with a checkbox +
  "รับทราบ" button (server action). "อ่านประกาศ" link stays visible afterwards (collapsible).
- Slot board: button label depends on phase and fill level: `จองที่นั่ง` (primary) /
  `เข้าคิวสำรอง` (gold) / `เต็มแล้ว` / `ยังไม่เปิด` / `ปิดลงทะเบียน`. Seat dots show confirmed vs
  waitlist; own seat is highlighted. Current bookings show `ได้ที่นั่งแล้ว` or `สำรองลำดับ N` and the
  cancel deadline.
- Server actions call the RPCs and redirect with mapped status.

## Admin (`/admin/lessons`)

- New card "รอบลงทะเบียนและประกาศ": open/close datetime (Asia/Bangkok), max per member, cancel
  cutoff, announcement title/body, checkbox "นับเป็นประกาศฉบับใหม่" (bumps version → members must
  re-acknowledge).
- New card "สร้างหลายรอบเรียน": program, date from/to, weekdays, time ranges `16:30-17:30, …`,
  capacity, waitlist, coach, venue, note, targets. Preview count; skips duplicates
  (same program/date/start); max 300 per run.
- Slot form gains "คิวสำรอง". Capacity-reduction guard becomes `capacity + waitlist ≥ active`.
- Stats add "คิวสำรอง". Each slot's details show the roster with ลำดับ / ตัวจริง-สำรอง / name /
  employee code / phone / booked time, and the attendance form moves next to each row.
- `GET /admin/lessons/export` streams a UTF-8 (BOM) CSV of all non-archived slots' rosters.

## Shared code

- `src/lib/lessons/booking.ts`: phase calculation, error-code → status map, position helpers,
  Bangkok date helpers, slot-plan generator (pure, unit-tested with Vitest).
- `src/components/lesson-booking-countdown.tsx`: client ticker.

## Testing

- Vitest unit tests for the pure helpers (phase, slot plan, status mapping).
- Migration applied to a throwaway `postgres:16` Docker container (with small auth/storage stubs) and exercised with a behavioural SQL script covering every error code, promotion on cancel, reschedule re-queue, and the cutoff rules.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- Remote migration push is left to the owner (`npx supabase db push --db-url "$MIGRATION_DATABASE_URL"`).

## Out of scope

Email/LINE notifications on promotion from waitlist, admin manual reordering of the queue, and the
CI palette change.
