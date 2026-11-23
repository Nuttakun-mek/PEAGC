"use server";

import * as XLSX from "xlsx";

import { recordAudit } from "@/lib/audit";
import { parseDirectoryGrid } from "@/lib/directory/import";
import { type ImportMode, type ImportRow, parseStoredRows, pickPresentFields, presentDirectoryFields } from "@/lib/directory/preview";
import { redirectAfterAction as redirect } from "@/lib/navigation";
import { classifyDbError, failureStatus, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail, normalizeEmployeeCode } from "@/lib/validation";
import { anyCorruptedText, decodeTextFile, hasCorruptedText } from "@/lib/text-integrity";

const employeeAdminRoles = ["platform_owner", "club_admin"];
function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseDelimitedText(text: string) {
  const rows: string[][] = [];
  const delimiter = text.includes("\t") ? "\t" : ",";
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell.trim());
      cell = "";

      if (row.some(Boolean)) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());

  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function redirectEmployees(status: string, employeeId?: string): never {
  const params = new URLSearchParams({ status });

  if (employeeId) {
    params.set("employee", employeeId);
  }

  redirect(`/admin/employees?${params.toString()}`);
}

async function requireEmployeeAdminClub() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/employees");
  }

  const { data: role, error } = await supabase
    .from("user_roles")
    .select("club_id, role_key")
    .eq("user_id", user.id)
    .in("role_key", employeeAdminRoles)
    .limit(1)
    .maybeSingle();

  if (error || !role) {
    redirect("/member?status=admin-required");
  }

  return { clubId: role.club_id as string, supabase, userId: user.id };
}

/** Form values → row, or the `?status=` key of the first invalid field. */
function getEmployeePayload(formData: FormData, clubId: string, userId: string) {
  // Same normalisation as the file import, so " uat 001" and "UAT001" are one employee.
  const employeeCode = normalizeEmployeeCode(getString(formData, "employeeCode"));
  const fullName = getString(formData, "fullName");

  if (!employeeCode || !fullName) {
    return { error: "missing-required", payload: null } as const;
  }

  const email = normalizeEmail(getString(formData, "email"));
  if (!email.ok) {
    return { error: "email-invalid", payload: null } as const;
  }

  return { error: null, payload: {
    affiliation: getString(formData, "affiliation") || null,
    bureau: getString(formData, "bureau") || null,
    club_id: clubId,
    department: getString(formData, "department") || null,
    division: getString(formData, "division") || null,
    email: email.value,
    employee_code: employeeCode,
    employment_status: getString(formData, "employmentStatus") || "active",
    association_member_code: getString(formData, "associationMemberCode") || null,
    member_type: getString(formData, "memberType") || null,
    membership_status: getString(formData, "membershipStatus") || "active",
    first_name: getString(formData, "firstName") || null,
    full_name: fullName,
    last_name: getString(formData, "lastName") || null,
    position: getString(formData, "position") || null,
    section: getString(formData, "section") || null,
    source: getString(formData, "source") || "manual",
    title_prefix: getString(formData, "titlePrefix") || null,
    updated_by: userId,
    work_line: getString(formData, "workLine") || null,
  } };
}

/** Employee codes are unique per club (DB constraint); say so instead of a generic error. */
function duplicateCodeStatus(error: { code?: string } | null, fallback: string) {
  return error?.code === "23505" ? "employee-code-taken" : failureStatus(fallback, error);
}

