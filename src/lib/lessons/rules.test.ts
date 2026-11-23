import { describe, expect, it } from "vitest";

import { bookingOpensAt, defaultLessonRules, describeLessonRules, lessonRulesFromForm, noShowBlockedUntil, parseLessonRules } from "./rules";

describe("parseLessonRules", () => {
  it("fills the audit defaults for a v1 settings row", () => {
    const rules = parseLessonRules({ booking_open_at: "2026-11-01T01:00:00.000Z", cancel_cutoff_hours: 24, max_bookings_per_member: 2 });
    expect(rules.change_cutoff_hours).toBe(12);
    expect(rules.offer_window_hours).toBe(2);
    expect(rules.offer_instant_hours).toBe(3);
    expect(rules.no_show_limit).toBe(2);
    expect(rules.no_show_window_days).toBe(30);
    expect(rules.no_show_block_days).toBe(7);
    expect(rules.credit_expiry_warning_days).toBe(7);
    expect(rules.employee_priority_days).toBe(2);
    expect(rules.reminder_hours).toBe(24);
    expect(rules.auto_no_show).toBe(true);
    expect(rules.booking_open_at).toBe("2026-11-01T01:00:00.000Z");
  });

  it("coerces strings and clamps to the database ranges", () => {
    const rules = parseLessonRules({ max_bookings_per_member: "3", no_show_window_days: 0, offer_window_hours: 999, reminder_hours: "x" });
    expect(rules.max_bookings_per_member).toBe(3);
    expect(rules.no_show_window_days).toBe(1);
    expect(rules.offer_window_hours).toBe(168);
    expect(rules.reminder_hours).toBe(24);
    expect(parseLessonRules(null)).toEqual(defaultLessonRules);
  });
});

describe("describeLessonRules", () => {
  it("reads like the audit's rule table", () => {
    const texts = describeLessonRules(defaultLessonRules).map((line) => line.text);
    expect(texts).toContain("จองล่วงหน้าค้างได้พร้อมกัน 2 รอบ");
    expect(texts).toContain("ยกเลิกก่อนเรียน 24 ชม. คืนเครดิต");
    expect(texts).toContain("เปลี่ยนรอบเองได้ก่อนเรียน 12 ชม.");
    expect(texts).toContain("ได้ที่จากคิวสำรอง ต้องยืนยันภายใน 2 ชม. (ถ้าเหลือเวลาก่อนเรียนไม่ถึง 3 ชม. ได้ที่นั่งทันที)");
    expect(texts).toContain("ขาดเรียนโดยไม่แจ้ง 2 ครั้งใน 30 วัน งดจองล่วงหน้า 7 วัน");
    expect(texts).toContain("แจ้งเตือนก่อนเครดิตหมดอายุ 7 วัน");
    expect(texts).toContain("พนักงาน กฟภ. จองได้ก่อนบุคคลภายนอก 2 วัน");
    expect(texts).toContain("แจ้งเตือนก่อนเรียน 24 ชม.");
    expect(texts.some((text) => text.includes("สัปดาห์"))).toBe(false);
  });

  it("words rules that are switched off and clubs without packages", () => {
    const texts = describeLessonRules(
      { ...defaultLessonRules, employee_priority_days: 0, max_bookings_per_member: 0, max_bookings_per_week: 3, no_show_limit: 0, offer_window_hours: 0 },
      { usesCredits: false },
    ).map((line) => line.text);
    expect(texts).toContain("จองล่วงหน้าได้ไม่จำกัดจำนวนรอบ");
    expect(texts).toContain("จองได้สัปดาห์ละไม่เกิน 3 รอบ");
    expect(texts).toContain("ยกเลิกได้ก่อนเรียน 24 ชม.");
    expect(texts).toContain("ได้ที่จากคิวสำรองแล้วได้ที่นั่งทันที");
    expect(texts.some((text) => text.includes("เครดิต") || text.includes("ขาดเรียนโดยไม่แจ้ง") || text.includes("กฟภ."))).toBe(false);
  });
});

describe("lessonRulesFromForm", () => {
  it("reads numbers by column name and the checkbox", () => {
    const form = new FormData();
    form.set("max_bookings_per_member", "3");
    form.set("offer_window_hours", "4");
    const result = lessonRulesFromForm(form);
    expect("values" in result && result.values.max_bookings_per_member).toBe(3);
    expect("values" in result && result.values.offer_window_hours).toBe(4);
    expect("values" in result && result.values.cancel_cutoff_hours).toBe(24);
    expect("values" in result && result.values.auto_no_show).toBe(false);
  });

  it("explains a bad value in Thai", () => {
    const form = new FormData();
    form.set("no_show_window_days", "0");
    expect(lessonRulesFromForm(form)).toEqual({ error: "นับขาดเรียนย้อนหลัง ต้องเป็นจำนวนเต็ม 1–365 วัน" });
    form.set("no_show_window_days", "2.5");
    expect("error" in lessonRulesFromForm(form)).toBe(true);
  });
});

describe("booking window and no-show block", () => {
  it("opens earlier for PEA employees", () => {
    const rules = { booking_open_at: "2026-12-01T01:00:00.000Z", employee_priority_days: 2 };
    expect(bookingOpensAt(rules, true)?.toISOString()).toBe("2026-11-29T01:00:00.000Z");
    expect(bookingOpensAt(rules, false)?.toISOString()).toBe("2026-12-01T01:00:00.000Z");
    expect(bookingOpensAt({ booking_open_at: null, employee_priority_days: 2 }, true)).toBeNull();
  });

  it("blocks after the limit within the window, until the last no-show + block days", () => {
    const now = Date.parse("2026-11-23T03:00:00.000Z");
    const rules = { no_show_block_days: 7, no_show_limit: 2, no_show_window_days: 30 };
    expect(noShowBlockedUntil(["2026-11-20T10:00:00.000Z"], rules, now)).toBeNull();
    expect(noShowBlockedUntil(["2026-11-05T10:00:00.000Z", "2026-11-20T10:00:00.000Z"], rules, now)?.toISOString()).toBe("2026-11-27T10:00:00.000Z");
    expect(noShowBlockedUntil(["2026-10-01T10:00:00.000Z", "2026-11-20T10:00:00.000Z"], rules, now)).toBeNull();
    expect(noShowBlockedUntil(["2026-11-05T10:00:00.000Z", "2026-11-10T10:00:00.000Z"], rules, now)).toBeNull();
    expect(noShowBlockedUntil(["2026-11-05T10:00:00.000Z", "2026-11-20T10:00:00.000Z"], { ...rules, no_show_limit: 0 }, now)).toBeNull();
  });
});
