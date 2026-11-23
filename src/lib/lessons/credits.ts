// Lesson credits (lessons v2): balances, which enrollment pays for a booking, expiry warnings.
// Mirrors the SQL rules in 20261123093000_lessons_v2.sql (_lesson_pick_enrollment).
// Relative imports: vitest has no "@/" alias configured.
import { formatThaiDate } from "../display";
import { bangkokDate, BANGKOK_OFFSET } from "./booking";
import type { LessonEnrollmentBalance } from "./types";

export type CreditEnrollment = Pick<
  LessonEnrollmentBalance,
  "credits_remaining" | "enrollment_id" | "expires_at" | "package_name" | "program_id" | "status"
> & { created_at?: string | null };

/** Balance of a ledger (sum of deltas). */
export function ledgerBalance(txns: ReadonlyArray<{ delta: number }>) {
  return txns.reduce((sum, txn) => sum + txn.delta, 0);
}

function time(value: string | Date | number) {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
}

/** Active, not expired, credits left. */
export function isUsableEnrollment(enrollment: CreditEnrollment, now: number = Date.now()) {
  return (
    enrollment.status === "active" &&
    Boolean(enrollment.expires_at) &&
    time(enrollment.expires_at as string) > now &&
    enrollment.credits_remaining > 0
  );
}

/** Enrollment covers a course: any-course packages (program_id null) cover everything. */
export function coversProgram(enrollment: Pick<CreditEnrollment, "program_id">, programId: string | null | undefined) {
  return enrollment.program_id === null || enrollment.program_id === programId;
}

/**
 * The enrollment a booking will take its credit from: usable, covers the course, still valid at
 * the lesson start; the one that expires soonest (course-specific before any-course on a tie).
 */
export function pickEnrollment<T extends CreditEnrollment>(
  enrollments: readonly T[],
  lesson: { lessonStart?: Date | string | null; programId: string | null | undefined },
  now: number = Date.now(),
): T | null {
  const mustLast = Math.max(now, lesson.lessonStart ? time(lesson.lessonStart) : now);
  const candidates = enrollments.filter(
    (item) =>
      item.status === "active" &&
      item.credits_remaining > 0 &&
      Boolean(item.expires_at) &&
      time(item.expires_at as string) > mustLast &&
      coversProgram(item, lesson.programId),
  );
  candidates.sort(
    (a, b) =>
      time(a.expires_at as string) - time(b.expires_at as string) ||
      Number(a.program_id === null) - Number(b.program_id === null) ||
      (a.created_at && b.created_at ? time(a.created_at) - time(b.created_at) : 0) ||
      a.enrollment_id.localeCompare(b.enrollment_id),
  );
  return candidates[0] ?? null;
}

/** What the member can still book with. `programId` limits it to credits valid for one course. */
export function creditSummary(enrollments: readonly CreditEnrollment[], options: { now?: number; programId?: string | null } = {}) {
  const now = options.now ?? Date.now();
  const usable = enrollments
    .filter((item) => isUsableEnrollment(item, now))
    .filter((item) => options.programId === undefined || coversProgram(item, options.programId))
    .sort((a, b) => time(a.expires_at as string) - time(b.expires_at as string));
  return {
    available: usable.reduce((sum, item) => sum + item.credits_remaining, 0),
    nextExpiry: usable[0]?.expires_at ?? null,
    pending: enrollments.filter((item) => item.status === "pending_payment").length,
    usable,
  };
}

/** Whole Bangkok calendar days from today until the expiry day (0 = expires today). */
export function daysUntilExpiry(expiresAt: string, now: number = Date.now()) {
  const today = Date.parse(`${bangkokDate(now)}T00:00:00${BANGKOK_OFFSET}`);
  const expiryDay = Date.parse(`${bangkokDate(new Date(expiresAt))}T00:00:00${BANGKOK_OFFSET}`);
  return Math.round((expiryDay - today) / 86_400_000);
}

/** "หมดอายุวันนี้", "เหลือ 3 วัน (หมด 26 พ.ย. 2569)", "ใช้ได้ถึง 22 ม.ค. 2570", "หมดอายุแล้ว". */
export function expiryLabel(expiresAt: string | null | undefined, now: number = Date.now(), warningDays = 7) {
  if (!expiresAt) return "ยังไม่เริ่มใช้";
  if (time(expiresAt) <= now) return "หมดอายุแล้ว";
  const days = daysUntilExpiry(expiresAt, now);
  if (days <= 0) return "หมดอายุวันนี้";
  if (days <= warningDays) return `เหลือ ${days} วัน (หมด ${formatThaiDate(expiresAt)})`;
  return `ใช้ได้ถึง ${formatThaiDate(expiresAt)}`;
}

/** Usable enrollments that expire within `warningDays` (the member screen's yellow notice). */
export function expiryWarnings<T extends CreditEnrollment>(enrollments: readonly T[], warningDays: number, now: number = Date.now()) {
  if (warningDays <= 0) return [];
  return enrollments
    .filter((item) => isUsableEnrollment(item, now))
    .map((item) => ({ daysLeft: daysUntilExpiry(item.expires_at as string, now), enrollment: item }))
    .filter((item) => item.daysLeft <= warningDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
