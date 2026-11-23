/**
 * แต้มสะสม rules: defaults from the UX/UI audit (page 20–21); clubs change them in /admin/points.
 * Keep the numbers in sync with public._point_rule_default() in the membership_points migration.
 * Never call these "แต้ม" alone or "แต้มต่อ": แต้มต่อ means handicap.
 */

export const pointRuleReasons = ["attend_lesson", "event_checkin", "scorecard_on_time", "referral", "staff_award", "no_show"] as const;

export type PointRuleReason = (typeof pointRuleReasons)[number];

export const defaultPointRules: Record<PointRuleReason, number> = {
  attend_lesson: 10,
  event_checkin: 30,
  no_show: -10,
  referral: 50,
  scorecard_on_time: 5,
  staff_award: 20,
};

/** What earns (or costs) points, as members read it. */
export const pointRuleLabels: Record<PointRuleReason, string> = {
  attend_lesson: "เข้าเรียน (เช็กชื่อแล้ว)",
  event_checkin: "ออกรอบกิจกรรมชมรม (เช็กอินแล้ว)",
  no_show: "จองแล้วขาดไม่แจ้ง",
  referral: "ชวนสมาชิกใหม่สำเร็จ",
  scorecard_on_time: "ส่งสกอร์การ์ดภายใน 24 ชม. หลังจบรอบ",
  staff_award: "ช่วยงานชมรม (ผู้ดูแลให้)",
};

export type PointRuleRow = { enabled: boolean; points: number; reason: string };

export type ResolvedPointRule = { enabled: boolean; isDefault: boolean; points: number; reason: PointRuleReason };

export function isPointRuleReason(value: string): value is PointRuleReason {
  return (pointRuleReasons as readonly string[]).includes(value);
}

/** Club rows over the defaults, in display order. */
export function resolvePointRules(rows: PointRuleRow[] | null | undefined): ResolvedPointRule[] {
  const byReason = new Map((rows ?? []).filter((row) => isPointRuleReason(row.reason)).map((row) => [row.reason, row]));
  return pointRuleReasons.map((reason) => {
    const row = byReason.get(reason);
    return row
      ? { enabled: row.enabled, isDefault: false, points: row.points, reason }
      : { enabled: true, isDefault: true, points: defaultPointRules[reason], reason };
  });
}

/**
 * Admin form value → stored points. The no-show rule is typed as a positive number of points to
 * deduct and stored negative; every other rule is stored as typed.
 */
export function parseRulePoints(reason: PointRuleReason, input: string): number | null {
  const text = input.trim();
  if (!/^-?\d{1,4}$/.test(text)) return null;
  const value = Math.abs(Number(text));
  if (value > 1000) return null;
  return reason === "no_show" ? -value : value;
}

/** Thai wording of every ledger reason (point_txns.reason). */
export const pointReasonLabels: Record<string, string> = {
  adjust: "ปรับแต้มสะสม",
  attend_lesson: "เข้าเรียน",
  event_checkin: "ออกรอบกิจกรรม",
  expiry: "แต้มสะสมหมดอายุ",
  no_show: "จองแล้วขาด",
  redemption: "แลกของรางวัล",
  referral: "ชวนสมาชิกใหม่",
  scorecard_on_time: "ส่งสกอร์การ์ดตรงเวลา",
  staff_award: "ช่วยงานชมรม",
};

/** "+10" / "−10" with a real minus sign, for ledger rows. */
export function formatPointDelta(delta: number) {
  const value = Math.abs(delta).toLocaleString("th-TH");
  return delta > 0 ? `+${value}` : `−${value}`;
}

/** "1,250 แต้มสะสม" */
export function formatPoints(value: number) {
  return `${value.toLocaleString("th-TH")} แต้มสะสม`;
}

/** Thai messages for the RPC errors raised by the points functions. */
export function pointsErrorToStatus(message: string | null | undefined, fallback: string) {
  const text = message ?? "";
  if (text.includes("POINTS_NOT_ENOUGH")) return "points-not-enough";
  if (text.includes("OUT_OF_STOCK")) return "points-out-of-stock";
  if (text.includes("REWARD_NOT_AVAILABLE")) return "points-reward-closed";
  if (text.includes("MEMBER_NOT_APPROVED")) return "points-not-approved";
  if (text.includes("REDEMPTION_CLOSED")) return "points-redemption-closed";
  if (text.includes("NOTE_REQUIRED")) return "points-needs-reason";
  if (text.includes("INVALID_POINTS")) return "points-invalid";
  if (text.includes("NOT_ADMIN") || text.includes("NOT_ALLOWED")) return "permission-denied";
  return fallback;
}
