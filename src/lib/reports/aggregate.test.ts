import { describe, expect, it } from "vitest";

import { eventAttendance, financeByEvent, lessonUsageByProgram, percent } from "./aggregate";

describe("financeByEvent", () => {
  it("splits approved, pending and refunded per event with totals", () => {
    const { lines, totals } = financeByEvent([
      { amount: "1500", event_id: "e1", event_name: "Cup", status: "approved" },
      { amount: 1500, event_id: "e1", event_name: "Cup", status: "review" },
      { amount: 1500, event_id: "e1", event_name: "Cup", status: "refunded" },
      { amount: 800, event_id: "e2", event_name: "Monthly", status: "approved" },
      { amount: 800, event_id: "e2", event_name: "Monthly", status: "rejected" },
    ]);
    expect(lines.map((l) => [l.eventId, l.approved, l.pending, l.refunded, l.approvedCount, l.pendingCount])).toEqual([
      ["e1", 1500, 1500, 1500, 1, 1],
      ["e2", 800, 0, 0, 1, 0],
    ]);
    expect(totals).toEqual({ approved: 2300, net: 800, pending: 1500, refunded: 1500 });
  });
});

describe("lessonUsageByProgram", () => {
  it("caps booked at capacity, counts overflow as waitlist, skips cancelled slots", () => {
    const usage = lessonUsageByProgram(
      [
        { capacity: 2, id: "s1", lesson_date: "2026-11-01", program_id: "p1", program_name: "Basic", status: "completed" },
        { capacity: 4, id: "s2", lesson_date: "2026-11-02", program_id: "p1", program_name: "Basic", status: "open" },
        { capacity: 4, id: "s3", lesson_date: "2026-11-03", program_id: "p1", program_name: "Basic", status: "cancelled" },
      ],
      [
        { slot_id: "s1", status: "attended" },
        { slot_id: "s1", status: "no_show" },
        { slot_id: "s1", status: "booked" },
        { slot_id: "s1", status: "cancelled" },
        { slot_id: "s2", status: "booked" },
        { slot_id: "s3", status: "booked" },
      ],
    );
    expect(usage).toEqual([
      { attended: 1, booked: 3, noShow: 1, programId: "p1", programName: "Basic", seats: 6, slots: 2, utilization: 0.5, waitlisted: 1 },
    ]);
  });
});

describe("eventAttendance", () => {
  it("computes fill, check-in and no-show rate", () => {
    const [row] = eventAttendance(
      [{ capacity: 4, event_date: "2026-11-01", id: "e1", name: "Cup" }],
      [
        { checked_in_at: "x", event_id: "e1", status: "paid" },
        { checked_in_at: null, event_id: "e1", status: "paid" },
        { checked_in_at: null, event_id: "e1", status: "no_show" },
        { checked_in_at: null, event_id: "e1", status: "waitlist" },
        { checked_in_at: null, event_id: "e1", status: "cancelled" },
      ],
    );
    expect(row).toMatchObject({ checkedIn: 1, fill: 0.5, noShow: 1, seats: 2, waitlist: 1 });
    expect(percent(row.noShowRate)).toBe("33%");
  });
});
