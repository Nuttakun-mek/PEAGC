import { describe, expect, it } from "vitest";

import {
  buildDirectoryRow,
  isDirectoryStale,
  mapHeaderColumns,
  normalizeMembershipStatus,
  parseDirectoryGrid,
} from "./import";

describe("mapHeaderColumns", () => {
  it("recognises Thai association headers", () => {
    const columns = mapHeaderColumns(["﻿รหัสพนักงาน", "ชื่อ", "สกุล", "สถานะ", "ประเภท", "รหัสสมาชิกสมาคมสโมสร"]);
    expect(columns).toEqual({
      associationMemberCode: 5,
      employeeCode: 0,
      firstName: 1,
      lastName: 2,
      memberType: 4,
      membershipStatus: 3,
    });
  });

  it("recognises English headers case-insensitively", () => {
    expect(mapHeaderColumns(["Employee Code", "Full Name", "Status"])).toEqual({ employeeCode: 0, fullName: 1, membershipStatus: 2 });
  });
});

describe("normalizeMembershipStatus", () => {
  it("maps Thai and English words", () => {
    expect(normalizeMembershipStatus("")).toBe("active");
    expect(normalizeMembershipStatus("ปกติ")).toBe("active");
    expect(normalizeMembershipStatus("สมาชิกปัจจุบัน")).toBe("active");
    expect(normalizeMembershipStatus("พ้นสภาพ")).toBe("inactive");
    expect(normalizeMembershipStatus("ลาออก")).toBe("inactive");
    expect(normalizeMembershipStatus("Inactive")).toBe("inactive");
    expect(normalizeMembershipStatus("ระงับ")).toBe("suspended");
    expect(normalizeMembershipStatus("???")).toBe("unknown");
  });
});

describe("buildDirectoryRow", () => {
  it("builds full name from parts and normalises codes", () => {
    const row = buildDirectoryRow({ associationMemberCode: " A 0012 ", employeeCode: " 4979 01 ", firstName: "สมชาย", lastName: "ใจดี", memberType: "สามัญ", membershipStatus: "ปกติ", titlePrefix: "นาย" });
    expect(row).toMatchObject({
      association_member_code: "A0012",
      employee_code: "497901",
      full_name: "นาย สมชาย ใจดี",
      member_type: "สามัญ",
      membership_status: "active",
      employment_status: "active",
    });
  });

  it("rejects rows without an employee code or name", () => {
    expect(buildDirectoryRow({ firstName: "x" })).toBeNull();
    expect(buildDirectoryRow({ employeeCode: "1" })).toBeNull();
  });
});

describe("parseDirectoryGrid", () => {
  it("de-duplicates by employee code and counts skipped rows", () => {
    const result = parseDirectoryGrid([
      ["รหัสพนักงาน", "ชื่อ-นามสกุล", "สถานะ", "ประเภท", "รหัสสมาชิก"],
      ["1001", "ก ข", "ปกติ", "สามัญ", "M1"],
      ["1001", "ก ข", "พ้นสภาพ", "สามัญ", "M1"],
      ["", "ไม่มีรหัส", "", "", ""],
      ["", "", "", "", ""],
    ]);
    if ("error" in result) throw new Error(result.error);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].membership_status).toBe("inactive");
    expect(result.skipped).toBe(1);
  });

  it("fails without an employee code column", () => {
    expect(parseDirectoryGrid([["ชื่อ"], ["ก"]])).toEqual({ error: "missing-employee-code" });
  });
});

describe("isDirectoryStale", () => {
  it("is stale when missing or older than 31 days", () => {
    const now = Date.parse("2026-11-06T00:00:00Z");
    expect(isDirectoryStale(null, now)).toBe(true);
    expect(isDirectoryStale("2026-10-01T00:00:00Z", now)).toBe(true);
    expect(isDirectoryStale("2026-10-20T00:00:00Z", now)).toBe(false);
  });
});
