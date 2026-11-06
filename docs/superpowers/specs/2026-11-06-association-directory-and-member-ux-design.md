# Association member directory (monthly upload) + member UX refresh

## Requirement

Sign-up must be checked against the parent association's member list, which the admin uploads
every month as Excel. Columns: รหัสพนักงาน, ชื่อ, สกุล, สถานะ, ประเภท, รหัสสมาชิกสมาคมสโมสร.
Decisions taken with the owner on 2026-11-06:

- File format: Excel (.xlsx). CSV/TSV stays supported.
- Code not found / not an active member: the applicant can still submit, lands in
  `pending_verification`, admin approves manually (existing flow).
- Approved members missing from the newest monthly file: flag for admin review, do not
  deactivate automatically.

## What existed

`employee_directory` + CSV import at `/admin/employees`; `/profile` save matches employee code +
name and auto-approves on match. This design extends that instead of adding a second table.

## Data

- `employee_directory`: `member_type`, `association_member_code`, `membership_status`
  (`active|inactive|suspended|unknown`), `import_batch_id`.
- `members`: `association_member_code`, `association_member_type`, `association_membership_status`
  copied at sign-up so the member card can show them.
- `directory_imports`: one row per upload (file, mode, counts, who, when). The newest row drives the
  "อัปเดตล่าสุด" stat and the >31-day stale warning.
- RPC `finalize_directory_replace(club, batch)`: rows not in the batch → `membership_status =
  'inactive'`; active members whose directory row is no longer active (or who have none) →
  `employee_match_status = 'mismatch'` with `employee_match_detail.reason = 'left_directory'`.

## Import flow (`importEmployees`)

1. Read `.xlsx` with SheetJS (first sheet, header row first) or CSV/TSV with the existing parser.
2. `parseDirectoryGrid` maps Thai/English headers, normalises status words (ปกติ/พ้นสภาพ/ระงับ …),
   builds full name from parts, de-duplicates by employee code.
3. Upsert in chunks of 500 on `(club_id, employee_code)`, tagging `import_batch_id`.
4. If "ไฟล์นี้คือรายชื่อทั้งหมดของเดือนนี้" (default on) → call the finalizer.
5. Insert `directory_imports`, audit log, redirect with counts
   (`imported:<n>:<skipped>:<deactivated>:<flagged>`).

## Sign-up verification

- `getEmployeeMatchDetail` adds `activeMembership` to the checks; only `matched` auto-approves.
- Association fields are copied to `members` even when the match fails, so admins see what the
  directory says.
- Live lookup: `GET /api/directory/check?code=` (signed-in only) returns found/not-found, masked
  name (first name + initial of surname), member type, membership status, and the last import date.
  `EmployeeCodeChecker` debounces 450 ms and renders the result under the input.

## Admin surfaces

- `/admin/employees`: renamed "ฐานข้อมูลสมาชิกสมาคม"; stale banner; stats (shown, active members,
  last update); upload card accepts .xlsx with the replace-mode checkbox and last-import summary;
  membership status pill, type chip, association code in rows; filters by membership status.
- `/admin/members`: stat "หายจากฐานสมาคม" and a red review panel listing flagged members with deep
  links to their rows.

## Member UX (benchmarked against common membership apps: wallet-style member card, stepper
onboarding, inline verification, toned feedback)

- `MemberCard`: purple/gold digital card with club member number, association type/code, employee
  code, join date and verification state. Sits at the top of `/member`.
- `/profile` rewritten as a 3-section form (ติดต่อ → ยืนยันตัวตน → ข้อมูลกอล์ฟ) with a 4-step
  progress rail, required-field marks, input modes, live employee-code check, sticky submit bar, and
  first-time vs. edit wording.
- `StatusBanner` + `toneForStatus`: success/info/warning/error colours chosen from the status key,
  used on `/member` and `/profile` (other pages can adopt it incrementally).

## Testing

Vitest for `src/lib/directory/import.ts`; migration + finalizer exercised on a local Postgres 16
container; `tsc`, `eslint`, `next build`.
