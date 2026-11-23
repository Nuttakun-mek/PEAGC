import { describe, expect, it } from "vitest";

import { checkCard, describeCheck, parseTotal } from "./validate";

const front = ["5", "4", "3", "6", "4", "5", "3", "4", "5"]; // 39
const back = ["4", "5", "3", "6", "4", "4", "3", "5", "5"]; // 39

describe("scorecard sum checks", () => {
  it("passes when holes are 1-15 and sums match the card", () => {
    const check = checkCard([...front, ...back], { in: "39", out: "39", total: "78" });
    expect(check.ok).toBe(true);
    expect(check.sums).toEqual({ in: 39, out: 39, total: 78 });
  });

  it("flags OUT / IN / TOTAL that do not match what is written", () => {
    const check = checkCard([...front, ...back], { in: "40", out: "39", total: "79" });
    expect(check.ok).toBe(false);
    expect(check.totalIssues.out).toBeNull();
    expect(check.totalIssues.in).toBe("IN รวมได้ 39 แต่การ์ดเขียน 40");
    expect(check.totalIssues.total).toBe("TOTAL รวมได้ 78 แต่การ์ดเขียน 79");
  });

  it("flags the card's own arithmetic", () => {
    const check = checkCard([...front, ...back], { in: "39", out: "39", total: "" });
    expect(check.ok).toBe(true);
    const wrong = checkCard(["", ...front.slice(1), ...back], { in: "39", out: "39", total: "80" });
    expect(wrong.totalIssues.total).toBe("OUT + IN บนการ์ด (78) ไม่เท่ากับ TOTAL 80");
  });

  it("flags empty holes and values outside 1-15", () => {
    const check = checkCard(["", "16", "0", "abc", ...front.slice(4), ...back]);
    expect(check.cellIssues.slice(0, 4)).toEqual(["ยังไม่ได้กรอก", "ต้องอยู่ระหว่าง 1-15", "ต้องอยู่ระหว่าง 1-15", "ต้องเป็นตัวเลขหรือ X"]);
    expect(check.sums.out).toBeNull();
    expect(check.ok).toBe(false);
    expect(describeCheck(check)[0]).toBe("หลุม 1: ยังไม่ได้กรอก");
  });

  it("accepts X (picked up) but skips that nine's sum", () => {
    const check = checkCard(["X", ...front.slice(1), ...back], { in: "39", out: "34", total: "73" });
    expect(check.cellIssues[0]).toBeNull();
    expect(check.sums.out).toBeNull();
    expect(check.totalIssues.out).toBeNull();
    expect(check.ok).toBe(true);
  });

  it("reads Thai digits in the totals", () => {
    expect(parseTotal("๗๘")).toBe(78);
    expect(parseTotal(" 78 ")).toBe(78);
    expect(parseTotal("7 8x")).toBeNull();
  });
});
