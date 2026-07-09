"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const employeeAdminRoles = ["platform_owner", "club_admin"];

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
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
    club_id: clubId,
    department: getString(formData, "department") || null,
    email: getString(formData, "email").toLowerCase() || null,
    employee_code: employeeCode,
    employment_status: getString(formData, "employmentStatus") || "active",
    full_name: fullName,
    source: getString(formData, "source") || "manual",
    updated_by: userId,
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
