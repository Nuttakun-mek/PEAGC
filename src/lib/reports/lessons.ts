// Lesson report figures (pure): fill rate, no-show rate and coach teaching hours.

import type { ProgramUsage } from "./aggregate";

export const NO_COACH_LABEL = "ยังไม่ระบุผู้สอน";

/** Overall seats/bookings across programs. Rates are null when there is nothing to divide by. */
export function lessonTotals(usage: ProgramUsage[]) {
  const totals = usage.reduce(
    (sum, row) => ({
      attended: sum.attended + row.attended,
      booked: sum.booked + row.booked,
      noShow: sum.noShow + row.noShow,
      seats: sum.seats + row.seats,
      slots: sum.slots + row.slots,
    }),
    { attended: 0, booked: 0, noShow: 0, seats: 0, slots: 0 },
  );
  return {
    ...totals,
    fillRate: totals.seats ? totals.booked / totals.seats : null,
    noShowRate: noShowRate(totals.attended, totals.noShow),
  };
}

/** Share of checked attendance that did not show up: no_show / (attended + no_show). */
export function noShowRate(attended: number, noShow: number) {
  const checked = attended + noShow;
  return checked ? noShow / checked : null;
}

export type CoachSlotRow = {
  coach_id?: string | null;
  coach_name?: string | null;
  end_time: string | null;
  lesson_date: string;
  /** Program's coach name, used when the slot itself has none. */
  program_coach_name?: string | null;
  start_time: string | null;
  status: string;
};

export type CoachHours = {
  key: string;
  name: string;
  /** Minutes of slots dated after today (still to teach). */
  plannedMinutes: number;
  slots: number;
  /** Minutes of slots dated today or earlier. */
  taughtMinutes: number;
  totalMinutes: number;
};

/** "09:30:00" → 570. */
export function clockMinutes(value: string | null | undefined) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Teaching time per coach: sum of (end − start) of slots that run (not cancelled, not draft).
 * Grouped by coach_id when the schema has it, otherwise by the coach name typed on the slot.
 */
export function coachTeachingHours(rows: CoachSlotRow[], today: string, names: Record<string, string> = {}) {
  const coaches = new Map<string, CoachHours>();
  for (const row of rows) {
    if (row.status === "cancelled" || row.status === "draft" || row.status === "archived") continue;
    const start = clockMinutes(row.start_time);
    const end = clockMinutes(row.end_time);
    if (start === null || end === null || end <= start) continue;
    const typedName = (row.coach_name ?? "").trim() || (row.program_coach_name ?? "").trim();
    const key = row.coach_id ? `id:${row.coach_id}` : typedName ? `name:${typedName.toLocaleLowerCase("th")}` : "none";
    const name = (row.coach_id ? names[row.coach_id] : null) || typedName || NO_COACH_LABEL;
    const entry = coaches.get(key) ?? { key, name, plannedMinutes: 0, slots: 0, taughtMinutes: 0, totalMinutes: 0 };
    const minutes = end - start;
    entry.slots += 1;
    entry.totalMinutes += minutes;
    if (row.lesson_date <= today) entry.taughtMinutes += minutes;
    else entry.plannedMinutes += minutes;
    coaches.set(key, entry);
  }
  return [...coaches.values()].sort(
    (a, b) => Number(a.key === "none") - Number(b.key === "none") || b.totalMinutes - a.totalMinutes || a.name.localeCompare(b.name, "th"),
  );
}

/** 750 → "12 ชม. 30 นาที", 60 → "1 ชม.", 0 → "0 ชม.". */
export function formatHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes - hours * 60);
  if (!rest) return `${hours.toLocaleString("th-TH")} ชม.`;
  if (!hours) return `${rest} นาที`;
  return `${hours.toLocaleString("th-TH")} ชม. ${rest} นาที`;
}
