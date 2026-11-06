// Pure helpers for the association member directory import (monthly Excel/CSV upload).

export const directoryHeaderAliases = {
  associationMemberCode: ["รหัสสมาชิกสมาคมสโมสร", "รหัสสมาชิกสมาคม", "รหัสสมาชิกสโมสร", "รหัสสมาชิก", "เลขสมาชิก", "association_member_code", "member_code", "member code", "membership_no"],
  bureau: ["สำนัก", "bureau", "office"],
  department: ["กอง", "department", "division_group"],
  division: ["ฝ่าย", "division"],
  email: ["email", "อีเมล", "อีเมล์"],
  employeeCode: ["รหัสพนักงาน", "รหัสพนง.", "รหัส พนง.", "employee_code", "employee code", "emp_id", "code"],
  employmentStatus: ["สถานะการจ้าง", "สถานะพนักงาน", "employment_status", "employment status"],
  firstName: ["ชื่อ", "ชื่อจริง", "first_name", "first name"],
  fullName: ["ชื่อ-นามสกุล", "ชื่อ นามสกุล", "ชื่อ-สกุล", "full_name", "full name"],
  lastName: ["นามสกุล", "สกุล", "last_name", "last name", "surname"],
  memberType: ["ประเภท", "ประเภทสมาชิก", "member_type", "member type", "type"],
  membershipStatus: ["สถานะ", "สถานะสมาชิก", "membership_status", "membership status", "status"],
  position: ["ตำแหน่ง", "position"],
  section: ["แผนก", "section"],
  titlePrefix: ["คำนำหน้า", "title_prefix", "prefix", "title"],
  workLine: ["สายงาน", "work_line", "work line"],
} as const;

export type DirectoryHeaderKey = keyof typeof directoryHeaderAliases;

export function normalizeHeader(value: string) {
  return value.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function mapHeaderColumns(headers: string[]) {
  const normalized = headers.map(normalizeHeader);
  const result: Partial<Record<DirectoryHeaderKey, number>> = {};
  for (const [key, aliases] of Object.entries(directoryHeaderAliases) as [DirectoryHeaderKey, readonly string[]][]) {
    const index = aliases.map((alias) => normalized.indexOf(normalizeHeader(alias))).find((item) => item >= 0);
    if (index !== undefined) {
      result[key] = index;
    }
  }
  return result;
}

const activeWords = ["active", "ปกติ", "ใช้งาน", "สมาชิก", "สมาชิกปัจจุบัน", "ยังเป็นสมาชิก", "ปฏิบัติงาน", "y", "yes", "1", "true"];
const inactiveWords = ["inactive", "พ้นสภาพ", "พ้นสมาชิก", "ลาออก", "หมดอายุ", "สิ้นสุด", "ยกเลิก", "เกษียณ", "retired", "resigned", "expired", "n", "no", "0", "false", "ไม่ปฏิบัติงาน", "ไม่ใช้งาน"];
const suspendedWords = ["suspended", "พักสมาชิก", "ระงับ", "พักสิทธิ์"];

/** Maps free-text status cells from the association file to a fixed set. Empty = active. */
export function normalizeMembershipStatus(value: string | null | undefined): "active" | "inactive" | "suspended" | "unknown" {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "active";
  if (suspendedWords.some((word) => text.includes(word))) return "suspended";
  if (inactiveWords.some((word) => text === word || text.includes(word))) return "inactive";
  if (activeWords.some((word) => text === word || text.includes(word))) return "active";
  return "unknown";
}

export function normalizeEmploymentStatus(value: string | null | undefined): "active" | "inactive" | "retired" | "unknown" {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "active";
  if (text.includes("เกษียณ") || text.includes("retired")) return "retired";
  const membership = normalizeMembershipStatus(text);
  return membership === "suspended" ? "inactive" : membership;
}

export type DirectoryRowInput = Partial<Record<DirectoryHeaderKey, string>>;

export type DirectoryRow = {
  affiliation: string | null;
  association_member_code: string | null;
  bureau: string | null;
  department: string | null;
  division: string | null;
  email: string | null;
  employee_code: string;
  employment_status: "active" | "inactive" | "retired" | "unknown";
  first_name: string | null;
  full_name: string;
  last_name: string | null;
  member_type: string | null;
  membership_status: "active" | "inactive" | "suspended" | "unknown";
  position: string | null;
  section: string | null;
  title_prefix: string | null;
  work_line: string | null;
};

/** Builds one directory row from raw cell values. Returns null when the row is unusable. */
export function buildDirectoryRow(input: DirectoryRowInput): DirectoryRow | null {
  const clean = (value: string | undefined) => (value ?? "").trim();
  const employeeCode = clean(input.employeeCode).replace(/\s+/g, "").toUpperCase();
  const titlePrefix = clean(input.titlePrefix);
  const firstName = clean(input.firstName);
  const lastName = clean(input.lastName);
  const fullName = clean(input.fullName) || [titlePrefix, firstName, lastName].filter(Boolean).join(" ");

  if (!employeeCode || !fullName) {
    return null;
  }

  const workLine = clean(input.workLine);
  const bureau = clean(input.bureau);
  const employmentRaw = clean(input.employmentStatus);
  const membershipRaw = clean(input.membershipStatus);

  return {
    affiliation: [workLine, bureau].filter(Boolean).join(" / ") || null,
    association_member_code: clean(input.associationMemberCode).replace(/\s+/g, "") || null,
    bureau: bureau || null,
    department: clean(input.department) || null,
    division: clean(input.division) || null,
    email: clean(input.email).toLowerCase() || null,
    employee_code: employeeCode,
    employment_status: normalizeEmploymentStatus(employmentRaw || membershipRaw),
    first_name: firstName || null,
    full_name: fullName,
    last_name: lastName || null,
    member_type: clean(input.memberType) || null,
    membership_status: normalizeMembershipStatus(membershipRaw),
    position: clean(input.position) || null,
    section: clean(input.section) || null,
    title_prefix: titlePrefix || null,
    work_line: workLine || null,
  };
}

/** Turns a 2-D cell grid (header row first) into directory rows, de-duplicating by employee code. */
export function parseDirectoryGrid(grid: string[][]) {
  const [headers = [], ...dataRows] = grid;
  const columns = mapHeaderColumns(headers);
  if (columns.employeeCode === undefined) {
    return { error: "missing-employee-code" as const };
  }
  const byCode = new Map<string, DirectoryRow>();
  let skipped = 0;
  for (const row of dataRows) {
    const input: DirectoryRowInput = {};
    for (const [key, index] of Object.entries(columns) as [DirectoryHeaderKey, number][]) {
      input[key] = row[index] ?? "";
    }
    const built = buildDirectoryRow(input);
    if (!built) {
      if (row.some((cell) => (cell ?? "").trim())) skipped += 1;
      continue;
    }
    byCode.set(built.employee_code, built);
  }
  return { columns, rows: [...byCode.values()], skipped, totalRows: dataRows.length };
}

export function isDirectoryStale(lastImportedAt: string | null | undefined, now = Date.now(), maxAgeDays = 31) {
  if (!lastImportedAt) return true;
  return now - Date.parse(lastImportedAt) > maxAgeDays * 86_400_000;
}
