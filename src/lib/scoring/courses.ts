// Course and tee data: validation shared by the courses admin page and the rules form. The same
// rules are enforced in the database (golf_course_tees check constraints).

import { HOLES } from "./engine";

export const teeColors = ["black", "gold", "blue", "white", "yellow", "green", "red", "silver", "orange"] as const;
export type TeeColor = (typeof teeColors)[number];

export const teeColorLabels: Record<TeeColor, string> = {
  black: "ดำ",
  blue: "น้ำเงิน",
  gold: "ทอง",
  green: "เขียว",
  orange: "ส้ม",
  red: "แดง",
  silver: "เงิน",
  white: "ขาว",
  yellow: "เหลือง",
};

/** Swatch colours for the small dot next to a tee name (decoration only, never status). */
export const teeColorSwatch: Record<TeeColor, string> = {
  black: "#111827",
  blue: "#1D4ED8",
  gold: "#C69214",
  green: "#15803D",
  orange: "#EA580C",
  red: "#DC2626",
  silver: "#9CA3AF",
  white: "#FFFFFF",
  yellow: "#FACC15",
};

export function isTeeColor(value: unknown): value is TeeColor {
  return typeof value === "string" && (teeColors as readonly string[]).includes(value);
}

export type TeeInput = {
  courseRating: number | null;
  name: string;
  pars: number[];
  slopeRating: number | null;
  strokeIndex: number[];
};

/** Thai messages for whatever is wrong; empty when the tee can be saved. */
export function validateTee(tee: TeeInput): string[] {
  const errors: string[] = [];
  if (!tee.name.trim()) errors.push("ตั้งชื่อที เช่น ทีขาว");
  if (tee.pars.length !== HOLES || tee.pars.some((par) => !Number.isInteger(par) || par < 3 || par > 6)) {
    errors.push("พาร์ต้องครบ 18 หลุม หลุมละ 3-6");
  }
  const sorted = [...tee.strokeIndex].sort((a, b) => a - b);
  if (tee.strokeIndex.length !== HOLES || sorted.some((value, index) => value !== index + 1)) {
    errors.push("ลำดับความยาก (SI) ต้องเป็นเลข 1-18 ไม่ซ้ำกัน ครบ 18 หลุม");
  }
  if (tee.courseRating !== null && !(tee.courseRating >= 50 && tee.courseRating <= 90)) {
    errors.push("Course rating ต้องอยู่ระหว่าง 50-90");
  }
  if (tee.slopeRating !== null && !(Number.isInteger(tee.slopeRating) && tee.slopeRating >= 55 && tee.slopeRating <= 155)) {
    errors.push("Slope rating ต้องเป็นจำนวนเต็ม 55-155");
  }
  if ((tee.courseRating === null) !== (tee.slopeRating === null)) {
    errors.push("ใส่ Course rating และ Slope rating คู่กัน (หรือเว้นว่างทั้งคู่)");
  }
  return errors;
}

/** Holes whose SI is duplicated or out of range (for highlighting cells). */
export function invalidStrokeIndexHoles(strokeIndex: (number | null)[]) {
  const seen = new Map<number, number>();
  strokeIndex.forEach((value) => {
    if (typeof value === "number") seen.set(value, (seen.get(value) ?? 0) + 1);
  });
  return strokeIndex
    .map((value, index) => ({ index, value }))
    .filter(({ value }) => typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > HOLES || (seen.get(value) ?? 0) > 1)
    .map(({ index }) => index + 1);
}

export function sumPars(pars: number[], from = 0, to = HOLES) {
  return pars.slice(from, to).reduce((sum, value) => sum + value, 0);
}

export type TeeSummary = {
  color: string | null;
  course_rating: number | null;
  id: string;
  name: string;
  par: number[];
  slope_rating: number | null;
  stroke_index: number[];
};

/** "ทีขาว · พาร์ 72 · CR 71.2 / Slope 125" */
export function teeDescription(tee: Pick<TeeSummary, "course_rating" | "name" | "par" | "slope_rating">) {
  const parts = [tee.name, `พาร์ ${sumPars(tee.par)}`];
  if (tee.course_rating !== null && tee.slope_rating !== null) {
    parts.push(`CR ${Number(tee.course_rating).toFixed(1)} / Slope ${tee.slope_rating}`);
  }
  return parts.join(" · ");
}
