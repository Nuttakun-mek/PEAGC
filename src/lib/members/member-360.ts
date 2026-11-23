// Pure helpers for the admin "member 360" page (/admin/members/[memberId]): labels, date
// splits, ledger balances, membership expiry, merged audit history and the read-only
// "สิ่งที่สมาชิกเห็น" preview. No I/O here.

import type { StatusTone } from "../status";

export const memberStatusLabels: Record<string, string> = {
  active: "ใช้งาน",
  archived: "เก็บถาวร",
  expired: "หมดอายุ",
  guest: "บุคคลภายนอก",
  inactive: "ไม่ใช้งาน",
  pending_verification: "รอตรวจสอบ",
  resigned: "พ้นสภาพ",
  suspended: "ระงับ",
};

/** Member status tone; the lifecycle statuses from the membership migration are not in lib/status yet. */
export function memberStatusTone(status: string | null | undefined): StatusTone {
  if (status === "expired") return "danger";
  if (status === "suspended") return "warning";
  if (status === "resigned") return "neutral";
  if (status === "active") return "success";
  if (status === "pending_verification") return "warning";
  if (status === "guest") return "info";
  return "neutral";
}

/** point_txns.reason (membership/points migration) → Thai. */
export const pointReasonLabels: Record<string, string> = {
  adjust: "ผู้ดูแลปรับแต้มสะสม",
  attend_lesson: "มาเรียน",
  event_checkin: "เช็กอินกิจกรรม",
  expiry: "แต้มสะสมหมดอายุ",
  no_show: "ขาดเรียน",
  redemption: "แลกของรางวัล",
  referral: "แนะนำเพื่อน",
  scorecard_on_time: "ส่งสกอร์การ์ดตรงเวลา",
  staff_award: "ผู้ดูแลให้แต้มสะสม",
};

export const bookingStatusLabels: Record<string, string> = {
  attended: "มาเรียน",
  booked: "จองแล้ว",
  cancelled: "ยกเลิก",
  no_show: "ขาดเรียน",
  waitlist: "คิวสำรอง",
};

export const registrationStatusLabels: Record<string, string> = {
  cancelled: "ยกเลิก",
  checked_in: "เช็กอินแล้ว",
  draft: "ฉบับร่าง",
  no_show: "ไม่มาแสดงตัว",
  paid: "ชำระเงินแล้ว",
  payment_review: "รอตรวจสลิป",
  pending_payment: "รอชำระเงิน",
  registered: "สมัครแล้ว",
  waitlist: "คิวสำรอง",
};

export const paymentStatusLabels: Record<string, string> = {
  approved: "อนุมัติแล้ว",
  pending: "รอแนบสลิป",
  refunded: "คืนเงินแล้ว",
  rejected: "ไม่อนุมัติ",
  review: "รอตรวจ",
};

export const paymentPurposeLabels: Record<string, string> = {
  event: "กิจกรรม",
  lesson_package: "แพ็กเกจเรียน",
  membership_fee: "ค่าบำรุง",
  other: "อื่นๆ",
};

export const notificationTypeLabels: Record<string, string> = {
  coach_note: "บันทึกจากผู้สอน",
  event_reminder: "เตือนกิจกรรม",
  event_update: "อัปเดตกิจกรรม",
  lesson_closure: "งดเรียน",
  lesson_credit: "เครดิตเรียน",
  lesson_offer: "เสนอที่นั่งเรียน",
  lesson_reminder: "เตือนรอบเรียน",
  lesson_update: "อัปเดตรอบเรียน",
  member_approved: "อนุมัติสมาชิก",
  member_rejected: "ไม่อนุมัติสมาชิก",
  membership_expiring: "สมาชิกใกล้หมดอายุ",
  membership_renewed: "ต่ออายุสมาชิก",
  payment_update: "การชำระเงิน",
  points_update: "แต้มสะสม",
};

export const notificationChannelLabels: Record<string, string> = {
  email: "อีเมล",
  line: "LINE",
  system: "ในแอป",
};

export const notificationStatusLabels: Record<string, string> = {
  failed: "ส่งไม่สำเร็จ",
  queued: "รอส่ง",
  sent: "ส่งแล้ว",
  skipped: "ไม่ได้ส่ง",
};

export function notificationTone(status: string | null | undefined): StatusTone {
  if (status === "sent") return "success";
  if (status === "failed") return "danger";
  if (status === "queued") return "warning";
  return "neutral";
}

