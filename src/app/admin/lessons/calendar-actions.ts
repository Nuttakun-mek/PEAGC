"use server";

import {
  getId,
  getString,
  redirectBack,
  requireLessonAdminClub,
  rpcFailureStatus,
} from "@/app/admin/lessons/action-helpers";
import { recordAudit } from "@/lib/audit";
import { closureStatusKey, isIsoDate } from "@/lib/lessons/admin";
import { classifyDbError, failureStatus, logDbError } from "@/lib/supabase/errors";
import { anyCorruptedText } from "@/lib/text-integrity";

// Calendar side-panel actions (lessons v2 RPCs). Each form sends a hidden "returnTo" so the admin
// lands back on the same week / month with the same round open.

/** "งดเรียนทั้งวัน": cancels the day's rounds, refunds credits and notifies members (close_lesson_day). */
export async function closeLessonDay(formData: FormData) {
  const date = getString(formData, "date");
  const reason = getString(formData, "reason");
  if (!isIsoDate(date)) redirectBack(formData, "rpc:INVALID_DATE");
  if (!reason) redirectBack(formData, "rpc:REASON_REQUIRED");
  if (anyCorruptedText([reason])) redirectBack(formData, "text-corrupted");

  const { clubId, supabase } = await requireLessonAdminClub();
  const { data, error } = await supabase.rpc("close_lesson_day", {
    p_club_id: clubId,
    p_date: date,
    p_reason: reason,
    p_venue_id: getId(formData, "venueId"),
  });

  if (error) {
    logDbError("close_lesson_day", error);
    redirectBack(formData, rpcFailureStatus(error, "day-close-failed"));
  }

  // The RPC writes its own audit row.
  redirectBack(formData, closureStatusKey(data as Record<string, number> | null));
}

/** "ย้ายไปรอบอื่น" (admin_move_lesson_booking): keeps the credit, notifies the member. */
export async function moveLessonBooking(formData: FormData) {
  const bookingId = getId(formData, "bookingId");
  const targetSlotId = getId(formData, "targetSlotId");
  if (!bookingId) redirectBack(formData, "rpc:NO_BOOKING");
  if (!targetSlotId) redirectBack(formData, "move-target-missing");
  const note = getString(formData, "note");
  if (anyCorruptedText([note])) redirectBack(formData, "text-corrupted");

  const { supabase } = await requireLessonAdminClub();
  const { error } = await supabase.rpc("admin_move_lesson_booking", {
    p_booking_id: bookingId,
    p_note: note || null,
    p_target_slot_id: targetSlotId,
  });

  if (error) {
    logDbError("admin_move_lesson_booking", error);
    redirectBack(formData, rpcFailureStatus(error, "move-failed"));
  }

  redirectBack(formData, "booking-moved");
}

/**
 * เช็กชื่อ / ขาดเรียน / ล้าง (mark_lesson_attendance). On a database without lessons v2 the
 * booking row is updated directly, as the old roster did.
 */
export async function markLessonAttendance(formData: FormData) {
  const bookingId = getId(formData, "bookingId");
  const value = getString(formData, "attended");
  if (!bookingId || !["true", "false", "clear"].includes(value)) {
    redirectBack(formData, "attendance-missing");
  }
  const attended = value === "true" ? true : value === "false" ? false : null;
  const note = getString(formData, "note") || null;

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { error } = await supabase.rpc("mark_lesson_attendance", {
    p_attended: attended,
    p_booking_id: bookingId,
    p_note: note,
  });

  if (error && classifyDbError(error) === "schema-outdated") {
    const status = attended === true ? "attended" : attended === false ? "no_show" : "booked";
    const payload = {
      ...(note ? { attendance_note: note } : {}),
      checked_in_at: attended === true ? new Date().toISOString() : null,
      status,
      updated_by: userId,
    };
    const { data: before } = await supabase.from("lesson_bookings").select("*").eq("club_id", clubId).eq("id", bookingId).maybeSingle();
    if (!before || !["booked", "attended", "no_show"].includes(before.status)) {
      redirectBack(formData, "rpc:NOT_BOOKED");
    }
    const { error: updateError } = await supabase.from("lesson_bookings").update(payload).eq("club_id", clubId).eq("id", bookingId);
    if (updateError) {
      logDbError("lesson_bookings.attendance.v1", updateError);
      redirectBack(formData, failureStatus("attendance-update-failed", updateError));
    }
    await recordAudit(supabase, {
      action: "lesson_booking.attendance_updated",
      actorUserId: userId,
      after: payload,
      before,
      clubId,
      entityId: bookingId,
      entityType: "lesson_bookings",
      metadata: { source: "admin.lessons.calendar" },
    });
    redirectBack(formData, "attendance-updated");
  }

  if (error) {
    logDbError("mark_lesson_attendance", error);
    redirectBack(formData, rpcFailureStatus(error, "attendance-update-failed"));
  }

  redirectBack(formData, "attendance-updated");
}

/** ยกเลิกรอบ: the database cancels its bookings, refunds credits and notifies the members. */
export async function cancelLessonSlot(formData: FormData) {
  const slotId = getId(formData, "slotId");
  if (!slotId) redirectBack(formData, "slot-not-found");
  const reason = getString(formData, "reason");
  if (anyCorruptedText([reason])) redirectBack(formData, "text-corrupted");

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { data: before } = await supabase.from("lesson_slots").select("*").eq("club_id", clubId).eq("id", slotId).is("archived_at", null).maybeSingle();
  if (!before) redirectBack(formData, "slot-not-found");
  if (before.status === "cancelled") redirectBack(formData, "slot-already-cancelled");

  const note = reason ? [before.note, `ยกเลิก: ${reason}`].filter(Boolean).join(" · ") : before.note;
  const { error } = await supabase
    .from("lesson_slots")
    .update({ note, status: "cancelled", updated_by: userId })
    .eq("club_id", clubId)
    .eq("id", slotId);

  if (error) {
    logDbError("lesson_slots.cancel", error);
    redirectBack(formData, failureStatus("slot-update-failed", error));
  }

  await recordAudit(supabase, {
    action: "lesson_slot.cancelled",
    actorUserId: userId,
    after: { note, status: "cancelled" },
    before,
    clubId,
    entityId: slotId,
    entityType: "lesson_slots",
    metadata: { reason: reason || null, source: "admin.lessons.calendar" },
  });

  redirectBack(formData, "slot-cancelled");
}

/** New check-in QR for a round (the old printout stops working). */
export async function rotateLessonCheckinToken(formData: FormData) {
  const slotId = getId(formData, "slotId");
  if (!slotId) redirectBack(formData, "slot-not-found");

  const { clubId, supabase, userId } = await requireLessonAdminClub();
  const { error } = await supabase.rpc("lesson_checkin_token", { p_rotate: true, p_slot_id: slotId });

  if (error) {
    logDbError("lesson_checkin_token.rotate", error);
    redirectBack(formData, rpcFailureStatus(error, "qr-rotate-failed"));
  }

  await recordAudit(supabase, {
    action: "lesson_checkin_token.rotated",
    actorUserId: userId,
    clubId,
    entityId: slotId,
    entityType: "lesson_checkin_tokens",
    metadata: { source: "admin.lessons.qr" },
  });

  redirectBack(formData, "qr-rotated");
}
