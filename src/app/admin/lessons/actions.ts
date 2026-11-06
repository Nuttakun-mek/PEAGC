"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { fromBangkokInputValue, parseTimeRanges, planSlots } from "@/lib/lessons/booking";

const lessonAdminRoles = ["platform_owner", "club_admin", "committee"];

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

function getBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function getStringList(formData: FormData, key: string) {
  return getString(formData, key)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function redirectLessons(status: string): never {
  redirect(`/admin/lessons?status=${encodeURIComponent(status)}`);
}

async function requireLessonAdminClub() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/lessons");
  }

  const { data: role, error } = await supabase
    .from("user_roles")
    .select("club_id, role_key")
    .eq("user_id", user.id)
    .in("role_key", lessonAdminRoles)
    .limit(1)
    .maybeSingle();

  if (error || !role) {
    redirect("/member?status=admin-required");
  }

  return { clubId: role.club_id as string, supabase, userId: user.id };
}

export async function createLessonProgram(formData: FormData) {
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const name = getString(formData, "name");

  if (!name) {
    redirectLessons("program-missing");
  }

  const payload = {
    club_id: clubId,
    coach_name: getString(formData, "coachName") || null,
    created_by: userId,
    description: getString(formData, "description") || null,
    level: getString(formData, "level") || "all",
    name,
    price: getNumberOrNull(formData, "price") ?? 0,
    status: getString(formData, "status") || "active",
    updated_by: userId,
  };
  const { data: program, error } = await supabase
    .from("lesson_programs")
    .insert(payload)
    .select("id")
    .single();

  if (error || !program) {
    redirectLessons("program-create-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "lesson_program.created",
    actor_user_id: userId,
    after_data: payload,
    club_id: clubId,
    entity_id: program.id,
    entity_type: "lesson_programs",
    metadata: { source: "admin.lessons" },
  });

  redirectLessons("program-created");
}

export async function updateLessonProgram(formData: FormData) {
  const programId = getString(formData, "programId");
  const name = getString(formData, "name");

  if (!programId || !name) {
    redirectLessons("program-missing");
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
    redirectLessons("program-not-found");
  }

  const payload = {
    coach_name: getString(formData, "coachName") || null,
    description: getString(formData, "description") || null,
    level: getString(formData, "level") || "all",
    name,
    price: getNumberOrNull(formData, "price") ?? 0,
    status: getString(formData, "status") || "active",
    updated_by: userId,
  };
  const { error } = await supabase
    .from("lesson_programs")
    .update(payload)
    .eq("club_id", clubId)
    .eq("id", programId);

  if (error) {
    redirectLessons("program-update-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "lesson_program.updated",
    actor_user_id: userId,
    after_data: payload,
    before_data: before,
    club_id: clubId,
    entity_id: programId,
    entity_type: "lesson_programs",
    metadata: { source: "admin.lessons" },
  });

  redirectLessons("program-updated");
}

export async function createLessonSlot(formData: FormData) {
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const programId = getString(formData, "programId");
  const title = getString(formData, "title");
  const lessonDate = getString(formData, "lessonDate");
  const startTime = getString(formData, "startTime");
  const endTime = getString(formData, "endTime");

  if (!programId || !title || !lessonDate || !startTime || !endTime) {
    redirectLessons("slot-missing");
  }

  const { data: program } = await supabase
    .from("lesson_programs")
    .select("id")
    .eq("club_id", clubId)
    .eq("id", programId)
    .maybeSingle();

  if (!program) {
    redirectLessons("program-not-found");
  }

  const payload = {
    capacity: getNumberOrNull(formData, "capacity") ?? 1,
    club_id: clubId,
    coach_name: getString(formData, "coachName") || null,
    created_by: userId,
    end_time: endTime,
    waitlist_capacity: Math.max(0, getNumberOrNull(formData, "waitlistCapacity") ?? 0),
    lesson_date: lessonDate,
    note: getString(formData, "note") || null,
    program_id: programId,
    allow_member_reschedule: getBoolean(formData, "allowMemberReschedule"),
    reschedule_cutoff_hours: getNumberOrNull(formData, "rescheduleCutoffHours") ?? 12,
    start_time: startTime,
    status: getString(formData, "status") || "open",
    target_bureaus: getStringList(formData, "targetBureaus"),
    target_departments: getStringList(formData, "targetDepartments"),
    target_divisions: getStringList(formData, "targetDivisions"),
    target_sections: getStringList(formData, "targetSections"),
    target_work_lines: getStringList(formData, "targetWorkLines"),
    title,
    updated_by: userId,
    venue: getString(formData, "venue") || null,
  };
  const { data: slot, error } = await supabase
    .from("lesson_slots")
    .insert(payload)
    .select("id")
    .single();

  if (error || !slot) {
    redirectLessons("slot-create-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "lesson_slot.created",
    actor_user_id: userId,
    after_data: payload,
    club_id: clubId,
    entity_id: slot.id,
    entity_type: "lesson_slots",
    metadata: { source: "admin.lessons" },
  });

  redirectLessons("slot-created");
}