export async function createEmployee(formData: FormData) {
  const { clubId, supabase, userId } = await requireEmployeeAdminClub();
  const parsed = getEmployeePayload(formData, clubId, userId);

  if (!parsed.payload) {
    redirectEmployees(parsed.error);
  }
  const { payload } = parsed;
  if (anyCorruptedText([payload.full_name, payload.first_name, payload.last_name, payload.department, payload.affiliation])) {
    redirectEmployees("text-corrupted");
  }

  const { data: employee, error } = await supabase
    .from("employee_directory")
    .insert({
      ...payload,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !employee) {
    logDbError("employee_directory.create", error);
    redirectEmployees(duplicateCodeStatus(error, "create-failed"));
  }

  await recordAudit(supabase, {
    action: "employee_directory.created",
    actorUserId: userId,
    after: payload,
    clubId,
    entityId: employee.id,
    entityType: "employee_directory",
    metadata: { source: "admin.employees" },
  });

  redirectEmployees("created", employee.id);
}

export async function updateEmployee(formData: FormData) {
  const employeeId = getString(formData, "employeeId");

  if (!employeeId) {
    redirectEmployees("missing-required");
  }

  const { clubId, supabase, userId } = await requireEmployeeAdminClub();
  const parsed = getEmployeePayload(formData, clubId, userId);

  if (!parsed.payload) {
    redirectEmployees(parsed.error, employeeId);
  }
  const { payload } = parsed;
  if (anyCorruptedText([payload.full_name, payload.first_name, payload.last_name, payload.department, payload.affiliation])) {
    redirectEmployees("text-corrupted", employeeId);
  }

  const { data: before } = await supabase
    .from("employee_directory")
    .select("*")
    .eq("club_id", clubId)
    .eq("id", employeeId)
    .maybeSingle();
  const { error } = await supabase
    .from("employee_directory")
    .update(payload)
    .eq("club_id", clubId)
    .eq("id", employeeId);

  if (error) {
    logDbError("employee_directory.update", error);
    redirectEmployees(duplicateCodeStatus(error, "update-failed"), employeeId);
  }

  await recordAudit(supabase, {
    action: "employee_directory.updated",
    actorUserId: userId,
    after: payload,
    before,
    clubId,
    entityId: employeeId,
    entityType: "employee_directory",
    metadata: { source: "admin.employees" },
  });

  redirectEmployees("updated", employeeId);
}

async function readUploadGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
    const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return [];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { blankrows: false, defval: "", header: 1, raw: false });
    return grid.map((row) => row.map((cell) => String(cell ?? "").trim()));
  }
  // Thai Excel saves "CSV" as Windows-874; File.text() would read it as UTF-8 garbage.
  return parseDelimitedText(decodeTextFile(await file.arrayBuffer()).text);
}


