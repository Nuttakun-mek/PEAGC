import { describe, expect, it } from "vitest";

import { monthlyRevenue } from "./revenue";
import { sampleReportData } from "./sample";

describe("sampleReportData", () => {
  it("gives the bypass preview several months of revenue in every purpose", () => {
    const period = { from: "2026-01-01", to: "2026-12-31" };
    const data = sampleReportData(period, "2026-11-23");
    const revenue = monthlyRevenue(data.revenue, period);
    expect(revenue.months.filter((month) => month.total > 0).length).toBeGreaterThanOrEqual(6);
    expect(revenue.purposes).toEqual(["event", "lesson_package", "membership_fee"]);
    expect(data.slots.length).toBeGreaterThan(0);
    expect(data.events.length).toBeGreaterThan(0);
  });
});
