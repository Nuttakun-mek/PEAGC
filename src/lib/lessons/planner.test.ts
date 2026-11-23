import { describe, expect, it } from "vitest";

import { applyConflictRows, planSlotsWithConflicts, planSummary, venueCapacityWarning } from "./planner";

// 2026-11-23 is a Monday. Mondays + Wednesdays for two weeks, two time ranges = 8 rounds.
const base = {
  from: "2026-11-23",
  times: [
    { end_time: "17:30", start_time: "16:30" },
    { end_time: "18:30", start_time: "17:30" },
  ],
  to: "2026-12-04",
  weekdays: [1, 3],
};

describe("planSlotsWithConflicts", () => {
  it("passes planSlots errors through", () => {
    expect(planSlotsWithConflicts({ ...base, weekdays: [] })).toEqual({ error: "กรุณาเลือกวันในสัปดาห์อย่างน้อย 1 วัน" });
  });

  it("creates everything when nothing clashes", () => {
    const result = planSlotsWithConflicts({ ...base, coachId: "c1" });
    if ("error" in result) throw new Error(result.error);
    expect(result.counts).toMatchObject({ create: 8, skipped: 0, total: 8 });
    expect(result.summary).toBe("จะสร้าง 8 รอบ");
    expect(result.toCreate[0]).toEqual({ end_time: "17:30", lesson_date: "2026-11-23", start_time: "16:30" });
  });

  it("skips rounds that clash with the coach, the venue bay, or an existing round of the course", () => {
    const result = planSlotsWithConflicts({
      ...base,
      bayLabel: "1",
      coachId: "c1",
      existing: [
        { coach_id: "c1", end_time: "17:00:00", id: "s1", lesson_date: "2026-11-23", start_time: "16:00:00", status: "open", title: "เดิม" },
        { coach_id: "c1", end_time: "19:00:00", id: "s2", lesson_date: "2026-11-25", start_time: "18:00:00", status: "open" },
        { bay_label: " 1 ", coach_id: "c9", end_time: "17:30:00", id: "s3", lesson_date: "2026-11-30", start_time: "16:30:00", status: "open", venue_id: "v1" },
        { bay_label: "2", end_time: "17:30:00", id: "s4", lesson_date: "2026-12-02", start_time: "16:30:00", status: "open", venue_id: "v1" },
        { end_time: "18:30:00", id: "s5", lesson_date: "2026-12-02", program_id: "p1", start_time: "17:30:00", status: "open" },
        { coach_id: "c1", end_time: "17:30:00", id: "s6", lesson_date: "2026-12-02", start_time: "16:30:00", status: "cancelled" },
      ],
      programId: "p1",
      venueId: "v1",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.counts).toMatchObject({ coach: 2, create: 4, duplicate: 1, skipped: 4, total: 8, venue: 1 });
    expect(result.summary).toBe("จะสร้าง 4 รอบ ข้าม 1 รอบที่มีอยู่แล้ว, 2 รอบที่ชนผู้สอน และ 1 รอบที่ชนสถานที่");
    expect(result.items[0].conflicts[0]).toMatchObject({ kind: "coach", slotId: "s1", start_time: "16:00", title: "เดิม" });
    expect(result.toCreate.some((item) => item.lesson_date === "2026-12-02" && item.start_time === "16:30")).toBe(true); // bay 2 ≠ bay 1
  });

  it("matches the audit's example sentence", () => {
    const result = planSlotsWithConflicts({
      coachId: "c1",
      existing: [
        { coach_id: "c1", end_time: "10:00:00", id: "x", lesson_date: "2026-11-23", start_time: "09:00:00", status: "open" },
        { coach_id: "c1", end_time: "10:00:00", id: "y", lesson_date: "2026-11-30", start_time: "09:00:00", status: "open" },
      ],
      from: "2026-11-23",
      times: [{ end_time: "10:00", start_time: "09:00" }],
      to: "2027-01-03",
      weekdays: [1, 3, 5],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.summary).toBe("จะสร้าง 16 รอบ ข้าม 2 รอบที่ชนผู้สอน");
  });

  it("flags typed ranges that overlap each other", () => {
    const result = planSlotsWithConflicts({
      from: "2026-11-23",
      times: [
        { end_time: "17:30", start_time: "16:30" },
        { end_time: "18:00", start_time: "17:00" },
      ],
      to: "2026-11-23",
      weekdays: [1],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.items[1].conflicts[0].kind).toBe("overlap");
    expect(result.summary).toBe("จะสร้าง 1 รอบ ข้าม 1 รอบที่เวลาซ้อนกันเอง");
  });
});

describe("applyConflictRows", () => {
  it("adds RPC rows once and recounts", () => {
    const plan = planSlotsWithConflicts({ ...base });
    if ("error" in plan) throw new Error(plan.error);
    const row = {
      conflict_bay_label: null,
      conflict_coach_id: "c1",
      conflict_end: "17:00:00",
      conflict_kind: "coach" as const,
      conflict_slot_id: "s1",
      conflict_start: "16:00:00",
      conflict_title: "เดิม",
      conflict_venue_id: null,
      item_date: "2026-11-23",
      item_end: "17:30:00",
      item_index: 0,
      item_start: "16:30:00",
    };
    const merged = applyConflictRows(plan.items, [row, row, { ...row, item_index: 99 }]);
    expect(merged.items[0].conflicts).toHaveLength(1);
    expect(merged.summary).toBe("จะสร้าง 7 รอบ ข้าม 1 รอบที่ชนผู้สอน");
    expect(plan.items[0].conflicts).toHaveLength(0); // input untouched
  });

  it("says when nothing is left to create", () => {
    expect(planSummary({ coach: 2, create: 0, duplicate: 0, overlap: 0, skipped: 2, total: 2, venue: 0 })).toBe("ไม่มีรอบใหม่ให้สร้าง ข้าม 2 รอบที่ชนผู้สอน");
  });
});

describe("venueCapacityWarning", () => {
  const venue = { bay_count: 6, capacity_per_bay: 2, name: "สนามไดร์ฟ" };
  it("checks the whole venue or one bay", () => {
    expect(venueCapacityWarning(10, venue)).toBeNull();
    expect(venueCapacityWarning(13, venue)).toBe("สนามไดร์ฟ รับได้ 12 คนต่อรอบ");
    expect(venueCapacityWarning(3, venue, "A")).toBe("สนามไดร์ฟ ช่อง A รับได้ 2 คนต่อรอบ");
    expect(venueCapacityWarning(3, null)).toBeNull();
  });
});