type ImportContext = {
  clubId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

type ApplyInput = {
  fileName: string;
  fileType: "csv" | "xlsx";
  mode: ImportMode;
  previewId?: string | null;
  rows: ImportRow[];
  skipped: number;
  totalRows: number;
};

type ApplyResult =
  | { deactivated: number; flagged: number; importId: string | null; imported: number; ok: true; restored: number }
  | { ok: false; status: string };

/**
 * Writes parsed rows to the directory: upsert by employee code in chunks, then (replace mode)
 * `finalize_directory_replace` marks rows missing from the file inactive and flags/restores the
 * linked members. Rows only carry the fields present in the file, so a file without an email
 * column leaves existing emails alone.
 */
async function applyDirectoryRows({ clubId, supabase, userId }: ImportContext, input: ApplyInput): Promise<ApplyResult> {
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const payloads = input.rows.map((row) => ({
    ...row,
    archived_at: null,
    club_id: clubId,
    created_by: userId,
    import_batch_id: batchId,
    last_synced_at: now,
    source: input.mode === "replace" ? "association_monthly" : "employee_import",
    updated_by: userId,
  }));

  // Upsert in chunks so a large monthly file does not hit request limits.
  for (let index = 0; index < payloads.length; index += 500) {
    const { error } = await supabase
      .from("employee_directory")
      .upsert(payloads.slice(index, index + 500), { onConflict: "club_id,employee_code" });
    if (error) {
      logDbError("employee_directory.import", error);
      return { ok: false, status: failureStatus("import-failed", error) };
    }
  }

  let deactivated = 0;
  let flagged = 0;
  let restored = 0;
  if (input.mode === "replace") {
    const { data, error } = await supabase.rpc("finalize_directory_replace", { p_batch_id: batchId, p_club_id: clubId });
    if (error) {
      logDbError("employee_directory.finalize_replace", error);
      return { ok: false, status: failureStatus("import-finalize-failed", error) };
    }
    const result = data as { deactivated?: number; flagged?: number; restored?: number } | null;
    deactivated = result?.deactivated ?? 0;
    flagged = result?.flagged ?? 0;
    restored = result?.restored ?? 0;
  }

  const { error: importError } = await supabase.from("directory_imports").insert({
    club_id: clubId,
    deactivated_count: deactivated,
    file_name: input.fileName,
    file_type: input.fileType,
    flagged_member_count: flagged,
    id: batchId,
    imported_by: userId,
    imported_count: payloads.length,
    mode: input.mode,
    row_count: input.totalRows,
    skipped_count: input.skipped,
  });
  if (importError) logDbError("directory_imports.insert", importError);

  await recordAudit(supabase, {
    action: "employee_directory.imported",
    actorUserId: userId,
    after: {
      batch_id: batchId,
      deactivated_count: deactivated,
      flagged_member_count: flagged,
      imported_count: payloads.length,
      mode: input.mode,
      restored_count: restored,
      skipped_count: input.skipped,
      source_file_name: input.fileName,
    },
    clubId,
    entityId: batchId,
    entityType: "employee_directory",
    metadata: { preview_id: input.previewId ?? null, source: "admin.employees.import" },
  });

  return { deactivated, flagged, importId: importError ? null : batchId, imported: payloads.length, ok: true, restored };
}

function importedStatus(result: Extract<ApplyResult, { ok: true }>, skipped: number, suffix = "") {
  return `imported:${result.imported}:${skipped}:${result.deactivated}:${result.flagged}:${result.restored}${suffix}`;
}

/**
 * Step 1 of the monthly import: read and check the file, then keep the parsed rows as a preview
 * (one hour) and show what would change. Nothing is written to the directory here.
 */
export async function importEmployees(formData: FormData) {
  const file = formData.get("employeeFile");

  if (!(file instanceof File) || file.size === 0) {
    redirectEmployees("import-missing-file");
  }
  if (file.size > 15 * 1024 * 1024) {
    redirectEmployees("import-too-large");
  }

  const context = await requireEmployeeAdminClub();
  const { clubId, supabase, userId } = context;
  const mode: ImportMode = formData.get("replaceMode") === "on" ? "replace" : "merge";
  let grid: string[][] = [];
  try {
    grid = await readUploadGrid(file);
  } catch {
    redirectEmployees("import-unreadable");
  }

  const parsed = parseDirectoryGrid(grid);
  if ("error" in parsed) {
    redirectEmployees("import-missing-employee-code");
  }
  if (!parsed.rows.length) {
    redirectEmployees("import-empty");
  }
  // Text that is already "???" in the file cannot be repaired after import; stop before it
  // overwrites good names in the directory.
  if (parsed.rows.some((row) => hasCorruptedText(row.full_name) || hasCorruptedText(row.first_name) || hasCorruptedText(row.last_name))) {
    redirectEmployees("import-text-corrupted");
  }

  const lowerName = file.name.toLowerCase();
  const fileType = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsm") ? "xlsx" : "csv";
  const fields = presentDirectoryFields(parsed.columns);
  const rows = parsed.rows.map((row) => pickPresentFields(row, fields));

  // Previews live one hour; clear this club's old ones before adding a new one.
  const { error: cleanupError } = await supabase
    .from("directory_import_previews")
    .delete()
    .eq("club_id", clubId)
    .lt("expires_at", new Date().toISOString());
  if (cleanupError && classifyDbError(cleanupError) !== "schema-outdated") {
    logDbError("directory_import_previews.cleanup", cleanupError);
  }

  const { data: preview, error } = await supabase
    .from("directory_import_previews")
    .insert({
      club_id: clubId,
      created_by: userId,
      file_name: file.name,
      file_type: fileType,
      mode,
      row_count: parsed.totalRows,
      rows,
      skipped_count: parsed.skipped,
    })
    .select("id")
    .single();

  if (error || !preview) {
    if (classifyDbError(error) === "schema-outdated") {
      // The preview table is not in this database yet. Replacing everyone without a preview is
      // too risky; a merge only adds/updates the rows in the file, as before.
      if (mode === "replace") {
        redirectEmployees("import-db-outdated");
      }
      const result = await applyDirectoryRows(context, {
        fileName: file.name,
        fileType,
        mode,
        rows,
        skipped: parsed.skipped,
        totalRows: parsed.totalRows,
      });
      if (!result.ok) redirectEmployees(result.status);
      redirectEmployees(importedStatus(result, parsed.skipped, ":direct"));
    }
    logDbError("directory_import_previews.insert", error);
    redirectEmployees(failureStatus("preview-failed", error));
  }

  redirect(`/admin/employees?preview=${preview.id}#import`);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Step 2: apply a preview the admin has checked. Each preview can be applied once. */
export async function confirmDirectoryImport(formData: FormData) {
  const previewId = getString(formData, "previewId");
  if (!UUID_PATTERN.test(previewId)) {
    redirectEmployees("preview-not-found");
  }

  const context = await requireEmployeeAdminClub();
  const { clubId, supabase } = context;

  // Claim it first so a double click (or a second admin) cannot import the same file twice.
  const { data: claimed, error: claimError } = await supabase
    .from("directory_import_previews")
    .update({ status: "applying" })
    .eq("id", previewId)
    .eq("club_id", clubId)
    .eq("status", "preview")
    .gt("expires_at", new Date().toISOString())
    .select("id, file_name, file_type, mode, row_count, skipped_count, rows")
    .maybeSingle();

  if (claimError) {
    logDbError("directory_import_previews.claim", claimError);
    redirectEmployees(failureStatus("import-failed", claimError));
  }
  if (!claimed) {
    const { data: existing } = await supabase
      .from("directory_import_previews")
      .select("status")
      .eq("id", previewId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (!existing) redirectEmployees("preview-not-found");
    if (existing.status === "applied" || existing.status === "applying") redirectEmployees("preview-used");
    if (existing.status === "cancelled") redirectEmployees("preview-cancelled");
    redirectEmployees("preview-expired");
  }

  const rows = parseStoredRows(claimed.rows);
  const mode: ImportMode = claimed.mode === "replace" ? "replace" : "merge";
  const release = () => supabase.from("directory_import_previews").update({ status: "preview" }).eq("id", previewId).eq("club_id", clubId);

  if (!rows.length) {
    await release();
    redirectEmployees("import-empty");
  }

  const result = await applyDirectoryRows(context, {
    fileName: claimed.file_name,
    fileType: claimed.file_type === "xlsx" ? "xlsx" : "csv",
    mode,
    previewId,
    rows,
    skipped: claimed.skipped_count ?? 0,
    totalRows: claimed.row_count ?? rows.length,
  });

  if (!result.ok) {
    // Upserts are idempotent; let the admin press "ยืนยันนำเข้า" again.
    await release();
    redirect(`/admin/employees?preview=${previewId}&status=${encodeURIComponent(result.status)}#import`);
  }

  const { error: doneError } = await supabase
    .from("directory_import_previews")
    .update({ applied_at: new Date().toISOString(), applied_import_id: result.importId, rows: [], status: "applied" })
    .eq("id", previewId)
    .eq("club_id", clubId);
  if (doneError) logDbError("directory_import_previews.applied", doneError);

  redirectEmployees(importedStatus(result, claimed.skipped_count ?? 0));
}

/** Drop a preview without importing it. */
export async function cancelDirectoryImport(formData: FormData) {
  const previewId = getString(formData, "previewId");
  if (!UUID_PATTERN.test(previewId)) {
    redirectEmployees("preview-not-found");
  }
  const { clubId, supabase } = await requireEmployeeAdminClub();
  const { error } = await supabase
    .from("directory_import_previews")
    .update({ rows: [], status: "cancelled" })
    .eq("id", previewId)
    .eq("club_id", clubId)
    .eq("status", "preview");
  if (error) {
    logDbError("directory_import_previews.cancel", error);
    redirectEmployees(failureStatus("preview-failed", error));
  }
  redirectEmployees("preview-cancelled");
}
