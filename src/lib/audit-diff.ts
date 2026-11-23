// Thai labels and before → after diffs for audit_logs rows (pure; used by /admin/audit and the
// member 360 history). Unknown actions/fields fall back to readable text instead of raw keys.

import { UNSET, formatThaiDate, formatThaiDateTime } from "./display";
import { roleLabels } from "./labels";

export const auditEntityLabels: Record<string, string> = {
  club_modules: "โมดูล",
  clubs: "ชมรม",
  competitions: "การแข่งขัน",
  directory_import_previews: "ไฟล์ฐานสมาชิกสมาคม",
  employee_directory: "ฐานสมาชิกสมาคม",
  event_pairing_groups: "ก๊วนออกรอบ",
  event_registrations: "การสมัครกิจกรรม",
  events: "กิจกรรม",
  lesson_booking_settings: "ช่วงเปิดจองเรียน",
  lesson_bookings: "การจองเรียน",
  lesson_credit_transactions: "เครดิตเรียน",
  lesson_enrollments: "แพ็กเกจเรียน",
  lesson_programs: "คอร์สเรียน",
  lesson_slots: "รอบเรียน",
  member_points: "แต้มสะสม",
  members: "สมาชิก",
  membership_terms: "อายุสมาชิก",
  payment_records: "การชำระเงิน",
  point_transactions: "แต้มสะสม",
  score_entries: "สกอร์",
  scorecard_ocr_jobs: "สกอร์การ์ด",
  user_roles: "สิทธิ์ผู้ใช้",
  verified_scores: "สกอร์ที่ตรวจแล้ว",
};

/** Exact labels for actions written by the app today. */
export const auditActionLabels: Record<string, string> = {
  "club.bootstrap_created": "สร้างชมรม (ตั้งค่าครั้งแรก)",
  "club_module.closed": "ปิดโมดูล",
  "club_module.opened": "เปิดโมดูล",
  "competition.created": "สร้างการแข่งขัน",
  "competition.prizes_awarded": "มอบรางวัลการแข่งขัน",
  "competition.rules_updated": "แก้กติกาการแข่งขัน",
  "employee_directory.created": "เพิ่มรายชื่อในฐานสมาชิกสมาคม",
  "employee_directory.imported": "นำเข้าฐานสมาชิกสมาคม",
  "employee_directory.updated": "แก้ไขรายชื่อในฐานสมาชิกสมาคม",
  "event.created": "เพิ่มกิจกรรม",
  "event.status_changed": "เปลี่ยนสถานะกิจกรรม",
  "event.updated": "แก้ไขกิจกรรม",
  "event_pairing.auto_assigned": "จัดก๊วนอัตโนมัติ",
  "event_pairing.cleared": "ล้างก๊วนทั้งหมด",
  "event_pairing.group_deleted": "ลบก๊วน",
  "event_pairing.group_updated": "แก้ไขก๊วน",
  "event_pairing.groups_generated": "สร้างก๊วน",
  "event_pairing.player_moved": "ย้ายผู้เล่นข้ามก๊วน",
  "event_registration.cancelled_by_member": "สมาชิกยกเลิกการสมัครกิจกรรม",
  "event_registration.created_by_member": "สมาชิกสมัครกิจกรรม",
  "event_registration.waitlist_promoted": "เลื่อนจากคิวสำรองเป็นผู้เล่น",
  "leaderboard.published": "ประกาศผลคะแนน",
  "lesson_booking.attendance_updated": "บันทึกการเข้าเรียน",
  "lesson_booking.cancelled_by_member": "สมาชิกยกเลิกการจองเรียน",
  "lesson_booking.created_by_member": "สมาชิกจองเรียน",
  "lesson_booking.removed_by_admin": "ผู้ดูแลนำผู้จองออก",
  "lesson_booking.rescheduled_by_member": "สมาชิกย้ายรอบเรียน",
  "lesson_booking_settings.opened_now": "เปิดจองเรียนทันที",
  "lesson_booking_settings.updated": "แก้ช่วงเปิดจองเรียน",
  "lesson_program.archived": "ลบคอร์สเรียน",
  "lesson_program.created": "เพิ่มคอร์สเรียน",
  "lesson_program.restored": "กู้คืนคอร์สเรียน",
  "lesson_program.updated": "แก้ไขคอร์สเรียน",
  "lesson_slot.archived": "ลบรอบเรียน",
  "lesson_slot.bulk_created": "สร้างรอบเรียนหลายรอบ",
  "lesson_slot.created": "เพิ่มรอบเรียน",
  "lesson_slot.updated": "แก้ไขรอบเรียน",
  "member.approved": "อนุมัติสมาชิก",
  "member.archived": "ลบสมาชิก",
  "member.created": "เพิ่มสมาชิก",
  "member.restored": "กู้คืนสมาชิก",
  "member.updated": "แก้ไขข้อมูลสมาชิก",
  "payment.proof_uploaded": "แนบสลิป",
  "payment.reviewed": "ตรวจสลิป",
  "score.entered": "บันทึกสกอร์",
  "score.entered_and_verified": "บันทึกและยืนยันสกอร์",
  "score.verified": "ยืนยันสกอร์",
  "scorecard.confirmed": "ยืนยันสกอร์การ์ด",
  "scorecard.discarded": "ทิ้งสกอร์การ์ด",
  "scorecard.uploaded": "อัปโหลดสกอร์การ์ด",
  "user_role.bootstrap_assigned": "ตั้งผู้ดูแลคนแรก",
};

