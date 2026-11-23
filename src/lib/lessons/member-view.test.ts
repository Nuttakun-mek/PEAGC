import { describe, expect, it } from "vitest";

import {
  type BookingEligibility,
  type BrowserSlot,
  bookingActions,
  dayStrip,
  effectiveBookingStatus,
  isHistoryStatus,
  lessonReturnPath,
  matchesMemberTargets,
  memberBookingPhase,
  notesByBooking,
  offerTimeLeft,
  slotAvailability,
  slotBlocker,
  slotSeatsText,
  timeOfDay,
  waitlistRank,
} from "./member-view";

// 23 Nov 2026 10:00 Bangkok
const NOW = Date.parse("2026-11-23T03:00:00.000Z");

function slot(overrides: Partial<BrowserSlot> = {}): BrowserSlot {
  return {
    bookedCount: 0,
    capacity: 4,
    coach: "โปรต้น",
    coachId: "coach-a",
    date: "2026-11-25",
    endTime: "17:30:00",
    id: "slot-1",
    program: "กอล์ฟพื้นฐาน",
    programId: "course-a",
    requiresPackage: false,
    seatsTaken: 0,
    startTime: "16:30:00",
    status: "open",
    title: "กอล์ฟพื้นฐาน",
    venue: "สนามไดร์ฟ",
    waitlistCapacity: 2,
    waitlistCount: 0,
    ...overrides,
  };
}

const eligible: BookingEligibility = {
  activeBookings: 0,
  enrollments: null,
  isActive: true,
  maxActiveBookings: 2,
  mustAckAnnouncement: false,
  noShowBlockedUntil: null,
  phase: "open",
};

describe("timeOfDay", () => {
  it("splits the day at 12:00 and 16:00", () => {
    expect(timeOfDay("08:00:00")).toBe("morning");
    expect(timeOfDay("11:59")).toBe("morning");
    expect(timeOfDay("12:00")).toBe("afternoon");
    expect(timeOfDay("15:30:00")).toBe("afternoon");
    expect(timeOfDay("16:30:00")).toBe("evening");
  });
});

describe("matchesMemberTargets", () => {
  it("lets everyone book an untargeted slot", () => {
    expect(matchesMemberTargets({}, null)).toBe(true);
    expect(matchesMemberTargets({ target_bureaus: [] }, { bureau: "x" })).toBe(true);
  });

  it("matches units case- and space-insensitively", () => {
    expect(matchesMemberTargets({ target_bureaus: [" สำนักงานใหญ่ "] }, { bureau: "สำนักงานใหญ่" })).toBe(true);
    expect(matchesMemberTargets({ target_bureaus: ["ภาคเหนือ"] }, { bureau: "สำนักงานใหญ่" })).toBe(false);
  });
});

describe("effectiveBookingStatus / waitlistRank", () => {
  it("treats v1 'booked' rows beyond capacity as waitlist", () => {
    expect(effectiveBookingStatus("booked", 5, 4)).toBe("waitlist");
    expect(waitlistRank("booked", 6, 4)).toBe(2);
    expect(effectiveBookingStatus("booked", 4, 4)).toBe("booked");
    expect(waitlistRank("booked", 4, 4)).toBeNull();
  });

  it("keeps v2 statuses", () => {
    expect(effectiveBookingStatus("offered", 4, 4)).toBe("offered");
    expect(effectiveBookingStatus("waitlist", 5, 4)).toBe("waitlist");
    expect(waitlistRank("waitlist", 5, 4)).toBe(1);
    expect(effectiveBookingStatus("booked", null, 4)).toBe("booked");
  });
});

