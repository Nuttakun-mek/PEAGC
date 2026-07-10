"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
