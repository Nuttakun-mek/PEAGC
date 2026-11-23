import { describe, expect, it } from "vitest";

import {
  bayOptions,
  calendarStep,
  closureStatusKey,
  closureStatusMessage,
  coachHours,
  dayCloseSummary,
  formatHours,
  generatedStatusKey,
  generatedStatusMessage,
  isIsoDate,
  lessonCheckInPath,
  lessonsAdminHref,
  moveTargets,
  packageScopeLabel,
  parseCalendarQuery,
  parseCreditDelta,
  parseLessonsTab,
  rosterGroups,
  safeLessonsReturnTo,
  slotCapacityProblem,
  suggestedCapacity,
  withStatus,
} from "./admin";

const SLOT = "00000000-0000-4000-8000-000000000501";
const COACH = "00000000-0000-4000-8000-000000000101";

describe("parseLessonsTab", () => {
  it("keeps the keys other pages link to", () => {
    expect(parseLessonsTab("create")).toBe("create");
    expect(parseLessonsTab("courses")).toBe("courses");
    expect(parseLessonsTab("settings")).toBe("settings");
  });

  it("maps old and friendly keys", () => {
    expect(parseLessonsTab("slots")).toBe("calendar");
    expect(parseLessonsTab("rules")).toBe("settings");
    expect(parseLessonsTab("venues")).toBe("coaches");
    expect(parseLessonsTab(undefined)).toBe("calendar");
    expect(parseLessonsTab("nope")).toBe("calendar");
  });
});

describe("parseCalendarQuery / lessonsAdminHref", () => {
  it("falls back to this week without filters", () => {
    expect(parseCalendarQuery({ coach: "x", date: "2026-02-30", view: "year" }, "2026-11-23")).toEqual({
      coach: "",
      course: "",
      date: "2026-11-23",
      slot: "",
      venue: "",
      view: "week",
    });
  });

  it("reads a month view with a selected slot", () => {
    const query = parseCalendarQuery({ coach: COACH, date: "2026-12-05", slot: SLOT, view: "month" }, "2026-11-23");
    expect(query).toMatchObject({ coach: COACH, date: "2026-12-05", slot: SLOT, view: "month" });
  });

  it("builds short links (defaults left out)", () => {
    expect(lessonsAdminHref()).toBe("/admin/lessons");
    expect(lessonsAdminHref({ tab: "calendar", view: "week" })).toBe("/admin/lessons");
    expect(lessonsAdminHref({ date: "2026-11-23", slot: SLOT, view: "month" })).toBe(`/admin/lessons?view=month&date=2026-11-23&slot=${SLOT}`);
    expect(lessonsAdminHref({ bypass: true, hash: "booking-window", tab: "settings" })).toBe("/admin/lessons?tab=settings&bypass=admin#booking-window");
    expect(lessonsAdminHref({ extra: { member: "สมชาย" }, tab: "courses" })).toBe(`/admin/lessons?tab=courses&member=${encodeURIComponent("สมชาย")}`);
  });

  it("validates dates", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("26-11-23")).toBe(false);
  });
});

describe("safeLessonsReturnTo / withStatus", () => {
  it("only returns to /admin/lessons pages", () => {
    expect(safeLessonsReturnTo("/admin/lessons?view=month&status=old#x")).toBe("/admin/lessons?view=month#x");
    expect(safeLessonsReturnTo("/admin/lessons/slots/abc/qr")).toBe("/admin/lessons/slots/abc/qr");
    expect(safeLessonsReturnTo("https://evil.example/admin/lessons")).toBe("/admin/lessons");
    expect(safeLessonsReturnTo("/admin/lessonsx")).toBe("/admin/lessons");
    expect(safeLessonsReturnTo("/admin/lessons//evil")).toBe("/admin/lessons");
    expect(safeLessonsReturnTo(null, "/admin/lessons?tab=courses")).toBe("/admin/lessons?tab=courses");
  });

  it("sets the status before the hash", () => {
    expect(withStatus("/admin/lessons?tab=courses#program-1", "program-updated")).toBe("/admin/lessons?tab=courses&status=program-updated#program-1");
    expect(withStatus("/admin/lessons", "day-closed:1:2:3:4")).toBe("/admin/lessons?status=day-closed%3A1%3A2%3A3%3A4");
  });
});

