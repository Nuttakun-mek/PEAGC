import { describe, expect, it } from "vitest";

import { bangkokMonth, formatAxisBaht, formatThaiMonth, monthlyRevenue, monthsInPeriod, revenueTicks } from "./revenue";

const period = { from: "2026-01-01", to: "2026-04-30" };

describe("bangkokMonth", () => {
  it("buckets by the Bangkok calendar, not UTC", () => {
    // 31 Jan 2026 18:30 UTC is already 1 Feb 01:30 in Bangkok.
    expect(bangkokMonth("2026-01-31T18:30:00Z")).toBe("2026-02");
    expect(bangkokMonth("2026-01-31T16:59:59Z")).toBe("2026-01");
    // New Year's Eve: 31 Dec 2025 17:00 UTC = 1 Jan 2026 00:00 Bangkok.
    expect(bangkokMonth("2025-12-31T17:00:00Z")).toBe("2026-01");
    expect(bangkokMonth("2025-12-31T16:59:59Z")).toBe("2025-12");
    expect(bangkokMonth(null)).toBeNull();
    expect(bangkokMonth("not a date")).toBeNull();
  });
});

describe("monthsInPeriod", () => {
  it("lists every month across a year boundary", () => {
    expect(monthsInPeriod("2025-11-15", "2026-02-03")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsInPeriod("2026-03-01", "2026-03-31")).toEqual(["2026-03"]);
  });
});

describe("monthlyRevenue", () => {
  it("stacks approved money by purpose and fills empty months with 0", () => {
    const result = monthlyRevenue(
      [
        { amount: "1500.00", created_at: "2026-01-02T03:00:00Z", purpose: "event", reviewed_at: "2026-01-05T03:00:00Z", status: "approved" },
        { amount: 3500, created_at: "2026-01-02T03:00:00Z", purpose: "lesson_package", reviewed_at: "2026-01-06T03:00:00Z", status: "approved" },
        { amount: 500, created_at: "2026-03-02T03:00:00Z", purpose: "membership_fee", reviewed_at: "2026-03-03T03:00:00Z", status: "approved" },
        { amount: 200, created_at: "2026-03-02T03:00:00Z", purpose: "donation", reviewed_at: "2026-03-03T03:00:00Z", status: "approved" },
      ],
      period,
    );
    expect(result.months.map((month) => [month.month, month.total])).toEqual([
      ["2026-01", 5000],
      ["2026-02", 0],
      ["2026-03", 700],
      ["2026-04", 0],
    ]);
    expect(result.months[0].byPurpose).toEqual({ event: 1500, lesson_package: 3500, membership_fee: 0, other: 0 });
    expect(result.months[2].byPurpose).toEqual({ event: 0, lesson_package: 0, membership_fee: 500, other: 200 });
    expect(result.purposes).toEqual(["event", "lesson_package", "membership_fee", "other"]);
    expect(result.total).toBe(5700);
  });

  it("excludes refunded, rejected and pending payments", () => {
    const result = monthlyRevenue(
      [
        { amount: 1000, created_at: "2026-02-01T03:00:00Z", purpose: "event", reviewed_at: "2026-02-02T03:00:00Z", status: "refunded" },
        { amount: 1000, created_at: "2026-02-01T03:00:00Z", purpose: "event", reviewed_at: "2026-02-02T03:00:00Z", status: "rejected" },
        { amount: 1000, created_at: "2026-02-01T03:00:00Z", purpose: "event", reviewed_at: null, status: "review" },
        { amount: 1000, created_at: "2026-02-01T03:00:00Z", purpose: "event", reviewed_at: "2026-02-02T03:00:00Z", status: "approved" },
      ],
      period,
    );
    expect(result.total).toBe(1000);
    expect(result.purposes).toEqual(["event"]);
  });

  it("treats rows without a purpose column as event payments and falls back to created_at", () => {
    const result = monthlyRevenue(
      [
        { amount: 800, created_at: "2026-04-10T03:00:00Z", reviewed_at: null, status: "approved" },
        { amount: 900, created_at: "2026-02-10T03:00:00Z", purpose: null, reviewed_at: "2026-04-01T03:00:00Z", status: "approved" },
      ],
      period,
    );
    expect(result.months[3]).toMatchObject({ byPurpose: { event: 1700 }, count: 2, month: "2026-04", total: 1700 });
    expect(result.purposes).toEqual(["event"]);
  });

  it("ignores money approved outside the period's months", () => {
    const result = monthlyRevenue(
      [{ amount: 500, created_at: "2025-12-31T16:00:00Z", purpose: "event", reviewed_at: "2025-12-31T16:00:00Z", status: "approved" }],
      period,
    );
    expect(result.total).toBe(0);
    expect(result.purposes).toEqual([]);
  });
});

describe("chart helpers", () => {
  it("formats Thai month labels", () => {
    expect(formatThaiMonth("2026-01")).toBe("ม.ค. 69");
    expect(formatThaiMonth("2026-12")).toBe("ธ.ค. 69");
  });

  it("picks clean ticks that cover the maximum", () => {
    expect(revenueTicks(0)).toEqual([0]);
    expect(revenueTicks(37_000)).toEqual([0, 10_000, 20_000, 30_000, 40_000]);
    const ticks = revenueTicks(123_456);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(123_456);
  });

  it("writes axis values in full, millions in Thai", () => {
    expect(formatAxisBaht(25_000)).toBe("25,000");
    expect(formatAxisBaht(1_500_000)).toBe("1.5 ล้าน");
  });
});