export async function updateLessonSlot(formData: FormData) {
  const slotId = getString(formData, "slotId");
  const programId = getString(formData, "programId");
  const title = getString(formData, "title");
  const lessonDate = getString(formData, "lessonDate");
  const startTime = getString(formData, "startTime");
  const endTime = getString(formData, "endTime");
  const capacity = getNumberOrNull(formData, "capacity");

  if (
    !slotId ||
    !programId ||
    !title ||
    !lessonDate ||
    !startTime ||
    !endTime ||
    !capacity ||
    capacity < 1
  ) {
    redirectLessons("slot-missing");
  }

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const [{ data: program }, { data: before }, { count: activeBookingCount }] =
    await Promise.all([
      supabase
        .from("lesson_programs")
        .select("id")
        .eq("club_id", clubId)
        .eq("id", programId)
        .maybeSingle(),
      supabase
        .from("lesson_slots")
        .select("*")
        .eq("club_id", clubId)
        .eq("id", slotId)
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("lesson_bookings")
        .select("id", { count: "exact", head: true })
        .eq("club_id", clubId)
        .eq("slot_id", slotId)
        .not("status", "in", "(cancelled)"),
    ]);

  if (!program || !before) {
    redirectLessons("slot-not-found");
  }

  const waitlistCapacity = Math.max(0, getNumberOrNull(formData, "waitlistCapacity") ?? 0);

  if (capacity + waitlistCapacity < (activeBookingCount ?? 0)) {
    redirectLessons("slot-capacity-too-low");
  }

  const payload = {
    allow_member_reschedule: getBoolean(formData, "allowMemberReschedule"),
    capacity,
    waitlist_capacity: waitlistCapacity,
    coach_name: getString(formData, "coachName") || null,
    end_time: endTime,
    lesson_date: lessonDate,
    note: getString(formData, "note") || null,
    program_id: programId,
    reschedule_cutoff_hours:
      getNumberOrNull(formData, "rescheduleCutoffHours") ?? 12,
    start_time: startTime,
    status: getString(formData, "status") || "open",
    target_bureaus: getStringList(formData, "targetBureaus"),
    target_departments: getStringList(formData, "targetDepartments"),
    target_divisions: getStringList(formData, "targetDivisions"),
    target_sections: getStringList(formData, "targetSections"),
    target_work_lines: getStringList(formData, "targetWorkLines"),
    title,
    updated_by: userId,
    venue: getString(formData, "venue") || null,
  };
  const { error } = await supabase
    .from("lesson_slots")
    .update(payload)
    .eq("club_id", clubId)
    .eq("id", slotId);

  if (error) {
    redirectLessons("slot-update-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "lesson_slot.updated",
    actor_user_id: userId,
    after_data: payload,
    before_data: before,
    club_id: clubId,
    entity_id: slotId,
    entity_type: "lesson_slots",
    metadata: { source: "admin.lessons" },
  });

  redirectLessons("slot-updated");
}

