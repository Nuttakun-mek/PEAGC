// Coach portal (/coach): pure view logic for "ตารางสอนของฉัน", the roster and the monthly
// teaching-hours summary. Relative imports so vitest can load it without the "@/" alias.
import { addDays, lessonStartAt } from "./booking";
import { teachingHours } from "./calendar";
import { isSeatStatus } from "./labels";
import type { LessonRosterRow, LessonSlotRow } from "./types";

/** Coaches may mark attendance from 30 minutes before the start (staff any time), same as the RPC. */
export const ATTENDANCE_OPENS_MINUTES = 30;

export function attendanceOpensAt(date: string, startTime: string) {
  return new Date(lessonStartAt(date, startTime).getTime() - ATTENDANCE_OPENS_MINUTES * 60_000);
}

export function canMarkAttendance(slot: { date: string; startTime: string }, options: { isStaff: boolean; now?: number }) {
  if (options.isStaff) return true;
  return (options.now ?? Date.now()) >= attendanceOpensAt(slot.date, slot.startTime).getTime();
}

export type RosterGroups<T extends Pick<LessonRosterRow, "booking_status">> = {
  /** booked / offered / attended / no_show, in seat order */
  seats: T[];
  waitlist: T[];
  /** cancelled / late cancelled / closed */
  inactive: T[];
  counts: { attended: number; noShow: number; notMarked: number; offered: number; seats: number; waitlist: number };
};

/** Split the roster for the coach: learners with a seat, the waitlist, and the rest. */
export function groupRoster<T extends Pick<LessonRosterRow, "booking_status">>(rows: readonly T[]): RosterGroups<T> {
  const seats = rows.filter((row) => isSeatStatus(row.booking_status));
  const waitlist = rows.filter((row) => row.booking_status === "waitlist");
  const inactive = rows.filter((row) => !isSeatStatus(row.booking_status) && row.booking_status !== "waitlist");
  return {
    counts: {
      attended: seats.filter((row) => row.booking_status === "attended").length,
      noShow: seats.filter((row) => row.booking_status === "no_show").length,
      notMarked: seats.filter((row) => row.booking_status === "booked").length,
      offered: seats.filter((row) => row.booking_status === "offered").length,
      seats: seats.length,
      waitlist: waitlist.length,
    },
    inactive,
    seats,
    waitlist,
  };
}

/** Learner name with nickname: "สมชาย ใจงาม (ชาย)". */
export function learnerName(row: Pick<LessonRosterRow, "full_name" | "nickname">) {
  const nickname = row.nickname?.trim();
  return nickname ? `${row.full_name} (${nickname})` : row.full_name;
}

type ScheduleSlot = Pick<LessonSlotRow, "coach_id" | "end_time" | "lesson_date" | "start_time" | "status">;

/** Slots of one coach on `today` and the following `days - 1` days, grouped by date (cancelled kept, shown greyed). */
export function coachSchedule<T extends ScheduleSlot>(slots: readonly T[], today: string, days = 7) {
  const last = addDays(today, days - 1);
  const inRange = slots
    .filter((slot) => slot.lesson_date >= today && slot.lesson_date <= last)
    .sort((a, b) => a.lesson_date.localeCompare(b.lesson_date) || a.start_time.localeCompare(b.start_time));
  const byDate = new Map<string, T[]>();
  for (const slot of inRange) {
    const list = byDate.get(slot.lesson_date) ?? [];
    list.push(slot);
    byDate.set(slot.lesson_date, list);
  }
  return {
    later: [...byDate.entries()].filter(([date]) => date !== today).map(([date, items]) => ({ date, slots: items })),
    today: byDate.get(today) ?? [],
  };
}

function monthOf(date: string) {
  return date.slice(0, 7);
}

/** "YYYY-MM" of the month before. */
export function previousMonth(month: string) {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 2;
  const y = index < 0 ? year - 1 : year;
  const m = (index + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * "สรุปชั่วโมงสอนรายเดือน": rounds and hours of one coach in a month. `taught` = rounds already
 * finished (end time passed), `planned` = the rest. Cancelled rounds are not counted.
 */
export function monthlyTeaching<T extends ScheduleSlot>(slots: readonly T[], coachId: string, month: string, now: number = Date.now()) {
  const active = slots.filter(
    (slot) => slot.coach_id === coachId && monthOf(slot.lesson_date) === month && !["cancelled", "archived", "draft"].includes(slot.status),
  );
  const finished = active.filter((slot) => lessonStartAt(slot.lesson_date, slot.end_time).getTime() <= now);
  return {
    hours: teachingHours(active, coachId),
    month,
    planned: active.length - finished.length,
    rounds: active.length,
    taught: finished.length,
    taughtHours: teachingHours(finished, coachId),
  };
}

/** 12.5 → "12.5", 12 → "12" (hours for KPI tiles). */
export function formatHours(hours: number) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(hours * 10 === Math.round(hours * 10) ? 1 : 2);
}
