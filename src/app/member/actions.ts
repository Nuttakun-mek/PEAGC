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
    .select("id, club_id, capacity, member_price, status, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections")
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

  const admin = createAdminClient();

  if (event.capacity && event.capacity > 0) {
    const { count } = await admin
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .not("status", "in", "(cancelled,no_show,waitlist)");

    if ((count ?? 0) >= event.capacity) {
      redirect("/member?status=registration-full");
    }
  }

  const { error } = await supabase.from("event_registrations").insert({
    club_id: member.club_id,
    created_by: user.id,
    event_id: event.id,
    member_id: member.id,
    registration_type: "single",
    status: event.member_price > 0 ? "pending_payment" : "registered",
    updated_by: user.id,
  });

  if (error) {
    if (error.code === "23505") {
      redirect("/member?status=already-registered");
    }

    redirect("/member?status=registration-failed");
  }

  redirect(`/member?status=${event.member_price > 0 ? "registered-payment-required" : "registered"}`);
}

export async function uploadEventPaymentProof(formData: FormData) {
  const registrationId = getString(formData, "registrationId");
  const transferredAt = getString(formData, "transferredAt");
  const proof = formData.get("paymentProof");
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

  if (
    !registrationId ||
    !(proof instanceof File) ||
    proof.size === 0 ||
    proof.size > 8 * 1024 * 1024 ||
    !allowedTypes.includes(proof.type)
  ) {
    redirect("/member?status=payment-proof-invalid");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/member");
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("members")
    .select("id, club_id, status")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member || member.status !== "active") {
    redirect("/member?status=member-not-approved");
  }

  const { data: registration } = await admin
    .from("event_registrations")
    .select("id, event_id, status, events(member_price)")
    .eq("id", registrationId)
    .eq("member_id", member.id)
    .eq("club_id", member.club_id)
    .maybeSingle();
  const relatedEvent = Array.isArray(registration?.events)
    ? registration?.events[0]
    : registration?.events;

  if (
    !registration ||
    registration.status !== "pending_payment" ||
    !relatedEvent ||
    relatedEvent.member_price <= 0
  ) {
    redirect("/member?status=payment-proof-closed");
  }

  const extension = proof.name.split(".").pop()?.toLowerCase() || "bin";
  const objectPath = `${member.club_id}/${member.id}/${registration.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await admin.storage
    .from("payment-proofs")
    .upload(objectPath, proof, { contentType: proof.type, upsert: false });

  if (uploadError) {
    redirect("/member?status=payment-proof-upload-failed");
  }

  const { data: fileRecord, error: fileError } = await admin
    .from("files")
    .insert({
      bucket: "payment-proofs",
      category: "event_payment_proof",
      club_id: member.club_id,
      created_by: user.id,
      mime_type: proof.type,
      object_path: objectPath,
      size_bytes: proof.size,
    })
    .select("id")
    .single();

  if (fileError || !fileRecord) {
    await admin.storage.from("payment-proofs").remove([objectPath]);
    redirect("/member?status=payment-proof-upload-failed");
  }

  const { data: existingPayment } = await admin
    .from("payment_records")
    .select("id")
    .eq("event_registration_id", registration.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const paymentPayload = {
    amount: relatedEvent.member_price,
    club_id: member.club_id,
    event_registration_id: registration.id,
    slip_file_id: fileRecord.id,
    status: "review",
    transferred_at: transferredAt || new Date().toISOString(),
    updated_by: user.id,
  };
  const paymentResult = existingPayment
    ? await admin.from("payment_records").update(paymentPayload).eq("id", existingPayment.id)
    : await admin.from("payment_records").insert({ ...paymentPayload, created_by: user.id });

  if (paymentResult.error) {
    redirect("/member?status=payment-proof-save-failed");
  }

  const { error: registrationError } = await admin
    .from("event_registrations")
    .update({ status: "payment_review", updated_by: user.id })
    .eq("id", registration.id);

  if (registrationError) {
    redirect("/member?status=payment-proof-save-failed");
  }

  await admin.from("audit_logs").insert({
    action: "payment.proof_uploaded",
    actor_user_id: user.id,
    after_data: { file_id: fileRecord.id, status: "review" },
    club_id: member.club_id,
    entity_id: registration.id,
    entity_type: "event_registrations",
    metadata: { event_id: registration.event_id, source: "member.portal" },
  });

  redirect("/member?status=payment-proof-submitted");
}

export async function cancelEventRegistration(formData: FormData) {
  const registrationId = getString(formData, "registrationId");

  if (!registrationId) {
    redirect("/member?status=registration-cancel-failed");
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
    .select("id, club_id")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member) {
    redirect("/member?status=registration-cancel-failed");
  }

  const admin = createAdminClient();
  const { data: registration } = await admin
    .from("event_registrations")
    .select("id, event_id, status")
    .eq("id", registrationId)
    .eq("club_id", member.club_id)
    .eq("member_id", member.id)
    .maybeSingle();

  if (
    !registration ||
    !["registered", "pending_payment", "payment_review"].includes(registration.status)
  ) {
    redirect("/member?status=registration-cancel-closed");
  }

  const { error } = await admin
    .from("event_registrations")
    .update({ status: "cancelled", updated_by: user.id })
    .eq("id", registration.id)
    .eq("member_id", member.id);

  if (error) {
    redirect("/member?status=registration-cancel-failed");
  }

  await admin.from("audit_logs").insert({
    action: "event_registration.cancelled_by_member",
    actor_user_id: user.id,
    before_data: registration,
    club_id: member.club_id,
    entity_id: registration.id,
    entity_type: "event_registrations",
    metadata: { event_id: registration.event_id, source: "member.portal" },
  });

  redirect("/member?status=registration-cancelled");
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
    .select("id, club_id, program_id, lesson_date, capacity, status, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections")
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

  const { data: activeBookings } = await supabase
    .from("lesson_bookings")
    .select("id, slot_id, lesson_slots(program_id, lesson_date)")
    .eq("member_id", member.id)
    .not("status", "in", "(cancelled)");
  const alreadyBookedThisSchedule = activeBookings?.some((booking) => {
    const bookedSlot = Array.isArray(booking.lesson_slots)
      ? booking.lesson_slots[0]
      : booking.lesson_slots;

    return (
      bookedSlot?.program_id === slot.program_id &&
      bookedSlot.lesson_date === slot.lesson_date
    );
  });

  if (alreadyBookedThisSchedule) {
    redirect("/member?status=lesson-use-change");
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

export async function cancelLessonBooking(formData: FormData) {
  const bookingId = getString(formData, "bookingId");

  if (!bookingId) {
    redirect("/member?status=lesson-cancel-failed");
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
    .select("id, club_id")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member) {
    redirect("/member?status=lesson-cancel-failed");
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("lesson_bookings")
    .select("id, slot_id, status, lesson_slots(lesson_date, start_time)")
    .eq("id", bookingId)
    .eq("club_id", member.club_id)
    .eq("member_id", member.id)
    .maybeSingle();

  const slot = Array.isArray(booking?.lesson_slots)
    ? booking.lesson_slots[0]
    : booking?.lesson_slots;

  if (!booking || booking.status !== "booked" || !slot) {
    redirect("/member?status=lesson-cancel-closed");
  }

  const lessonStart = new Date(`${slot.lesson_date}T${slot.start_time}`);

  if (lessonStart.getTime() <= Date.now()) {
    redirect("/member?status=lesson-cancel-closed");
  }

  const { error } = await admin
    .from("lesson_bookings")
    .update({ status: "cancelled", updated_by: user.id })
    .eq("id", booking.id)
    .eq("member_id", member.id);

  if (error) {
    redirect("/member?status=lesson-cancel-failed");
  }

  await admin.from("audit_logs").insert({
    action: "lesson_booking.cancelled_by_member",
    actor_user_id: user.id,
    before_data: { id: booking.id, slot_id: booking.slot_id, status: booking.status },
    club_id: member.club_id,
    entity_id: booking.id,
    entity_type: "lesson_bookings",
    metadata: { source: "member.portal" },
  });

  redirect("/member?status=lesson-cancelled");
}
