// Club lesson rules (lesson_booking_settings) for lessons v2: parsing, validation and the Thai
// sentences shown to members and admins. Defaults are the UX/UI audit's proposals (page 19).
import { defaultLessonBookingSettings, type LessonBookingSettings } from "./booking";

export type LessonRules = LessonBookingSettings & {
  auto_no_show: boolean;
  change_cutoff_hours: number;
  credit_expiry_warning_days: number;
  employee_priority_days: number;
  max_bookings_per_week: number;
  no_show_block_days: number;
  no_show_limit: number;
  no_show_window_days: number;
  offer_instant_hours: number;
  offer_window_hours: number;
  reminder_hours: number;
};

export type LessonRuleNumberKey = {
  [K in keyof LessonRules]: LessonRules[K] extends number ? K : never;
}[keyof LessonRules];

/** Number rules: DB check range, unit and the form label (Thai). Keep in sync with the migration. */
export const lessonRuleLimits: Record<LessonRuleNumberKey, { label: string; max: number; min: number; unit: "รอบ" | "ชม." | "วัน" | "ครั้ง" | "" }> = {
  announcement_version: { label: "ฉบับประกาศ", max: 1_000_000, min: 0, unit: "" },
  cancel_cutoff_hours: { label: "ยกเลิกแล้วคืนเครดิต ก่อนเรียน", max: 720, min: 0, unit: "ชม." },
  change_cutoff_hours: { label: "เปลี่ยนรอบเองได้ ก่อนเรียน", max: 720, min: 0, unit: "ชม." },
  credit_expiry_warning_days: { label: "แจ้งเตือนก่อนเครดิตหมดอายุ", max: 365, min: 0, unit: "วัน" },
  employee_priority_days: { label: "พนักงาน กฟภ. จองได้ก่อน", max: 60, min: 0, unit: "วัน" },
  max_bookings_per_member: { label: "จองล่วงหน้าค้างได้พร้อมกัน", max: 100, min: 0, unit: "รอบ" },
  max_bookings_per_week: { label: "จองได้ต่อสัปดาห์", max: 50, min: 0, unit: "รอบ" },
  no_show_block_days: { label: "งดจองล่วงหน้า", max: 365, min: 0, unit: "วัน" },
  no_show_limit: { label: "ขาดเรียนโดยไม่แจ้ง", max: 100, min: 0, unit: "ครั้ง" },
  no_show_window_days: { label: "นับขาดเรียนย้อนหลัง", max: 365, min: 1, unit: "วัน" },
  offer_instant_hours: { label: "ได้ที่นั่งทันทีถ้าเหลือเวลาก่อนเรียนไม่ถึง", max: 168, min: 0, unit: "ชม." },
  offer_window_hours: { label: "เวลายืนยันเมื่อได้ที่จากคิวสำรอง", max: 168, min: 0, unit: "ชม." },
  reminder_hours: { label: "แจ้งเตือนก่อนเรียน", max: 168, min: 0, unit: "ชม." },
};

export const defaultLessonRules: LessonRules = {
  ...defaultLessonBookingSettings,
  auto_no_show: true,
  cancel_cutoff_hours: 24,
  change_cutoff_hours: 12,
  credit_expiry_warning_days: 7,
  employee_priority_days: 2,
  max_bookings_per_member: 2,
  max_bookings_per_week: 0,
  no_show_block_days: 7,
  no_show_limit: 2,
  no_show_window_days: 30,
  offer_instant_hours: 3,
  offer_window_hours: 2,
  reminder_hours: 24,
};

/** Column list for `.from("lesson_booking_settings").select(lessonRuleColumns)`. */
export const lessonRuleColumns = [
  "booking_open_at",
  "booking_close_at",
  "max_bookings_per_member",
  "max_bookings_per_week",
  "cancel_cutoff_hours",
  "change_cutoff_hours",
  "offer_window_hours",
  "offer_instant_hours",
  "no_show_limit",
  "no_show_window_days",
  "no_show_block_days",
  "credit_expiry_warning_days",
  "employee_priority_days",
  "reminder_hours",
  "auto_no_show",
  "announcement_title",
  "announcement_body",
  "announcement_version",
].join(", ");

