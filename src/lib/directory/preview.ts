// Pure "what will this file change?" diff for the monthly association directory import.
//
// The upload step parses the file and stores it as a preview; the admin sees this diff and only
// "ยืนยันนำเข้า" writes. The rules mirror the import + `finalize_directory_replace`
// (migration 20261123090000):
//   - every row in the file is upserted by employee code (archived rows come back);
//   - replace mode: rows of the club that are not in the file, not archived and not already
//     inactive become inactive;
//   - replace mode: active, non-archived members LINKED to a row that is inactive (or not active,
//     or archived) after the import are flagged "ไม่อยู่ในฐานสมาชิกสมาคมเดือนล่าสุด", unless they are
//     already "mismatch";
//   - replace mode: members flagged left_directory whose linked row is active again are restored.
// Merge mode never runs the finalize step, so it neither deactivates, flags nor restores.

import type { DirectoryHeaderKey, DirectoryRow } from "./import";

export type ImportMode = "merge" | "replace";

/** Directory fields an import can overwrite, in display order. */
export const directoryImportFields = [
  "full_name",
  "title_prefix",
  "first_name",
  "last_name",
  "association_member_code",
  "member_type",
  "membership_status",
  "employment_status",
  "email",
  "position",
  "work_line",
  "bureau",
  "division",
  "department",
  "section",
  "affiliation",
] as const satisfies readonly (keyof DirectoryRow)[];

export type DirectoryImportField = (typeof directoryImportFields)[number];

/** Thai labels for the diff (same words as the employees page form). */
export const directoryFieldLabels: Record<DirectoryImportField, string> = {
  affiliation: "สังกัด",
  association_member_code: "รหัสสมาชิกสมาคม",
  bureau: "สำนัก",
  department: "หน่วยงาน (กอง)",
  division: "ฝ่าย",
  email: "อีเมล",
  employment_status: "สถานะพนักงาน",
  first_name: "ชื่อ",
  full_name: "ชื่อ-นามสกุล",
  last_name: "นามสกุล",
  member_type: "ประเภทสมาชิก",
  membership_status: "สถานะสมาชิกสมาคม",
  position: "ตำแหน่ง",
  section: "แผนก",
  title_prefix: "คำนำหน้า",
  work_line: "สายงาน",
};

/** File columns that feed each field. A field whose columns are all missing is left as it is. */
const fieldSources: Record<DirectoryImportField, readonly DirectoryHeaderKey[] | "always"> = {
  affiliation: ["workLine", "bureau"],
  association_member_code: ["associationMemberCode"],
  bureau: ["bureau"],
  department: ["department"],
  division: ["division"],
  email: ["email"],
  employment_status: ["employmentStatus", "membershipStatus"],
  first_name: ["firstName"],
  full_name: "always",
  last_name: ["lastName"],
  member_type: ["memberType"],
  // Being in the monthly file means "member" unless a status column says otherwise.
  membership_status: "always",
  position: ["position"],
  section: ["section"],
  title_prefix: ["titlePrefix"],
  work_line: ["workLine"],
};

/**
 * Fields the file actually carries. A file without an "อีเมล" column must not wipe every email in
 * the directory, so the stored rows (and the upsert) only include these fields.
 */
export function presentDirectoryFields(columns: Partial<Record<DirectoryHeaderKey, number>>): DirectoryImportField[] {
  return directoryImportFields.filter((field) => {
    const sources = fieldSources[field];
    return sources === "always" || sources.some((key) => columns[key] !== undefined);
  });
}

/** Incoming row as stored in the preview: employee code + the fields present in the file. */
export type ImportRow = Pick<DirectoryRow, "employee_code" | "full_name"> & Partial<Omit<DirectoryRow, "employee_code" | "full_name">>;

export function pickPresentFields(row: DirectoryRow, fields: readonly DirectoryImportField[]): ImportRow {
  const picked: Record<string, unknown> = { employee_code: row.employee_code, full_name: row.full_name };
  for (const field of fields) picked[field] = row[field];
  return picked as ImportRow;
}

export type CurrentDirectoryRow = {
  archived_at?: string | null;
  employee_code: string;
  full_name: string;
  id: string;
  membership_status?: string | null;
} & Partial<Record<Exclude<DirectoryImportField, "full_name" | "membership_status">, string | null>>;

export type LinkedMember = {
  archived_at?: string | null;
  employee_directory_id: string | null;
  employee_match_detail?: { reason?: string | null } | null;
  employee_match_status?: string | null;
  full_name: string;
  id: string;
  member_code?: string | null;
  status: string;
};

export type FieldChange = { after: string | null; before: string | null; field: DirectoryImportField; label: string };

export type ChangedRow = { changes: FieldChange[]; currentId: string; row: ImportRow };

export type AffectedMember = {
  directoryCode: string;
  fullName: string;
  id: string;
  memberCode: string | null;
  /** Why the member is flagged: the code is not in the file, or the file says not active. */
  reason: "left_file" | "not_active_in_file" | "archived";
};

export type DirectoryPreview = {
  added: ImportRow[];
  changed: ChangedRow[];
  deactivated: CurrentDirectoryRow[];
  flagged: AffectedMember[];
  /** Archived rows that are in the file again (counted in `added`). */
  reappeared: number;
  restored: AffectedMember[];
  unchanged: number;
};

function clean(value: string | null | undefined) {
  const text = (value ?? "").trim();
  return text ? text : null;
}

