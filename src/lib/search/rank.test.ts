import { describe, expect, it } from "vitest";

import { matchPages, memberScore, normalizeQuery, phoneDigits, rankByFields, rankMembers, sanitizeForFilter } from "./rank";

const members = [
  { full_name: "สมชาย ใจดี", id: "1", member_code: "PEAGC-0012", employee_code: "497901", nickname: "ชาย", phone: "0891000004", status: "active" },
  { full_name: "ชายแดน สุขใจ", id: "2", member_code: "PEAGC-0003", employee_code: "500120", nickname: "แดน", phone: "0812223333", status: "active" },
  { full_name: "วิชัย ชายทอง", id: "3", member_code: "PEAGC-0120", employee_code: "120001", nickname: null, phone: null, status: "archived" },
  { full_name: "มานี มีนา", id: "4", member_code: "PEAGC-0004", employee_code: null, nickname: "ชาย", phone: "0899999999", status: "active" },
];

describe("query cleaning", () => {
  it("normalises spaces and case", () => {
    expect(normalizeQuery("  PEAGC   0012 ")).toBe("peagc 0012");
  });

  it("removes characters that would break a PostgREST or-filter", () => {
    expect(sanitizeForFilter("a,b(c)*%'\"\\:d")).toBe("a b c d");
  });

  it("reads phone digits only when there are at least three", () => {
    expect(phoneDigits("089-100-0004")).toBe("0891000004");
    expect(phoneDigits("ab12")).toBe("");
  });
});

describe("member ranking", () => {
  it("puts an exact member code first", () => {
    expect(rankMembers(members, "peagc-0003")[0].id).toBe("2");
  });

  it("finds by employee code and phone", () => {
    expect(rankMembers(members, "497901")[0].id).toBe("1");
    expect(rankMembers(members, "089-100-0004")[0].id).toBe("1");
  });

  it("ranks exact nickname, then name prefix, then word prefix; archived last", () => {
    // Exact nickname "ชาย" (มานี, สมชาย: tie → Thai order) beats the name prefix "ชายแดน…",
    // which beats the word prefix in "วิชัย ชายทอง" (also archived, so last).
    expect(rankMembers(members, "ชาย").map((row) => row.id)).toEqual(["4", "1", "2", "3"]);
  });

  it("returns nothing for an empty query and caps the list", () => {
    expect(memberScore(members[0], "  ")).toBe(0);
    expect(rankMembers(members, "peagc", 2)).toHaveLength(2);
  });
});

describe("other groups", () => {
  it("ranks events by name before venue", () => {
    const events = [
      { name: "ออกรอบประจำเดือน", venue: "สนามธนาธร" },
      { name: "แข่งขันการกุศล ธนาธร", venue: "อื่น" },
    ];
    expect(rankByFields(events, "ธนาธร", [(row) => row.name, (row) => row.venue]).map((row) => row.name)).toEqual([
      "แข่งขันการกุศล ธนาธร",
      "ออกรอบประจำเดือน",
    ]);
  });

  it("matches menu pages by label and keywords", () => {
    const pages = [
      { href: "/admin/payments", keywords: "สลิป โอนเงิน", label: "ตรวจสลิป" },
      { href: "/admin/audit", keywords: "ประวัติ log", label: "บันทึกการแก้ไข" },
    ];
    expect(matchPages(pages, "ประวัติ").map((page) => page.href)).toEqual(["/admin/audit"]);
    expect(matchPages(pages, "สลิป")[0].href).toBe("/admin/payments");
  });
});
