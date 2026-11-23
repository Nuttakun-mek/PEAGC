// Thai labels for lesson v2 values. Colours come from src/lib/status.ts (kind "booking" /
// "enrollment"), so a <StatusBadge kind="booking" status={row.status}> picks the right tone.
// Relative imports: vitest has no "@/" alias configured.
import { statusTone, type StatusTone } from "../status";
import type { LessonBookingStatus, LessonCreditReason, LessonEnrollmentStatus, SkillLevel } from "./types";

/** Short label for badges and table cells. */
export const lessonBookingStatusLabels: Record<LessonBookingStatus, string> = {
  attended: "เข้าเรียนแล้ว",
  booked: "จองแล้ว",
  cancelled: "ยกเลิกแล้ว",
  closed: "ชมรมงดเรียน",
  late_cancelled: "ยกเลิกช้า",
  no_show: "ขาดเรียน",
  offered: "รอยืนยันที่ว่าง",
  waitlist: "คิวสำรอง",
};

/** Longer explanation (what happened to the credit), for detail views and tooltips. */
export const lessonBookingStatusDescriptions: Record<LessonBookingStatus, string> = {
  attended: "เช็กชื่อเข้าเรียนแล้ว",
  booked: "ได้ที่นั่งแล้ว (ถ้าคอร์สใช้แพ็กเกจ ตัดเครดิต 1 ครั้ง)",
  cancelled: "ยกเลิกทันเวลา คืนเครดิตแล้ว",
  closed: "ชมรมงดเรียน คืนเครดิตแล้ว",
  late_cancelled: "ยกเลิกหลังกำหนด ไม่คืนเครดิต",
  no_show: "ไม่ได้เช็กชื่อ ไม่คืนเครดิต",
  offered: "มีที่ว่างจากคิวสำรอง กดยืนยันก่อนหมดเวลา",
  waitlist: "รอที่ว่าง ยังไม่ตัดเครดิต",
};

export function lessonBookingStatusLabel(status: string | null | undefined) {
  return (status && lessonBookingStatusLabels[status as LessonBookingStatus]) || "ไม่ทราบสถานะ";
}

export function lessonBookingTone(status: string | null | undefined): StatusTone {
  return statusTone("booking", status);
}

/** Booking holds a seat (counts against capacity). */
export function isSeatStatus(status: string | null | undefined) {
  return status === "booked" || status === "offered" || status === "attended" || status === "no_show";
}

/** Booking is still waiting for its lesson (counts toward "จองล่วงหน้าค้างได้"). */
export function isUpcomingStatus(status: string | null | undefined) {
  return status === "booked" || status === "waitlist" || status === "offered";
}

/** Booking no longer takes part in the slot. */
export function isInactiveStatus(status: string | null | undefined) {
  return status === "cancelled" || status === "late_cancelled" || status === "closed";
}

export const lessonEnrollmentStatusLabels: Record<LessonEnrollmentStatus, string> = {
  active: "ใช้งานได้",
  cancelled: "ยกเลิก",
  expired: "หมดอายุ",
  pending_payment: "รอชำระเงิน",
};

export const lessonCreditReasonLabels: Record<LessonCreditReason, string> = {
  adjust: "ผู้ดูแลปรับเครดิต",
  booking: "จองรอบเรียน",
  closure: "ชมรมงดเรียน",
  expired: "เครดิตหมดอายุ",
  late_cancel: "ยกเลิกช้า",
  purchase: "ซื้อแพ็กเกจ",
  refund: "คืนเครดิต",
};

export const lessonCoachStatusLabels: Record<string, string> = {
  active: "สอนอยู่",
  inactive: "พักการสอน",
};

export const lessonVenueStatusLabels: Record<string, string> = {
  active: "ใช้งาน",
  inactive: "ปิดใช้งาน",
};

export const lessonPackageStatusLabels: Record<string, string> = {
  active: "เปิดขาย",
  inactive: "ปิดขาย",
};

export const skillLevelLabels: Record<SkillLevel, string> = {
  advanced: "ชำนาญ",
  beginner: "เริ่มต้น",
  intermediate: "ปานกลาง",
};

/** "8 ครั้ง", "ไม่มีเครดิต" */
export function formatCredits(count: number | null | undefined) {
  const value = Math.max(0, Math.trunc(count ?? 0));
  return value ? `${value.toLocaleString("th-TH")} ครั้ง` : "ไม่มีเครดิต";
}

/** "+8", "-1" for ledger rows. */
export function formatCreditDelta(delta: number) {
  return delta > 0 ? `+${delta}` : `${delta}`;
}
