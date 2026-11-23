// Lesson calendar (lessons v2): week and month grids on the Bangkok calendar, with how full each
// round / day is and the status tone for its colour. Pure; dates are "YYYY-MM-DD" strings.
// Relative imports: vitest has no "@/" alias configured.
import type { StatusTone } from "../status";
import { addDays, bangkokDate, weekdayOf } from "./booking";
import type { LessonSlotRow } from "./types";

export type FillLevel = "closed" | "empty" | "low" | "medium" | "high" | "full";

export type SlotFill = {
  capacity: number;
  free: number;
  /** "3/4 ที่ · คิวสำรอง 2" */
  label: string;
  level: FillLevel;
  /** 0–100, seats taken / capacity */
  percent: number;
  taken: number;
  tone: StatusTone;
  waitlist: number;
};

export const thaiWeekdaysShort = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."] as const;
export const thaiMonthsLong = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
] as const;
export const thaiMonthsShort = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
] as const;

const INACTIVE_SLOT = new Set(["cancelled", "archived", "draft"]);

/** Level -> tone: full / nearly full = warning ("ใกล้เต็ม"), open seats = info, closed = neutral. */
export function fillTone(level: FillLevel): StatusTone {
  if (level === "closed") return "neutral";
  if (level === "full" || level === "high") return "warning";
  return "info";
}

export function fillLevel(percent: number, closed = false): FillLevel {
  if (closed) return "closed";
  if (percent >= 100) return "full";
  if (percent >= 80) return "high";
  if (percent >= 50) return "medium";
  if (percent > 0) return "low";
  return "empty";
}

/** How full one round is. Uses seats_taken / waitlist_count (v2), else booked_count (v1). */
export function slotFill(slot: Pick<LessonSlotRow, "booked_count" | "capacity" | "seats_taken" | "status" | "waitlist_count">): SlotFill {
  const capacity = Math.max(0, slot.capacity ?? 0);
  const booked = Math.max(0, slot.booked_count ?? 0);
  const taken = Math.max(0, slot.seats_taken ?? Math.min(booked, capacity));
  const waitlist = Math.max(0, slot.waitlist_count ?? Math.max(0, booked - capacity));
  const percent = capacity > 0 ? Math.min(100, Math.round((taken * 100) / capacity)) : 0;
  const level = fillLevel(percent, INACTIVE_SLOT.has(slot.status));
  return {
    capacity,
    free: Math.max(0, capacity - taken),
    label: `${taken}/${capacity} ที่${waitlist ? ` · คิวสำรอง ${waitlist}` : ""}`,
    level,
    percent,
    taken,
    tone: fillTone(level),
    waitlist,
  };
}

export type DaySummary = {
  cancelled: number;
  capacity: number;
  level: FillLevel;
  percent: number;
  /** active rounds (not cancelled / draft) */
  slots: number;
  taken: number;
  tone: StatusTone;
  waitlist: number;
};

export type CalendarSlot<T extends LessonSlotRow> = T & { fill: SlotFill };

export type CalendarDay<T extends LessonSlotRow> = {
  date: string;
  dayOfMonth: number;
  /** false for the leading / trailing days of a month grid */
  inMonth: boolean;
  isPast: boolean;
  isToday: boolean;
  slots: CalendarSlot<T>[];
  summary: DaySummary;
  weekday: number;
  weekdayLabel: string;
};

function summarize(slots: ReadonlyArray<CalendarSlot<LessonSlotRow>>): DaySummary {
  const active = slots.filter((slot) => slot.fill.level !== "closed");
  const capacity = active.reduce((sum, slot) => sum + slot.fill.capacity, 0);
  const taken = active.reduce((sum, slot) => sum + slot.fill.taken, 0);
  const percent = capacity > 0 ? Math.min(100, Math.round((taken * 100) / capacity)) : 0;
  const level = active.length ? fillLevel(percent) : "closed";
  return {
    cancelled: slots.length - active.length,
    capacity,
    level,
    percent,
    slots: active.length,
    taken,
    tone: fillTone(level),
    waitlist: active.reduce((sum, slot) => sum + slot.fill.waitlist, 0),
  };
}

function groupByDate<T extends LessonSlotRow>(slots: readonly T[]) {
  const map = new Map<string, CalendarSlot<T>[]>();
  for (const slot of slots) {
    const list = map.get(slot.lesson_date) ?? [];
    list.push({ ...slot, fill: slotFill(slot) });
    map.set(slot.lesson_date, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time));
  }
  return map;
}

function makeDay<T extends LessonSlotRow>(date: string, byDate: Map<string, CalendarSlot<T>[]>, today: string, inMonth: boolean): CalendarDay<T> {
  const slots = byDate.get(date) ?? [];
  const weekday = weekdayOf(date);
  return {
    date,
    dayOfMonth: Number(date.slice(8, 10)),
    inMonth,
    isPast: date < today,
    isToday: date === today,
    slots,
    summary: summarize(slots),
    weekday,
    weekdayLabel: thaiWeekdaysShort[weekday],
  };
}

