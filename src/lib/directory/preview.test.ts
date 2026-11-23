import { describe, expect, it } from "vitest";

import { buildDirectoryRow, mapHeaderColumns } from "./import";
import {
  type CurrentDirectoryRow,
  type ImportRow,
  type LinkedMember,
  computeDirectoryPreview,
  parseStoredRows,
  pickPresentFields,
  presentDirectoryFields,
  summarizeDirectoryPreview,
} from "./preview";

const current: CurrentDirectoryRow[] = [
  { email: "one@pea.co.th", employee_code: "E1", full_name: "หนึ่ง ใจดี", id: "d1", membership_status: "active", position: "ช่าง" },
  { email: null, employee_code: "E2", full_name: "สอง ลาออก", id: "d2", membership_status: "active" },
  { employee_code: "E3", full_name: "สาม พ้นแล้ว", id: "d3", membership_status: "inactive" },
  { archived_at: "2026-10-01T00:00:00Z", employee_code: "E4", full_name: "สี่ ถูกลบ", id: "d4", membership_status: "active" },
  { employee_code: "E5", full_name: "ห้า กลับมา", id: "d5", membership_status: "inactive" },
  { employee_code: "E6", full_name: "หก พักสิทธิ์", id: "d6", membership_status: "suspended" },
];

const incoming: ImportRow[] = [
  // unchanged apart from spacing / empty-vs-null
  { email: "ONE@pea.co.th", employee_code: "e1", full_name: "หนึ่ง  ใจดี", membership_status: "active", position: "ช่าง " },
  // back in the file and active again
  { employee_code: "E5", full_name: "ห้า กลับมา", membership_status: "active" },
  // in the file but the file says not active
  { employee_code: "E6", full_name: "หก พักสิทธิ์", membership_status: "inactive" },
  // archived row reappears
  { employee_code: "E4", full_name: "สี่ ถูกลบ", membership_status: "active" },
  // brand new
  { employee_code: "E9", full_name: "เก้า ใหม่", membership_status: "active" },
];

const members: LinkedMember[] = [
  { employee_directory_id: "d1", employee_match_status: "matched", full_name: "หนึ่ง ใจดี", id: "m1", status: "active" },
  { employee_directory_id: "d2", employee_match_status: "matched", full_name: "สอง ลาออก", id: "m2", member_code: "PEAGC-0002", status: "active" },
  // not linked: never flagged (the bug fixed in 20261123090000)
  { employee_directory_id: null, employee_match_status: "not_checked", full_name: "เพิ่มเอง", id: "m3", status: "active" },
  { employee_directory_id: "d5", employee_match_detail: { reason: "left_directory" }, employee_match_status: "mismatch", full_name: "ห้า กลับมา", id: "m5", status: "active" },
  { employee_directory_id: "d6", employee_match_status: "matched", full_name: "หก พักสิทธิ์", id: "m6", status: "active" },
  // already flagged: not counted again
  { employee_directory_id: "d3", employee_match_status: "mismatch", full_name: "สาม พ้นแล้ว", id: "m7", status: "active" },
  // pending members are not flagged by finalize (status must be active)
  { employee_directory_id: "d2", employee_match_status: "matched", full_name: "สองรอตรวจ", id: "m8", status: "pending_verification" },
  // archived members are ignored
  { archived_at: "2026-01-01T00:00:00Z", employee_directory_id: "d2", employee_match_status: "matched", full_name: "ลบแล้ว", id: "m9", status: "active" },
];

