import { describe, expect, it } from "vitest";

import { matchDirectory, matchReasonOf, namesMatch, normalizePersonName } from "./matching";

const row = {
  email: "somchai@pea.co.th",
  employment_status: "active",
  first_name: "สมชาย",
  full_name: "นายสมชาย ใจดี",
  id: "d1",
  last_name: "ใจดี",
  membership_status: "active",
  title_prefix: "นาย",
};

describe("name normalisation", () => {
  it("drops titles, dots, spaces and zero-width characters", () => {
    expect(normalizePersonName("นาย สมชาย  ใจดี")).toBe("สมชายใจดี");
    expect(normalizePersonName("น.ส. สมหญิง ใจงาม")).toBe("สมหญิงใจงาม");
    expect(normalizePersonName("นางสาวสมหญิง ใจงาม")).toBe("สมหญิงใจงาม");
    expect(normalizePersonName("สม​ชาย ใจดี")).toBe("สมชายใจดี");
  });

  it("treats decomposed sara am as ำ", () => {
    expect(normalizePersonName("กําพล")).toBe(normalizePersonName("กำพล"));
  });

  it("matches the full name or first + last name", () => {
    expect(namesMatch(row, "สมชาย ใจดี")).toBe(true);
    expect(namesMatch({ ...row, full_name: "" }, "สมชาย ใจดี")).toBe(true);
    expect(namesMatch(row, "สมชาย ใจร้าย")).toBe(false);
    expect(namesMatch(row, "")).toBe(false);
  });
});

describe("directory match", () => {
  it("auto-approves an active row with the same name", () => {
    const result = matchDirectory({ directory: row, email: "other@gmail.com", fullName: "สมชาย ใจดี" });
    expect(result).toMatchObject({ canAutoApprove: true, reason: null, status: "matched" });
    expect(result.checks.email).toBe(false);
  });

  it("reports why it cannot auto-approve", () => {
    expect(matchDirectory({ directory: null, fullName: "x" })).toMatchObject({ canAutoApprove: false, reason: "not_found", status: "not_found" });
    expect(matchDirectory({ directory: row, fullName: "สมศรี ใจดี" }).reason).toBe("name_mismatch");
    expect(matchDirectory({ directory: { ...row, membership_status: "inactive" }, fullName: "สมชาย ใจดี" }).reason).toBe("left_directory");
    expect(matchDirectory({ directory: { ...row, archived_at: "2026-11-01" }, fullName: "สมชาย ใจดี" }).reason).toBe("left_directory");
    expect(matchDirectory({ directory: { ...row, membership_status: "suspended" }, fullName: "สมชาย ใจดี" }).reason).toBe("inactive_in_directory");
    expect(matchDirectory({ directory: { ...row, employment_status: "retired" }, fullName: "สมชาย ใจดี" }).reason).toBe("inactive_in_directory");
  });

  it("reads stored reasons, including the legacy key", () => {
    expect(matchReasonOf({ reason: "employee_code_not_found" })).toBe("not_found");
    expect(matchReasonOf({ reason: "external" })).toBe("external");
    expect(matchReasonOf({ reason: "something" })).toBeNull();
    expect(matchReasonOf(null)).toBeNull();
  });
});