describe("bookingActions", () => {
  const v2 = { cancelCutoffHours: 24, changeCutoffHours: 12, now: NOW, v2: true };
  const base = { date: "2026-11-25", endTime: "17:30:00", startTime: "16:30:00" };

  it("allows cancel and change well before the lesson", () => {
    const result = bookingActions({ ...base, status: "booked" }, v2);
    expect(result).toMatchObject({ ahead: true, canCancel: true, canChange: true, lateCancel: false, cancelLocked: false });
  });

  it("marks a v2 cancel after the cutoff as late (no refund)", () => {
    // lesson tomorrow 09:00 = 23 h away, cutoff 24 h
    const result = bookingActions({ ...base, date: "2026-11-24", startTime: "09:00:00", status: "booked" }, v2);
    expect(result.canCancel).toBe(true);
    expect(result.lateCancel).toBe(true);
    expect(result.canChange).toBe(true); // 23 h > change cutoff 12 h
  });

  it("locks a v1 cancel after the cutoff", () => {
    const result = bookingActions({ ...base, date: "2026-11-24", startTime: "09:00:00", status: "booked" }, { ...v2, v2: false });
    expect(result.canCancel).toBe(false);
    expect(result.cancelLocked).toBe(true);
  });

  it("lets waitlisted and offered bookings cancel and move any time before the start (v2)", () => {
    const soon = { ...base, date: "2026-11-23", startTime: "12:00:00" };
    expect(bookingActions({ ...soon, status: "waitlist" }, v2)).toMatchObject({ canCancel: true, canChange: true, lateCancel: false });
    expect(bookingActions({ ...soon, status: "booked" }, v2).canChange).toBe(false);
  });

  it("respects the slot's reschedule switch and cutoff", () => {
    expect(bookingActions({ ...base, allowReschedule: false, status: "booked" }, v2).canChange).toBe(false);
    expect(bookingActions({ ...base, rescheduleCutoffHours: 72, status: "booked" }, v2).canChange).toBe(false);
  });

  it("offers confirmation only while the offer is open", () => {
    const offered = { ...base, offerExpiresAt: "2026-11-23T05:00:00.000Z", status: "offered" as const };
    expect(bookingActions(offered, v2).canConfirmOffer).toBe(true);
    expect(bookingActions({ ...offered, offerExpiresAt: "2026-11-23T02:00:00.000Z" }, v2).canConfirmOffer).toBe(false);
    expect(bookingActions(offered, { ...v2, v2: false }).canConfirmOffer).toBe(false);
  });

  it("does nothing for past or finished bookings", () => {
    const past = bookingActions({ ...base, date: "2026-11-20", status: "booked" }, v2);
    expect(past).toMatchObject({ ahead: false, canCancel: false, canChange: false });
    expect(bookingActions({ ...base, status: "attended" }, v2).canCancel).toBe(false);
  });
});

describe("offerTimeLeft", () => {
  it("formats hours and minutes", () => {
    expect(offerTimeLeft("2026-11-23T04:20:00.000Z", NOW)).toBe("เหลือ 1 ชม. 20 นาที");
    expect(offerTimeLeft("2026-11-23T05:00:00.000Z", NOW)).toBe("เหลือ 2 ชม.");
    expect(offerTimeLeft("2026-11-23T03:05:30.000Z", NOW)).toBe("เหลือ 5 นาที");
    expect(offerTimeLeft("2026-11-23T02:00:00.000Z", NOW)).toBe("หมดเวลาแล้ว");
    expect(offerTimeLeft(null, NOW)).toBe("หมดเวลาแล้ว");
  });
});

describe("slot availability", () => {
  it("uses v2 seat counts", () => {
    expect(slotAvailability(slot({ seatsTaken: 3 }), NOW)).toBe("book");
    expect(slotAvailability(slot({ seatsTaken: 4, waitlistCount: 1 }), NOW)).toBe("waitlist");
    expect(slotAvailability(slot({ seatsTaken: 4, waitlistCount: 2 }), NOW)).toBe("full");
  });

  it("falls back to booked_count on v1", () => {
    expect(slotAvailability(slot({ bookedCount: 5, seatsTaken: null, waitlistCount: null }), NOW)).toBe("waitlist");
    expect(slotAvailability(slot({ bookedCount: 6, seatsTaken: null, waitlistCount: null }), NOW)).toBe("full");
  });

  it("reports closed and started slots", () => {
    expect(slotAvailability(slot({ status: "cancelled" }), NOW)).toBe("closed");
    expect(slotAvailability(slot({ date: "2026-11-23", startTime: "09:00:00" }), NOW)).toBe("started");
  });

  it("describes seats in plain Thai", () => {
    expect(slotSeatsText(slot({ seatsTaken: 2 }))).toBe("ว่าง 2 จาก 4 ที่");
    expect(slotSeatsText(slot({ seatsTaken: 4, waitlistCount: 1 }))).toBe("เต็ม · คิวสำรอง 1/2 คน");
    expect(slotSeatsText(slot({ seatsTaken: 4, waitlistCount: 2 }))).toBe("เต็ม (คิวสำรองเต็มแล้ว)");
    expect(slotSeatsText(slot({ seatsTaken: 4, waitlistCapacity: 0 }))).toBe("เต็มแล้ว");
  });
});

