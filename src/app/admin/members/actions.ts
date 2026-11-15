"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";
import { failureStatus, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { anyCorruptedText } from "@/lib/text-integrity";

const adminRoles = ["platform_owner", "club_admin", "committee"];

type Client = Awaited<ReturnType<typeof createClient>>;

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

/**
 * Member number for a save. A typed code is validated; a blank field keeps the member's
 * current number (editing used to hand out a brand-new number when the field was empty) and
 * only falls back to the next free number when the member has none.
 */
async function resolveMemberCode(
  supabase: Client,
  clubId: string,
  requestedCode: string,
  currentCode?: string | null,
) {
  const normalized = normalizeMemberCode(requestedCode);

  if (normalized) {
    if (!/^PEAGC-\d{4,}$/.test(normalized)) {
      return { code: null, error: "member-code-invalid" } as const;
    }

    return { code: normalized, error: null } as const;
  }

  if (currentCode) {
    return { code: currentCode, error: null } as const;
  }

  const { data, error } = await supabase.rpc("next_member_code", {
    target_club_id: clubId,
  });

  if (error || typeof data !== "string") {
    logDbError("members.next_member_code", error);
    return { code: null, error: "member-code-generate-failed" } as const;
  }

  return { code: data, error: null } as const;
}

/** The club's "สมาชิก" type (or its first active type), used when the form leaves type empty. */
async function defaultMemberTypeId(supabase: Client, clubId: string) {
  const { data } = await supabase
    .from("member_types")
    .select("id, name")
    .eq("club_id", clubId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return (data ?? []).find((type) => type.name === "สมาชิก")?.id ?? data?.[0]?.id ?? null;
}

function redirectMembers(status: string, memberId?: string, filter?: string): never {
  const params = new URLSearchParams({ status });

  if (memberId) {
    params.set("member", memberId);
  }
  if (filter) {
    params.set("filter", filter);
  }

  redirect(`/admin/members?${params.toString()}${memberId ? `#member-${memberId}` : ""}`);
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
    member_code: null as string | null,
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

function hasCorruptedMemberText(payload: NonNullable<ReturnType<typeof getMemberPayload>>) {
  return anyCorruptedText([
    payload.full_name,
    payload.nickname,
    payload.department,
    payload.affiliation,
    payload.organization,
    payload.note,
  ]);
}

/** Status "archived" in the form means the same as the archive button: hide the member. */
function archiveFields(status: string, previousArchivedAt: string | null | undefined) {
  return { archived_at: status === "archived" ? (previousArchivedAt ?? new Date().toISOString()) : null };
}

export async function createMember(formData: FormData) {
  const { clubId, supabase, userId } = await requireAdminClub();
  const payload = getMemberPayload(formData, clubId, userId);

  if (!payload) {
    redirectMembers("missing-required");
  }
  if (hasCorruptedMemberText(payload)) {
    redirectMembers("text-corrupted");
  }

  const memberCode = await resolveMemberCode(supabase, clubId, getString(formData, "memberCode"));

  if (memberCode.error || !memberCode.code) {
    redirectMembers(memberCode.error ?? "member-code-generate-failed");
  }

  payload.member_code = memberCode.code;
  payload.member_type_id = payload.member_type_id ?? (await defaultMemberTypeId(supabase, clubId));

  const { data: member, error } = await supabase
    .from("members")
    .insert({
      ...payload,
      ...archiveFields(payload.status, null),
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !member) {
    logDbError("members.create", error);
    redirectMembers(error?.code === "23505" ? "member-code-taken" : failureStatus("create-failed", error));
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
  if (hasCorruptedMemberText(payload)) {
    redirectMembers("text-corrupted", memberId);
  }

  const { data: before } = await supabase
    .from("members")
    .select("*")
    .eq("club_id", clubId)
    .eq("id", memberId)
    .maybeSingle();

  if (!before) {
    redirectMembers("update-not-found", memberId);
  }

  const memberCode = await resolveMemberCode(supabase, clubId, getString(formData, "memberCode"), before.member_code);

  if (memberCode.error || !memberCode.code) {
    redirectMembers(memberCode.error ?? "member-code-generate-failed", memberId);
  }

  payload.member_code = memberCode.code;
  payload.member_type_id = payload.member_type_id ?? before.member_type_id ?? (await defaultMemberTypeId(supabase, clubId));

  const { data: saved, error } = await supabase
    .from("members")
    .update({ ...payload, ...archiveFields(payload.status, before.archived_at) })
    .eq("club_id", clubId)
    .eq("id", memberId)
    .select("id")
    .maybeSingle();

  if (error) {
    logDbError("members.update", error);
    redirectMembers(error.code === "23505" ? "member-code-taken" : failureStatus("update-failed", error), memberId);
  }
  if (!saved) {
    redirectMembers("update-not-found", memberId);
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

  redirectMembers("updated", memberId, payload.status === "archived" ? "archived" : undefined);
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

  if (!before) {
    redirectMembers("update-not-found", memberId);
  }

  const memberCode = await resolveMemberCode(supabase, clubId, getString(formData, "memberCode"), before.member_code);

  if (memberCode.error || !memberCode.code) {
    redirectMembers(memberCode.error ?? "member-code-generate-failed", memberId);
  }

  const update = {
    member_code: memberCode.code,
    member_type_id: before.member_type_id ?? (await defaultMemberTypeId(supabase, clubId)),
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
    logDbError("members.approve", error);
    redirectMembers(error.code === "23505" ? "member-code-taken" : failureStatus("approve-failed", error), memberId);
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

  if (before.email) {
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

const openRegistrationStatuses = ["registered", "pending_payment", "payment_review", "paid", "waitlist"];

/**
 * Soft-delete: the member disappears from lists, pickers and reports but the row, its number
 * and its history stay for the audit trail. Refused while the member still holds an upcoming
 * lesson seat or event registration, which would otherwise be orphaned.
 */
export async function archiveMember(formData: FormData) {
  const memberId = getString(formData, "memberId");

  if (!memberId) {
    redirectMembers("missing-required");
  }

  const { clubId, supabase, userId } = await requireAdminClub();
  const { data: before } = await supabase
    .from("members")
    .select("id, status, archived_at, full_name, member_code")
    .eq("club_id", clubId)
    .eq("id", memberId)
    .maybeSingle();

  if (!before) {
    redirectMembers("update-not-found", memberId);
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const [{ count: lessonCount, error: lessonError }, { count: eventCount, error: eventError }] = await Promise.all([
    supabase
      .from("lesson_bookings")
      .select("id, lesson_slots!inner(lesson_date)", { count: "exact", head: true })
      .eq("member_id", memberId)
      .eq("status", "booked")
      .gte("lesson_slots.lesson_date", today),
    supabase
      .from("event_registrations")
      .select("id, events!inner(event_date)", { count: "exact", head: true })
      .eq("member_id", memberId)
      .in("status", openRegistrationStatuses)
      .gte("events.event_date", today),
  ]);

  if (lessonError || eventError) {
    logDbError("members.archive.check", lessonError ?? eventError);
    redirectMembers(failureStatus("archive-failed", lessonError ?? eventError), memberId);
  }
  if ((lessonCount ?? 0) > 0 || (eventCount ?? 0) > 0) {
    redirectMembers("member-archive-blocked", memberId);
  }

  const { data: saved, error } = await supabase
    .from("members")
    .update({ archived_at: new Date().toISOString(), status: "archived", updated_by: userId })
    .eq("club_id", clubId)
    .eq("id", memberId)
    .select("id")
    .maybeSingle();

  if (error || !saved) {
    logDbError("members.archive", error);
    redirectMembers(failureStatus("archive-failed", error), memberId);
  }

  await supabase.from("audit_logs").insert({
    action: "member.archived",
    actor_user_id: userId,
    before_data: before,
    club_id: clubId,
    entity_id: memberId,
    entity_type: "members",
    metadata: { source: "admin.members" },
  });

  redirectMembers("member-archived");
}

export async function restoreMember(formData: FormData) {
  const memberId = getString(formData, "memberId");

  if (!memberId) {
    redirectMembers("missing-required");
  }

  const { clubId, supabase, userId } = await requireAdminClub();
  const { data: saved, error } = await supabase
    .from("members")
    .update({ archived_at: null, status: "inactive", updated_by: userId })
    .eq("club_id", clubId)
    .eq("id", memberId)
    .select("id")
    .maybeSingle();

  if (error || !saved) {
    logDbError("members.restore", error);
    redirectMembers(failureStatus("restore-failed", error), memberId);
  }

  await supabase.from("audit_logs").insert({
    action: "member.restored",
    actor_user_id: userId,
    after_data: { archived_at: null, status: "inactive" },
    club_id: clubId,
    entity_id: memberId,
    entity_type: "members",
    metadata: { source: "admin.members" },
  });

  redirectMembers("member-restored", memberId);
}
