"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function getNumberOrNull(formData: FormData, key: string) {
  const value = getString(formData, key);

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getEmployeeMatchDetail({
  affiliation,
  department,
  directory,
  email,
  fullName,
}: {
  affiliation: string;
  department: string;
  directory: {
    affiliation: string | null;
    department: string | null;
    email: string | null;
    employment_status: string;
    full_name: string;
    id: string;
  } | null;
  email: string | null;
  fullName: string;
}) {
  if (!directory) {
    return {
      directoryId: null,
      detail: { reason: "employee_code_not_found" },
      status: "not_found",
    };
  }

  const checks = {
    activeEmployee: directory.employment_status === "active",
    affiliation: !directory.affiliation || normalize(directory.affiliation) === normalize(affiliation),
    department: !directory.department || normalize(directory.department) === normalize(department),
    email: !directory.email || normalize(directory.email) === normalize(email),
    fullName: normalize(directory.full_name) === normalize(fullName),
  };
  const status = Object.values(checks).every(Boolean) ? "matched" : "mismatch";

  return {
    directoryId: directory.id,
    detail: {
      checks,
      directory: {
        affiliation: directory.affiliation,
        department: directory.department,
        email: directory.email,
        employment_status: directory.employment_status,
        full_name: directory.full_name,
      },
    },
    status,
  };
}

export async function savePersonalProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  const displayName = getString(formData, "displayName");
  const fullName = getString(formData, "fullName");
  const nickname = getString(formData, "nickname");
  const phone = getString(formData, "phone");
  const lineId = getString(formData, "lineId");
  const employeeCode = getString(formData, "employeeCode");
  const department = getString(formData, "department");
  const affiliation = getString(formData, "affiliation");
  const organization = getString(formData, "organization");
  const handicap = getNumberOrNull(formData, "handicap");
  const skillLevel = getString(formData, "skillLevel");

  if (!displayName || !fullName || !phone || !employeeCode || !department || !affiliation) {
    redirect("/profile?status=missing-required");
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    display_name: displayName,
    id: user.id,
    line_id: lineId || null,
    phone,
    updated_at: new Date().toISOString(),
  });

  if (profileError) {
    redirect("/profile?status=profile-failed");
  }

  const { data: club, error: clubError } = await supabase
    .from("clubs")
    .select("id")
    .eq("status", "active")
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (clubError || !club) {
    redirect("/profile?status=no-club");
  }

  const admin = createAdminClient();
  const { data: directory } = await admin
    .from("employee_directory")
    .select("id, full_name, email, department, affiliation, employment_status")
    .eq("club_id", club.id)
    .eq("employee_code", employeeCode)
    .is("archived_at", null)
    .maybeSingle();
  const employeeMatch = getEmployeeMatchDetail({
    affiliation,
    department,
    directory,
    email: user.email ?? null,
    fullName,
  });

  const { error: memberError } = await supabase.from("members").upsert(
    {
      club_id: club.id,
      email: user.email,
      affiliation,
      department,
      employee_code: employeeCode,
      employee_directory_id: employeeMatch.directoryId,
      employee_match_checked_at: new Date().toISOString(),
      employee_match_detail: employeeMatch.detail,
      employee_match_status: employeeMatch.status,
      full_name: fullName,
      handicap,
      line_id: lineId || null,
      nickname: nickname || null,
      organization: organization || null,
      phone,
      skill_level: skillLevel || null,
      status: "pending_verification",
      updated_by: user.id,
      user_id: user.id,
      verification_note: null,
    },
    { onConflict: "club_id,user_id" },
  );

  if (memberError) {
    redirect("/profile?status=member-failed");
  }

  redirect("/member?status=pending-review");
}
