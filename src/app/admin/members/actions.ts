"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";
import { failureStatus, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { anyCorruptedText } from "@/lib/text-integrity";
import { isValidHandicap, normalizeEmail, normalizeEmployeeCode, normalizePhone } from "@/lib/validation";

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

function redirectMembers(status: string, memberId?: string, filter?: string, extra?: Record<string, string>): never {
  const params = new URLSearchParams({ status });

  if (memberId) {
    params.set("member", memberId);
  }
  if (filter) {
    params.set("filter", filter);
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    params.set(key, value);
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

/** Form values → row, or the `?status=` key of the first invalid field. */
function getMemberPayload(formData: FormData, clubId: string, userId: string) {
  const fullName = getString(formData, "fullName");

  if (!fullName) {
    return { error: "missing-required", payload: null } as const;
  }

  const phone = normalizePhone(getString(formData, "phone"));
  if (!phone.ok) {
    return { error: "phone-invalid", payload: null } as const;
  }
  const email = normalizeEmail(getString(formData, "email"));
  if (!email.ok) {
    return { error: "email-invalid", payload: null } as const;
  }
  const handicap = getNumberOrNull(formData, "handicap");
  if (getString(formData, "handicap") && handicap === null) {
    return { error: "handicap-invalid", payload: null } as const;
  }
  if (!isValidHandicap(handicap)) {
    return { error: "handicap-invalid", payload: null } as const;
  }

  return { error: null, payload: {
    club_id: clubId,
    affiliation: getString(formData, "affiliation") || null,
    department: getString(formData, "department") || null,
    email: email.value,
    employee_code: normalizeEmployeeCode(getString(formData, "employeeCode")) || null,
    full_name: fullName,
    handicap,
    joined_at: getDateOrNull(formData, "joinedAt"),
    line_id: getString(formData, "lineId") || null,
    member_code: null as string | null,
    member_type_id: getString(formData, "memberTypeId") || null,
    nickname: getString(formData, "nickname") || null,
    note: getString(formData, "note") || null,
    organization: getString(formData, "organization") || null,
    phone: phone.value,
    skill_level: getString(formData, "skillLevel") || null,
    status: getString(formData, "status") || "active",
    updated_by: userId,
  } };
}

type MemberPayload = NonNullable<ReturnType<typeof getMemberPayload>["payload"]>;

/**
 * The other member (not archived) already holding this employee code. One employee is one
 * member; the database enforces the same rule with a unique index.
 */
async function findEmployeeCodeOwner(supabase: Client, clubId: string, employeeCode: string | null, exceptMemberId?: string) {
  if (!employeeCode) {
    return null;
  }

  let query = supabase
    .from("members")
    .select("id, member_code, full_name")
    .eq("club_id", clubId)
    // Case-insensitive exact match (older rows may be lower case); escape LIKE wildcards.
    .ilike("employee_code", employeeCode.replace(/[\\%_]/g, (char) => `\\${char}`))
    .is("archived_at", null)
    .limit(1);
  if (exceptMemberId) {
    query = query.neq("id", exceptMemberId);
  }
  const { data, error } = await query.maybeSingle();

  if (error) {
    logDbError("members.employee_code_owner", error);
  }

  return data ?? null;
}

function ownerRef(owner: { full_name: string | null; member_code: string | null }) {
  return [owner.member_code, owner.full_name].filter(Boolean).join(" ");
}

/** 23505 from either unique rule on members → the matching message. */
function uniqueViolationStatus(error: { code?: string; message?: string } | null, fallback: string) {
  if (error?.code !== "23505") return null;
  return error.message?.includes("employee_code") ? "employee-code-taken" : fallback;
}

function hasCorruptedMemberText(payload: MemberPayload) {
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
  const parsed = getMemberPayload(formData, clubId, userId);

  if (!parsed.payload) {
    redirectMembers(parsed.error);
  }
  const { payload } = parsed;
  if (hasCorruptedMemberText(payload)) {
    redirectMembers("text-corrupted");
  }

  if (payload.status !== "archived") {
    const owner = await findEmployeeCodeOwner(supabase, clubId, payload.employee_code);
    if (owner) {
      redirectMembers("employee-code-taken", owner.id, undefined, { ref: ownerRef(owner) });
    }
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
    redirectMembers(uniqueViolationStatus(error, "member-code-taken") ?? failureStatus("create-failed", error));
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
  const parsed = getMemberPayload(formData, clubId, userId);

  if (!parsed.payload) {
    redirectMembers(parsed.error, memberId);
  }
  const { payload } = parsed;
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

  if (payload.status !== "archived") {
    const owner = await findEmployeeCodeOwner(supabase, clubId, payload.employee_code, memberId);
    if (owner) {
      redirectMembers("employee-code-taken", memberId, undefined, { ref: ownerRef(owner) });
    }
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
    redirectMembers(uniqueViolationStatus(error, "member-code-taken") ?? failureStatus("update-failed", error), memberId);
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

  const approveOwner = await findEmployeeCodeOwner(supabase, clubId, before.employee_code, memberId);
  if (approveOwner) {
    redirectMembers("employee-code-taken", memberId, undefined, { ref: ownerRef(approveOwner) });
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
    redirectMembers(uniqueViolationStatus(error, "member-code-taken") ?? failureStatus("approve-failed", error), memberId);
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
  const { data: archived } = await supabase
    .from("members")
    .select("employee_code")
    .eq("club_id", clubId)
    .eq("id", memberId)
    .maybeSingle();
  const restoreOwner = await findEmployeeCodeOwner(supabase, clubId, archived?.employee_code ?? null, memberId);
  if (restoreOwner) {
    redirectMembers("employee-code-taken", memberId, "archived", { ref: ownerRef(restoreOwner) });
  }

  const { data: saved, error } = await supabase
    .from("members")
    .update({ archived_at: null, status: "inactive", updated_by: userId })
    .eq("club_id", clubId)
    .eq("id", memberId)
    .select("id")
    .maybeSingle();

  if (error || !saved) {
    logDbError("members.restore", error);
    redirectMembers(uniqueViolationStatus(error, "restore-failed") ?? failureStatus("restore-failed", error), memberId, "archived");
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
