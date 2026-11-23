import "server-only";

import {
  type CurrentDirectoryRow,
  type DirectoryPreview,
  type ImportMode,
  type ImportRow,
  type LinkedMember,
  computeDirectoryPreview,
  parseStoredRows,
} from "@/lib/directory/preview";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export type ImportPreviewMeta = {
  createdAt: string;
  expiresAt: string;
  fileName: string;
  id: string;
  mode: ImportMode;
  rowCount: number;
  skipped: number;
};

export type ImportPreviewState =
  | { diff: DirectoryPreview; meta: ImportPreviewMeta; state: "ready" }
  | { meta: ImportPreviewMeta | null; state: "applied" | "cancelled" | "expired" }
  | { state: "error" | "not-found" | "outdated" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const directoryColumns =
  "id, employee_code, full_name, title_prefix, first_name, last_name, association_member_code, member_type, membership_status, employment_status, email, position, work_line, bureau, division, department, section, affiliation, archived_at";

/** Loads a stored preview and diffs it against the directory and linked members as they are now. */
export async function loadImportPreview(supabase: Client, clubId: string, previewId: string): Promise<ImportPreviewState> {
  if (!UUID_PATTERN.test(previewId)) return { state: "not-found" };

  const { data: row, error } = await supabase
    .from("directory_import_previews")
    .select("id, file_name, mode, row_count, skipped_count, rows, status, created_at, expires_at")
    .eq("club_id", clubId)
    .eq("id", previewId)
    .maybeSingle();

  if (error) {
    logDbError("admin.employees preview", error);
    return { state: classifyDbError(error) === "schema-outdated" ? "outdated" : "error" };
  }
  if (!row) return { state: "not-found" };

  const meta: ImportPreviewMeta = {
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    fileName: row.file_name as string,
    id: row.id as string,
    mode: row.mode === "replace" ? "replace" : "merge",
    rowCount: Number(row.row_count ?? 0),
    skipped: Number(row.skipped_count ?? 0),
  };

  if (row.status === "applied" || row.status === "applying") return { meta, state: "applied" };
  if (row.status === "cancelled") return { meta, state: "cancelled" };
  if (Date.parse(meta.expiresAt) <= Date.now()) return { meta, state: "expired" };

  const incoming: ImportRow[] = parseStoredRows(row.rows);
  const [current, members] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from("employee_directory").select(directoryColumns).eq("club_id", clubId).order("id").range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("members")
        .select("id, full_name, member_code, status, archived_at, employee_match_status, employee_match_detail, employee_directory_id")
        .eq("club_id", clubId)
        .is("archived_at", null)
        .not("employee_directory_id", "is", null)
        .order("id")
        .range(from, to),
    ),
  ]);

  if (current.error || members.error) {
    logDbError("admin.employees preview directory", current.error);
    logDbError("admin.employees preview members", members.error);
    return { state: "error" };
  }

  const diff = computeDirectoryPreview({
    current: (current.data ?? []) as unknown as CurrentDirectoryRow[],
    incoming,
    members: (members.data ?? []) as unknown as LinkedMember[],
    mode: meta.mode,
  });

  return { diff, meta, state: "ready" };
}

/** Bypass preview (`?bypass=admin&preview=sample`): a realistic replace-mode file. */
export function sampleImportPreview(): ImportPreviewState {
  const now = Date.now();
  const diff: DirectoryPreview = {
    added: [
      { employee_code: "511204", full_name: "นายกิตติพงษ์ ศรีสุข", member_type: "สามัญ", membership_status: "active", position: "วิศวกร ระดับ 6" },
      { employee_code: "512877", full_name: "นางสาวพิมพ์ชนก แก้วมณี", member_type: "สามัญ", membership_status: "active", position: "นักบัญชี ระดับ 5" },
      { employee_code: "498761", full_name: "นายวีระ ทองดี", member_type: "สมทบ", membership_status: "active", position: "ช่างไฟฟ้า ระดับ 4" },
    ],
    changed: [
      {
        changes: [
          { after: "กองบริการลูกค้า", before: "กองมิเตอร์", field: "department", label: "หน่วยงาน (กอง)" },
          { after: "หัวหน้าแผนก ระดับ 8", before: "วิศวกร ระดับ 7", field: "position", label: "ตำแหน่ง" },
        ],
        currentId: "sample-employee-1",
        row: { employee_code: "497901", full_name: "สมาชิก ตัวอย่างหนึ่ง", membership_status: "active" },
      },
      {
        changes: [{ after: "suspended", before: "active", field: "membership_status", label: "สถานะสมาชิกสมาคม" }],
        currentId: "sample-employee-3",
        row: { employee_code: "503310", full_name: "นายประเสริฐ ใจงาม", membership_status: "suspended" },
      },
    ],
    deactivated: [
      { employee_code: "498000", full_name: "พนักงาน ไม่ใช้งาน", id: "sample-employee-2", membership_status: "active" },
      { employee_code: "487512", full_name: "นายสมศักดิ์ บุญมา", id: "sample-employee-4", membership_status: "active" },
    ],
    flagged: [
      { directoryCode: "487512", fullName: "นายสมศักดิ์ บุญมา", id: "sample-member-4", memberCode: "PEAGC-0012", reason: "left_file" },
      { directoryCode: "503310", fullName: "นายประเสริฐ ใจงาม", id: "sample-member-7", memberCode: "PEAGC-0031", reason: "not_active_in_file" },
    ],
    reappeared: 0,
    restored: [{ directoryCode: "490215", fullName: "นางวรรณา สายทอง", id: "sample-member-9", memberCode: "PEAGC-0008", reason: "left_file" }],
    unchanged: 482,
  };
  return {
    diff,
    meta: {
      createdAt: new Date(now - 5 * 60_000).toISOString(),
      expiresAt: new Date(now + 55 * 60_000).toISOString(),
      fileName: "รายชื่อสมาชิกสมาคม พ.ย. 2569.xlsx",
      id: "sample",
      mode: "replace",
      rowCount: 490,
      skipped: 1,
    },
    state: "ready",
  };
}