function comparable(field: DirectoryImportField, value: string | null | undefined) {
  const text = clean(value);
  if (text === null) return field === "membership_status" ? "active" : null;
  if (field === "email" || field === "association_member_code") return text.toLowerCase();
  return text.replace(/\s+/g, " ");
}

function normalizeCode(code: string) {
  return code.replace(/\s+/g, "").toUpperCase();
}

export function computeDirectoryPreview({
  current,
  incoming,
  members,
  mode,
}: {
  current: CurrentDirectoryRow[];
  incoming: ImportRow[];
  members: LinkedMember[];
  mode: ImportMode;
}): DirectoryPreview {
  const currentByCode = new Map(current.map((row) => [normalizeCode(row.employee_code), row]));
  const incomingCodes = new Set<string>();
  const added: ImportRow[] = [];
  const changed: ChangedRow[] = [];
  let unchanged = 0;
  let reappeared = 0;

  // Directory row id → its state after the import.
  const after = new Map<string, { active: boolean; archived: boolean; code: string; inFile: boolean }>();

  for (const row of incoming) {
    const code = normalizeCode(row.employee_code);
    incomingCodes.add(code);
    const existing = currentByCode.get(code);
    const membership = comparable("membership_status", row.membership_status);
    if (!existing) {
      added.push(row);
      continue;
    }
    after.set(existing.id, {
      active: (row.membership_status === undefined ? comparable("membership_status", existing.membership_status) : membership) === "active",
      archived: false,
      code: existing.employee_code,
      inFile: true,
    });
    if (existing.archived_at) {
      reappeared += 1;
      added.push(row);
      continue;
    }
    const changes: FieldChange[] = [];
    for (const field of directoryImportFields) {
      if (!(field in row)) continue;
      const before = (existing as Record<string, string | null | undefined>)[field];
      const next = (row as Record<string, string | null | undefined>)[field];
      if (comparable(field, before) !== comparable(field, next)) {
        changes.push({ after: clean(next), before: clean(before), field, label: directoryFieldLabels[field] });
      }
    }
    if (changes.length) changed.push({ changes, currentId: existing.id, row });
    else unchanged += 1;
  }

  const deactivated: CurrentDirectoryRow[] = [];
  for (const row of current) {
    if (after.has(row.id)) continue;
    const code = normalizeCode(row.employee_code);
    const status = comparable("membership_status", row.membership_status);
    const archived = Boolean(row.archived_at);
    const willDeactivate = mode === "replace" && !archived && !incomingCodes.has(code) && status !== "inactive";
    if (willDeactivate) deactivated.push(row);
    after.set(row.id, {
      active: willDeactivate ? false : status === "active",
      archived,
      code: row.employee_code,
      inFile: false,
    });
  }

  const flagged: AffectedMember[] = [];
  const restored: AffectedMember[] = [];
  if (mode === "replace") {
    for (const member of members) {
      if (member.archived_at || !member.employee_directory_id) continue;
      const linked = after.get(member.employee_directory_id);
      if (!linked) continue;
      const base = {
        directoryCode: linked.code,
        fullName: member.full_name,
        id: member.id,
        memberCode: member.member_code ?? null,
      };
      const leaves = linked.archived || !linked.active;
      if (leaves && member.status === "active" && member.employee_match_status !== "mismatch") {
        flagged.push({ ...base, reason: linked.archived ? "archived" : linked.inFile ? "not_active_in_file" : "left_file" });
      } else if (!leaves && member.employee_match_detail?.reason === "left_directory") {
        restored.push({ ...base, reason: "left_file" });
      }
    }
  }

  const byName = (a: { full_name: string }, b: { full_name: string }) => a.full_name.localeCompare(b.full_name, "th");
  return {
    added: added.sort(byName),
    changed: changed.sort((a, b) => byName(a.row, b.row)),
    deactivated: deactivated.sort(byName),
    flagged: flagged.sort((a, b) => a.fullName.localeCompare(b.fullName, "th")),
    reappeared,
    restored: restored.sort((a, b) => a.fullName.localeCompare(b.fullName, "th")),
    unchanged,
  };
}

/** "เพิ่ม 12 · แก้ 3 · ไม่เปลี่ยน 480 · จะพ้นสภาพ 5 คน · สมาชิกชมรมต้องตรวจ 2 คน · คืนสถานะ 1 คน" */
export function summarizeDirectoryPreview(preview: DirectoryPreview, mode: ImportMode) {
  const n = (value: number) => value.toLocaleString("th-TH");
  const parts = [`เพิ่ม ${n(preview.added.length)}`, `แก้ ${n(preview.changed.length)}`, `ไม่เปลี่ยน ${n(preview.unchanged)}`];
  if (mode === "replace") {
    parts.push(`จะพ้นสภาพ ${n(preview.deactivated.length)} คน`);
    parts.push(`สมาชิกชมรมต้องตรวจ ${n(preview.flagged.length)} คน`);
    if (preview.restored.length) parts.push(`คืนสถานะ ${n(preview.restored.length)} คน`);
  }
  return parts.join(" · ");
}

/** Accepts the jsonb `rows` column back as ImportRow[] (drops anything malformed). */
export function parseStoredRows(value: unknown): ImportRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is ImportRow =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as ImportRow).employee_code === "string" &&
      typeof (row as ImportRow).full_name === "string" &&
      Boolean((row as ImportRow).employee_code),
  );
}
