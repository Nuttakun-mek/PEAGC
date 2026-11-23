"use server";

import {
  getId,
  getNumberOrNull,
  getString,
  redirectBack,
  requireLessonAdminClub,
  rpcFailureStatus,
} from "@/app/admin/lessons/action-helpers";
import { recordAudit } from "@/lib/audit";
import { parseCreditDelta } from "@/lib/lessons/admin";
import { failureStatus, logDbError } from "@/lib/supabase/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { anyCorruptedText } from "@/lib/text-integrity";

// Packages, coaches (+ coach logins), venues and credit adjustments of /admin/lessons.
// Writes go through the signed-in user's client (RLS: lesson staff) except the coach role in
// user_roles, which only the service-role client may write (after the checks below).

const coursesTab = "/admin/lessons?tab=courses";
const coachesTab = "/admin/lessons?tab=coaches";

function intIn(value: number | null, min: number, max: number) {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

// ---------- packages ----------

export async function saveLessonPackage(formData: FormData) {
  const packageId = getId(formData, "packageId");
  const back = `${coursesTab}#${packageId ? `package-${packageId}` : "packages"}`;
  const name = getString(formData, "name");
  const credits = getNumberOrNull(formData, "credits");
  const validDays = getNumberOrNull(formData, "validDays");
  const price = getNumberOrNull(formData, "price") ?? 0;
  const maxPerMember = getNumberOrNull(formData, "maxPerMember");

  if (!name) redirectBack(formData, "package-missing", back);
  if (!intIn(credits, 1, 1000)) redirectBack(formData, "package-credits-invalid", back);
  if (!intIn(validDays, 1, 3650)) redirectBack(formData, "package-days-invalid", back);
  if (!(price >= 0)) redirectBack(formData, "package-price-invalid", back);
  if (maxPerMember !== null && !intIn(maxPerMember, 1, 1000)) redirectBack(formData, "package-limit-invalid", back);
  if (anyCorruptedText([name, getString(formData, "description")])) redirectBack(formData, "text-corrupted", back);

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const programId = getId(formData, "programId");
  if (programId) {
    const { data: program } = await supabase.from("lesson_programs").select("id").eq("club_id", clubId).eq("id", programId).is("archived_at", null).maybeSingle();
    if (!program) redirectBack(formData, "program-not-found", back);
  }

  const payload = {
    credits,
    description: getString(formData, "description") || null,
    max_per_member: maxPerMember,
    name,
    price,
    program_id: programId,
    status: getString(formData, "status") === "inactive" ? "inactive" : "active",
    updated_by: userId,
    valid_days: validDays,
  };

  if (packageId) {
    const { data: before } = await supabase.from("lesson_packages").select("*").eq("club_id", clubId).eq("id", packageId).maybeSingle();
    if (!before) redirectBack(formData, "package-not-found", back);
    const { error } = await supabase.from("lesson_packages").update(payload).eq("club_id", clubId).eq("id", packageId);
    if (error) {
      logDbError("lesson_packages.update", error);
      redirectBack(formData, failureStatus("package-save-failed", error), back);
    }
    await recordAudit(supabase, { action: "lesson_package.updated", actorUserId: userId, after: payload, before, clubId, entityId: packageId, entityType: "lesson_packages", metadata: { source: "admin.lessons" } });
    redirectBack(formData, "package-saved", back);
  }

  const { data: created, error } = await supabase
    .from("lesson_packages")
    .insert({ ...payload, club_id: clubId, created_by: userId })
    .select("id")
    .single();
  if (error || !created) {
    logDbError("lesson_packages.create", error);
    redirectBack(formData, failureStatus("package-save-failed", error), back);
  }
  await recordAudit(supabase, { action: "lesson_package.created", actorUserId: userId, after: payload, clubId, entityId: created.id, entityType: "lesson_packages", metadata: { source: "admin.lessons" } });
  redirectBack(formData, "package-created", `${coursesTab}#package-${created.id}`);
}

/** Archive (stop selling, hide) or restore a package. Bought enrollments keep working. */
export async function setLessonPackageArchived(formData: FormData) {
  const packageId = getId(formData, "packageId");
  const archive = formData.get("archive") === "1";
  if (!packageId) redirectBack(formData, "package-not-found", coursesTab);

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const payload = archive
    ? { archived_at: new Date().toISOString(), status: "inactive", updated_by: userId }
    : { archived_at: null, status: "inactive", updated_by: userId };
  const { data: saved, error } = await supabase
    .from("lesson_packages")
    .update(payload)
    .eq("club_id", clubId)
    .eq("id", packageId)
    .select("id")
    .maybeSingle();
  if (error || !saved) {
    logDbError("lesson_packages.archive", error);
    redirectBack(formData, error ? failureStatus("package-save-failed", error) : "package-not-found", coursesTab);
  }
  await recordAudit(supabase, { action: archive ? "lesson_package.archived" : "lesson_package.restored", actorUserId: userId, after: payload, clubId, entityId: packageId, entityType: "lesson_packages", metadata: { source: "admin.lessons" } });
  redirectBack(formData, archive ? "package-archived" : "package-restored", `${coursesTab}#packages`);
}

// ---------- credits ----------

/** Adds or removes credits for one member (admin_adjust_lesson_credits; a note is required). */
export async function adjustLessonCredits(formData: FormData) {
  const memberId = getId(formData, "memberId");
  const note = getString(formData, "note");
  const parsed = parseCreditDelta(formData.get("delta"));
  const validDays = getNumberOrNull(formData, "validDays");
  const back = `${coursesTab}#credits`;

  if (!memberId) redirectBack(formData, "rpc:NOT_MEMBER", back);
  if ("error" in parsed) redirectBack(formData, `credits-invalid:${parsed.error}`, back);
  if (!note) redirectBack(formData, "rpc:NOTE_REQUIRED", back);
  if (validDays !== null && !intIn(validDays, 1, 3650)) redirectBack(formData, "rpc:INVALID_DAYS", back);
  if (anyCorruptedText([note])) redirectBack(formData, "text-corrupted", back);

  const { supabase } = await requireLessonAdminClub();
  const { data, error } = await supabase.rpc("admin_adjust_lesson_credits", {
    p_delta: parsed.delta,
    p_enrollment_id: getId(formData, "enrollmentId"),
    p_member_id: memberId,
    p_note: note,
    p_valid_days: validDays,
  });
  if (error) {
    logDbError("admin_adjust_lesson_credits", error);
    redirectBack(formData, rpcFailureStatus(error, "credits-adjust-failed"), back);
  }
  // The RPC writes the ledger row, the audit row and the member's notification.
  const remaining = Number((data as { credits_remaining?: number } | null)?.credits_remaining ?? 0);
  redirectBack(formData, `credits-adjusted:${parsed.delta}:${Number.isFinite(remaining) ? remaining : 0}`, back);
}

// ---------- coaches ----------

export async function saveLessonCoach(formData: FormData) {
  const coachId = getId(formData, "coachId");
  const back = `${coachesTab}#${coachId ? `coach-${coachId}` : "coaches"}`;
  const fullName = getString(formData, "fullName");
  if (!fullName) redirectBack(formData, "coach-missing", back);
  const fields = [fullName, getString(formData, "nickname"), getString(formData, "phone"), getString(formData, "bio")];
  if (anyCorruptedText(fields)) redirectBack(formData, "text-corrupted", back);

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const payload = {
    bio: getString(formData, "bio") || null,
    full_name: fullName,
    nickname: getString(formData, "nickname") || null,
    phone: getString(formData, "phone").replace(/[^\d+]/g, "") || null,
    status: getString(formData, "status") === "inactive" ? "inactive" : "active",
    updated_by: userId,
  };

  if (coachId) {
    const { data: before } = await supabase.from("lesson_coaches").select("*").eq("club_id", clubId).eq("id", coachId).is("archived_at", null).maybeSingle();
    if (!before) redirectBack(formData, "coach-not-found", back);
    const { error } = await supabase.from("lesson_coaches").update(payload).eq("club_id", clubId).eq("id", coachId);
    if (error) {
      logDbError("lesson_coaches.update", error);
      redirectBack(formData, failureStatus("coach-save-failed", error), back);
    }
    await recordAudit(supabase, { action: "lesson_coach.updated", actorUserId: userId, after: payload, before, clubId, entityId: coachId, entityType: "lesson_coaches", metadata: { source: "admin.lessons" } });
    redirectBack(formData, "coach-saved", back);
  }

  const { data: created, error } = await supabase
    .from("lesson_coaches")
    .insert({ ...payload, club_id: clubId, created_by: userId })
    .select("id")
    .single();
  if (error || !created) {
    logDbError("lesson_coaches.create", error);
    redirectBack(formData, failureStatus("coach-save-failed", error), back);
  }
  await recordAudit(supabase, { action: "lesson_coach.created", actorUserId: userId, after: payload, clubId, entityId: created.id, entityType: "lesson_coaches", metadata: { source: "admin.lessons" } });
  redirectBack(formData, "coach-created", `${coachesTab}#coach-${created.id}`);
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** auth user id for an e-mail: the club's member rows first, then the auth user list. */
async function findUserIdByEmail(admin: AdminClient, clubId: string, email: string) {
  const { data: member } = await admin
    .from("members")
    .select("user_id")
    .eq("club_id", clubId)
    // Exact match, any letter case: escape LIKE wildcards ("_" is common in e-mail addresses).
    .ilike("email", email.replace(/[\\%_]/g, (char) => `\\${char}`))
    .not("user_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (member?.user_id) return member.user_id as string;

  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      logDbError("auth.admin.listUsers", { code: error.code ?? null, message: error.message });
      return null;
    }
    const found = data.users.find((user) => (user.email ?? "").toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
}

/**
 * Gives a coach a login: the person signs up with their own e-mail first, then staff link that
 * account here. Sets lesson_coaches.user_id and grants the `coach` role for this club (nothing else).
 */
export async function linkLessonCoachLogin(formData: FormData) {
  const coachId = getId(formData, "coachId");
  const email = getString(formData, "email").toLowerCase();
  const back = `${coachesTab}#coach-${coachId ?? ""}`;
  if (!coachId) redirectBack(formData, "coach-not-found", coachesTab);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirectBack(formData, "coach-email-invalid", back);

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { data: coach } = await supabase.from("lesson_coaches").select("*").eq("club_id", clubId).eq("id", coachId).is("archived_at", null).maybeSingle();
  if (!coach) redirectBack(formData, "coach-not-found", back);

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    redirectBack(formData, "coach-link-unavailable", back);
  }

  const targetUserId = await findUserIdByEmail(admin, clubId, email);
  if (!targetUserId) redirectBack(formData, "coach-login-not-found", back);

  const { data: other } = await supabase
    .from("lesson_coaches")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", targetUserId)
    .is("archived_at", null)
    .neq("id", coachId)
    .limit(1)
    .maybeSingle();
  if (other) redirectBack(formData, "coach-login-taken", back);

  const { error: linkError } = await supabase.from("lesson_coaches").update({ updated_by: userId, user_id: targetUserId }).eq("club_id", clubId).eq("id", coachId);
  if (linkError) {
    logDbError("lesson_coaches.link", linkError);
    redirectBack(formData, failureStatus("coach-link-failed", linkError), back);
  }

  const { error: roleError } = await admin
    .from("user_roles")
    .upsert({ club_id: clubId, created_by: userId, role_key: "coach", user_id: targetUserId }, { onConflict: "club_id,user_id,role_key" });
  if (roleError) {
    logDbError("user_roles.coach.grant", roleError);
    // Undo the half-done link so the list does not show a login that cannot open /coach.
    await supabase.from("lesson_coaches").update({ updated_by: userId, user_id: coach.user_id }).eq("club_id", clubId).eq("id", coachId);
    redirectBack(formData, failureStatus("coach-link-failed", roleError), back);
  }

  // The previous login (if any) loses the role unless another coach row still uses it.
  if (coach.user_id && coach.user_id !== targetUserId) {
    await revokeCoachRole(admin, clubId, coach.user_id, coachId);
  }

  await recordAudit(supabase, {
    action: "lesson_coach.login_linked",
    actorUserId: userId,
    after: { role_key: "coach", user_id: targetUserId },
    before: { user_id: coach.user_id },
    clubId,
    entityId: coachId,
    entityType: "lesson_coaches",
    metadata: { email, source: "admin.lessons" },
  });
  redirectBack(formData, "coach-login-linked", back);
}

async function revokeCoachRole(admin: AdminClient, clubId: string, userId: string, exceptCoachId: string) {
  const { data: still } = await admin
    .from("lesson_coaches")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .is("archived_at", null)
    .neq("id", exceptCoachId)
    .limit(1)
    .maybeSingle();
  if (still) return null;
  const { error } = await admin.from("user_roles").delete().eq("club_id", clubId).eq("user_id", userId).eq("role_key", "coach");
  if (error) logDbError("user_roles.coach.revoke", error);
  return error;
}

/** Removes the coach login: clears lesson_coaches.user_id and the `coach` role of that account. */
export async function unlinkLessonCoachLogin(formData: FormData) {
  const coachId = getId(formData, "coachId");
  const back = `${coachesTab}#coach-${coachId ?? ""}`;
  if (!coachId) redirectBack(formData, "coach-not-found", coachesTab);

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { data: coach } = await supabase.from("lesson_coaches").select("*").eq("club_id", clubId).eq("id", coachId).maybeSingle();
  if (!coach) redirectBack(formData, "coach-not-found", back);
  if (!coach.user_id) redirectBack(formData, "coach-login-unlinked", back);

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    redirectBack(formData, "coach-link-unavailable", back);
  }

  const { error } = await supabase.from("lesson_coaches").update({ updated_by: userId, user_id: null }).eq("club_id", clubId).eq("id", coachId);
  if (error) {
    logDbError("lesson_coaches.unlink", error);
    redirectBack(formData, failureStatus("coach-link-failed", error), back);
  }
  const roleError = await revokeCoachRole(admin, clubId, coach.user_id, coachId);

  await recordAudit(supabase, {
    action: "lesson_coach.login_unlinked",
    actorUserId: userId,
    after: { user_id: null },
    before: { user_id: coach.user_id },
    clubId,
    entityId: coachId,
    entityType: "lesson_coaches",
    metadata: { role_revoked: !roleError, source: "admin.lessons" },
  });
  redirectBack(formData, "coach-login-unlinked", back);
}

/** Archive a coach (rounds keep the name). A linked login loses the coach role. */
export async function archiveLessonCoach(formData: FormData) {
  const coachId = getId(formData, "coachId");
  if (!coachId) redirectBack(formData, "coach-not-found", coachesTab);

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { data: before } = await supabase.from("lesson_coaches").select("*").eq("club_id", clubId).eq("id", coachId).is("archived_at", null).maybeSingle();
  if (!before) redirectBack(formData, "coach-not-found", coachesTab);

  const { error } = await supabase
    .from("lesson_coaches")
    .update({ archived_at: new Date().toISOString(), status: "inactive", updated_by: userId, user_id: null })
    .eq("club_id", clubId)
    .eq("id", coachId);
  if (error) {
    logDbError("lesson_coaches.archive", error);
    redirectBack(formData, failureStatus("coach-save-failed", error), coachesTab);
  }
  if (before.user_id) {
    try {
      await revokeCoachRole(createAdminClient(), clubId, before.user_id, coachId);
    } catch {
      // No service key: the role stays; the coach row is archived so /coach shows nothing.
    }
  }
  await recordAudit(supabase, { action: "lesson_coach.archived", actorUserId: userId, before, clubId, entityId: coachId, entityType: "lesson_coaches", metadata: { source: "admin.lessons" } });
  redirectBack(formData, "coach-archived", `${coachesTab}#coaches`);
}

// ---------- venues ----------

export async function saveLessonVenue(formData: FormData) {
  const venueId = getId(formData, "venueId");
  const back = `${coachesTab}#${venueId ? `venue-${venueId}` : "venues"}`;
  const name = getString(formData, "name");
  const bayCount = getNumberOrNull(formData, "bayCount") ?? 1;
  const capacityPerBay = getNumberOrNull(formData, "capacityPerBay") ?? 1;
  if (!name) redirectBack(formData, "venue-missing", back);
  if (!intIn(bayCount, 1, 500) || !intIn(capacityPerBay, 1, 100)) redirectBack(formData, "venue-numbers-invalid", back);
  if (anyCorruptedText([name, getString(formData, "address"), getString(formData, "note")])) redirectBack(formData, "text-corrupted", back);

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const payload = {
    address: getString(formData, "address") || null,
    bay_count: bayCount,
    capacity_per_bay: capacityPerBay,
    name,
    note: getString(formData, "note") || null,
    status: getString(formData, "status") === "inactive" ? "inactive" : "active",
    updated_by: userId,
  };

  if (venueId) {
    const { data: before } = await supabase.from("lesson_venues").select("*").eq("club_id", clubId).eq("id", venueId).is("archived_at", null).maybeSingle();
    if (!before) redirectBack(formData, "venue-not-found", back);
    const { error } = await supabase.from("lesson_venues").update(payload).eq("club_id", clubId).eq("id", venueId);
    if (error) {
      logDbError("lesson_venues.update", error);
      redirectBack(formData, failureStatus("venue-save-failed", error), back);
    }
    await recordAudit(supabase, { action: "lesson_venue.updated", actorUserId: userId, after: payload, before, clubId, entityId: venueId, entityType: "lesson_venues", metadata: { source: "admin.lessons" } });
    redirectBack(formData, "venue-saved", back);
  }

  const { data: created, error } = await supabase
    .from("lesson_venues")
    .insert({ ...payload, club_id: clubId, created_by: userId })
    .select("id")
    .single();
  if (error || !created) {
    logDbError("lesson_venues.create", error);
    redirectBack(formData, failureStatus("venue-save-failed", error), back);
  }
  await recordAudit(supabase, { action: "lesson_venue.created", actorUserId: userId, after: payload, clubId, entityId: created.id, entityType: "lesson_venues", metadata: { source: "admin.lessons" } });
  redirectBack(formData, "venue-created", `${coachesTab}#venue-${created.id}`);
}

export async function archiveLessonVenue(formData: FormData) {
  const venueId = getId(formData, "venueId");
  if (!venueId) redirectBack(formData, "venue-not-found", coachesTab);

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { data: before } = await supabase.from("lesson_venues").select("*").eq("club_id", clubId).eq("id", venueId).is("archived_at", null).maybeSingle();
  if (!before) redirectBack(formData, "venue-not-found", coachesTab);
  const { error } = await supabase
    .from("lesson_venues")
    .update({ archived_at: new Date().toISOString(), status: "inactive", updated_by: userId })
    .eq("club_id", clubId)
    .eq("id", venueId);
  if (error) {
    logDbError("lesson_venues.archive", error);
    redirectBack(formData, failureStatus("venue-save-failed", error), coachesTab);
  }
  await recordAudit(supabase, { action: "lesson_venue.archived", actorUserId: userId, before, clubId, entityId: venueId, entityType: "lesson_venues", metadata: { source: "admin.lessons" } });
  redirectBack(formData, "venue-archived", `${coachesTab}#venues`);
}
