"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const adminRoles = ["platform_owner", "club_admin", "committee"];

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

function getDateOrNull(formData: FormData, key: string) {
  const value = getString(formData, key);

  return value || null;
}

function normalizeMemberCode(value: string) {
  return value.trim().toUpperCase();
}

async function resolveMemberCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clubId: string,
  requestedCode: string,
) {
  const normalized = normalizeMemberCode(requestedCode);

  if (normalized) {
    if (!/^PEAGC-\d{4,}$/.test(normalized)) {
      return { code: null, error: "member-code-invalid" } as const;
    }

    return { code: normalized, error: null } as const;
  }

  const { data, error } = await supabase.rpc("next_member_code", {
    target_club_id: clubId,
  });

  if (error || typeof data !== "string") {
    return { code: null, error: "member-code-generate-failed" } as const;
  }

  return { code: data, error: null } as const;
}

function redirectMembers(status: string, memberId?: string): never {
  const params = new URLSearchParams({ status });

  if (memberId) {
    params.set("member", memberId);
  }

  redirect(`/admin/members?${params.toString()}`);
}

async function requireAdminClub() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/members");
  }

  const { data: role, error } = await supabase
    .from("user_roles")
    .select("club_id, role_key")
    .eq("user_id", user.id)
    .in("role_key", adminRoles)
    .limit(1)
    .maybeSingle();

  if (error || !role) {
    redirect("/member?status=admin-required");
  }

  return { clubId: role.club_id as string, supabase, userId: user.id };
}

function getMemberPayload(formData: FormData, clubId: string, userId: string) {
  const fullName = getString(formData, "fullName");

  if (!fullName) {
    return null;
  }

  return {
    club_id: clubId,
    affiliation: getString(formData, "affiliation") || null,
    department: getString(formData, "department") || null,
    email: getString(formData, "email") || null,
    employee_code: getString(formData, "employeeCode") || null,
    full_name: fullName,
    handicap: getNumberOrNull(formData, "handicap"),
    joined_at: getDateOrNull(formData, "joinedAt"),
    line_id: getString(formData, "lineId") || null,
    member_code: getString(formData, "memberCode") || null,
    member_type_id: getString(formData, "memberTypeId") || null,
    nickname: getString(formData, "nickname") || null,
    note: getString(formData, "note") || null,
    organization: getString(formData, "organization") || null,
    phone: getString(formData, "phone") || null,
    skill_level: getString(formData, "skillLevel") || null,
    status: getString(formData, "status") || "active",
    updated_by: userId,
  };
}

export async function createMember(formData: FormData) {
  const { clubId, supabase, userId } = await requireAdminClub();
  const payload = getMemberPayload(formData, clubId, userId);

  if (!payload) {
    redirectMembers("missing-required");
  }

  const memberCode = await resolveMemberCode(
    supabase,
    clubId,
    getString(formData, "memberCode"),
  );

  if (memberCode.error || !memberCode.code) {
    redirectMembers(memberCode.error ?? "member-code-generate-failed");
  }

  payload.member_code = memberCode.code;

  const { data: member, error } = await supabase
    .from("members")
    .insert({
      ...payload,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !member) {
    redirectMembers(error?.code === "23505" ? "member-code-taken" : "create-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "member.created",
    actor_user_id: userId,
    after_data: payload,
    club_id: clubId,
    entity_id: member.id,
    entity_type: "members",
    metadata: { source: "admin.members" },
  });

  redirectMembers("created", member.id);
}

export async function updateMember(formData: FormData) {
  const memberId = getString(formData, "memberId");

  if (!memberId) {
    redirectMembers("missing-required");
  }

  const { clubId, supabase, userId } = await requireAdminClub();
  const payload = getMemberPayload(formData, clubId, userId);

  if (!payload) {
    redirectMembers("missing-required", memberId);
  }

  const memberCode = await resolveMemberCode(
    supabase,
    clubId,
    getString(formData, "memberCode"),
  );

  if (memberCode.error || !memberCode.code) {
    redirectMembers(memberCode.error ?? "member-code-generate-failed", memberId);
  }

  payload.member_code = memberCode.code;

  const { data: before } = await supabase
    .from("members")
    .select("*")
    .eq("club_id", clubId)
    .eq("id", memberId)
    .maybeSingle();

  const { error } = await supabase
    .from("members")
    .update(payload)
    .eq("club_id", clubId)
    .eq("id", memberId);

  if (error) {
    redirectMembers(error.code === "23505" ? "member-code-taken" : "update-failed", memberId);
  }

  await supabase.from("audit_logs").insert({
    action: "member.updated",
    actor_user_id: userId,
    after_data: payload,
    before_data: before,
    club_id: clubId,
    entity_id: memberId,
    entity_type: "members",
    metadata: { source: "admin.members" },
  });

  redirectMembers("updated", memberId);
}

export async function approveMember(formData: FormData) {
  const memberId = getString(formData, "memberId");

  if (!memberId) {
    redirectMembers("missing-required");
  }

  const { clubId, supabase, userId } = await requireAdminClub();
  const { data: before } = await supabase
    .from("members")
    .select("*")
    .eq("club_id", clubId)
    .eq("id", memberId)
    .maybeSingle();
  const memberCode = await resolveMemberCode(
    supabase,
    clubId,
    getString(formData, "memberCode") || before?.member_code || "",
  );

  if (memberCode.error || !memberCode.code) {
    redirectMembers(memberCode.error ?? "member-code-generate-failed", memberId);
  }

  const update = {
    member_code: memberCode.code,
    status: "active",
    updated_by: userId,
    verification_note: getString(formData, "verificationNote") || null,
    verified_at: new Date().toISOString(),
    verified_by: userId,
  };
  const { error } = await supabase
    .from("members")
    .update(update)
    .eq("club_id", clubId)
    .eq("id", memberId);

  if (error) {
    redirectMembers(error.code === "23505" ? "member-code-taken" : "approve-failed", memberId);
  }

  await supabase.from("audit_logs").insert({
    action: "member.approved",
    actor_user_id: userId,
    after_data: update,
    before_data: before,
    club_id: clubId,
    entity_id: memberId,
    entity_type: "members",
    metadata: { source: "admin.members" },
  });

  if (before?.email) {
    await supabase.from("member_notifications").insert({
      body: `เรียน ${before.full_name} บัญชีสมาชิก PEAGC ของคุณได้รับการอนุมัติแล้ว สามารถเข้าสู่ระบบเพื่อจองเรียน สมัครกิจกรรม และดูข้อมูลสมาชิกได้`,
      channel: "email",
      club_id: clubId,
      created_by: userId,
      member_id: memberId,
      metadata: { source: "admin.members", trigger: "member.approved" },
      notification_type: "member_approved",
      recipient: before.email,
      status: "queued",
      subject: "PEAGC อนุมัติสมาชิกเรียบร้อยแล้ว",
      updated_by: userId,
    });
  }

  redirectMembers("approved", memberId);
}