/** Verb part of "entity.verb" for actions without an exact label. */
const verbLabels: Record<string, string> = {
  adjusted: "ปรับ",
  applied: "นำเข้า",
  approved: "อนุมัติ",
  archived: "ลบ",
  assigned: "มอบหมาย",
  cancelled: "ยกเลิก",
  checked_in: "เช็กอิน",
  closed: "ปิด",
  created: "เพิ่ม",
  deleted: "ลบ",
  expired: "หมดอายุ",
  granted: "ให้",
  imported: "นำเข้า",
  marked: "บันทึก",
  opened: "เปิด",
  previewed: "ตรวจไฟล์",
  published: "เผยแพร่",
  refunded: "คืนเงิน",
  rejected: "ไม่อนุมัติ",
  removed: "นำออก",
  renewed: "ต่ออายุ",
  restored: "กู้คืน",
  revoked: "ถอน",
  reviewed: "ตรวจ",
  updated: "แก้ไข",
  verified: "ยืนยัน",
};

/** Entity part of "entity.verb" (singular names used in action keys). */
const actionEntityLabels: Record<string, string> = {
  club: "ชมรม",
  club_module: "โมดูล",
  competition: "การแข่งขัน",
  directory_import: "ไฟล์ฐานสมาชิกสมาคม",
  employee_directory: "ฐานสมาชิกสมาคม",
  event: "กิจกรรม",
  event_pairing: "ก๊วนออกรอบ",
  event_registration: "การสมัครกิจกรรม",
  leaderboard: "ผลคะแนน",
  lesson_booking: "การจองเรียน",
  lesson_booking_settings: "ช่วงเปิดจองเรียน",
  lesson_credit: "เครดิตเรียน",
  lesson_enrollment: "แพ็กเกจเรียน",
  lesson_program: "คอร์สเรียน",
  lesson_slot: "รอบเรียน",
  member: "สมาชิก",
  membership: "อายุสมาชิก",
  membership_term: "อายุสมาชิก",
  payment: "การชำระเงิน",
  points: "แต้มสะสม",
  score: "สกอร์",
  scorecard: "สกอร์การ์ด",
  user_role: "สิทธิ์ผู้ใช้",
};

function humanize(key: string) {
  return key.replace(/[._]+/g, " ").trim();
}

export function auditEntityLabel(entityType: string | null | undefined) {
  if (!entityType) return UNSET;
  return auditEntityLabels[entityType] ?? humanize(entityType);
}

/** Thai name of the entity part of an action key, e.g. "member" → สมาชิก (filter groups). */
export function auditActionEntityLabel(prefix: string) {
  return actionEntityLabels[prefix] ?? auditEntityLabels[prefix] ?? humanize(prefix);
}

export function auditActionLabel(action: string | null | undefined) {
  if (!action) return UNSET;
  const exact = auditActionLabels[action];
  if (exact) return exact;
  const [entity, ...rest] = action.split(".");
  const verbKey = rest.join(".");
  const verb = verbLabels[verbKey] ?? verbLabels[verbKey.split("_")[0]] ?? null;
  const entityLabel = actionEntityLabels[entity] ?? auditEntityLabels[entity] ?? null;
  if (verb && entityLabel) return `${verb}${entityLabel}`;
  return humanize(action);
}