function toInt(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/**
 * A settings row (possibly from a database that does not have the v2 columns yet) -> full rules.
 * Missing / invalid numbers fall back to the defaults; numbers are clamped to the DB ranges.
 */
export function parseLessonRules(row: Partial<Record<keyof LessonRules, unknown>> | null | undefined): LessonRules {
  const rules: LessonRules = { ...defaultLessonRules };
  if (!row) {
    return rules;
  }
  for (const key of Object.keys(lessonRuleLimits) as LessonRuleNumberKey[]) {
    const limits = lessonRuleLimits[key];
    rules[key] = Math.min(limits.max, Math.max(limits.min, toInt(row[key], defaultLessonRules[key])));
  }
  rules.auto_no_show = typeof row.auto_no_show === "boolean" ? row.auto_no_show : defaultLessonRules.auto_no_show;
  rules.booking_open_at = typeof row.booking_open_at === "string" ? row.booking_open_at : null;
  rules.booking_close_at = typeof row.booking_close_at === "string" ? row.booking_close_at : null;
  rules.announcement_title = typeof row.announcement_title === "string" ? row.announcement_title : "";
  rules.announcement_body = typeof row.announcement_body === "string" ? row.announcement_body : "";
  return rules;
}

/**
 * Reads the v2 rule fields from a settings form (input names = column names; checkbox
 * "auto_no_show" = "on"). Returns the values to upsert or the first problem in Thai.
 */
export function lessonRulesFromForm(formData: FormData):
  | { values: Omit<LessonRules, "announcement_body" | "announcement_title" | "announcement_version" | "booking_close_at" | "booking_open_at"> }
  | { error: string } {
  const values = {} as Record<string, number | boolean>;
  for (const key of Object.keys(lessonRuleLimits) as LessonRuleNumberKey[]) {
    if (key === "announcement_version") continue;
    const limits = lessonRuleLimits[key];
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) {
      values[key] = defaultLessonRules[key];
      continue;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < limits.min || parsed > limits.max) {
      return { error: `${limits.label} ต้องเป็นจำนวนเต็ม ${limits.min}–${limits.max}${limits.unit ? ` ${limits.unit}` : ""}` };
    }
    values[key] = parsed;
  }
  values.auto_no_show = formData.get("auto_no_show") === "on";
  return { values: values as never };
}

export type LessonRuleLine = { key: keyof LessonRules | "offer"; text: string };

function hours(value: number) {
  return `${value} ชม.`;
}

/**
 * The club's rules as short Thai sentences, e.g. "จองล่วงหน้าค้างได้พร้อมกัน 2 รอบ",
 * "ยกเลิกก่อนเรียน 24 ชม. คืนเครดิต". `usesCredits` = the club sells packages (credit wording).
 */