export async function updateLessonAttendance(formData: FormData) {
  const bookingId = getString(formData, "bookingId");
  const attendanceStatus = getString(formData, "attendanceStatus");

  if (!bookingId || !["attended", "no_show", "cancelled", "booked"].includes(attendanceStatus)) {
    redirectLessons("attendance-missing");
  }

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const payload = {
    attendance_note: getString(formData, "attendanceNote") || null,
    checked_in_at: attendanceStatus === "attended" ? new Date().toISOString() : null,
    status: attendanceStatus,
    updated_by: userId,
  };
  const { data: before } = await supabase
    .from("lesson_bookings")
    .select("*")
    .eq("club_id", clubId)
    .eq("id", bookingId)
    .maybeSingle();
  const { error } = await supabase
    .from("lesson_bookings")
    .update(payload)
    .eq("club_id", clubId)
    .eq("id", bookingId);

  if (error) {
    redirectLessons("attendance-update-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "lesson_booking.attendance_updated",
    actor_user_id: userId,
    after_data: payload,
    before_data: before,
    club_id: clubId,
    entity_id: bookingId,
    entity_type: "lesson_bookings",
    metadata: { source: "admin.lessons" },
  });

  redirectLessons("attendance-updated");
}

export async function archiveLessonSlot(formData: FormData) {
  const slotId = getString(formData, "slotId");
  if (!slotId) redirectLessons("slot-not-found");
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const [{ data: before }, { count }] = await Promise.all([
    supabase.from("lesson_slots").select("*").eq("id", slotId).eq("club_id", clubId).is("archived_at", null).maybeSingle(),
    supabase.from("lesson_bookings").select("id", { count: "exact", head: true }).eq("slot_id", slotId).not("status", "in", "(cancelled)"),
  ]);
  if (!before) redirectLessons("slot-not-found");
  if ((count ?? 0) > 0) redirectLessons("slot-archive-has-bookings");
  const { error } = await supabase.from("lesson_slots").update({ archived_at: new Date().toISOString(), status: "cancelled", updated_by: userId }).eq("id", slotId).eq("club_id", clubId);
  if (error) redirectLessons("slot-archive-failed");
  await supabase.from("audit_logs").insert({ action: "lesson_slot.archived", actor_user_id: userId, before_data: before, club_id: clubId, entity_id: slotId, entity_type: "lesson_slots", metadata: { source: "admin.lessons" } });
  redirectLessons("slot-archived");
}

export async function saveLessonBookingSettings(formData: FormData) {
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const openAt = fromBangkokInputValue(getString(formData, "bookingOpenAt"));
  const closeAt = fromBangkokInputValue(getString(formData, "bookingCloseAt"));

  if (openAt && closeAt && closeAt <= openAt) {
    redirectLessons("settings-window-invalid");
  }

  const { data: before } = await supabase
    .from("lesson_booking_settings")
    .select("*")
    .eq("club_id", clubId)
    .maybeSingle();
  const announcementTitle = getString(formData, "announcementTitle");
  const announcementBody = getString(formData, "announcementBody");
  const currentVersion = before?.announcement_version ?? 0;
  const bumpVersion = getBoolean(formData, "announcementNewVersion") && Boolean(announcementTitle || announcementBody);
  const payload = {
    announcement_body: announcementBody,
    announcement_title: announcementTitle,
    announcement_version: bumpVersion ? currentVersion + 1 : currentVersion,
    booking_close_at: closeAt,
    booking_open_at: openAt,
    cancel_cutoff_hours: Math.max(0, getNumberOrNull(formData, "cancelCutoffHours") ?? 24),
    club_id: clubId,
    max_bookings_per_member: Math.max(0, getNumberOrNull(formData, "maxBookingsPerMember") ?? 0),
    updated_by: userId,
  };
  const { error } = await supabase
    .from("lesson_booking_settings")
    .upsert(payload, { onConflict: "club_id" });

  if (error) {
    redirectLessons("settings-save-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "lesson_booking_settings.updated",
    actor_user_id: userId,
    after_data: payload,
    before_data: before,
    club_id: clubId,
    entity_id: clubId,
    entity_type: "lesson_booking_settings",
    metadata: { source: "admin.lessons" },
  });

  redirectLessons("settings-saved");
}