describe("status messages", () => {
  it("describes a closed day", () => {
    const key = closureStatusKey({ bookings: 9, credits_refunded: 7, members: 8, slots: 3 });
    expect(key).toBe("day-closed:3:9:7:8");
    expect(closureStatusMessage(key)).toBe("งดเรียนแล้ว ยกเลิก 3 รอบ · การจอง 9 รายการ · คืนเครดิต 7 ครั้ง · แจ้งสมาชิก 8 คน");
    expect(closureStatusMessage(closureStatusKey({ slots: 0 }))).toBe("บันทึกวันงดเรียนแล้ว วันนั้นไม่มีรอบที่ต้องยกเลิก");
    expect(closureStatusMessage("day-closed:x")).toBeNull();
  });

  it("describes generated rounds with the skipped reasons", () => {
    const key = generatedStatusKey(24, { coach: 2, duplicate: 0, overlap: 0, venue: 1 }, true);
    expect(key).toBe("generated:24:0:0:2:1:1");
    expect(generatedStatusMessage(key)).toBe("สร้าง 24 รอบเรียนแล้ว (ข้าม 2 รอบที่ชนผู้สอน และ 1 รอบที่ชนสถานที่) และเปิดให้สมาชิกจองได้เลย");
    expect(generatedStatusMessage("generated:5:0:0:0:0:0", " · ยังจองไม่ได้")).toBe("สร้าง 5 รอบเรียนแล้ว · ยังจองไม่ได้");
  });

  it("still reads the pre-wizard format", () => {
    expect(generatedStatusMessage("generated:12:3")).toBe("สร้าง 12 รอบเรียนแล้ว (ข้าม 3 รอบที่มีอยู่แล้ว)");
    expect(generatedStatusMessage("generated:12:0:opened")).toBe("สร้าง 12 รอบเรียนแล้ว และเปิดให้สมาชิกจองได้เลย");
    expect(generatedStatusMessage("generated:x")).toBeNull();
  });
});

describe("slotCapacityProblem", () => {
  it("refuses capacity below the seats already taken (v2)", () => {
    expect(slotCapacityProblem({ capacity: 3, seatsTaken: 4, waitlistCapacity: 5, waitlistCount: 0 })).toBe("slot-capacity-below-seats:4");
    expect(slotCapacityProblem({ capacity: 4, seatsTaken: 4, waitlistCapacity: 1, waitlistCount: 2 })).toBe("slot-waitlist-below-queue:2");
    expect(slotCapacityProblem({ capacity: 4, seatsTaken: 4, waitlistCapacity: 2, waitlistCount: 2 })).toBeNull();
  });

  it("falls back to the old total check without v2 counters", () => {
    expect(slotCapacityProblem({ activeBookings: 7, capacity: 4, waitlistCapacity: 2 })).toBe("slot-capacity-too-low");
    expect(slotCapacityProblem({ activeBookings: 6, capacity: 4, waitlistCapacity: 2 })).toBeNull();
  });

  it("rejects bad numbers", () => {
    expect(slotCapacityProblem({ capacity: 0, waitlistCapacity: 0 })).toBe("slot-missing");
    expect(slotCapacityProblem({ capacity: null, waitlistCapacity: 0 })).toBe("slot-missing");
    expect(slotCapacityProblem({ capacity: 2.5, waitlistCapacity: 0 })).toBe("slot-missing");
  });
});

describe("rosterGroups", () => {
  it("splits seat holders, waitlist and the rest", () => {
    const rows = [
      { booking_status: "attended" as const, id: 1 },
      { booking_status: "offered" as const, id: 2 },
      { booking_status: "waitlist" as const, id: 3 },
      { booking_status: "cancelled" as const, id: 4 },
      { booking_status: "no_show" as const, id: 5 },
      { booking_status: "closed" as const, id: 6 },
    ];
    const groups = rosterGroups(rows);
    expect(groups.seats.map((row) => row.id)).toEqual([1, 2, 5]);
    expect(groups.waitlist.map((row) => row.id)).toEqual([3]);
    expect(groups.inactive.map((row) => row.id)).toEqual([4, 6]);
  });
});

describe("moveTargets", () => {
  const base = { booked_count: 0, capacity: 4, end_time: "17:30:00", seats_taken: 0, start_time: "16:30:00", status: "open", waitlist_count: 0 };
  it("lists open future rounds, same course first", () => {
    const targets = moveTargets(
      [
        { ...base, id: "a", lesson_date: "2026-11-25", program_id: "p2", title: "อื่น" },
        { ...base, id: "b", lesson_date: "2026-11-27", program_id: "p1", seats_taken: 4, title: "พื้นฐาน" },
        { ...base, id: "c", lesson_date: "2026-11-20", program_id: "p1", title: "ผ่านไปแล้ว" },
        { ...base, id: "d", lesson_date: "2026-11-26", program_id: "p1", status: "cancelled", title: "ยกเลิก" },
        { ...base, id: "cur", lesson_date: "2026-11-24", program_id: "p1", title: "รอบนี้" },
      ],
      { id: "cur", program_id: "p1" },
      "2026-11-23",
    );
    expect(targets.map((target) => target.id)).toEqual(["b", "a"]);
    expect(targets[0]).toMatchObject({ free: 0, sameCourse: true });
    expect(targets[0].label).toContain("เต็ม");
    expect(targets[1].label).toContain("ว่าง 4 ที่");
  });
});

