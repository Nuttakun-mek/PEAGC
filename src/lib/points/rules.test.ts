import { describe, expect, it } from "vitest";

import { formatPointDelta, parseRulePoints, pointsErrorToStatus, resolvePointRules } from "./rules";

describe("point rules", () => {
  it("falls back to the audit defaults", () => {
    const rules = resolvePointRules(null);
    expect(rules.map((rule) => [rule.reason, rule.points])).toEqual([
      ["attend_lesson", 10],
      ["event_checkin", 30],
      ["scorecard_on_time", 5],
      ["referral", 50],
      ["staff_award", 20],
      ["no_show", -10],
    ]);
  });

  it("uses club rows over defaults", () => {
    const rules = resolvePointRules([{ enabled: false, points: 15, reason: "attend_lesson" }, { enabled: true, points: 1, reason: "bogus" }]);
    expect(rules[0]).toEqual({ enabled: false, isDefault: false, points: 15, reason: "attend_lesson" });
    expect(rules).toHaveLength(6);
  });

  it("stores the no-show deduction as a negative number", () => {
    expect(parseRulePoints("no_show", "10")).toBe(-10);
    expect(parseRulePoints("no_show", "-10")).toBe(-10);
    expect(parseRulePoints("attend_lesson", "12")).toBe(12);
    expect(parseRulePoints("attend_lesson", "1.5")).toBeNull();
    expect(parseRulePoints("attend_lesson", "5000")).toBeNull();
  });

  it("formats deltas with a real minus sign", () => {
    expect(formatPointDelta(10)).toBe("+10");
    expect(formatPointDelta(-1200)).toBe("−1,200");
  });

  it("maps RPC errors to status keys", () => {
    expect(pointsErrorToStatus("POINTS_NOT_ENOUGH", "x")).toBe("points-not-enough");
    expect(pointsErrorToStatus("boom", "x")).toBe("x");
  });
});