export async function generateLessonSlots(formData: FormData) {
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const programId = getString(formData, "programId");
  const title = getString(formData, "title");
  const times = parseTimeRanges(getString(formData, "timeRanges"));
  const weekdays = formData
    .getAll("weekdays")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

  if (!programId || !title) {
    redirectLessons("slot-missing");
  }
  if (!times) {
    redirectLessons("generate-times-invalid");
  }

  const plan = planSlots({
    from: getString(formData, "dateFrom"),
    times: times!,
    to: getString(formData, "dateTo"),
    weekdays,
  });

  if ("error" in plan) {
    redirectLessons(`generate-invalid:${plan.error}`);
  }

  const { data: program } = await supabase
    .from("lesson_programs")
    .select("id")
    .eq("club_id", clubId)
    .eq("id", programId)
    .maybeSingle();

  if (!program) {
    redirectLessons("program-not-found");
  }

  const items = plan.items;
  const { data: existing } = await supabase
    .from("lesson_slots")
    .select("lesson_date, start_time")
    .eq("club_id", clubId)
    .eq("program_id", programId)
    .is("archived_at", null)
    .gte("lesson_date", items[0].lesson_date)
    .lte("lesson_date", items[items.length - 1].lesson_date);
  const taken = new Set((existing ?? []).map((slot) => `${slot.lesson_date} ${String(slot.start_time).slice(0, 5)}`));
  const common = {
    allow_member_reschedule: getBoolean(formData, "allowMemberReschedule"),
    capacity: Math.max(1, getNumberOrNull(formData, "capacity") ?? 1),
    club_id: clubId,
    coach_name: getString(formData, "coachName") || null,
    created_by: userId,
    note: getString(formData, "note") || null,
    program_id: programId,
    reschedule_cutoff_hours: getNumberOrNull(formData, "rescheduleCutoffHours") ?? 12,
    status: getString(formData, "status") || "open",
    target_bureaus: getStringList(formData, "targetBureaus"),
    target_departments: getStringList(formData, "targetDepartments"),
    target_divisions: getStringList(formData, "targetDivisions"),
    target_sections: getStringList(formData, "targetSections"),
    target_work_lines: getStringList(formData, "targetWorkLines"),
    title,
    updated_by: userId,
    venue: getString(formData, "venue") || null,
    waitlist_capacity: Math.max(0, getNumberOrNull(formData, "waitlistCapacity") ?? 0),
  };
  const rows = items
    .filter((item) => !taken.has(`${item.lesson_date} ${item.start_time}`))
    .map((item) => ({ ...common, end_time: item.end_time, lesson_date: item.lesson_date, start_time: item.start_time }));

  if (!rows.length) {
    redirectLessons("generate-nothing-new");
  }

  const { data: created, error } = await supabase.from("lesson_slots").insert(rows).select("id");

  if (error) {
    redirectLessons("slot-create-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "lesson_slot.bulk_created",
    actor_user_id: userId,
    after_data: { count: created?.length ?? rows.length, from: items[0].lesson_date, to: items[items.length - 1].lesson_date, ...common },
    club_id: clubId,
    entity_id: programId,
    entity_type: "lesson_slots",
    metadata: { skipped: items.length - rows.length, source: "admin.lessons" },
  });

  redirectLessons(`generated:${created?.length ?? rows.length}:${items.length - rows.length}`);
}

export async function removeLessonBooking(formData: FormData) {
  const bookingId = getString(formData, "bookingId");
  if (!bookingId) redirectLessons("attendance-missing");
  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { data: before } = await supabase
    .from("lesson_bookings")
    .select("*")
    .eq("club_id", clubId)
    .eq("id", bookingId)
    .maybeSingle();
  if (!before) redirectLessons("attendance-missing");
  const { error } = await supabase
    .from("lesson_bookings")
    .update({ attendance_note: getString(formData, "attendanceNote") || "นำออกโดยผู้ดูแล", status: "cancelled", updated_by: userId })
    .eq("club_id", clubId)
    .eq("id", bookingId);
  if (error) redirectLessons("attendance-update-failed");
  await supabase.from("audit_logs").insert({
    action: "lesson_booking.removed_by_admin",
    actor_user_id: userId,
    before_data: before,
    club_id: clubId,
    entity_id: bookingId,
    entity_type: "lesson_bookings",
    metadata: { source: "admin.lessons" },
  });
  redirectLessons("booking-removed");
}