describe("computeDirectoryPreview", () => {
  it("replace mode: new, changed, unchanged, deactivated, flagged and restored", () => {
    const preview = computeDirectoryPreview({ current, incoming, members, mode: "replace" });

    expect(preview.added.map((row) => row.employee_code).sort()).toEqual(["E4", "E9"]);
    expect(preview.reappeared).toBe(1);
    expect(preview.unchanged).toBe(1);
    expect(preview.changed.map((row) => row.row.employee_code).sort()).toEqual(["E5", "E6"]);
    const e6 = preview.changed.find((row) => row.row.employee_code === "E6");
    expect(e6?.changes).toEqual([{ after: "inactive", before: "suspended", field: "membership_status", label: "สถานะสมาชิกสมาคม" }]);

    // E2 (active, not in file) becomes inactive; E3 already inactive; E4 archived but in file.
    expect(preview.deactivated.map((row) => row.employee_code)).toEqual(["E2"]);

    expect(preview.flagged.map((member) => [member.id, member.reason]).sort()).toEqual([
      ["m2", "left_file"],
      ["m6", "not_active_in_file"],
    ]);
    expect(preview.flagged.find((member) => member.id === "m2")?.memberCode).toBe("PEAGC-0002");
    expect(preview.restored.map((member) => member.id)).toEqual(["m5"]);
  });

  it("merge mode never deactivates, flags or restores", () => {
    const preview = computeDirectoryPreview({ current, incoming, members, mode: "merge" });
    expect(preview.deactivated).toEqual([]);
    expect(preview.flagged).toEqual([]);
    expect(preview.restored).toEqual([]);
    expect(preview.added).toHaveLength(2);
  });

  it("flags members linked to archived rows that are not in the file", () => {
    const preview = computeDirectoryPreview({
      current: [{ archived_at: "2026-10-01T00:00:00Z", employee_code: "X1", full_name: "เอ็กซ์", id: "x1", membership_status: "active" }],
      incoming: [{ employee_code: "Y1", full_name: "วาย", membership_status: "active" }],
      members: [{ employee_directory_id: "x1", employee_match_status: "matched", full_name: "เอ็กซ์", id: "mx", status: "active" }],
      mode: "replace",
    });
    expect(preview.deactivated).toEqual([]);
    expect(preview.flagged).toEqual([{ directoryCode: "X1", fullName: "เอ็กซ์", id: "mx", memberCode: null, reason: "archived" }]);
  });

  it("only compares fields the file carries", () => {
    const preview = computeDirectoryPreview({
      current: [{ email: "keep@pea.co.th", employee_code: "E1", full_name: "หนึ่ง", id: "d1", membership_status: "active" }],
      incoming: [{ employee_code: "E1", full_name: "หนึ่ง", membership_status: "active" }],
      members: [],
      mode: "merge",
    });
    expect(preview.unchanged).toBe(1);
    expect(preview.changed).toEqual([]);
  });

  it("reports which fields changed with before and after", () => {
    const preview = computeDirectoryPreview({
      current: [{ department: "กองเดิม", employee_code: "E1", full_name: "หนึ่ง", id: "d1", membership_status: "active" }],
      incoming: [{ department: "กองใหม่", email: "new@pea.co.th", employee_code: "E1", full_name: "หนึ่ง", membership_status: "active" }],
      members: [],
      mode: "merge",
    });
    expect(preview.changed[0].changes).toEqual([
      { after: "new@pea.co.th", before: null, field: "email", label: "อีเมล" },
      { after: "กองใหม่", before: "กองเดิม", field: "department", label: "หน่วยงาน (กอง)" },
    ]);
  });
});

describe("presentDirectoryFields / pickPresentFields", () => {
  it("keeps only the fields that have a column in the file", () => {
    const columns = mapHeaderColumns(["รหัสพนักงาน", "ชื่อ", "นามสกุล", "สายงาน"]);
    const fields = presentDirectoryFields(columns);
    expect(fields).toEqual(["full_name", "first_name", "last_name", "membership_status", "work_line", "affiliation"]);
    const row = buildDirectoryRow({ employeeCode: "e 1", firstName: "หนึ่ง", lastName: "ใจดี", workLine: "สายงานเหนือ" });
    expect(row).not.toBeNull();
    expect(pickPresentFields(row!, fields)).toEqual({
      affiliation: "สายงานเหนือ",
      employee_code: "E1",
      first_name: "หนึ่ง",
      full_name: "หนึ่ง ใจดี",
      last_name: "ใจดี",
      membership_status: "active",
      work_line: "สายงานเหนือ",
    });
  });

  it("a status column also sets the employment status", () => {
    expect(presentDirectoryFields(mapHeaderColumns(["รหัสพนักงาน", "ชื่อ-นามสกุล", "สถานะ"]))).toContain("employment_status");
    expect(presentDirectoryFields(mapHeaderColumns(["รหัสพนักงาน", "ชื่อ-นามสกุล"]))).not.toContain("employment_status");
  });
});

describe("summarizeDirectoryPreview", () => {
  it("lists counts in Thai", () => {
    const preview = computeDirectoryPreview({ current, incoming, members, mode: "replace" });
    expect(summarizeDirectoryPreview(preview, "replace")).toBe(
      "เพิ่ม 2 · แก้ 2 · ไม่เปลี่ยน 1 · จะพ้นสภาพ 1 คน · สมาชิกชมรมต้องตรวจ 2 คน · คืนสถานะ 1 คน",
    );
    expect(summarizeDirectoryPreview(computeDirectoryPreview({ current, incoming, members, mode: "merge" }), "merge")).toBe(
      "เพิ่ม 2 · แก้ 2 · ไม่เปลี่ยน 1",
    );
  });
});

describe("parseStoredRows", () => {
  it("drops malformed rows", () => {
    expect(parseStoredRows([{ employee_code: "E1", full_name: "หนึ่ง" }, { full_name: "no code" }, null, "x"])).toEqual([
      { employee_code: "E1", full_name: "หนึ่ง" },
    ]);
    expect(parseStoredRows({})).toEqual([]);
  });
});
