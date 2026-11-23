/**
 * Member lifecycle (UX/UI audit, page 20):
 *   รอตรวจ → ใช้งาน → ใกล้หมดอายุ → หมดอายุ, plus ระงับ (admin or directory grace) and พ้นสภาพ/ลาออก.
 *
 * Stored in members.status: pending_verification, active, expired, suspended, resigned (and the older
 * inactive / guest / archived). "ใกล้หมดอายุ" is never stored: it is an active member whose
 * membership_expires_at falls within the club's renewal notice window. An active member whose end
 * date has passed counts as expired even before the daily job flips the stored status.
 */

export const memberLifecycles = [
  "pending",
  "active",
  "expiring",
  "expired",
  "suspended",
  "resigned",
  "inactive",
  "guest",
  "archived",
] as const;

export type MemberLifecycle = (typeof memberLifecycles)[number];

export const memberLifecycleLabels: Record<MemberLifecycle, string> = {
  active: "ใช้งาน",
  archived: "เก็บถาวร",
  expired: "หมดอายุ",
  expiring: "ใกล้หมดอายุ",
  guest: "บุคคลภายนอก",
  inactive: "ไม่ใช้งาน",
  pending: "รอตรวจ",
  resigned: "พ้นสภาพ/ลาออก",
  suspended: "ระงับ",
};

/** Stored members.status values an admin may pick in the edit form. */
export const storedMemberStatuses = [
  "pending_verification",
  "active",
  "expired",
  "suspended",
  "resigned",
  "inactive",
  "guest",
  "archived",
] as const;

export type LifecycleInput = {
  archived_at?: string | null;
  membership_expires_at?: string | null;
  status?: string | null;
};

const DAY_MS = 86_400_000;

/** Today's calendar date in Bangkok as YYYY-MM-DD. */
export function bangkokToday(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

function toUtcDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

function fromUtcDay(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

/** "2026-11-23" + 30 → "2026-12-23" (calendar days, no time zone drift). */
export function addDays(date: string, days: number) {
  return fromUtcDay(toUtcDay(date) + days * DAY_MS);
}

/** "2026-01-31" + 1 month → "2026-02-28" (clamped to the month's last day, like Postgres). */
export function addMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `today` to `date` (negative when `date` is in the past). */
export function daysUntil(date: string, today: string) {
  return Math.round((toUtcDay(date) - toUtcDay(today)) / DAY_MS);
}

export function deriveLifecycle(member: LifecycleInput, today: string, noticeDays = 30): MemberLifecycle {
  if (member.archived_at || member.status === "archived") return "archived";
  switch (member.status) {
    case "pending_verification":
      return "pending";
    case "expired":
      return "expired";
    case "suspended":
      return "suspended";
    case "resigned":
      return "resigned";
    case "inactive":
      return "inactive";
    case "guest":
      return "guest";
    case "active": {
      const expires = member.membership_expires_at;
      if (!expires) return "active";
      if (expires < today) return "expired";
      return daysUntil(expires, today) <= noticeDays ? "expiring" : "active";
    }
    default:
      return "pending";
  }
}

/** Members who may book lessons and register for events. */
export function canUseClub(lifecycle: MemberLifecycle) {
  return lifecycle === "active" || lifecycle === "expiring";
}

/**
 * Next membership year. Paying early starts the day after the current end; a lapsed or new
 * membership starts today. Mirrors request_membership_term() / the payment trigger in SQL.
 */
export function nextTermPeriod({
  currentExpiresAt,
  termMonths,
  today,
}: {
  currentExpiresAt: string | null | undefined;
  termMonths: number;
  today: string;
}) {
  const afterCurrent = currentExpiresAt ? addDays(currentExpiresAt, 1) : today;
  const start = afterCurrent > today ? afterCurrent : today;
  const end = addDays(addMonths(start, termMonths), -1);
  return { end, start };
}

/** Renewal opens within the notice window, after expiry, or when the member has never paid. */
export function isRenewalOpen(expiresAt: string | null | undefined, today: string, noticeDays: number) {
  if (!expiresAt) return true;
  return daysUntil(expiresAt, today) <= noticeDays;
}
