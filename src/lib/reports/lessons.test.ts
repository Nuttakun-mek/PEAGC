import { describe, expect, it } from "vitest";

import { NO_COACH_LABEL, clockMinutes, coachTeachingHours, formatHours, lessonTotals, noShowRate } from "./lessons";

describe("lessonTotals", () => {
  it("sums programs and computes fill and no-show rates", () => {
    const totals = lessonTotals([
      { attended: 3, booked: 4, noShow: 1, programId: "p1", programName: "A", seats: 8, slots: 2, utilization: 0.5, waitlisted: 0 },
      { attended: 0, booked: 2, noShow: 0, programId: "p2", programName: "B", seats: 2, slots: 1, utilization: 1, waitlisted: 1 },
    ]);
    expect(totals).toMatchObject({ booked: 6, fillRate: 0.6, noShowRate: 0.25, seats: 10, slots: 3 });
  });

  it("has no rates when there is nothing to divide by", () => {
    expect(lessonTotals([])).toMatchObject({ fillRate: null, noShowRate: null });
    expect(noShowRate(0, 0)).toBeNull();
  });
});

describe("coachTeachingHours", () => {
  const today = "2026-06-15";

  it("groups by coach id when present, else by typed name, skipping cancelled and draft slots", () => {
    const rows = coachTeachingHours(
      [
        { coach_id: "u1", coach_name: "โค้ชเอ", end_time: "10:30:00", lesson_date: "2026-06-01", start_time: "09:00:00", status: "completed" },
        { coach_id: "u1", coach_name: null, end_time: "11:00:00", lesson_date: "2026-06-20", start_time: "10:00:00", status: "open" },
        { coach_name: "โค้ชบี", end_time: "12:00:00", lesson_date: "2026-06-15", start_time: "09:00:00", status: "open" },
        { coach_name: " โค้ชบี ", end_time: "10:00:00", lesson_date: "2026-06-16", start_time: "09:00:00", status: "cancelled" },
        { coach_name: "โค้ชบี", end_time: "10:00:00", lesson_date: "2026-06-16", start_time: "09:00:00", status: "draft" },
        { end_time: "10:00:00", lesson_date: "2026-06-02", program_coach_name: "", start_time: "09:00:00", status: "completed" },
      ],
      today,
      { u1: "สมชาย ใจดี" },
    );
    expect(rows).toEqual([
      { key: "name:โค้ชบี", name: "โค้ชบี", plannedMinutes: 0, slots: 1, taughtMinutes: 180, totalMinutes: 180 },
      { key: "id:u1", name: "สมชาย ใจดี", plannedMinutes: 60, slots: 2, taughtMinutes: 90, totalMinutes: 150 },
      { key: "none", name: NO_COACH_LABEL, plannedMinutes: 0, slots: 1, taughtMinutes: 60, totalMinutes: 60 },
    ]);
  });

  it("uses the program's coach when the slot has none and skips broken times", () => {
    const rows = coachTeachingHours(
      [
        { end_time: "10:00", lesson_date: "2026-06-01", program_coach_name: "โค้ชซี", start_time: "09:15", status: "open" },
        { end_time: "09:00", lesson_date: "2026-06-01", program_coach_name: "โค้ชซี", start_time: "10:00", status: "open" },
        { end_time: null, lesson_date: "2026-06-01", program_coach_name: "โค้ชซี", start_time: "10:00", status: "open" },
      ],
      today,
    );
    expect(rows).toEqual([{ key: "name:โค้ชซี", name: "โค้ชซี", plannedMinutes: 0, slots: 1, taughtMinutes: 45, totalMinutes: 45 }]);
  });
});

describe("time helpers", () => {
  it("reads clock times and writes Thai hours", () => {
    expect(clockMinutes("09:30:00")).toBe(570);
    expect(clockMinutes("bad")).toBeNull();
    expect(formatHours(750)).toBe("12 ชม. 30 นาที");
    expect(formatHours(60)).toBe("1 ชม.");
    expect(formatHours(45)).toBe("45 นาที");
    expect(formatHours(0)).toBe("0 ชม.");
  });
});