/** First non-empty value among candidate column names (tables from other tracks may differ). */
export function pickField<T = unknown>(row: Record<string, unknown> | null | undefined, candidates: readonly string[]): T | null {
  if (!row) return null;
  for (const key of candidates) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== "") return value as T;
  }
  return null;
}

/** Splits dated rows into upcoming (today onwards, soonest first) and past (latest first, capped). */
export function splitByDate<T>(rows: T[], dateOf: (row: T) => string | null | undefined, today: string, pastLimit = 20) {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const row of rows) {
    const date = dateOf(row);
    if (!date) continue;
    (date.slice(0, 10) >= today ? upcoming : past).push(row);
  }
  upcoming.sort((a, b) => String(dateOf(a)).localeCompare(String(dateOf(b))));
  past.sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a))));
  return { past: past.slice(0, pastLimit), upcoming };
}

/**
 * 1-based queue position of each active booking within its slot (by queue_seq, then booked_at),
 * so a booking past the slot capacity reads as "คิวสำรอง" (lesson_bookings has no waitlist status).
 */
export function queuePositions(rows: Array<{ booked_at?: string | null; id: string; queue_seq?: number | string | null; slot_id: string; status: string }>) {
  const bySlot = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.status === "cancelled") continue;
    bySlot.set(row.slot_id, [...(bySlot.get(row.slot_id) ?? []), row]);
  }
  const positions = new Map<string, number>();
  for (const list of bySlot.values()) {
    list
      .slice()
      .sort((a, b) => {
        const qa = Number(a.queue_seq ?? Number.MAX_SAFE_INTEGER);
        const qb = Number(b.queue_seq ?? Number.MAX_SAFE_INTEGER);
        return qa - qb || String(a.booked_at ?? "").localeCompare(String(b.booked_at ?? ""));
      })
      .forEach((row, index) => positions.set(row.id, index + 1));
  }
  return positions;
}

/** Display status of a booking: an active booking beyond the slot capacity is on the waitlist. */
export function bookingDisplayStatus(status: string, position: number | undefined, capacity: number | null | undefined) {
  if (status === "booked" && position && capacity && position > capacity) return "waitlist";
  return status;
}

const ledgerAmountFields = ["delta", "change", "credit_delta", "credits_delta", "points_delta", "credits", "points", "amount", "quantity"] as const;

