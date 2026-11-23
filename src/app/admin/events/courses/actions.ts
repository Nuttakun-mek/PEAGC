"use server";

import { requireStaffClub } from "@/lib/auth/staff";
import { redirectAfterAction as redirect } from "@/lib/navigation";
import { isTeeColor, validateTee } from "@/lib/scoring/courses";
import { scoringRoles } from "@/lib/scoring/data";
import { HOLES } from "@/lib/scoring/engine";
import { failureStatus, logDbError } from "@/lib/supabase/errors";
import { anyCorruptedText } from "@/lib/text-integrity";

const PATH = "/admin/events/courses";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function numberOrNull(formData: FormData, key: string) {
  const value = str(formData, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function back(status: string, anchor = ""): never {
  redirect(`${PATH}?status=${status}${anchor ? `#${anchor}` : ""}`);
}

async function audit(
  staff: Awaited<ReturnType<typeof requireStaffClub>>,
  action: string,
  entityType: string,
  entityId: string | null,
  data: { after?: unknown; before?: unknown },
) {
  await staff.supabase.from("audit_logs").insert({
    action,
    actor_user_id: staff.userId,
    after_data: data.after ?? null,
    before_data: data.before ?? null,
    club_id: staff.clubId,
    entity_id: entityId,
    entity_type: entityType,
    metadata: { source: "admin.courses" },
  });
}

// ---------- courses ----------

function coursePayload(formData: FormData) {
  return {
    name: str(formData, "name"),
    note: str(formData, "note") || null,
    province: str(formData, "province") || null,
  };
}

export async function createCourse(formData: FormData) {
  const staff = await requireStaffClub(scoringRoles, PATH);
  const payload = coursePayload(formData);
  if (!payload.name) back("missing-name");
  if (anyCorruptedText([payload.name, payload.province, payload.note])) back("text-corrupted");

  const { data, error } = await staff.supabase
    .from("golf_courses")
    .insert({ ...payload, club_id: staff.clubId, created_by: staff.userId, updated_by: staff.userId })
    .select("id")
    .single();
  if (error || !data) {
    logDbError("courses.create", error);
    back(failureStatus("course-failed", error));
  }
  await audit(staff, "golf_course.created", "golf_courses", data.id, { after: payload });
  back("course-created", `course-${data.id}`);
}

export async function updateCourse(formData: FormData) {
  const staff = await requireStaffClub(scoringRoles, PATH);
  const courseId = str(formData, "courseId");
  const payload = coursePayload(formData);
  if (!courseId || !payload.name) back("missing-name", courseId ? `course-${courseId}` : "");
  if (anyCorruptedText([payload.name, payload.province, payload.note])) back("text-corrupted", `course-${courseId}`);

  const { data: before } = await staff.supabase.from("golf_courses").select("name, province, note").eq("id", courseId).eq("club_id", staff.clubId).maybeSingle();
  const { data, error } = await staff.supabase
    .from("golf_courses")
    .update({ ...payload, updated_by: staff.userId })
    .eq("id", courseId)
    .eq("club_id", staff.clubId)
    .select("id");
  if (error || !data?.length) {
    logDbError("courses.update", error);
    back(failureStatus("course-failed", error), `course-${courseId}`);
  }
  await audit(staff, "golf_course.updated", "golf_courses", courseId, { after: payload, before });
  back("course-saved", `course-${courseId}`);
}

export async function archiveCourse(formData: FormData) {
  const staff = await requireStaffClub(scoringRoles, PATH);
  const courseId = str(formData, "courseId");
  const restore = str(formData, "restore") === "1";
  const { data, error } = await staff.supabase
    .from("golf_courses")
    .update({ archived_at: restore ? null : new Date().toISOString(), updated_by: staff.userId })
    .eq("id", courseId)
    .eq("club_id", staff.clubId)
    .select("id");
  if (error || !data?.length) {
    logDbError("courses.archive", error);
    back(failureStatus("course-failed", error));
  }
  await audit(staff, restore ? "golf_course.restored" : "golf_course.archived", "golf_courses", courseId, {});
  back(restore ? "course-restored" : "course-archived");
}

// ---------- tees ----------

function teePayload(formData: FormData) {
  const pars = Array.from({ length: HOLES }, (_, i) => Number(str(formData, `par${i + 1}`)));
  const strokeIndex = Array.from({ length: HOLES }, (_, i) => Number(str(formData, `si${i + 1}`)));
  const color = str(formData, "color");
  return {
    color: isTeeColor(color) ? color : null,
    courseRating: numberOrNull(formData, "courseRating"),
    name: str(formData, "name"),
    pars,
    slopeRating: numberOrNull(formData, "slopeRating"),
    strokeIndex,
  };
}

function teeRow(tee: ReturnType<typeof teePayload>) {
  return {
    color: tee.color,
    course_rating: tee.courseRating,
    name: tee.name,
    par: tee.pars,
    slope_rating: tee.slopeRating,
    stroke_index: tee.strokeIndex,
  };
}

function teeError(tee: ReturnType<typeof teePayload>) {
  if (Number.isNaN(tee.courseRating) || Number.isNaN(tee.slopeRating)) return "invalid-rating";
  const errors = validateTee(tee);
  if (!errors.length) return null;
  if (errors.some((error) => error.startsWith("ตั้งชื่อ"))) return "missing-tee-name";
  if (errors.some((error) => error.startsWith("พาร์"))) return "invalid-pars";
  if (errors.some((error) => error.includes("(SI)"))) return "invalid-si";
  return "invalid-rating";
}

export async function saveTee(formData: FormData) {
  const staff = await requireStaffClub(scoringRoles, PATH);
  const courseId = str(formData, "courseId");
  const teeId = str(formData, "teeId");
  const tee = teePayload(formData);
  const anchor = teeId ? `tee-${teeId}` : `course-${courseId}`;
  if (!courseId) back("course-failed");
  const problem = teeError(tee);
  if (problem) back(problem, anchor);
  if (anyCorruptedText([tee.name])) back("text-corrupted", anchor);

  if (teeId) {
    const { data: before } = await staff.supabase
      .from("golf_course_tees")
      .select("name, color, course_rating, slope_rating, par, stroke_index")
      .eq("id", teeId)
      .eq("club_id", staff.clubId)
      .maybeSingle();
    const { data, error } = await staff.supabase
      .from("golf_course_tees")
      .update({ ...teeRow(tee), updated_by: staff.userId })
      .eq("id", teeId)
      .eq("club_id", staff.clubId)
      .select("id");
    if (error || !data?.length) {
      logDbError("tees.update", error);
      back(failureStatus("tee-failed", error), anchor);
    }
    await audit(staff, "golf_course_tee.updated", "golf_course_tees", teeId, { after: teeRow(tee), before });
    back("tee-saved", anchor);
  }

  const { data, error } = await staff.supabase
    .from("golf_course_tees")
    .insert({ ...teeRow(tee), club_id: staff.clubId, course_id: courseId, created_by: staff.userId, updated_by: staff.userId })
    .select("id")
    .single();
  if (error || !data) {
    logDbError("tees.create", error);
    back(failureStatus("tee-failed", error), anchor);
  }
  await audit(staff, "golf_course_tee.created", "golf_course_tees", data.id, { after: teeRow(tee) });
  back("tee-created", `tee-${data.id}`);
}

export async function archiveTee(formData: FormData) {
  const staff = await requireStaffClub(scoringRoles, PATH);
  const teeId = str(formData, "teeId");
  const { data, error } = await staff.supabase
    .from("golf_course_tees")
    .update({ archived_at: new Date().toISOString(), updated_by: staff.userId })
    .eq("id", teeId)
    .eq("club_id", staff.clubId)
    .select("id, course_id");
  if (error || !data?.length) {
    logDbError("tees.archive", error);
    back(failureStatus("tee-failed", error));
  }
  await audit(staff, "golf_course_tee.archived", "golf_course_tees", teeId, {});
  back("tee-archived", `course-${data[0].course_id}`);
}
