import { describe, expect, it } from "vitest";

import { memberListHref, memberSearchExpression, membersCsv, parseMemberListParams, sanitizeMemberSearch } from "./member-list";

describe("member list params", () => {
  it("parses filters with safe defaults", () => {
    expect(parseMemberListParams({})).toEqual({ lifecycle: "all", page: 1, q: "", reason: "all", sort: "newest", type: "all" });
    expect(parseMemberListParams({ filter: "expiring", page: "3", reason: "name_mismatch", sort: "name" })).toMatchObject({
      lifecycle: "expiring",
      page: 3,
      reason: "name_mismatch",
      sort: "name",
    });
  });

  it("keeps old links working and ignores junk", () => {
    expect(parseMemberListParams({ filter: "pending_verification" }).lifecycle).toBe("pending");
    expect(parseMemberListParams({ status: "pending_verification" }).lifecycle).toBe("pending");
    expect(parseMemberListParams({ status: "updated" }).lifecycle).toBe("all");
    expect(parseMemberListParams({ filter: "updated", page: "-4", sort: "drop table" })).toMatchObject({ lifecycle: "all", page: 1, sort: "newest" });
  });

  it("builds links that reset the page", () => {
    const filters = parseMemberListParams({ filter: "active", page: "4", q: "สมชาย" });
    expect(memberListHref(filters, { sort: "code" })).toBe("?q=%E0%B8%AA%E0%B8%A1%E0%B8%8A%E0%B8%B2%E0%B8%A2&filter=active&sort=code");
    expect(memberListHref(filters, { page: 5 }, { bypass: "admin" })).toContain("page=5");
  });
});

describe("member search", () => {
  it("strips characters that break a PostgREST or-filter", () => {
    expect(sanitizeMemberSearch("a,b(c)*%'\"\\")).toBe("a b c");
  });

  it("searches names and phone digits", () => {
    const expression = memberSearchExpression("081-234");
    expect(expression).toContain("full_name.ilike.*081-234*");
    expect(expression).toContain("phone.ilike.*081234*");
    expect(memberSearchExpression("  ")).toBeNull();
  });
});

describe("members CSV", () => {
  it("writes a BOM, Thai headers, lifecycle labels and quoted cells", () => {
    const csv = membersCsv(
      [
        {
          affiliation: null,
          department: "กองบริการ, เขต 1",
          email: "a@b.c",
          employee_code: "497901",
          employee_match_detail: { reason: "name_mismatch" },
          employee_match_status: "mismatch",
          full_name: "สมชาย ใจดี",
          joined_at: "2026-07-01",
          line_id: null,
          member_code: "PEAGC-0001",
          membership_expires_at: "2026-12-01",
          nickname: null,
          organization: null,
          phone: "0812345678",
          sponsor: { full_name: "ผู้รับรอง", member_code: "PEAGC-0002" },
          status: "active",
        },
      ],
      { noticeDays: 30, today: "2026-11-23" },
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, line] = csv.slice(1).split("\r\n");
    expect(header.startsWith("เลขสมาชิก,ชื่อ-นามสกุล")).toBe(true);
    expect(line).toContain("ใกล้หมดอายุ");
    expect(line).toContain("ชื่อไม่ตรงกับฐานสมาคม");
    expect(line).toContain('"กองบริการ, เขต 1"');
    expect(line).toContain("PEAGC-0002 ผู้รับรอง");
    expect(line.endsWith("2026-07-01,2026-12-01")).toBe(true);
  });
});
