"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";

import { rpcErrorCode } from "@/lib/lessons/errors";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

// Coach portal actions. The RPCs check who may do what (the slot's coach from 30 minutes before
// the start, lesson staff any time) and write the audit rows; these actions only pass the form on.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const skillLevels = new Set(["beginner", "intermediate", "advanced"]);

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** Back to the roster, at the learner's row. `coach` keeps a staff member's coach choice. */
function rosterUrl(formData: FormData, query: string, bookingId?: string) {
  const slotId = getString(formData, "slotId");
  if (!UUID.test(slotId)) return "/coach";
  const coach = getString(formData, "coach");
  const coachParam = UUID.test(coach) ? `&coach=${coach}` : "";
  return `/coach/slots/${slotId}?${query}${coachParam}${bookingId && UUID.test(bookingId) ? `#learner-${bookingId}` : ""}`;
}

function errorQuery(error: { code?: string; message: string }) {
  if (classifyDbError(error) === "schema-outdated") return "error=outdated";
  const code = rpcErrorCode(error.message);
  if (!code) logDbError("coach action", error);
  return `error=${code ?? "failed"}`;
}

async function requireSignedIn(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const slotId = getString(formData, "slotId");
    redirect(`/login?next=${encodeURIComponent(UUID.test(slotId) ? `/coach/slots/${slotId}` : "/coach")}`);
  }
  return supabase;
}

/** One tap: มาเรียน (attended) / ขาด (no_show) / ล้าง (back to booked). */
export async function markLessonAttendance(formData: FormData) {
  const bookingId = getString(formData, "bookingId");
  const mark = getString(formData, "mark");

  if (!UUID.test(bookingId) || !["attended", "no_show", "undo"].includes(mark)) {
    redirect(rosterUrl(formData, "error=failed"));
  }

  const supabase = await requireSignedIn(formData);
  const { error } = await supabase.rpc("mark_lesson_attendance", {
    p_attended: mark === "attended" ? true : mark === "no_show" ? false : null,
    p_booking_id: bookingId,
  });

  if (error) {
    redirect(rosterUrl(formData, errorQuery(error), bookingId));
  }

  redirect(rosterUrl(formData, `status=attendance-${mark}`, bookingId));
}

/** Coach note after the lesson, optional new skill level and swing video link. */
export async function addLessonCoachNote(formData: FormData) {
  const bookingId = getString(formData, "bookingId");
  const note = getString(formData, "note");
  const skillLevel = getString(formData, "skillLevel");
  const videoUrl = getString(formData, "videoUrl");
  const visible = formData.get("visibleToMember") === "on";

  if (!UUID.test(bookingId)) {
    redirect(rosterUrl(formData, "error=failed"));
  }
  if (!note) {
    redirect(rosterUrl(formData, "error=NOTE_REQUIRED", bookingId));
  }
  if (note.length > 2000) {
    redirect(rosterUrl(formData, "error=note-too-long", bookingId));
  }
  if (skillLevel && !skillLevels.has(skillLevel)) {
    redirect(rosterUrl(formData, "error=INVALID_SKILL", bookingId));
  }
  if (videoUrl && !/^https?:\/\//i.test(videoUrl)) {
    redirect(rosterUrl(formData, "error=INVALID_URL", bookingId));
  }

  const supabase = await requireSignedIn(formData);
  const { error } = await supabase.rpc("add_lesson_coach_note", {
    p_booking_id: bookingId,
    p_note: note,
    p_skill_level: skillLevel || null,
    p_video_url: videoUrl || null,
    p_visible_to_member: visible,
  });

  if (error) {
    redirect(rosterUrl(formData, errorQuery(error), bookingId));
  }

  redirect(rosterUrl(formData, "status=note-saved", bookingId));
}