describe("slotBlocker", () => {
  const credit = {
    credits_remaining: 2,
    enrollment_id: "e1",
    expires_at: "2026-12-31T16:59:59.000Z",
    package_name: "8 ครั้ง",
    program_id: "course-a",
    status: "active" as const,
  };

  it("passes an eligible member", () => {
    expect(slotBlocker(slot(), eligible, { now: NOW })).toBeNull();
  });

  it("checks member, announcement, window, no-show block and the limit in order", () => {
    expect(slotBlocker(slot(), { ...eligible, isActive: false }, { now: NOW })).toBe("not-active");
    expect(slotBlocker(slot(), { ...eligible, mustAckAnnouncement: true }, { now: NOW })).toBe("announcement");
    expect(slotBlocker(slot(), { ...eligible, phase: "before" }, { now: NOW })).toBe("not-open");
    expect(slotBlocker(slot(), { ...eligible, phase: "after" }, { now: NOW })).toBe("window-closed");
    expect(slotBlocker(slot(), { ...eligible, noShowBlockedUntil: "2026-11-30T00:00:00.000Z" }, { now: NOW })).toBe("blocked");
    expect(slotBlocker(slot(), { ...eligible, noShowBlockedUntil: "2026-11-20T00:00:00.000Z" }, { now: NOW })).toBeNull();
    expect(slotBlocker(slot(), { ...eligible, activeBookings: 2 }, { now: NOW })).toBe("limit");
    expect(slotBlocker(slot(), { ...eligible, activeBookings: 5, maxActiveBookings: 0 }, { now: NOW })).toBeNull();
  });

  it("needs a credit that covers the course and lasts until the lesson", () => {
    const paid = slot({ requiresPackage: true });
    expect(slotBlocker(paid, { ...eligible, enrollments: [] }, { now: NOW })).toBe("need-credit");
    expect(slotBlocker(paid, { ...eligible, enrollments: [credit] }, { now: NOW })).toBeNull();
    expect(slotBlocker(paid, { ...eligible, enrollments: [{ ...credit, program_id: "course-b" }] }, { now: NOW })).toBe("need-credit");
    expect(slotBlocker(paid, { ...eligible, enrollments: [{ ...credit, program_id: null }] }, { now: NOW })).toBeNull();
    expect(
      slotBlocker(paid, { ...eligible, enrollments: [{ ...credit, expires_at: "2026-11-24T16:59:59.000Z" }] }, { now: NOW }),
    ).toBe("need-credit");
    // v1 / no credit data: not checked here (the RPC decides)
    expect(slotBlocker(paid, eligible, { now: NOW })).toBeNull();
  });

  it("skips the limit and credit checks when moving a booking", () => {
    const paid = slot({ requiresPackage: true });
    expect(slotBlocker(paid, { ...eligible, activeBookings: 2, enrollments: [] }, { moving: true, now: NOW })).toBeNull();
    expect(slotBlocker(paid, { ...eligible, phase: "after" }, { moving: true, now: NOW })).toBe("window-closed");
  });
});

describe("memberBookingPhase", () => {
  it("uses the member's own (employee priority) opening time", () => {
    const settings = { booking_close_at: null, booking_open_at: "2026-11-24T01:00:00.000Z" };
    expect(memberBookingPhase(settings, null, NOW)).toBe("before");
    expect(memberBookingPhase(settings, "2026-11-22T01:00:00.000Z", NOW)).toBe("open");
    expect(memberBookingPhase({ booking_close_at: null, booking_open_at: null }, undefined, NOW)).toBe("unset");
  });
});

describe("dayStrip", () => {
  it("covers at least two weeks and extends to the last round", () => {
    const days = dayStrip([{ date: "2026-11-24" }, { bookable: false, date: "2026-11-24" }, { date: "2026-12-10" }], "2026-11-23");
    expect(days[0]).toMatchObject({ date: "2026-11-23", isToday: true, slots: 0, weekday: "จ." });
    expect(days[1]).toMatchObject({ date: "2026-11-24", open: 1, slots: 2 });
    expect(days.at(-1)?.date).toBe("2026-12-10");
    expect(dayStrip([], "2026-11-23")).toHaveLength(14);
  });

  it("ignores past and far-away rounds", () => {
    const days = dayStrip([{ date: "2026-11-01" }, { date: "2027-03-01" }], "2026-11-23", { maxDays: 30 });
    expect(days).toHaveLength(14);
    expect(days.every((day) => day.slots === 0)).toBe(true);
  });
});

describe("history and notes", () => {
  it("knows which statuses are history", () => {
    expect(isHistoryStatus("attended")).toBe(true);
    expect(isHistoryStatus("no_show")).toBe(true);
    expect(isHistoryStatus("booked")).toBe(false);
    expect(isHistoryStatus("cancelled")).toBe(false);
  });

  it("groups notes per booking, newest first", () => {
    const map = notesByBooking([
      { bookingId: "b1", createdAt: "2026-11-01T10:00:00Z", id: "n1" },
      { bookingId: "b1", createdAt: "2026-11-02T10:00:00Z", id: "n2" },
      { bookingId: null, createdAt: "2026-11-03T10:00:00Z", id: "n3" },
    ]);
    expect(map.get("b1")?.map((note) => note.id)).toEqual(["n2", "n1"]);
    expect(map.size).toBe(1);
  });
});

describe("lessonReturnPath", () => {
  it("only allows the member lesson screens", () => {
    expect(lessonReturnPath("/member/lessons")).toBe("/member/lessons");
    expect(lessonReturnPath("/member")).toBe("/member");
    expect(lessonReturnPath("https://evil.example")).toBe("/member");
    expect(lessonReturnPath("//evil.example")).toBe("/member");
    expect(lessonReturnPath(null)).toBe("/member");
  });
});
