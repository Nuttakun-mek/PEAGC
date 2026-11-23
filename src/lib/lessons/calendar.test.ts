import { describe, expect, it } from "vitest";

import { buildMonth, buildWeek, fillLevel, formatDateRange, formatMonthLabel, monthRange, slotFill, startOfWeek, teachingHours, weekRange } from "./calendar";
import type { LessonSlotRow } from "./types";

function slot(id: string, date: string, start: string, end: string, extra: Partial<LessonSlotRow> = {}): LessonSlotRow {
  return { capacity: 4, end_time: `${end}:00`, id, lesson_date: date, seats_taken: 0, start_time: `${start}:00`, status: "open", waitlist_count: 0, ...extra };
}

describe("slotFill", () => {
  it("uses the v2 counters", () => {
    const fill = slotFill({ capacity: 4, seats_taken: 3, status: "open", waitlist_count: 2 });
    expect(fill).toMatchObject({ free: 1, label: "3/4 ที่ · คิวสำรอง 2", level: "medium", percent: 75, taken: 3, tone: "info", waitlist: 2 });
  });

  it("falls back to booked_count before the migration", () => {
    expect(slotFill({ booked_count: 6, capacity: 4, status: "open" })).toMatchObject({ label: "4/4 ที่ · คิวสำรอง 2", level: "full", percent: 100, tone: "warning" });
  });

  it("greys out cancelled rounds", () => {
    expect(slotFill({ capacity: 4, seats_taken: 0, status: "cancelled" })).toMatchObject({ level: "closed", tone: "neutral" });
  });

  it("grades the levels", () => {
    expect([0, 10, 50, 80, 100].map((percent) => fillLevel(percent))).toEqual(["empty", "low", "medium", "high", "full"]);
  });
});

describe("weeks", () => {
  it("starts on Monday by default (Sunday optional)", () => {
    expect(startOfWeek("2026-11-23")).toBe("2026-11-23"); // Monday
    expect(startOfWeek("2026-11-29")).toBe("2026-11-23"); // Sunday
    expect(startOfWeek("2026-11-29", 0)).toBe("2026-11-29");
    expect(weekRange("2026-11-26")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
  });

  it("labels ranges in Thai", () => {
    expect(formatDateRange("2026-11-23", "2026-11-29")).toBe("23–29 พ.ย. 2569");
    expect(formatDateRange("2026-11-30", "2026-12-06")).toBe("30 พ.ย. – 6 ธ.ค. 2569");
    expect(formatDateRange("2026-12-28", "2027-01-03")).toBe("28 ธ.ค. 2569 – 3 ม.ค. 2570");
  });

  it("builds 7 days with sorted rounds and a day summary", () => {
    const week = buildWeek(
      [
        slot("b", "2026-11-24", "17:30", "18:30", { seats_taken: 4 }),
        slot("a", "2026-11-24", "16:30", "17:30", { seats_taken: 2 }),
        slot("c", "2026-11-24", "09:00", "10:00", { status: "cancelled" }),
        slot("x", "2026-12-24", "09:00", "10:00"),
      ],
      "2026-11-26",
      { today: "2026-11-25" },
    );
    expect(week.days.map((day) => day.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(week.days[0].weekdayLabel).toBe("จ.");
    const tuesday = week.days[1];
    expect(tuesday.slots.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(tuesday.summary).toMatchObject({ cancelled: 1, capacity: 8, percent: 75, slots: 2, taken: 6 });
    expect(tuesday.isPast).toBe(true);
    expect(week.days[2].isToday).toBe(true);
    expect(week.days[3].summary.level).toBe("closed"); // no rounds
    expect(week.label).toBe("23–29 พ.ย. 2569");
    expect(week.prevAnchor).toBe("2026-11-16");
    expect(week.nextAnchor).toBe("2026-11-30");
  });
});

describe("months", () => {
  it("covers whole weeks around the month", () => {
    expect(monthRange("2026-11")).toEqual({ from: "2026-10-26", lastOfMonth: "2026-11-30", to: "2026-12-06" });
    expect(formatMonthLabel("2026-11-23")).toBe("พฤศจิกายน 2569");
  });

  it("builds the grid with in-month flags and per-day fill", () => {
    const month = buildMonth([slot("a", "2026-11-24", "16:30", "17:30", { seats_taken: 4 }), slot("z", "2026-10-27", "16:30", "17:30")], "2026-11", { today: "2026-11-23" });
    expect(month.weeks).toHaveLength(6);
    expect(month.weeks.every((week) => week.length === 7)).toBe(true);
    expect(month.weeks[0][0]).toMatchObject({ date: "2026-10-26", inMonth: false });
    const day = month.weeks.flat().find((item) => item.date === "2026-11-24");
    expect(day?.summary).toMatchObject({ level: "full", percent: 100, tone: "warning" });
    expect(month.summary.slots).toBe(1); // only rounds inside November
    expect(month.label).toBe("พฤศจิกายน 2569");
    expect(month.prevMonth).toBe("2026-10");
    expect(buildMonth([], "2026-12").nextMonth).toBe("2027-01");
    expect(buildMonth([], "2026-12", { weekStartsOn: 0 }).weekdayLabels[0]).toBe("อา.");
  });
});

describe("teachingHours", () => {
  it("adds active rounds per coach", () => {
    const slots = [
      slot("a", "2026-11-24", "16:30", "17:30", { coach_id: "c1" }),
      slot("b", "2026-11-25", "09:00", "10:30", { coach_id: "c1" }),
      slot("c", "2026-11-26", "09:00", "10:00", { coach_id: "c1", status: "cancelled" }),
      slot("d", "2026-11-26", "09:00", "10:00", { coach_id: "c2" }),
    ];
    expect(teachingHours(slots, "c1")).toBe(2.5);
    expect(teachingHours(slots)).toBe(3.5);
  });
});
