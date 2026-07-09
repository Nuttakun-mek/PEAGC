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

  const { data: member, error } = await supabase
    .from("members")
    .insert({
      ...payload,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !member) {
    redirectMembers("create-failed");
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
    redirectMembers("update-failed", memberId);
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
  const update = {
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
    redirectMembers("approve-failed", memberId);
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

  redirectMembers("approved", memberId);
}
