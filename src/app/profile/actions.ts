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

function normalizePersonName(value: string | null | undefined) {
  return normalize(value)
    .replace(/^(นาย|นางสาว|นาง|ดร\.|ดร)\s*/, "")
    .replace(/[.]/g, "");
}

function getAvatarFile(formData: FormData) {
  const file = formData.get("avatar");

  if (!(file instanceof File) || file.size === 0) {
    return null;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return { error: "invalid-avatar-type" as const, file: null };
  }

  if (file.size > 5 * 1024 * 1024) {
    return { error: "avatar-too-large" as const, file: null };
  }

  return { error: null, file };
}

function getEmployeeMatchDetail({
  directory,
  email,
  fullName,
}: {
  directory: {
    affiliation: string | null;
    bureau?: string | null;
    department: string | null;
    division?: string | null;
    email: string | null;
    employment_status: string;
    first_name?: string | null;
    full_name: string;
    id: string;
    last_name?: string | null;
    position?: string | null;
    section?: string | null;
    title_prefix?: string | null;
    work_line?: string | null;
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
    email: !directory.email || normalize(directory.email) === normalize(email),
    fullName:
      normalizePersonName(directory.full_name) === normalizePersonName(fullName),
  };
  const status = Object.values(checks).every(Boolean) ? "matched" : "mismatch";

  return {
    directoryId: directory.id,
    detail: {
      checks,
      directory: {
        affiliation: directory.affiliation,
        bureau: directory.bureau,
        department: directory.department,
        division: directory.division,
        email: directory.email,
        employment_status: directory.employment_status,
        first_name: directory.first_name,
        full_name: directory.full_name,
        last_name: directory.last_name,
        position: directory.position,
        section: directory.section,
        title_prefix: directory.title_prefix,
        work_line: directory.work_line,
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
  const avatarInput = getAvatarFile(formData);

  if (!displayName || !fullName || !phone || !employeeCode) {
    redirect("/profile?status=missing-required");
  }

  if (avatarInput?.error) {
    redirect(`/profile?status=${avatarInput.error}`);
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
    .select("id, title_prefix, first_name, last_name, full_name, email, position, work_line, bureau, division, department, section, affiliation, employment_status")
    .eq("club_id", club.id)
    .eq("employee_code", employeeCode)
    .is("archived_at", null)
    .maybeSingle();
  const employeeMatch = getEmployeeMatchDetail({
    directory,
    email: user.email ?? null,
    fullName,
  });
  const verifiedDirectory =
    employeeMatch.status === "matched" && directory ? directory : null;
  const { data: existingMember } = await admin
    .from("members")
    .select("employee_code, member_code, status")
    .eq("club_id", club.id)
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();
  const keepApprovedStatus =
    existingMember?.status === "active" &&
    existingMember.employee_code === employeeCode &&
    employeeMatch.status === "matched";
  const isAutomaticallyApproved =
    employeeMatch.status === "matched" || keepApprovedStatus;
  const memberCode = existingMember?.member_code ?? null;
  let avatarUrl: string | null = null;

  if (avatarInput?.file) {
    const extension = avatarInput.file.type.split("/")[1] ?? "jpg";
    const objectPath = `${club.id}/${user.id}/${Date.now()}.${extension}`;
    const { error: uploadError } = await admin.storage
      .from("member-avatars")
      .upload(objectPath, avatarInput.file, {
        contentType: avatarInput.file.type,
        upsert: true,
      });

    if (uploadError) {
      redirect("/profile?status=avatar-upload-failed");
    }

    const { data: publicUrl } = admin.storage
      .from("member-avatars")
      .getPublicUrl(objectPath);

    avatarUrl = publicUrl.publicUrl;
  }

  const memberPayload = {
      avatar_url: avatarUrl || undefined,
      bureau: verifiedDirectory?.bureau ?? null,
      club_id: club.id,
      email: user.email,
      affiliation: verifiedDirectory?.affiliation ?? affiliation,
      department: verifiedDirectory?.department ?? department,
      division: verifiedDirectory?.division ?? null,
      employee_code: employeeCode,
      employee_directory_id: employeeMatch.directoryId,
      employee_match_checked_at: new Date().toISOString(),
      employee_match_detail: employeeMatch.detail,
      employee_match_status: employeeMatch.status,
      first_name: verifiedDirectory?.first_name ?? null,
      full_name: verifiedDirectory?.full_name ?? fullName,
      handicap,
      last_name: verifiedDirectory?.last_name ?? null,
      line_id: lineId || null,
      member_code: memberCode,
      nickname: nickname || null,
      organization: organization || null,
      phone,
      position: verifiedDirectory?.position ?? null,
      section: verifiedDirectory?.section ?? null,
      skill_level: skillLevel || null,
      status: isAutomaticallyApproved ? "active" : "pending_verification",
      title_prefix: verifiedDirectory?.title_prefix ?? null,
      updated_by: user.id,
      user_id: user.id,
      verification_note: isAutomaticallyApproved
        ? "ตรวจสอบอัตโนมัติจากฐานข้อมูลพนักงาน"
        : null,
      verified_at: isAutomaticallyApproved ? new Date().toISOString() : null,
      work_line: verifiedDirectory?.work_line ?? null,
    };
  const { error: memberError } = await supabase.from("members").upsert(
    memberPayload,
    { onConflict: "club_id,user_id" },
  );

  if (memberError) {
    redirect("/profile?status=member-failed");
  }

  if (avatarUrl) {
    await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", user.id);
  }

  redirect(
    isAutomaticallyApproved
      ? "/member?status=profile-approved"
      : "/member?status=pending-review",
  );
}
