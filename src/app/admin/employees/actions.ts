"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { parseDirectoryGrid } from "@/lib/directory/import";
import * as XLSX from "xlsx";

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

function getEmployeePayload(formData: FormData, clubId: string, userId: string) {
  const employeeCode = getString(formData, "employeeCode");
  const fullName = getString(formData, "fullName");

  if (!employeeCode || !fullName) {
    return null;
  }

  return {
    affiliation: getString(formData, "affiliation") || null,
    bureau: getString(formData, "bureau") || null,
    club_id: clubId,
    department: getString(formData, "department") || null,
    division: getString(formData, "division") || null,
    email: getString(formData, "email").toLowerCase() || null,
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
  };
}

export async function createEmployee(formData: FormData) {
  const { clubId, supabase, userId } = await requireEmployeeAdminClub();
  const payload = getEmployeePayload(formData, clubId, userId);

  if (!payload) {
    redirectEmployees("missing-required");
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
    redirectEmployees("create-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "employee_directory.created",
    actor_user_id: userId,
    after_data: payload,
    club_id: clubId,
    entity_id: employee.id,
    entity_type: "employee_directory",
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
  const payload = getEmployeePayload(formData, clubId, userId);

  if (!payload) {
    redirectEmployees("missing-required", employeeId);
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
    redirectEmployees("update-failed", employeeId);
  }

  await supabase.from("audit_logs").insert({
    action: "employee_directory.updated",
    actor_user_id: userId,
    after_data: payload,
    before_data: before,
    club_id: clubId,
    entity_id: employeeId,
    entity_type: "employee_directory",
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
  return parseDelimitedText(await file.text());
}

export async function importEmployees(formData: FormData) {
  const file = formData.get("employeeFile");

  if (!(file instanceof File) || file.size === 0) {
    redirectEmployees("import-missing-file");
  }
  if (file.size > 15 * 1024 * 1024) {
    redirectEmployees("import-too-large");
  }

  const { clubId, supabase, userId } = await requireEmployeeAdminClub();
  const replaceMode = formData.get("replaceMode") === "on";
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

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileType = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls") ? "xlsx" : "csv";
  const payloads = parsed.rows.map((row) => ({
    ...row,
    club_id: clubId,
    created_by: userId,
    import_batch_id: batchId,
    last_synced_at: now,
    source: replaceMode ? "association_monthly" : "employee_import",
    updated_by: userId,
    archived_at: null,
  }));

  // Upsert in chunks so a large monthly file does not hit request limits.
  for (let index = 0; index < payloads.length; index += 500) {
    const { error } = await supabase
      .from("employee_directory")
      .upsert(payloads.slice(index, index + 500), { onConflict: "club_id,employee_code" });
    if (error) {
      redirectEmployees("import-failed");
    }
  }

  let deactivated = 0;
  let flagged = 0;
  if (replaceMode) {
    const { data, error } = await supabase.rpc("finalize_directory_replace", { p_batch_id: batchId, p_club_id: clubId });
    if (error) {
      redirectEmployees("import-finalize-failed");
    }
    const result = data as { deactivated: number; flagged: number } | null;
    deactivated = result?.deactivated ?? 0;
    flagged = result?.flagged ?? 0;
  }

  await supabase.from("directory_imports").insert({
    club_id: clubId,
    deactivated_count: deactivated,
    file_name: file.name,
    file_type: fileType,
    flagged_member_count: flagged,
    id: batchId,
    imported_by: userId,
    imported_count: payloads.length,
    mode: replaceMode ? "replace" : "merge",
    row_count: parsed.totalRows,
    skipped_count: parsed.skipped,
  });

  await supabase.from("audit_logs").insert({
    action: "employee_directory.imported",
    actor_user_id: userId,
    after_data: {
      batch_id: batchId,
      deactivated_count: deactivated,
      flagged_member_count: flagged,
      imported_count: payloads.length,
      mode: replaceMode ? "replace" : "merge",
      skipped_count: parsed.skipped,
      source_file_name: file.name,
    },
    club_id: clubId,
    entity_id: batchId,
    entity_type: "employee_directory",
    metadata: { source: "admin.employees.import" },
  });

  redirectEmployees(`imported:${payloads.length}:${parsed.skipped}:${deactivated}:${flagged}`);
}
