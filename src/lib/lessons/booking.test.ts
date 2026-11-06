import { describe, expect, it } from "vitest";

import {
  addDays,
  cancelDeadline,
  formatCountdown,
  fromBangkokInputValue,
  getBookingPhase,
  lessonStartAt,
  needsAnnouncementAck,
  parseTimeRanges,
  planSlots,
  queueStatus,
  rpcErrorToStatus,
  seatSummary,
  slotOffer,
  toBangkokInputValue,
  weekdayOf,
} from "./booking";

describe("getBookingPhase", () => {
  const open = "2026-11-10T02:00:00.000Z";
  const close = "2026-11-20T02:00:00.000Z";

  it("is unset without an open time", () => {
    expect(getBookingPhase(null)).toBe("unset");
    expect(getBookingPhase({ booking_open_at: null, booking_close_at: close })).toBe("unset");
  });

  it("moves before -> open -> after", () => {
    const settings = { booking_open_at: open, booking_close_at: close };
    expect(getBookingPhase(settings, Date.parse(open) - 1)).toBe("before");
    expect(getBookingPhase(settings, Date.parse(open))).toBe("open");
    expect(getBookingPhase(settings, Date.parse(close))).toBe("open");
    expect(getBookingPhase(settings, Date.parse(close) + 1)).toBe("after");
  });

  it("stays open forever without a close time", () => {
    expect(getBookingPhase({ booking_open_at: open, booking_close_at: null }, Date.parse(close) + 1e9)).toBe("open");
  });
});

describe("announcement gate", () => {
  const settings = { announcement_body: "กติกา", announcement_title: "", announcement_version: 2 };

  it("requires ack when member version is behind", () => {
    expect(needsAnnouncementAck(settings, 1)).toBe(true);
    expect(needsAnnouncementAck(settings, 2)).toBe(false);
    expect(needsAnnouncementAck(settings, null)).toBe(true);
  });

  it("never gates when there is no announcement", () => {
    expect(needsAnnouncementAck({ ...settings, announcement_body: " " }, 0)).toBe(false);
    expect(needsAnnouncementAck({ ...settings, announcement_version: 0 }, 0)).toBe(false);
  });
});

describe("Bangkok time", () => {
  it("interprets lesson date/time as UTC+7", () => {
    expect(lessonStartAt("2026-11-12", "17:30").toISOString()).toBe("2026-11-12T10:30:00.000Z");
    expect(lessonStartAt("2026-11-12", "17:30:00").toISOString()).toBe("2026-11-12T10:30:00.000Z");
  });

  it("computes the cancel deadline", () => {
    expect(cancelDeadline("2026-11-12", "17:30", 24).toISOString()).toBe("2026-11-11T10:30:00.000Z");
  });

  it("round-trips datetime-local values", () => {
    expect(toBangkokInputValue("2026-11-12T10:30:00.000Z")).toBe("2026-11-12T17:30");
    expect(fromBangkokInputValue("2026-11-12T17:30")).toBe("2026-11-12T10:30:00.000Z");
    expect(fromBangkokInputValue("")).toBeNull();
    expect(toBangkokInputValue(null)).toBe("");
  });

  it("knows weekdays and date arithmetic by calendar date", () => {
    expect(weekdayOf("2026-11-08")).toBe(0); // Sunday
    expect(weekdayOf("2026-11-10")).toBe(2); // Tuesday
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });

  it("formats countdowns", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(61_000)).toBe("00:01:01");
    expect(formatCountdown(90_061_000)).toBe("1 วัน 01:01:01");
  });
});

describe("queue helpers", () => {
  it("splits confirmed and waitlisted", () => {
    expect(queueStatus(6, 6)).toEqual({ kind: "confirmed", position: 6 });
    expect(queueStatus(8, 6)).toEqual({ kind: "waitlisted", position: 8, waitlistRank: 2 });
  });

  it("summarises seats", () => {
    expect(seatSummary(4, 6, 2)).toEqual({ confirmed: 4, free: 2, waitlistFree: 2, waitlisted: 0 });
    expect(seatSummary(7, 6, 2)).toEqual({ confirmed: 6, free: 0, waitlistFree: 1, waitlisted: 1 });
  });

  it("offers the right button", () => {
    const base = { bookedCount: 0, capacity: 6, phase: "open" as const, slotStatus: "open", waitlistCapacity: 2 };
    expect(slotOffer(base)).toBe("book");
    expect(slotOffer({ ...base, bookedCount: 6 })).toBe("waitlist");
    expect(slotOffer({ ...base, bookedCount: 8 })).toBe("full");
    expect(slotOffer({ ...base, phase: "before" })).toBe("not-open");
    expect(slotOffer({ ...base, phase: "after" })).toBe("window-closed");
    expect(slotOffer({ ...base, slotStatus: "closed" })).toBe("closed");
  });
});

describe("rpcErrorToStatus", () => {
  it("maps known codes and falls back otherwise", () => {
    expect(rpcErrorToStatus("FULL", "lesson-booking-failed")).toBe("lesson-full");
    expect(rpcErrorToStatus("CANCEL_LOCKED", "x")).toBe("lesson-cancel-locked");
    expect(rpcErrorToStatus("lesson_slot_full", "x")).toBe("lesson-full");
    expect(rpcErrorToStatus("something else", "lesson-booking-failed")).toBe("lesson-booking-failed");
    expect(rpcErrorToStatus(undefined, "fallback")).toBe("fallback");
  });
});

describe("slot generator", () => {
  it("parses time ranges", () => {
    expect(parseTimeRanges("16:30-17:30, 17:30-18:30")).toEqual([
      { end_time: "17:30", start_time: "16:30" },
      { end_time: "18:30", start_time: "17:30" },
    ]);
    expect(parseTimeRanges("9:00-10:00")).toEqual([{ end_time: "10:00", start_time: "09:00" }]);
    expect(parseTimeRanges("17:30-16:30")).toBeNull();
    expect(parseTimeRanges("")).toBeNull();
    expect(parseTimeRanges("25:00-26:00")).toBeNull();
  });

  it("creates every date x time pair on the chosen weekdays", () => {
    const result = planSlots({
      from: "2026-11-09", // Monday
      times: [{ end_time: "17:30", start_time: "16:30" }, { end_time: "18:30", start_time: "17:30" }],
      to: "2026-11-15", // Sunday
      weekdays: [2, 4, 6],
    });
    expect("items" in result && result.items.map((item) => `${item.lesson_date} ${item.start_time}`)).toEqual([
      "2026-11-10 16:30",
      "2026-11-10 17:30",
      "2026-11-12 16:30",
      "2026-11-12 17:30",
      "2026-11-14 16:30",
      "2026-11-14 17:30",
    ]);
  });

  it("rejects bad ranges and empty plans", () => {
    expect(planSlots({ from: "2026-11-15", times: [{ end_time: "10:00", start_time: "09:00" }], to: "2026-11-09", weekdays: [1] })).toEqual({ error: "ช่วงวันที่ไม่ถูกต้อง" });
    expect(planSlots({ from: "2026-11-09", times: [{ end_time: "10:00", start_time: "09:00" }], to: "2026-11-09", weekdays: [0] })).toEqual({ error: "ไม่มีวันที่ตรงกับวันในสัปดาห์ที่เลือก" });
    expect(planSlots({ from: "2026-01-01", times: [{ end_time: "10:00", start_time: "09:00" }], to: "2027-12-31", weekdays: [0, 1, 2, 3, 4, 5, 6] })).toEqual({ error: "สร้างได้ครั้งละไม่เกิน 300 รอบ" });
  });
});