/** Balance of an append-only ledger = sum of its signed amounts. */
export function ledgerBalance(rows: Array<Record<string, unknown>>, fields: readonly string[] = ledgerAmountFields) {
  let total = 0;
  for (const row of rows) {
    const value = Number(pickField(row, fields) ?? 0);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

export type MembershipState = "active" | "expiring" | "expired" | "none";

const termEndFields = ["ends_on", "end_date", "expires_on", "expires_at", "valid_until", "period_end", "end_at"] as const;
const termStartFields = ["starts_on", "start_date", "valid_from", "period_start", "start_at"] as const;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

/**
 * The membership term that counts today: the active/paid term ending last. Expiring = within
 * `warnDays` days. Terms that were cancelled, refunded or are still waiting for payment do not count.
 */
export function membershipSummary(terms: Array<Record<string, unknown>>, today: string, warnDays = 30) {
  const counted = terms
    .filter((term) => !["cancelled", "refunded", "rejected", "pending", "pending_payment", "void"].includes(String(term.status ?? "")))
    .map((term) => ({
      end: pickField<string>(term, termEndFields),
      start: pickField<string>(term, termStartFields),
      term,
    }))
    .filter((item) => item.end);
  counted.sort((a, b) => String(b.end).localeCompare(String(a.end)));
  const latest = counted[0];
  const pending = terms.find((term) => ["pending", "pending_payment"].includes(String(term.status ?? ""))) ?? null;
  if (!latest?.end) return { daysLeft: null, endsOn: null, pending, startsOn: null, state: "none" as MembershipState };
  const daysLeft = daysBetween(today, latest.end);
  const state: MembershipState = daysLeft < 0 ? "expired" : daysLeft <= warnDays ? "expiring" : "active";
  return { daysLeft, endsOn: latest.end.slice(0, 10), pending, startsOn: latest.start ? latest.start.slice(0, 10) : null, state };
}

export const membershipStateLabels: Record<MembershipState, string> = {
  active: "สมาชิกปัจจุบัน",
  expired: "หมดอายุแล้ว",
  expiring: "ใกล้หมดอายุ",
  none: "ยังไม่มีข้อมูลอายุสมาชิก",
};

export const membershipStateTones: Record<MembershipState, StatusTone> = {
  active: "success",
  expired: "danger",
  expiring: "warning",
  none: "neutral",
};

/** Merges several audit_logs result lists: one row per id, newest first, capped. */
export function mergeAuditRows<T extends { created_at: string; id: string }>(lists: Array<T[] | null | undefined>, limit = 30) {
  const byId = new Map<string, T>();
  for (const list of lists) for (const row of list ?? []) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

export type PreviewItem = {
  date?: string | null;
  detail: string;
  key: string;
  kind: "lesson" | "event" | "payment" | "notification" | "membership";
  title: string;
  tone: StatusTone;
};

/**
 * What the member sees on their own home screen next, in the member page's order: next
 * appointments, things they still have to do (slips), unread notices, membership expiry.
 */
export function buildMemberPreview(input: {
  events: Array<{ date: string; id: string; name: string; status: string }>;
  lessons: Array<{ date: string; id: string; status: string; time?: string | null; title: string }>;
  membership: { daysLeft: number | null; endsOn: string | null; state: MembershipState };
  pendingPayments: Array<{ amount: number; id: string; label: string }>;
  unread: number;
}): PreviewItem[] {
  const items: PreviewItem[] = [];
  for (const lesson of input.lessons.slice(0, 3)) {
    items.push({
      date: lesson.date,
      detail: lesson.status === "waitlist" ? "อยู่ในคิวสำรอง" : "จองแล้ว",
      key: `lesson-${lesson.id}`,
      kind: "lesson",
      title: lesson.title,
      tone: lesson.status === "waitlist" ? "warning" : "success",
    });
  }
  for (const event of input.events.slice(0, 3)) {
    items.push({
      date: event.date,
      detail: registrationStatusLabels[event.status] ?? event.status,
      key: `event-${event.id}`,
      kind: "event",
      title: event.name,
      tone: ["pending_payment", "payment_review", "waitlist"].includes(event.status) ? "warning" : "success",
    });
  }
  for (const payment of input.pendingPayments.slice(0, 3)) {
    items.push({
      detail: "ต้องแนบสลิป",
      key: `payment-${payment.id}`,
      kind: "payment",
      title: `${payment.label} ${payment.amount.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`,
      tone: "warning",
    });
  }
  if (input.unread > 0) {
    items.push({
      detail: "ยังไม่ได้เปิดอ่าน",
      key: "notifications",
      kind: "notification",
      title: `แจ้งเตือนใหม่ ${input.unread.toLocaleString("th-TH")} รายการ`,
      tone: "info",
    });
  }
  if (input.membership.state === "expiring" || input.membership.state === "expired") {
    items.push({
      date: input.membership.endsOn,
      detail: input.membership.state === "expired" ? "หมดอายุแล้ว ต่ออายุได้ที่หน้าโปรไฟล์" : `เหลือ ${input.membership.daysLeft ?? 0} วัน`,
      key: "membership",
      kind: "membership",
      title: "อายุสมาชิก",
      tone: input.membership.state === "expired" ? "danger" : "warning",
    });
  }
  return items;
}

export const employeeMatchLabels: Record<string, string> = {
  directory_inactive: "ไม่ใช้งานในฐานสมาคม",
  directory_missing: "ไม่อยู่ในฐานสมาคมแล้ว",
  matched: "ตรงกับฐานสมาชิกสมาคม",
  mismatch: "ข้อมูลไม่ตรงฐานสมาคม",
  not_checked: "ยังไม่ตรวจกับฐานสมาคม",
  not_found: "ไม่พบในฐานสมาคม",
};

/**
 * The stored match is a snapshot from sign-up; re-check it against the linked directory row as it
 * is now (same rule as the member list), so "matched" never shows for a row that left or is gone.
 */
export function effectiveMatchStatus(
  matchStatus: string | null | undefined,
  directory: { archived_at?: string | null; employment_status?: string | null; membership_status?: string | null } | null,
  linked: boolean,
) {
  if (matchStatus !== "matched") return matchStatus || "not_checked";
  if (!linked || !directory || directory.archived_at) return "directory_missing";
  if ((directory.employment_status ?? "active") !== "active" || (directory.membership_status ?? "active") !== "active") {
    return "directory_inactive";
  }
  return "matched";
}

export function matchTone(status: string): StatusTone {
  if (status === "matched") return "success";
  if (status === "not_found") return "danger";
  if (status === "not_checked") return "neutral";
  return "warning";
}
