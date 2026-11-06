"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { rpcErrorToStatus } from "@/lib/lessons/booking";

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

// ---------- lesson booking (FCFS queue + waitlist; rules live in SQL RPCs) ----------

type LessonRpcResult = {
  booking_id: string;
  capacity: number;
  position: number;
  waitlisted: boolean;
};

async function requireMemberForLessons() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/member");
  }

  const { data: member } = await supabase
    .from("members")
    .select("id, club_id, status")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member) {
    redirect("/member?status=member-not-approved");
  }

  return { member, supabase, userId: user.id };
}

export async function bookLessonSlot(formData: FormData) {
  const slotId = getString(formData, "slotId");

  if (!slotId) {
    redirect("/member?status=lesson-booking-failed");
  }

  const { member, supabase, userId } = await requireMemberForLessons();
  const { data, error } = await supabase.rpc("book_lesson_slot", { p_slot_id: slotId });

  if (error) {
    redirect(`/member?status=${rpcErrorToStatus(error.message, "lesson-booking-failed")}`);
  }

  const result = data as LessonRpcResult;
  await createAdminClient().from("audit_logs").insert({
    action: "lesson_booking.created_by_member",
    actor_user_id: userId,
    after_data: { position: result.position, slot_id: slotId, waitlisted: result.waitlisted },
    club_id: member.club_id,
    entity_id: result.booking_id,
    entity_type: "lesson_bookings",
    metadata: { source: "member.portal" },
  });

  redirect(
    result.waitlisted
      ? `/member?status=lesson-waitlisted&rank=${result.position - result.capacity}`
      : "/member?status=lesson-booked",
  );
}

export async function changeLessonSlot(formData: FormData) {
  const bookingId = getString(formData, "bookingId");
  const slotId = getString(formData, "slotId");

  if (!bookingId || !slotId) {
    redirect("/member?status=lesson-change-failed");
  }

  const { member, supabase, userId } = await requireMemberForLessons();
  const { data, error } = await supabase.rpc("change_lesson_booking", {
    p_booking_id: bookingId,
    p_slot_id: slotId,
  });

  if (error) {
    redirect(`/member?status=${rpcErrorToStatus(error.message, "lesson-change-failed")}`);
  }

  const result = data as LessonRpcResult;
  await createAdminClient().from("audit_logs").insert({
    action: "lesson_booking.rescheduled_by_member",
    actor_user_id: userId,
    after_data: { position: result.position, slot_id: slotId, waitlisted: result.waitlisted },
    club_id: member.club_id,
    entity_id: bookingId,
    entity_type: "lesson_bookings",
    metadata: { source: "member.portal" },
  });

  redirect(
    result.waitlisted
      ? `/member?status=lesson-changed-waitlisted&rank=${result.position - result.capacity}`
      : "/member?status=lesson-changed",
  );
}

export async function cancelLessonBooking(formData: FormData) {
  const bookingId = getString(formData, "bookingId");

  if (!bookingId) {
    redirect("/member?status=lesson-cancel-failed");
  }

  const { member, supabase, userId } = await requireMemberForLessons();
  const { data, error } = await supabase.rpc("cancel_lesson_booking", { p_booking_id: bookingId });

  if (error) {
    redirect(`/member?status=${rpcErrorToStatus(error.message, "lesson-cancel-failed")}`);
  }

  const result = data as { booking_id: string; position: number; slot_id: string };
  await createAdminClient().from("audit_logs").insert({
    action: "lesson_booking.cancelled_by_member",
    actor_user_id: userId,
    before_data: { id: bookingId, position: result.position, slot_id: result.slot_id, status: "booked" },
    club_id: member.club_id,
    entity_id: bookingId,
    entity_type: "lesson_bookings",
    metadata: { source: "member.portal" },
  });

  redirect("/member?status=lesson-cancelled");
}

export async function acknowledgeLessonAnnouncement(formData: FormData) {
  const version = Number.parseInt(getString(formData, "version"), 10);

  if (!Number.isFinite(version) || version <= 0 || formData.get("accepted") !== "on") {
    redirect("/member?status=lesson-announcement-required");
  }

  const { member, supabase } = await requireMemberForLessons();
  const { error } = await supabase.rpc("ack_lesson_announcement", {
    p_club_id: member.club_id,
    p_version: version,
  });

  if (error) {
    redirect("/member?status=lesson-announcement-failed");
  }

  redirect("/member?status=lesson-announcement-acked#lessons");
}