/** First day of the week containing `date` (weekStartsOn 1 = Monday, 0 = Sunday). */
export function startOfWeek(date: string, weekStartsOn: 0 | 1 = 1) {
  const back = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDays(date, -back);
}

function thaiYear(date: string) {
  return Number(date.slice(0, 4)) + 543;
}

/** "23–29 พ.ย. 2569", "30 พ.ย. – 6 ธ.ค. 2569", "29 ธ.ค. 2569 – 4 ม.ค. 2570" */
export function formatDateRange(from: string, to: string) {
  const [fy, fm, fd] = [from.slice(0, 4), Number(from.slice(5, 7)), Number(from.slice(8, 10))];
  const [ty, tm, td] = [to.slice(0, 4), Number(to.slice(5, 7)), Number(to.slice(8, 10))];
  if (fy !== ty) {
    return `${fd} ${thaiMonthsShort[fm - 1]} ${thaiYear(from)} – ${td} ${thaiMonthsShort[tm - 1]} ${thaiYear(to)}`;
  }
  if (fm !== tm) {
    return `${fd} ${thaiMonthsShort[fm - 1]} – ${td} ${thaiMonthsShort[tm - 1]} ${thaiYear(to)}`;
  }
  return `${fd}–${td} ${thaiMonthsShort[tm - 1]} ${thaiYear(to)}`;
}

/** Date range to query for a week view (inclusive). */
export function weekRange(anchor: string, weekStartsOn: 0 | 1 = 1) {
  const from = startOfWeek(anchor, weekStartsOn);
  return { from, to: addDays(from, 6) };
}

export function buildWeek<T extends LessonSlotRow>(
  slots: readonly T[],
  anchor: string,
  options: { today?: string; weekStartsOn?: 0 | 1 } = {},
) {
  const today = options.today ?? bangkokDate();
  const { from, to } = weekRange(anchor, options.weekStartsOn ?? 1);
  const byDate = groupByDate(slots);
  const days = Array.from({ length: 7 }, (_, index) => makeDay(addDays(from, index), byDate, today, true));
  return {
    days,
    end: to,
    label: formatDateRange(from, to),
    nextAnchor: addDays(from, 7),
    prevAnchor: addDays(from, -7),
    start: from,
    summary: summarize(days.flatMap((day) => day.slots)),
  };
}

function monthStart(anchor: string) {
  return `${anchor.slice(0, 7)}-01`;
}

function shiftMonth(month: string, delta: number) {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  const y = year + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Grid range to query for a month view (whole weeks around the month, inclusive). */
export function monthRange(anchor: string, weekStartsOn: 0 | 1 = 1) {
  const first = monthStart(anchor);
  const lastOfMonth = addDays(`${shiftMonth(anchor.slice(0, 7), 1)}-01`, -1);
  const from = startOfWeek(first, weekStartsOn);
  const to = addDays(startOfWeek(lastOfMonth, weekStartsOn), 6);
  return { from, lastOfMonth, to };
}

/** "พฤศจิกายน 2569" */
export function formatMonthLabel(anchor: string) {
  return `${thaiMonthsLong[Number(anchor.slice(5, 7)) - 1]} ${thaiYear(anchor)}`;
}

/** Month grid: whole weeks (Monday first by default), each day with its rounds and fill. */
export function buildMonth<T extends LessonSlotRow>(
  slots: readonly T[],
  anchor: string,
  options: { today?: string; weekStartsOn?: 0 | 1 } = {},
) {
  const weekStartsOn = options.weekStartsOn ?? 1;
  const today = options.today ?? bangkokDate();
  const month = anchor.slice(0, 7);
  const { from, to } = monthRange(anchor, weekStartsOn);
  const byDate = groupByDate(slots);
  const weeks: CalendarDay<T>[][] = [];
  for (let date = from; date <= to; date = addDays(date, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => {
      const day = addDays(date, index);
      return makeDay(day, byDate, today, day.startsWith(month));
    }));
  }
  const inMonth = weeks.flat().filter((day) => day.inMonth);
  return {
    label: formatMonthLabel(anchor),
    month,
    nextMonth: shiftMonth(month, 1),
    prevMonth: shiftMonth(month, -1),
    summary: summarize(inMonth.flatMap((day) => day.slots)),
    weekdayLabels: Array.from({ length: 7 }, (_, index) => thaiWeekdaysShort[(index + weekStartsOn) % 7]),
    weeks,
  };
}

function minutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Teaching hours of the active rounds (for "สรุปชั่วโมงสอนรายเดือน"), optionally one coach. */
export function teachingHours(slots: ReadonlyArray<Pick<LessonSlotRow, "coach_id" | "end_time" | "start_time" | "status">>, coachId?: string) {
  const total = slots
    .filter((slot) => !INACTIVE_SLOT.has(slot.status))
    .filter((slot) => coachId === undefined || slot.coach_id === coachId)
    .reduce((sum, slot) => sum + Math.max(0, minutes(slot.end_time) - minutes(slot.start_time)), 0);
  return Math.round((total / 60) * 100) / 100;
}