describe("dayCloseSummary", () => {
  it("counts the rounds and people a closure touches", () => {
    const slots = [
      { booked_count: 6, capacity: 4, seats_taken: 4, status: "open", venue_id: "v1", waitlist_count: 2 },
      { booked_count: 1, capacity: 4, seats_taken: 1, status: "open", venue_id: "v2", waitlist_count: 0 },
      { booked_count: 0, capacity: 4, seats_taken: 0, status: "cancelled", venue_id: "v1", waitlist_count: 0 },
    ];
    expect(dayCloseSummary(slots)).toEqual({ people: 7, slots: 2 });
    expect(dayCloseSummary(slots, "v1")).toEqual({ people: 6, slots: 1 });
  });
});

describe("coachHours / formatHours", () => {
  it("sums active rounds per coach", () => {
    const hours = coachHours([
      { coach_id: COACH, end_time: "17:30:00", start_time: "16:30:00", status: "open" },
      { coach_id: COACH, end_time: "10:30:00", start_time: "09:00:00", status: "completed" },
      { coach_id: COACH, end_time: "10:30:00", start_time: "09:00:00", status: "cancelled" },
      { coach_id: null, end_time: "10:30:00", start_time: "09:00:00", status: "open" },
    ]);
    expect(hours.get(COACH)).toEqual({ hours: 2.5, rounds: 2 });
    expect(hours.size).toBe(1);
    expect(formatHours(2.5)).toBe("2.5 ชม.");
    expect(formatHours(0)).toBe("ยังไม่มีรอบสอน");
  });
});

describe("venues", () => {
  it("offers bay labels for multi-bay venues", () => {
    expect(bayOptions({ bay_count: 3 })).toEqual(["1", "2", "3"]);
    expect(bayOptions({ bay_count: 1 })).toEqual([]);
    expect(bayOptions(null)).toEqual([]);
  });

  it("suggests the capacity of the venue or one bay", () => {
    expect(suggestedCapacity({ bay_count: 6, capacity_per_bay: 2 })).toBe(12);
    expect(suggestedCapacity({ bay_count: 6, capacity_per_bay: 2 }, "3")).toBe(2);
    expect(suggestedCapacity(null)).toBe(8);
  });
});

describe("packages and credits", () => {
  it("labels the package scope", () => {
    const programs = [{ id: "p1", name: "กอล์ฟพื้นฐาน" }];
    expect(packageScopeLabel(null, programs)).toBe("ทุกคอร์ส");
    expect(packageScopeLabel("p1", programs)).toBe("กอล์ฟพื้นฐาน");
    expect(packageScopeLabel("p9", programs)).toBe("คอร์สที่เก็บถาวรแล้ว");
  });

  it("parses credit adjustments", () => {
    expect(parseCreditDelta("+3")).toEqual({ delta: 3 });
    expect(parseCreditDelta(" −2 ")).toEqual({ delta: -2 });
    expect(parseCreditDelta("0")).toEqual({ error: "จำนวนเครดิตต้องไม่เป็น 0" });
    expect(parseCreditDelta("1001")).toEqual({ error: "ปรับได้ครั้งละไม่เกิน 1,000 ครั้ง" });
    expect(parseCreditDelta("สอง")).toHaveProperty("error");
  });
});

describe("calendarStep", () => {
  it("moves a week or a month", () => {
    expect(calendarStep("week", "2026-11-23", 1)).toBe("2026-11-30");
    expect(calendarStep("week", "2026-11-23", -1)).toBe("2026-11-16");
    expect(calendarStep("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(calendarStep("month", "2026-01-15", -1)).toBe("2025-12-01");
  });
});

describe("lessonCheckInPath", () => {
  it("points at the member check-in page", () => {
    expect(lessonCheckInPath("0123456789abcdef0123456789abcdef")).toBe("/member/check-in?token=0123456789abcdef0123456789abcdef");
  });
});
