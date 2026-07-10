"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const employeeAdminRoles = ["platform_owner", "club_admin"];
const employeeHeaderAliases = {
  bureau: ["สำนัก", "bureau", "office"],
  department: ["กอง", "department", "division_group"],
  division: ["ฝ่าย", "division"],
  email: ["email", "อีเมล", "อีเมล์"],
  employeeCode: ["รหัสพนักงาน", "employee_code", "employee code", "code"],
  employmentStatus: ["สถานะ", "employment_status", "status"],
  firstName: ["ชื่อ", "first_name", "first name"],
  fullName: ["ชื่อ-นามสกุล", "ชื่อ นามสกุล", "full_name", "full name"],
  lastName: ["นามสกุล", "last_name", "last name"],
  position: ["ตำแหน่ง", "position"],
  section: ["แผนก", "section"],
  titlePrefix: ["คำนำหน้า", "title_prefix", "prefix", "title"],
  workLine: ["สายงาน", "work_line", "work line"],
} as const;

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
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

function getColumnIndex(headers: string[], aliases: readonly string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);

  return aliases
    .map((alias) => normalizedHeaders.indexOf(normalizeHeader(alias)))
    .find((index) => index >= 0);
}

function getRowValue(
  row: string[],
  columnIndexes: Record<keyof typeof employeeHeaderAliases, number | undefined>,
  key: keyof typeof employeeHeaderAliases,
) {
  const index = columnIndexes[key];

  if (index === undefined) {
    return "";
  }

  return (row[index] ?? "").trim();
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

export async function importEmployees(formData: FormData) {
  const file = formData.get("employeeFile");

  if (!(file instanceof File) || file.size === 0) {
    redirectEmployees("import-missing-file");
  }

  const { clubId, supabase, userId } = await requireEmployeeAdminClub();
  const rows = parseDelimitedText(await file.text());
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);

  if (!headers.length || !dataRows.length) {
    redirectEmployees("import-empty");
  }

  const columnIndexes = Object.fromEntries(
    Object.entries(employeeHeaderAliases).map(([key, aliases]) => [
      key,
      getColumnIndex(headers, aliases),
    ]),
  ) as Record<keyof typeof employeeHeaderAliases, number | undefined>;

  if (columnIndexes.employeeCode === undefined) {
    redirectEmployees("import-missing-employee-code");
  }

  const now = new Date().toISOString();
  const payloads = dataRows
    .map((row) => {
      const employeeCode = getRowValue(row, columnIndexes, "employeeCode");
      const titlePrefix = getRowValue(row, columnIndexes, "titlePrefix");
      const firstName = getRowValue(row, columnIndexes, "firstName");
      const lastName = getRowValue(row, columnIndexes, "lastName");
      const fullName =
        getRowValue(row, columnIndexes, "fullName") ||
        [titlePrefix, firstName, lastName].filter(Boolean).join(" ");

      if (!employeeCode || !fullName) {
        return null;
      }

      const workLine = getRowValue(row, columnIndexes, "workLine");
      const bureau = getRowValue(row, columnIndexes, "bureau");
      const division = getRowValue(row, columnIndexes, "division");
      const department = getRowValue(row, columnIndexes, "department");
      const section = getRowValue(row, columnIndexes, "section");

      return {
        affiliation: [workLine, bureau].filter(Boolean).join(" / ") || null,
        bureau: bureau || null,
        club_id: clubId,
        department: department || null,
        division: division || null,
        email: getRowValue(row, columnIndexes, "email").toLowerCase() || null,
        employee_code: employeeCode,
        employment_status:
          getRowValue(row, columnIndexes, "employmentStatus") || "active",
        first_name: firstName || null,
        full_name: fullName,
        last_name: lastName || null,
        last_synced_at: now,
        position: getRowValue(row, columnIndexes, "position") || null,
        section: section || null,
        source: "employee_import",
        title_prefix: titlePrefix || null,
        updated_by: userId,
        work_line: workLine || null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (!payloads.length) {
    redirectEmployees("import-empty");
  }

  const { error } = await supabase.from("employee_directory").upsert(
    payloads.map((payload) => ({
      ...payload,
      created_by: userId,
    })),
    { onConflict: "club_id,employee_code" },
  );

  if (error) {
    redirectEmployees("import-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "employee_directory.imported",
    actor_user_id: userId,
    after_data: {
      imported_count: payloads.length,
      source_file_name: file.name,
    },
    club_id: clubId,
    entity_type: "employee_directory",
    metadata: { source: "admin.employees.import" },
  });

  redirectEmployees("imported");
}
