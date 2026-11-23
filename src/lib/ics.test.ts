import { describe, expect, it } from "vitest";

import { buildIcs } from "./ics";

const now = new Date("2026-11-23T03:00:00.000Z");

describe("buildIcs", () => {
  it("writes a timed Bangkok event with escaped text", () => {
    const ics = buildIcs(
      [{ date: "2026-12-20", endTime: "17:30:00", location: "สนามไดรฟ์, ช่อง 3", startTime: "16:30", title: "เรียนกอล์ฟ; พื้นฐาน", uid: "lesson-booking-1" }],
      { now },
    );
    expect(ics).toContain("DTSTART;TZID=Asia/Bangkok:20261220T163000");
    expect(ics).toContain("DTEND;TZID=Asia/Bangkok:20261220T173000");
    expect(ics).toContain("SUMMARY:เรียนกอล์ฟ\\; พื้นฐาน");
    expect(ics).toContain("LOCATION:สนามไดรฟ์\\, ช่อง 3");
    expect(ics).toContain("UID:lesson-booking-1@peagc");
    expect(ics).toContain("DTSTAMP:20261123T030000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("writes an all-day event ending the next day", () => {
    const ics = buildIcs([{ date: "2026-12-31", title: "ออกรอบ", uid: "event-1" }], { now });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const ics = buildIcs([{ date: "2026-12-20", description: "ก".repeat(80), title: "x", uid: "u" }], { now });
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain("\r\n ");
  });
});
