"use server";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  type LessonsClient,
  getBoolean,
  getId,
  getNumberOrNull,
  getString,
  getStringList,
  isV2Form,
  redirectBack,
  requireLessonAdminClub,
} from "@/app/admin/lessons/action-helpers";
import { recordAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth/session";
import { type LessonsAdminTab, generatedStatusKey, slotCapacityProblem } from "@/lib/lessons/admin";
import { bangkokDate, fromBangkokInputValue, getBookingPhase, parseTimeRangesDetailed } from "@/lib/lessons/booking";
import { type PlannedSlot, type PlannerExistingSlot, applyConflictRows, plannerConflictLabels, planSlotsWithConflicts, venueCapacityWarning } from "@/lib/lessons/planner";
import { lessonRulesFromForm } from "@/lib/lessons/rules";
import { lessonSampleData } from "@/lib/lessons/sample-data";
import type { LessonSlotConflictRow, LessonVenue } from "@/lib/lessons/types";
import { redirectAfterAction as redirect } from "@/lib/navigation";
import { failureStatus, logDbError } from "@/lib/supabase/errors";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { isAuthBypassEnabled } from "@/lib/supabase/env";
import { anyCorruptedText } from "@/lib/text-integrity";

/** Every redirect returns the admin to the tab the form was on (or its hidden "returnTo"). */
function redirectLessons(status: string, tab: LessonsAdminTab, anchor?: string): never {
  const tabParam = tab === "calendar" ? "" : `tab=${tab}&`;
  redirect(`/admin/lessons?${tabParam}status=${encodeURIComponent(status)}${anchor ? `#${anchor}` : ""}`);
}

/** `returnTo` from the form when present, else the tab. */
function finish(formData: FormData, status: string, tab: LessonsAdminTab, anchor?: string): never {
  if (formData.get("returnTo")) {
    redirectBack(formData, status);
  }
  redirectLessons(status, tab, anchor);
}

/**
 * Opens member booking now (keeps a close time that is still in the future). Used by the
 * "เปิดให้จองทันที" button and by the slot forms, so new rounds are not stuck at "ยังไม่เปิด"
 * just because no registration window was ever set. Returns whether anything changed.
 */
async function openBookingWindowNow(supabase: LessonsClient, clubId: string, userId: string) {
  const { data: before, error: readError } = await supabase
    .from("lesson_booking_settings")
    .select("*")
    .eq("club_id", clubId)
    .maybeSingle();

  if (readError) {
    logDbError("lesson_booking_settings.open_now.read", readError);
    return { error: readError, opened: false } as const;
  }
  if (getBookingPhase(before) === "open") {
    return { error: null, opened: false } as const;
  }

  const now = Date.now();
  const keepClose = before?.booking_close_at && Date.parse(before.booking_close_at) > now + 60_000;
  const payload = {
    booking_close_at: keepClose ? before.booking_close_at : null,
    booking_open_at: new Date(now).toISOString(),
    club_id: clubId,
    updated_by: userId,
  };
  const { error } = await supabase.from("lesson_booking_settings").upsert(payload, { onConflict: "club_id" });

  if (error) {
    logDbError("lesson_booking_settings.open_now", error);
    return { error, opened: false } as const;
  }

  await recordAudit(supabase, {
    action: "lesson_booking_settings.opened_now",
    actorUserId: userId,
    after: payload,
    before,
    clubId,
    entityId: clubId,
    entityType: "lesson_booking_settings",
    metadata: { source: "admin.lessons" },
  });

  return { error: null, opened: true } as const;
}

export async function openLessonBookingNow() {
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const result = await openBookingWindowNow(supabase, clubId, userId);

  if (result.error) {
    redirectLessons(failureStatus("settings-save-failed", result.error), "settings", "booking-window");
  }

  redirectLessons(result.opened ? "booking-opened" : "booking-already-open", "settings", "booking-window");
}

// ---------- courses ----------

/** Course columns from the form; v2 forms add the package switch and the usual coach / venue. */
function programPayload(formData: FormData, userId: string) {
  const v2 = isV2Form(formData);
  const defaultCoachId = v2 ? getId(formData, "defaultCoachId") : null;
  const payload: Record<string, unknown> = {
    description: getString(formData, "description") || null,
    level: getString(formData, "level") || "all",
    name: getString(formData, "name"),
    price: Math.max(0, getNumberOrNull(formData, "price") ?? 0),
    status: getString(formData, "status") || "active",
    updated_by: userId,
  };
  if (v2) {
    payload.requires_package = getBoolean(formData, "requiresPackage");
    payload.default_coach_id = defaultCoachId;
    payload.default_venue_id = getId(formData, "defaultVenueId");
    // A picked coach fills coach_name in the database (trigger); otherwise keep the typed name.
    if (!defaultCoachId) payload.coach_name = getString(formData, "coachName") || null;
  } else {
    payload.coach_name = getString(formData, "coachName") || null;
  }
  return payload;
}

export async function createLessonProgram(formData: FormData) {
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const name = getString(formData, "name");

  if (!name) {
    redirectLessons("program-missing", "courses");
  }
  if (anyCorruptedText([name, getString(formData, "coachName"), getString(formData, "description")])) {
    redirectLessons("text-corrupted", "courses");
  }

  const payload = { ...programPayload(formData, userId), club_id: clubId, created_by: userId };
  const { data: program, error } = await supabase
    .from("lesson_programs")
    .insert(payload)
    .select("id")
    .single();

  if (error || !program) {
    logDbError("lesson_programs.create", error);
    redirectLessons(failureStatus("program-create-failed", error), "courses");
  }

  await recordAudit(supabase, {
    action: "lesson_program.created",
    actorUserId: userId,
    after: payload,
    clubId,
    entityId: program.id,
    entityType: "lesson_programs",
    metadata: { source: "admin.lessons" },
  });

  redirectLessons("program-created", "courses", `program-${program.id}`);
}

export async function updateLessonProgram(formData: FormData) {
  const programId = getString(formData, "programId");
  const name = getString(formData, "name");

  if (!programId || !name) {
    redirectLessons("program-missing", "courses");
  }
  if (anyCorruptedText([name, getString(formData, "coachName"), getString(formData, "description")])) {
    redirectLessons("text-corrupted", "courses", `program-${programId}`);
  }

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { data: before } = await supabase
    .from("lesson_programs")
    .select("*")
    .eq("club_id", clubId)
    .eq("id", programId)
    .is("archived_at", null)
    .maybeSingle();

  if (!before) {
    redirectLessons("program-not-found", "courses");
  }

  const payload = programPayload(formData, userId);
  const { error } = await supabase
    .from("lesson_programs")
    .update(payload)
    .eq("club_id", clubId)
    .eq("id", programId);

  if (error) {
    logDbError("lesson_programs.update", error);
    redirectLessons(failureStatus("program-update-failed", error), "courses", `program-${programId}`);
  }

  await recordAudit(supabase, {
    action: "lesson_program.updated",
    actorUserId: userId,
    after: payload,
    before,
    clubId,
    entityId: programId,
    entityType: "lesson_programs",
    metadata: { source: "admin.lessons" },
  });

  redirectLessons("program-updated", "courses", `program-${programId}`);
}

/**
 * Removes a course from the admin lists and the member portal (soft delete). Refused while any
 * upcoming round of the course still has members booked; upcoming rounds without bookings are
 * archived with it. Past rounds stay for history and reports.
 */
export async function archiveLessonProgram(formData: FormData) {
  const programId = getString(formData, "programId");
  if (!programId) redirectLessons("program-not-found", "courses");

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const today = bangkokDate();
  const [{ data: before }, { data: upcoming, error: upcomingError }] = await Promise.all([
    supabase.from("lesson_programs").select("*").eq("club_id", clubId).eq("id", programId).is("archived_at", null).maybeSingle(),
    supabase
      .from("lesson_slots")
      .select("id, lesson_bookings(id, status)")
      .eq("club_id", clubId)
      .eq("program_id", programId)
      .is("archived_at", null)
      .gte("lesson_date", today),
  ]);

  if (!before) redirectLessons("program-not-found", "courses");
  if (upcomingError) {
    logDbError("lesson_programs.archive.check", upcomingError);
    redirectLessons(failureStatus("program-archive-failed", upcomingError), "courses");
  }

  type UpcomingSlot = { id: string; lesson_bookings: Array<{ status: string }> | null };
  const slots = (upcoming ?? []) as UpcomingSlot[];
  const booked = slots.filter((slot) => (slot.lesson_bookings ?? []).some((booking) => !["cancelled", "late_cancelled", "closed"].includes(booking.status)));
  if (booked.length) {
    redirectLessons(`program-archive-blocked:${booked.length}`, "courses", `program-${programId}`);
  }

  const now = new Date().toISOString();
  const { data: saved, error } = await supabase
    .from("lesson_programs")
    .update({ archived_at: now, status: "archived", updated_by: userId })
    .eq("club_id", clubId)
    .eq("id", programId)
    .select("id")
    .maybeSingle();

  if (error || !saved) {
    logDbError("lesson_programs.archive", error);
    redirectLessons(failureStatus("program-archive-failed", error), "courses");
  }

  if (slots.length) {
    const { error: slotError } = await supabase
      .from("lesson_slots")
      .update({ archived_at: now, status: "cancelled", updated_by: userId })
      .eq("club_id", clubId)
      .in("id", slots.map((slot) => slot.id));
    if (slotError) logDbError("lesson_programs.archive.slots", slotError);
  }

  await recordAudit(supabase, {
    action: "lesson_program.archived",
    actorUserId: userId,
    before,
    clubId,
    entityId: programId,
    entityType: "lesson_programs",
    metadata: { archived_upcoming_slots: slots.length, source: "admin.lessons" },
  });

  redirectLessons("program-archived", "courses", "archived-programs");
}

export async function restoreLessonProgram(formData: FormData) {
  const programId = getString(formData, "programId");
  if (!programId) redirectLessons("program-not-found", "courses");

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { data: saved, error } = await supabase
    .from("lesson_programs")
    .update({ archived_at: null, status: "inactive", updated_by: userId })
    .eq("club_id", clubId)
    .eq("id", programId)
    .not("archived_at", "is", null)
    .select("id")
    .maybeSingle();

  if (error || !saved) {
    logDbError("lesson_programs.restore", error);
    redirectLessons(error ? failureStatus("program-restore-failed", error) : "program-not-found", "courses");
  }

  await recordAudit(supabase, {
    action: "lesson_program.restored",
    actorUserId: userId,
    after: { archived_at: null, status: "inactive" },
    clubId,
    entityId: programId,
    entityType: "lesson_programs",
    metadata: { source: "admin.lessons" },
  });

  redirectLessons("program-restored", "courses", `program-${programId}`);
}

// ---------- rounds ----------

/** Columns shared by the single-round form, the round editor and the wizard. */
function slotCommonPayload(formData: FormData) {
  const v2 = isV2Form(formData);
  const coachId = v2 ? getId(formData, "coachId") : null;
  const venueId = v2 ? getId(formData, "venueId") : null;
  const payload: Record<string, unknown> = {
    allow_member_reschedule: getBoolean(formData, "allowMemberReschedule"),
    note: getString(formData, "note") || null,
    reschedule_cutoff_hours: Math.max(0, getNumberOrNull(formData, "rescheduleCutoffHours") ?? 12),
    status: getString(formData, "status") || "open",
    target_bureaus: getStringList(formData, "targetBureaus"),
    target_departments: getStringList(formData, "targetDepartments"),
    target_divisions: getStringList(formData, "targetDivisions"),
    target_sections: getStringList(formData, "targetSections"),
    target_work_lines: getStringList(formData, "targetWorkLines"),
    title: getString(formData, "title"),
  };
  if (v2) {
    payload.coach_id = coachId;
    payload.venue_id = venueId;
    payload.bay_label = venueId ? getString(formData, "bayLabel") || null : null;
    // The database fills coach_name / venue from the picked coach / venue (trigger).
    if (!coachId) payload.coach_name = getString(formData, "coachName") || null;
    if (!venueId) payload.venue = getString(formData, "venue") || null;
  } else {
    payload.coach_name = getString(formData, "coachName") || null;
    payload.venue = getString(formData, "venue") || null;
  }
  return { coachId, payload, v2, venueId };
}

/** Coach / venue clashes of one round with other rounds (v2 only; empty when the check fails). */
async function slotConflictKinds(
  supabase: LessonsClient,
  clubId: string,
  item: { bay_label: string | null; coach_id: string | null; end_time: string; lesson_date: string; start_time: string; venue_id: string | null },
  excludeSlotId: string | null,
) {
  if (!item.coach_id && !item.venue_id) return [];
  const { data, error } = await supabase.rpc("lesson_slot_conflicts", {
    p_club_id: clubId,
    p_exclude_slot_id: excludeSlotId,
    p_items: [item],
  });
  if (error) {
    logDbError("lesson_slot_conflicts.single", error);
    return [];
  }
  return [...new Set(((data ?? []) as LessonSlotConflictRow[]).map((row) => row.conflict_kind))];
}

const textFields = (formData: FormData) =>
  [getString(formData, "title"), getString(formData, "coachName"), getString(formData, "venue"), getString(formData, "note")];

export async function createLessonSlot(formData: FormData) {
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const programId = getString(formData, "programId");
  const title = getString(formData, "title");
  const lessonDate = getString(formData, "lessonDate");
  const startTime = getString(formData, "startTime");
  const endTime = getString(formData, "endTime");
  const capacity = getNumberOrNull(formData, "capacity");

  if (!programId || !title || !lessonDate || !startTime || !endTime || !capacity || capacity < 1) {
    redirectLessons("slot-missing", "create");
  }
  if (endTime <= startTime) {
    redirectLessons("slot-time-invalid", "create");
  }
  if (anyCorruptedText(textFields(formData))) {
    redirectLessons("text-corrupted", "create");
  }

  const { data: program } = await supabase
    .from("lesson_programs")
    .select("id")
    .eq("club_id", clubId)
    .eq("id", programId)
    .is("archived_at", null)
    .maybeSingle();

  if (!program) {
    redirectLessons("program-not-found", "create");
  }

  const common = slotCommonPayload(formData);
  const payload = {
    ...common.payload,
    capacity: Math.trunc(capacity),
    club_id: clubId,
    created_by: userId,
    end_time: endTime,
    lesson_date: lessonDate,
    program_id: programId,
    start_time: startTime,
    updated_by: userId,
    waitlist_capacity: Math.max(0, Math.trunc(getNumberOrNull(formData, "waitlistCapacity") ?? 0)),
  };
  const { data: slot, error } = await supabase
    .from("lesson_slots")
    .insert(payload)
    .select("id")
    .single();

  if (error || !slot) {
    logDbError("lesson_slots.create", error);
    redirectLessons(failureStatus("slot-create-failed", error), "create");
  }

  await recordAudit(supabase, {
    action: "lesson_slot.created",
    actorUserId: userId,
    after: payload,
    clubId,
    entityId: slot.id,
    entityType: "lesson_slots",
    metadata: { source: "admin.lessons" },
  });

  const conflicts = common.v2
    ? await slotConflictKinds(
        supabase,
        clubId,
        { bay_label: (common.payload.bay_label as string | null) ?? null, coach_id: common.coachId, end_time: endTime, lesson_date: lessonDate, start_time: startTime, venue_id: common.venueId },
        slot.id,
      )
    : [];
  const opened = getBoolean(formData, "openBookingNow") ? await openBookingWindowNow(supabase, clubId, userId) : null;
  const status = conflicts.length ? `slot-saved-conflict:${conflicts.join("+")}` : opened?.opened ? "slot-created-opened" : "slot-created";
  redirect(`/admin/lessons?date=${lessonDate}&slot=${slot.id}&status=${encodeURIComponent(status)}`);
}

export async function updateLessonSlot(formData: FormData) {
  const slotId = getString(formData, "slotId");
  const programId = getString(formData, "programId");
  const title = getString(formData, "title");
  const lessonDate = getString(formData, "lessonDate");
  const startTime = getString(formData, "startTime");
  const endTime = getString(formData, "endTime");
  const capacity = getNumberOrNull(formData, "capacity");

  if (!slotId || !programId || !title || !lessonDate || !startTime || !endTime || !capacity || capacity < 1) {
    finish(formData, "slot-missing", "calendar");
  }
  if (endTime <= startTime) {
    finish(formData, "slot-time-invalid", "calendar");
  }
  if (anyCorruptedText(textFields(formData))) {
    finish(formData, "text-corrupted", "calendar");
  }

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const [{ data: program }, { data: before }, { count: activeBookingCount }] = await Promise.all([
    supabase.from("lesson_programs").select("id").eq("club_id", clubId).eq("id", programId).maybeSingle(),
    supabase.from("lesson_slots").select("*").eq("club_id", clubId).eq("id", slotId).is("archived_at", null).maybeSingle(),
    supabase
      .from("lesson_bookings")
      .select("id", { count: "exact", head: true })
      .eq("club_id", clubId)
      .eq("slot_id", slotId)
      .not("status", "in", "(cancelled,late_cancelled,closed)"),
  ]);

  if (!program || !before) {
    finish(formData, "slot-not-found", "calendar");
  }

  const waitlistCapacity = Math.max(0, Math.trunc(getNumberOrNull(formData, "waitlistCapacity") ?? 0));
  // The database never takes a seat away from someone who has one: refuse here instead.
  const problem = slotCapacityProblem({
    activeBookings: activeBookingCount ?? 0,
    capacity,
    seatsTaken: typeof before.seats_taken === "number" ? before.seats_taken : null,
    waitlistCapacity,
    waitlistCount: typeof before.waitlist_count === "number" ? before.waitlist_count : null,
  });
  if (problem) {
    finish(formData, problem, "calendar");
  }

  const common = slotCommonPayload(formData);
  const payload = {
    ...common.payload,
    capacity,
    end_time: endTime,
    lesson_date: lessonDate,
    program_id: programId,
    start_time: startTime,
    updated_by: userId,
    waitlist_capacity: waitlistCapacity,
  };
  const { error } = await supabase
    .from("lesson_slots")
    .update(payload)
    .eq("club_id", clubId)
    .eq("id", slotId);

  if (error) {
    logDbError("lesson_slots.update", error);
    finish(formData, failureStatus("slot-update-failed", error), "calendar");
  }

  await recordAudit(supabase, {
    action: "lesson_slot.updated",
    actorUserId: userId,
    after: payload,
    before,
    clubId,
    entityId: slotId,
    entityType: "lesson_slots",
    metadata: { source: "admin.lessons" },
  });

  const conflicts = common.v2
    ? await slotConflictKinds(
        supabase,
        clubId,
        { bay_label: (common.payload.bay_label as string | null) ?? null, coach_id: common.coachId, end_time: endTime, lesson_date: lessonDate, start_time: startTime, venue_id: common.venueId },
        slotId,
      )
    : [];
  finish(formData, conflicts.length ? `slot-saved-conflict:${conflicts.join("+")}` : "slot-updated", "calendar");
}

/** Old attendance form (status select); the calendar panel uses markLessonAttendance. */
export async function updateLessonAttendance(formData: FormData) {
  const bookingId = getString(formData, "bookingId");
  const attendanceStatus = getString(formData, "attendanceStatus");

  if (!bookingId || !["attended", "no_show", "booked"].includes(attendanceStatus)) {
    finish(formData, "attendance-missing", "calendar");
  }

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const payload = {
    attendance_note: getString(formData, "attendanceNote") || null,
    checked_in_at: attendanceStatus === "attended" ? new Date().toISOString() : null,
    status: attendanceStatus,
    updated_by: userId,
  };
  const { data: before } = await supabase.from("lesson_bookings").select("*").eq("club_id", clubId).eq("id", bookingId).maybeSingle();
  const { error } = await supabase.from("lesson_bookings").update(payload).eq("club_id", clubId).eq("id", bookingId);

  if (error) {
    logDbError("lesson_bookings.attendance", error);
    finish(formData, failureStatus("attendance-update-failed", error), "calendar");
  }

  await recordAudit(supabase, {
    action: "lesson_booking.attendance_updated",
    actorUserId: userId,
    after: payload,
    before,
    clubId,
    entityId: bookingId,
    entityType: "lesson_bookings",
    metadata: { source: "admin.lessons" },
  });

  finish(formData, "attendance-updated", "calendar");
}

export async function archiveLessonSlot(formData: FormData) {
  const slotId = getString(formData, "slotId");
  if (!slotId) finish(formData, "slot-not-found", "calendar");
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const [{ data: before }, { count }] = await Promise.all([
    supabase.from("lesson_slots").select("*").eq("id", slotId).eq("club_id", clubId).is("archived_at", null).maybeSingle(),
    supabase.from("lesson_bookings").select("id", { count: "exact", head: true }).eq("slot_id", slotId).not("status", "in", "(cancelled,late_cancelled,closed)"),
  ]);
  if (!before) finish(formData, "slot-not-found", "calendar");
  if ((count ?? 0) > 0) finish(formData, "slot-archive-has-bookings", "calendar");
  const { error } = await supabase
    .from("lesson_slots")
    .update({ archived_at: new Date().toISOString(), status: "cancelled", updated_by: userId })
    .eq("id", slotId)
    .eq("club_id", clubId);
  if (error) {
    logDbError("lesson_slots.archive", error);
    finish(formData, failureStatus("slot-archive-failed", error), "calendar");
  }
  await recordAudit(supabase, {
    action: "lesson_slot.archived",
    actorUserId: userId,
    before,
    clubId,
    entityId: slotId,
    entityType: "lesson_slots",
    metadata: { source: "admin.lessons" },
  });
  // The round is gone: close the side panel.
  redirect(`/admin/lessons?date=${before.lesson_date}&status=slot-archived`);
}

export async function removeLessonBooking(formData: FormData) {
  const bookingId = getString(formData, "bookingId");
  if (!bookingId) finish(formData, "attendance-missing", "calendar");
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { data: before } = await supabase.from("lesson_bookings").select("*").eq("club_id", clubId).eq("id", bookingId).maybeSingle();
  if (!before) finish(formData, "attendance-missing", "calendar");
  const { error } = await supabase
    .from("lesson_bookings")
    .update({ attendance_note: getString(formData, "attendanceNote") || "นำออกโดยผู้ดูแล", status: "cancelled", updated_by: userId })
    .eq("club_id", clubId)
    .eq("id", bookingId);
  if (error) {
    logDbError("lesson_bookings.remove", error);
    finish(formData, failureStatus("attendance-update-failed", error), "calendar");
  }
  await recordAudit(supabase, {
    action: "lesson_booking.removed_by_admin",
    actorUserId: userId,
    before,
    clubId,
    entityId: bookingId,
    entityType: "lesson_bookings",
    metadata: { source: "admin.lessons" },
  });
  finish(formData, "booking-removed", "calendar");
}

// ---------- rules, booking window, announcement ----------

/**
 * One action for the three settings forms: `section` = "window" (booking window), "rules"
 * (กติกา) or "announcement" (ประกาศ). Only that section's columns are written.
 */
export async function saveLessonBookingSettings(formData: FormData) {
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const section = getString(formData, "section");
  const tab: LessonsAdminTab = section === "announcement" ? "announcement" : "settings";
  const anchor = section === "window" ? "booking-window" : section === "rules" ? "rules" : undefined;

  const { data: before } = await supabase.from("lesson_booking_settings").select("*").eq("club_id", clubId).maybeSingle();
  const payload: Record<string, unknown> = { club_id: clubId, updated_by: userId };

  if (section === "window") {
    const openAt = fromBangkokInputValue(getString(formData, "bookingOpenAt"));
    const closeAt = fromBangkokInputValue(getString(formData, "bookingCloseAt"));
    if (openAt && closeAt && closeAt <= openAt) {
      redirectLessons("settings-window-invalid", tab, anchor);
    }
    payload.booking_open_at = openAt;
    payload.booking_close_at = closeAt;
  } else if (section === "rules") {
    if (isV2Form(formData)) {
      const rules = lessonRulesFromForm(formData);
      if ("error" in rules) {
        redirectLessons(`rules-invalid:${rules.error}`, tab, anchor);
      }
      Object.assign(payload, rules.values);
    } else {
      // Database without lessons v2: only the two original limits exist.
      payload.max_bookings_per_member = Math.max(0, Math.trunc(getNumberOrNull(formData, "max_bookings_per_member") ?? 0));
      payload.cancel_cutoff_hours = Math.max(0, Math.trunc(getNumberOrNull(formData, "cancel_cutoff_hours") ?? 24));
    }
  } else if (section === "announcement") {
    const announcementTitle = getString(formData, "announcementTitle");
    const announcementBody = getString(formData, "announcementBody");
    if (anyCorruptedText([announcementTitle, announcementBody])) {
      redirectLessons("text-corrupted", tab);
    }
    const currentVersion = before?.announcement_version ?? 0;
    const bumpVersion = getBoolean(formData, "announcementNewVersion") && Boolean(announcementTitle || announcementBody);
    payload.announcement_title = announcementTitle;
    payload.announcement_body = announcementBody;
    payload.announcement_version = bumpVersion ? currentVersion + 1 : currentVersion;
  } else {
    redirectLessons("settings-save-failed", "settings");
  }

  const { error } = await supabase.from("lesson_booking_settings").upsert(payload, { onConflict: "club_id" });

  if (error) {
    logDbError("lesson_booking_settings.save", error);
    redirectLessons(failureStatus("settings-save-failed", error), tab, anchor);
  }

  await recordAudit(supabase, {
    action: "lesson_booking_settings.updated",
    actorUserId: userId,
    after: payload,
    before,
    clubId,
    entityId: clubId,
    entityType: "lesson_booking_settings",
    metadata: { section, source: "admin.lessons" },
  });

  redirectLessons(section === "announcement" ? "announcement-saved" : section === "rules" ? "rules-saved" : "settings-saved", tab, anchor);
}

// ---------- recurring rounds (wizard) ----------

type PlanForm = {
  bayLabel: string | null;
  capacity: number;
  coachId: string | null;
  from: string;
  programId: string;
  title: string;
  to: string;
  times: Array<{ end_time: string; start_time: string }>;
  venueId: string | null;
  weekdays: number[];
};

/** Reads the wizard form; returns the first problem in Thai. */
function readPlanForm(formData: FormData): PlanForm | { error: string } {
  const programId = getString(formData, "programId");
  const title = getString(formData, "title");
  if (!programId) return { error: "เลือกคอร์สก่อน" };
  if (!title) return { error: "ใส่ชื่อรอบเรียน" };
  const parsedTimes = parseTimeRangesDetailed(getString(formData, "timeRanges"));
  if ("error" in parsedTimes) return { error: parsedTimes.error };
  const capacity = getNumberOrNull(formData, "capacity");
  if (!capacity || capacity < 1 || !Number.isInteger(capacity)) return { error: "ที่นั่งต่อรอบต้องเป็นจำนวนเต็มตั้งแต่ 1 คน" };
  const v2 = isV2Form(formData);
  const venueId = v2 ? getId(formData, "venueId") : null;
  return {
    bayLabel: venueId ? getString(formData, "bayLabel") || null : null,
    capacity,
    coachId: v2 ? getId(formData, "coachId") : null,
    from: getString(formData, "dateFrom"),
    programId,
    title,
    times: parsedTimes.ranges,
    to: getString(formData, "dateTo"),
    venueId,
    weekdays: formData
      .getAll("weekdays")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
  };
}

type PlanOutcome =
  | { error: string }
  | {
      counts: ReturnType<typeof applyConflictRows>["counts"];
      dbChecked: boolean;
      items: PlannedSlot[];
      summary: string;
      toCreate: Array<{ end_time: string; lesson_date: string; start_time: string }>;
      venue: LessonVenue | null;
    };

/**
 * The wizard's plan: planSlots (dates × times, max 300) + clashes with existing rounds — same
 * course at the same start, the coach or the venue/bay busy, two typed ranges overlapping — then
 * the database check (rpc lesson_slot_conflicts) when lessons v2 is installed.
 */
async function computePlan(supabase: LessonsClient | null, clubId: string | null, form: PlanForm, v2: boolean): Promise<PlanOutcome> {
  let existing: PlannerExistingSlot[] = [];
  let venue: LessonVenue | null = null;

  if (supabase && clubId) {
    const columns = v2 ? "id, program_id, title, lesson_date, start_time, end_time, status, archived_at, coach_id, venue_id, bay_label" : "id, program_id, title, lesson_date, start_time, end_time, status, archived_at";
    const [existingResult, venueResult] = await Promise.all([
      form.from && form.to && form.from <= form.to
        ? fetchAllRows<PlannerExistingSlot>((start, end) =>
            supabase
              .from("lesson_slots")
              .select(columns)
              .eq("club_id", clubId)
              .is("archived_at", null)
              .gte("lesson_date", form.from)
              .lte("lesson_date", form.to)
              .order("id")
              .range(start, end) as unknown as PromiseLike<{ data: PlannerExistingSlot[] | null; error: PostgrestError | null }>,
          )
        : Promise.resolve({ data: [], error: null }),
      form.venueId ? supabase.from("lesson_venues").select("*").eq("club_id", clubId).eq("id", form.venueId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (existingResult.error) {
      logDbError("lesson_slots.plan.existing", existingResult.error);
      return { error: "ตรวจรอบที่มีอยู่แล้วไม่สำเร็จ ลองอีกครั้ง" };
    }
    existing = existingResult.data ?? [];
    venue = (venueResult.data as LessonVenue | null) ?? null;
  } else {
    // Bypass preview: plan against the sample rounds.
    const sample = lessonSampleData(bangkokDate());
    existing = sample.slots.map((slot) => ({ ...slot, archived_at: null }));
    venue = sample.venues.find((item) => item.id === form.venueId) ?? null;
  }

  const plan = planSlotsWithConflicts({
    bayLabel: form.bayLabel,
    coachId: form.coachId,
    existing,
    from: form.from,
    programId: form.programId,
    times: form.times,
    to: form.to,
    venueId: form.venueId,
    weekdays: form.weekdays,
  });
  if ("error" in plan) return { error: plan.error };

  let result = plan;
  let dbChecked = false;
  if (supabase && clubId && v2 && (form.coachId || form.venueId)) {
    const { data, error } = await supabase.rpc("lesson_slot_conflicts", {
      p_bay_label: form.bayLabel,
      p_club_id: clubId,
      p_coach_id: form.coachId,
      p_items: plan.items.map(({ end_time, lesson_date, start_time }) => ({ end_time, lesson_date, start_time })),
      p_venue_id: form.venueId,
    });
    if (error) {
      logDbError("lesson_slot_conflicts.plan", error);
    } else {
      result = applyConflictRows(plan.items, (data ?? []) as LessonSlotConflictRow[]);
      dbChecked = true;
    }
  }
  return { counts: result.counts, dbChecked, items: result.items, summary: result.summary, toCreate: result.toCreate, venue };
}

export type SlotPreview =
  | { error: string; ok: false }
  | {
      capacityWarning: string | null;
      counts: { coach: number; create: number; duplicate: number; overlap: number; skipped: number; total: number; venue: number };
      dbChecked: boolean;
      items: Array<{ conflicts: Array<{ label: string; time: string | null; title: string | null }>; date: string; end: string; skip: boolean; start: string }>;
      ok: true;
      summary: string;
    };

/** Wizard step "ดูตัวอย่าง": what would be created and what is skipped, without writing anything. */
export async function previewLessonSlots(formData: FormData): Promise<SlotPreview> {
  const form = readPlanForm(formData);
  if ("error" in form) return { error: form.error, ok: false };

  let supabase: LessonsClient | null = null;
  let clubId: string | null = null;
  const user = await getSessionUser();
  if (user) {
    const staff = await requireLessonAdminClub();
    supabase = staff.supabase;
    clubId = staff.clubId;
  } else if (!(isAuthBypassEnabled() && formData.get("bypass") === "admin")) {
    return { error: "กรุณาเข้าสู่ระบบอีกครั้ง", ok: false };
  }

  const outcome = await computePlan(supabase, clubId, form, isV2Form(formData));
  if ("error" in outcome) return { error: outcome.error, ok: false };
  return {
    capacityWarning: venueCapacityWarning(form.capacity, outcome.venue, form.bayLabel),
    counts: outcome.counts,
    dbChecked: outcome.dbChecked,
    items: outcome.items.map((item) => ({
      conflicts: item.conflicts.map((conflict) => ({
        label: plannerConflictLabels[conflict.kind],
        time: conflict.start_time && conflict.end_time ? `${conflict.start_time}–${conflict.end_time}` : null,
        title: conflict.title ?? null,
      })),
      date: item.lesson_date,
      end: item.end_time,
      skip: item.skip,
      start: item.start_time,
    })),
    ok: true,
    summary: outcome.summary,
  };
}

export async function generateLessonSlots(formData: FormData) {
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const form = readPlanForm(formData);

  if ("error" in form) {
    redirectLessons(`generate-invalid:${form.error}`, "create");
  }
  if (anyCorruptedText(textFields(formData))) {
    redirectLessons("text-corrupted", "create");
  }

  const { data: program } = await supabase
    .from("lesson_programs")
    .select("id")
    .eq("club_id", clubId)
    .eq("id", form.programId)
    .is("archived_at", null)
    .maybeSingle();

  if (!program) {
    redirectLessons("program-not-found", "create");
  }

  const v2 = isV2Form(formData);
  const outcome = await computePlan(supabase, clubId, form, v2);
  if ("error" in outcome) {
    redirectLessons(`generate-invalid:${outcome.error}`, "create");
  }
  if (!outcome.toCreate.length) {
    redirectLessons(outcome.counts.duplicate === outcome.counts.total ? "generate-nothing-new" : `generate-invalid:${outcome.summary}`, "create");
  }

  const common = slotCommonPayload(formData).payload;
  const shared = {
    ...common,
    capacity: form.capacity,
    club_id: clubId,
    created_by: userId,
    program_id: form.programId,
    updated_by: userId,
    waitlist_capacity: Math.max(0, Math.trunc(getNumberOrNull(formData, "waitlistCapacity") ?? 0)),
  };
  const rows = outcome.toCreate.map((item) => ({ ...shared, end_time: item.end_time, lesson_date: item.lesson_date, start_time: item.start_time }));
  const { data: created, error } = await supabase.from("lesson_slots").insert(rows).select("id");

  if (error) {
    logDbError("lesson_slots.generate", error);
    redirectLessons(failureStatus("slot-create-failed", error), "create");
  }

  await recordAudit(supabase, {
    action: "lesson_slot.bulk_created",
    actorUserId: userId,
    after: { count: created?.length ?? rows.length, from: form.from, to: form.to, ...shared },
    clubId,
    entityId: form.programId,
    entityType: "lesson_slots",
    metadata: { db_checked: outcome.dbChecked, skipped: outcome.counts.skipped, skipped_by_kind: outcome.counts, source: "admin.lessons" },
  });

  const opened = getBoolean(formData, "openBookingNow") ? await openBookingWindowNow(supabase, clubId, userId) : null;
  const status = generatedStatusKey(created?.length ?? rows.length, outcome.counts, Boolean(opened?.opened));
  redirect(`/admin/lessons?date=${rows[0].lesson_date}&status=${encodeURIComponent(status)}`);
}
