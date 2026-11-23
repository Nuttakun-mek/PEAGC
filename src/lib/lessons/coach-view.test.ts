import { describe, expect, it } from "vitest";

import {
  attendanceOpensAt,
  canMarkAttendance,
  coachSchedule,
  formatHours,
  groupRoster,
  learnerName,
  monthlyTeaching,
  previousMonth,
} from "./coach-view";

// 23 Nov 2026 16:10 Bangkok
const NOW = Date.parse("2026-11-23T09:10:00.000Z");

describe("attendance window", () => {
  it("opens 30 minutes before the start for coaches", () => {
    expect(attendanceOpensAt("2026-11-23", "16:30:00").toISOString()).toBe("2026-11-23T09:00:00.000Z");
    expect(canMarkAttendance({ date: "2026-11-23", startTime: "16:30:00" }, { isStaff: false, now: NOW })).toBe(true);
    expect(canMarkAttendance({ date: "2026-11-23", startTime: "17:30:00" }, { isStaff: false, now: NOW })).toBe(false);
  });

  it("is always open for staff", () => {
    expect(canMarkAttendance({ date: "2026-12-01", startTime: "09:00:00" }, { isStaff: true, now: NOW })).toBe(true);
  });
});

describe("groupRoster", () => {
  it("splits seats, waitlist and inactive rows and counts attendance", () => {
    const rows = [
      { booking_status: "attended" as const, id: 1 },
      { booking_status: "booked" as const, id: 2 },
      { booking_status: "offered" as const, id: 3 },
      { booking_status: "no_show" as const, id: 4 },
      { booking_status: "waitlist" as const, id: 5 },
      { booking_status: "cancelled" as const, id: 6 },
      { booking_status: "late_cancelled" as const, id: 7 },
    ];
    const groups = groupRoster(rows);
    expect(groups.seats.map((row) => row.id)).toEqual([1, 2, 3, 4]);
    expect(groups.waitlist.map((row) => row.id)).toEqual([5]);
    expect(groups.inactive.map((row) => row.id)).toEqual([6, 7]);
    expect(groups.counts).toEqual({ attended: 1, noShow: 1, notMarked: 1, offered: 1, seats: 4, waitlist: 1 });
  });
});

describe("learnerName", () => {
  it("adds the nickname when there is one", () => {
    expect(learnerName({ full_name: "สมชาย ใจงาม", nickname: "ชาย" })).toBe("สมชาย ใจงาม (ชาย)");
    expect(learnerName({ full_name: "สมชาย ใจงาม", nickname: " " })).toBe("สมชาย ใจงาม");
  });
});

const slots = [
  { coach_id: "a", end_time: "17:30:00", id: "1", lesson_date: "2026-11-23", start_time: "16:30:00", status: "open" },
  { coach_id: "a", end_time: "10:00:00", id: "2", lesson_date: "2026-11-23", start_time: "09:00:00", status: "open" },
  { coach_id: "a", end_time: "18:30:00", id: "3", lesson_date: "2026-11-25", start_time: "17:00:00", status: "cancelled" },
  { coach_id: "a", end_time: "10:30:00", id: "4", lesson_date: "2026-11-29", start_time: "09:00:00", status: "open" },
  { coach_id: "a", end_time: "10:00:00", id: "5", lesson_date: "2026-11-30", start_time: "09:00:00", status: "open" },
  { coach_id: "a", end_time: "10:00:00", id: "6", lesson_date: "2026-11-10", start_time: "09:00:00", status: "completed" },
  { coach_id: "b", end_time: "10:00:00", id: "7", lesson_date: "2026-11-10", start_time: "09:00:00", status: "open" },
  { coach_id: "a", end_time: "10:00:00", id: "8", lesson_date: "2026-10-31", start_time: "08:00:00", status: "open" },
];

describe("coachSchedule", () => {
  it("returns today's rounds in time order and the next days grouped by date", () => {
    const schedule = coachSchedule(slots, "2026-11-23");
    expect(schedule.today.map((slot) => slot.id)).toEqual(["2", "1"]);
    expect(schedule.later.map((day) => day.date)).toEqual(["2026-11-25", "2026-11-29"]);
  });
});

describe("monthlyTeaching", () => {
  it("counts the coach's active rounds of the month, split by finished and planned", () => {
    const summary = monthlyTeaching(slots, "a", "2026-11", NOW);
    // 1 h (id 2) + 1 h (id 1) + 1.5 h (id 4) + 1 h (id 5) + 1 h (id 6); cancelled id 3 left out
    expect(summary).toMatchObject({ hours: 5.5, planned: 3, rounds: 5, taught: 2, taughtHours: 2 });
  });

  it("works across the year boundary", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
    expect(monthlyTeaching(slots, "a", "2026-10", NOW)).toMatchObject({ hours: 2, rounds: 1, taught: 1 });
  });
});

describe("formatHours", () => {
  it("keeps whole hours short", () => {
    expect(formatHours(12)).toBe("12");
    expect(formatHours(5.5)).toBe("5.5");
    expect(formatHours(1.25)).toBe("1.25");
  });
});
