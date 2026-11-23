import { describe, expect, it } from "vitest";

import { fiscalYearRange, quarterRange, reportPeriod, reportPresets } from "./period";

describe("reportPeriod", () => {
  it("defaults to the whole current year so later rounds and events are included", () => {
    expect(reportPeriod(undefined, undefined, "2026-11-16")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("accepts future dates and swaps a reversed range", () => {
    expect(reportPeriod("2026-12-01", "2027-01-31", "2026-11-16")).toEqual({ from: "2026-12-01", to: "2027-01-31" });
    expect(reportPeriod("2026-12-31", "2026-12-01", "2026-11-16")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("ignores malformed dates", () => {
    expect(reportPeriod("abc", "2026-13", "2026-11-16")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("reportPresets", () => {
  it("offers month, quarter, fiscal year, next 30 days, last 30 days, this year and last year", () => {
    expect(reportPresets("2026-11-16")).toEqual([
      { from: "2026-11-01", label: "เดือนนี้", to: "2026-11-30" },
      { from: "2026-10-01", label: "ไตรมาสนี้", to: "2026-12-31" },
      { from: "2026-10-01", label: "ปีงบประมาณนี้", to: "2027-09-30" },
      { from: "2026-11-16", label: "30 วันข้างหน้า", to: "2026-12-16" },
      { from: "2026-10-17", label: "30 วันที่ผ่านมา", to: "2026-11-16" },
      { from: "2026-01-01", label: "ปีนี้", to: "2026-12-31" },
      { from: "2025-01-01", label: "ปีที่แล้ว", to: "2025-12-31" },
    ]);
  });

  it("handles February in a leap year", () => {
    expect(reportPresets("2028-02-10")[0]).toEqual({ from: "2028-02-01", label: "เดือนนี้", to: "2028-02-29" });
  });
});

describe("quarterRange", () => {
  it("covers the calendar quarter of the day", () => {
    expect(quarterRange("2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(quarterRange("2026-05-20")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(quarterRange("2026-09-30")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(quarterRange("2026-12-31")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });
});

describe("fiscalYearRange", () => {
  it("runs 1 October to 30 September", () => {
    expect(fiscalYearRange("2026-11-23")).toEqual({ from: "2026-10-01", to: "2027-09-30" });
    expect(fiscalYearRange("2026-10-01")).toEqual({ from: "2026-10-01", to: "2027-09-30" });
    expect(fiscalYearRange("2026-09-30")).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    expect(fiscalYearRange("2027-01-15")).toEqual({ from: "2026-10-01", to: "2027-09-30" });
  });
});