/** Field (column) names → Thai. */
export const auditFieldLabels: Record<string, string> = {
  affiliation: "สังกัด",
  amount: "ยอดเงิน",
  association_member_code: "รหัสสมาชิกสมาคม",
  association_membership_status: "สถานะสมาชิกสมาคม",
  attendance_note: "หมายเหตุการเข้าเรียน",
  booking_closes_at: "ปิดจอง",
  booking_opens_at: "เปิดจอง",
  bureau: "สำนัก",
  capacity: "จำนวนรับ",
  checked_in_at: "เวลาเช็กอิน",
  coach_id: "ผู้สอน",
  coach_name: "ผู้สอน",
  count: "จำนวน",
  credits: "เครดิต",
  deactivated_count: "พ้นสภาพ",
  department: "หน่วยงาน",
  description: "รายละเอียด",
  division: "ฝ่าย",
  email: "อีเมล",
  employee_code: "รหัสพนักงาน",
  employee_match_status: "ผลตรวจฐานสมาชิกสมาคม",
  employment_status: "สถานะพนักงาน",
  enabled: "เปิดใช้งาน",
  end_time: "เวลาเลิก",
  event_date: "วันที่",
  expires_at: "หมดอายุ",
  first_name: "ชื่อ",
  flagged_member_count: "สมาชิกต้องตรวจ",
  full_name: "ชื่อ-นามสกุล",
  guest_price: "ค่าสมัครบุคคลภายนอก",
  handicap: "แต้มต่อ",
  imported_count: "นำเข้า",
  includes: "สิ่งที่รวม",
  last_name: "นามสกุล",
  lesson_date: "วันที่เรียน",
  line_id: "LINE ID",
  member_code: "เลขสมาชิก",
  member_price: "ค่าสมัครสมาชิก",
  member_type: "ประเภทสมาชิก",
  membership_status: "สถานะสมาชิก",
  mode: "รูปแบบ",
  module_key: "โมดูล",
  name: "ชื่อ",
  nickname: "ชื่อเล่น",
  note: "หมายเหตุ",
  organization: "หน่วยงาน / บริษัท",
  phone: "เบอร์โทร",
  points: "แต้มสะสม",
  position: "ตำแหน่ง",
  price: "ราคา",
  purpose: "ชำระค่า",
  reason: "เหตุผล",
  restored_count: "คืนสถานะ",
  role_key: "บทบาท",
  section: "แผนก",
  skill_level: "ระดับฝีมือ",
  skipped_count: "ข้าม",
  source: "ที่มา",
  source_file_name: "ไฟล์",
  start_time: "เวลาเริ่ม",
  status: "สถานะ",
  tee_off_time: "เวลาออกรอบ",
  title: "หัวข้อ",
  title_prefix: "คำนำหน้า",
  venue: "สถานที่",
  verification_note: "หมายเหตุการตรวจ",
  work_line: "สายงาน",
};

export function auditFieldLabel(key: string) {
  return auditFieldLabels[key] ?? humanize(key);
}

/** Common stored enum values → Thai (status, purpose, mode …). */
const valueLabels: Record<string, string> = {
  active: "ใช้งาน",
  applied: "นำเข้าแล้ว",
  approved: "อนุมัติแล้ว",
  archived: "เก็บถาวร",
  attended: "มาเรียน",
  booked: "จองแล้ว",
  cancelled: "ยกเลิก",
  checked_in: "เช็กอินแล้ว",
  closed: "ปิด",
  completed: "เสร็จสิ้น",
  draft: "ฉบับร่าง",
  event: "กิจกรรม",
  guest: "บุคคลภายนอก",
  inactive: "ไม่ใช้งาน",
  lesson_package: "แพ็กเกจเรียน",
  matched: "ตรงฐานสมาชิกสมาคม",
  membership_fee: "ค่าบำรุง",
  merge: "เพิ่ม/อัปเดตบางส่วน",
  mismatch: "ไม่ตรงฐานสมาชิกสมาคม",
  no_show: "ไม่มา",
  not_checked: "ยังไม่ตรวจ",
  not_found: "ไม่พบในฐาน",
  open: "เปิด",
  other: "อื่นๆ",
  paid: "ชำระแล้ว",
  payment_review: "รอตรวจสลิป",
  pending: "รอดำเนินการ",
  pending_payment: "รอชำระ",
  pending_verification: "รอตรวจสอบ",
  published: "เผยแพร่แล้ว",
  refunded: "คืนเงินแล้ว",
  registered: "สมัครแล้ว",
  rejected: "ไม่อนุมัติ",
  replace: "แทนทั้งหมด",
  retired: "เกษียณ",
  review: "รอตรวจ",
  suspended: "พักสิทธิ์",
  waitlist: "คิวสำรอง",
};

