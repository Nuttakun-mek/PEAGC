"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function normalizeTarget(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function matchesTargetList(
  targets: string[] | null | undefined,
  memberValue: string | null | undefined,
) {
  if (!targets?.length) {
    return true;
  }

  const normalizedMemberValue = normalizeTarget(memberValue);

  return targets.some((target) => normalizeTarget(target) === normalizedMemberValue);
}

function isVisibleForMember(
  item: {
    target_bureaus?: string[] | null;
    target_departments?: string[] | null;
    target_divisions?: string[] | null;
    target_sections?: string[] | null;
    target_work_lines?: string[] | null;
  },
  member: {
    bureau?: string | null;
    department?: string | null;
    division?: string | null;
    section?: string | null;
    work_line?: string | null;
  },
) {
  return (
    matchesTargetList(item.target_work_lines, member.work_line) &&
    matchesTargetList(item.target_bureaus, member.bureau) &&
    matchesTargetList(item.target_divisions, member.division) &&
    matchesTargetList(item.target_departments, member.department) &&
    matchesTargetList(item.target_sections, member.section)
  );
}

export async function registerForEvent(formData: FormData) {
  const eventId = getString(formData, "eventId");

  if (!eventId) {
    redirect("/member?status=registration-failed");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/member");
  }

  const { data: member } = await supabase
    .from("members")
    .select("id, club_id, status, work_line, bureau, division, department, section")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member || member.status !== "active") {
    redirect("/member?status=member-not-approved");
  }

  const { data: event } = await supabase
    .from("events")
    .select("id, club_id, status, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections")
    .eq("id", eventId)
    .eq("club_id", member.club_id)
    .is("archived_at", null)
    .maybeSingle();

  if (!event || event.status !== "open") {
    redirect("/member?status=registration-closed");
  }

  if (!isVisibleForMember(event, member)) {
    redirect("/member?status=registration-closed");
  }

  const { data: existing } = await supabase
    .from("event_registrations")
    .select("id")
    .eq("event_id", event.id)
    .eq("member_id", member.id)
    .not("status", "in", "(cancelled,no_show)")
    .maybeSingle();

  if (existing) {
    redirect("/member?status=already-registered");
  }

  const { error } = await supabase.from("event_registrations").insert({
    club_id: member.club_id,
    created_by: user.id,
    event_id: event.id,
    member_id: member.id,
    registration_type: "single",
    status: "pending_payment",
    updated_by: user.id,
  });

  if (error) {
    if (error.code === "23505") {
      redirect("/member?status=already-registered");
    }

    redirect("/member?status=registration-failed");
  }

  redirect("/member?status=registered");
}

export async function bookLessonSlot(formData: FormData) {
  const slotId = getString(formData, "slotId");

  if (!slotId) {
    redirect("/member?status=lesson-booking-failed");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/member");
  }

  const { data: member } = await supabase
    .from("members")
    .select("id, club_id, status, work_line, bureau, division, department, section")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member || member.status !== "active") {
    redirect("/member?status=member-not-approved");
  }

  const { data: slot } = await supabase
    .from("lesson_slots")
    .select("id, club_id, capacity, status, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections")
    .eq("id", slotId)
    .eq("club_id", member.club_id)
    .is("archived_at", null)
    .maybeSingle();

  if (!slot || slot.status !== "open") {
    redirect("/member?status=lesson-closed");
  }

  if (!isVisibleForMember(slot, member)) {
    redirect("/member?status=lesson-closed");
  }

  const admin = createAdminClient();
  const { count } = await admin
    .from("lesson_bookings")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slot.id)
    .not("status", "in", "(cancelled)");

  if ((count ?? 0) >= slot.capacity) {
    redirect("/member?status=lesson-full");
  }

  const { error } = await supabase.from("lesson_bookings").insert({
    club_id: member.club_id,
    created_by: user.id,
    member_id: member.id,
    slot_id: slot.id,
    status: "booked",
    updated_by: user.id,
  });

  if (error) {
    if (error.code === "23505") {
      redirect("/member?status=lesson-already-booked");
    }

    redirect("/member?status=lesson-booking-failed");
  }

  redirect("/member?status=lesson-booked");
}

export async function changeLessonSlot(formData: FormData) {
  const bookingId = getString(formData, "bookingId");
  const slotId = getString(formData, "slotId");

  if (!bookingId || !slotId) {
    redirect("/member?status=lesson-change-failed");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/member");
  }

  const { data: member } = await supabase
    .from("members")
    .select("id, club_id, status, work_line, bureau, division, department, section")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member || member.status !== "active") {
    redirect("/member?status=member-not-approved");
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("lesson_bookings")
    .select("id, slot_id, club_id, member_id, status, lesson_slots(allow_member_reschedule, lesson_date, start_time, reschedule_cutoff_hours)")
    .eq("id", bookingId)
    .eq("club_id", member.club_id)
    .eq("member_id", member.id)
    .maybeSingle();

  if (!booking || booking.status !== "booked" || booking.slot_id === slotId) {
    redirect("/member?status=lesson-change-failed");
  }

  const currentSlot = Array.isArray(booking.lesson_slots)
    ? booking.lesson_slots[0]
    : booking.lesson_slots;

  if (!currentSlot?.allow_member_reschedule) {
    redirect("/member?status=lesson-change-closed");
  }

  const cutoffHours = currentSlot.reschedule_cutoff_hours ?? 12;
  const lessonStart = new Date(`${currentSlot.lesson_date}T${currentSlot.start_time}`);
  const cutoffMs = cutoffHours * 60 * 60 * 1000;

  if (Date.now() > lessonStart.getTime() - cutoffMs) {
    redirect("/member?status=lesson-change-closed");
  }

  const { data: slot } = await admin
    .from("lesson_slots")
    .select("id, club_id, capacity, status, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections")
    .eq("id", slotId)
    .eq("club_id", member.club_id)
    .is("archived_at", null)
    .maybeSingle();

  if (!slot || slot.status !== "open") {
    redirect("/member?status=lesson-closed");
  }

  if (!isVisibleForMember(slot, member)) {
    redirect("/member?status=lesson-closed");
  }

  const { count } = await admin
    .from("lesson_bookings")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", slot.id)
    .not("status", "in", "(cancelled)");

  if ((count ?? 0) >= slot.capacity) {
    redirect("/member?status=lesson-full");
  }

  const { error } = await admin
    .from("lesson_bookings")
    .update({
      attendance_note: null,
      checked_in_at: null,
      slot_id: slot.id,
      status: "booked",
      updated_by: user.id,
    })
    .eq("id", booking.id)
    .eq("club_id", member.club_id);

  if (error) {
    redirect("/member?status=lesson-change-failed");
  }

  await admin.from("lesson_booking_change_requests").insert({
    booking_id: booking.id,
    club_id: member.club_id,
    created_by: user.id,
    decided_at: new Date().toISOString(),
    decided_by: user.id,
    from_slot_id: booking.slot_id,
    member_id: member.id,
    status: "approved",
    to_slot_id: slot.id,
    updated_by: user.id,
  });

  redirect("/member?status=lesson-changed");
}