export function describeLessonRules(rules: LessonRules, options: { usesCredits?: boolean } = {}): LessonRuleLine[] {
  const usesCredits = options.usesCredits ?? true;
  const lines: LessonRuleLine[] = [];

  lines.push({
    key: "max_bookings_per_member",
    text: rules.max_bookings_per_member > 0
      ? `จองล่วงหน้าค้างได้พร้อมกัน ${rules.max_bookings_per_member} รอบ`
      : "จองล่วงหน้าได้ไม่จำกัดจำนวนรอบ",
  });
  if (rules.max_bookings_per_week > 0) {
    lines.push({ key: "max_bookings_per_week", text: `จองได้สัปดาห์ละไม่เกิน ${rules.max_bookings_per_week} รอบ` });
  }
  lines.push({
    key: "cancel_cutoff_hours",
    text: rules.cancel_cutoff_hours > 0
      ? usesCredits
        ? `ยกเลิกก่อนเรียน ${hours(rules.cancel_cutoff_hours)} คืนเครดิต`
        : `ยกเลิกได้ก่อนเรียน ${hours(rules.cancel_cutoff_hours)}`
      : usesCredits
        ? "ยกเลิกก่อนเริ่มเรียน คืนเครดิต"
        : "ยกเลิกได้จนถึงเวลาเริ่มเรียน",
  });
  lines.push({
    key: "change_cutoff_hours",
    text: rules.change_cutoff_hours > 0
      ? `เปลี่ยนรอบเองได้ก่อนเรียน ${hours(rules.change_cutoff_hours)}`
      : "เปลี่ยนรอบเองได้จนถึงเวลาเริ่มเรียน",
  });
  lines.push({
    key: "offer",
    text: rules.offer_window_hours > 0
      ? `ได้ที่จากคิวสำรอง ต้องยืนยันภายใน ${hours(rules.offer_window_hours)}${
          rules.offer_instant_hours > 0 ? ` (ถ้าเหลือเวลาก่อนเรียนไม่ถึง ${hours(rules.offer_instant_hours)} ได้ที่นั่งทันที)` : ""
        }`
      : "ได้ที่จากคิวสำรองแล้วได้ที่นั่งทันที",
  });
  if (rules.no_show_limit > 0 && rules.no_show_block_days > 0) {
    lines.push({
      key: "no_show_limit",
      text: `ขาดเรียนโดยไม่แจ้ง ${rules.no_show_limit} ครั้งใน ${rules.no_show_window_days} วัน งดจองล่วงหน้า ${rules.no_show_block_days} วัน`,
    });
  }
  if (rules.auto_no_show) {
    lines.push({ key: "auto_no_show", text: "ไม่เช็กชื่อภายใน 30 นาทีหลังเลิกเรียน นับเป็นขาดเรียน" });
  }
  if (usesCredits && rules.credit_expiry_warning_days > 0) {
    lines.push({ key: "credit_expiry_warning_days", text: `แจ้งเตือนก่อนเครดิตหมดอายุ ${rules.credit_expiry_warning_days} วัน` });
  }
  if (rules.employee_priority_days > 0) {
    lines.push({ key: "employee_priority_days", text: `พนักงาน กฟภ. จองได้ก่อนบุคคลภายนอก ${rules.employee_priority_days} วัน` });
  }
  if (rules.reminder_hours > 0) {
    lines.push({ key: "reminder_hours", text: `แจ้งเตือนก่อนเรียน ${hours(rules.reminder_hours)}` });
  }
  return lines;
}

/** When this member may start booking (employees get employee_priority_days earlier). */
export function bookingOpensAt(rules: Pick<LessonRules, "booking_open_at" | "employee_priority_days">, isEmployee: boolean) {
  if (!rules.booking_open_at) {
    return null;
  }
  const open = new Date(rules.booking_open_at);
  return isEmployee && rules.employee_priority_days > 0
    ? new Date(open.getTime() - rules.employee_priority_days * 86_400_000)
    : open;
}

/**
 * Mirror of the SQL rule: `no_show_limit` no-shows whose lesson started within the last
 * `no_show_window_days` days block booking until the latest one + `no_show_block_days`.
 * `noShowStarts` are lesson start instants of the member's no-show bookings.
 */
export function noShowBlockedUntil(
  noShowStarts: Array<Date | string>,
  rules: Pick<LessonRules, "no_show_block_days" | "no_show_limit" | "no_show_window_days">,
  now: number = Date.now(),
) {
  if (rules.no_show_limit <= 0) {
    return null;
  }
  const windowStart = now - rules.no_show_window_days * 86_400_000;
  const recent = noShowStarts.map((value) => new Date(value).getTime()).filter((time) => time > windowStart);
  if (recent.length < rules.no_show_limit) {
    return null;
  }
  const until = Math.max(...recent) + rules.no_show_block_days * 86_400_000;
  return until > now ? new Date(until) : null;
}