/** Keys that change on every save and say nothing to a reader. */
const noiseKeys = new Set(["club_id", "created_at", "created_by", "id", "updated_at", "updated_by"]);

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function formatAuditValue(value: unknown, key?: string): string {
  if (value === null || value === undefined || value === "") return UNSET;
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (typeof value === "number") return value.toLocaleString("th-TH");
  if (typeof value === "string") {
    if (isoDate.test(value)) return formatThaiDate(value);
    if (isoDateTime.test(value)) return formatThaiDateTime(value);
    if (key === "role_key" && roleLabels[value]) return roleLabels[value];
    if (key && /(status|purpose|mode|level|type)$/.test(key) && valueLabels[value]) return valueLabels[value];
    return value.length > 160 ? `${value.slice(0, 157)}…` : value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return UNSET;
    const items = value.slice(0, 5).map((item) => formatAuditValue(item, key));
    return value.length > 5 ? `${items.join(", ")} และอีก ${value.length - 5} รายการ` : items.join(", ");
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 157)}…` : text;
  } catch {
    return UNSET;
  }
}

export type AuditChange = {
  after: string;
  before: string;
  key: string;
  kind: "added" | "changed" | "removed";
  label: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function same(a: unknown, b: unknown) {
  if (a === b) return true;
  if ((a === null || a === undefined || a === "") && (b === null || b === undefined || b === "")) return true;
  // numeric(12,2) comes back as "1000.00" in one row and 1000 in the form payload.
  if ((typeof a === "number" || typeof a === "string") && (typeof b === "number" || typeof b === "string")) {
    const na = Number(a);
    const nb = Number(b);
    if (a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== "" && String(b).trim() !== "") {
      return na === nb;
    }
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Field-level changes between before_data and after_data. Only keys whose value changed are
 * returned; for a create (no before) every non-empty after field is "added", for a delete every
 * non-empty before field is "removed". Bookkeeping keys (ids, timestamps) are skipped.
 */
export function diffAuditData(before: unknown, after: unknown): AuditChange[] {
  const b = asRecord(before);
  const a = asRecord(after);
  if (!a && !b) return [];
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].filter((key) => !noiseKeys.has(key));
  const changes: AuditChange[] = [];
  for (const key of keys) {
    const hasBefore = Boolean(b && key in b);
    const hasAfter = Boolean(a && key in a);
    const beforeValue = b?.[key];
    const afterValue = a?.[key];
    if (b && a && hasBefore && hasAfter && same(beforeValue, afterValue)) continue;
    // An update payload that does not mention a field did not change it.
    if (b && a && !hasAfter) continue;
    let kind: AuditChange["kind"] = "changed";
    if (!b || !hasBefore) kind = "added";
    else if (!a) kind = "removed";
    if (kind === "added" && (afterValue === null || afterValue === undefined || afterValue === "")) continue;
    if (kind === "removed" && (beforeValue === null || beforeValue === undefined || beforeValue === "")) continue;
    changes.push({
      after: kind === "removed" ? "" : formatAuditValue(afterValue, key),
      before: kind === "added" ? "" : formatAuditValue(beforeValue, key),
      key,
      kind,
      label: auditFieldLabel(key),
    });
  }
  return changes.sort((x, y) => x.label.localeCompare(y.label, "th"));
}

/** Short one-line summary for lists, e.g. "สถานะ: รอตรวจ → อนุมัติแล้ว และอีก 2 ช่อง". */
export function summarizeAuditChanges(changes: AuditChange[], max = 2) {
  if (!changes.length) return "";
  const parts = changes.slice(0, max).map((change) =>
    change.kind === "changed"
      ? `${change.label}: ${change.before} → ${change.after}`
      : change.kind === "added"
        ? `${change.label}: ${change.after}`
        : `${change.label}: ลบ ${change.before}`,
  );
  return changes.length > max ? `${parts.join(" · ")} และอีก ${changes.length - max} ช่อง` : parts.join(" · ");
}
