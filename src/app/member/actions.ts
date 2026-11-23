"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { eventErrorToStatus } from "@/lib/events/pairing";
import { requireModuleOpen } from "@/lib/modules-server";
import { recordAudit } from "@/lib/audit";
import { fromBangkokInputValue, rpcErrorToStatus } from "@/lib/lessons/booking";
import { rpcErrorCode } from "@/lib/lessons/errors";
import { lessonReturnPath } from "@/lib/lessons/member-view";
import { type StorePaymentSlipError, storePaymentSlip } from "@/lib/payments/slip-upload";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** storePaymentSlip error → /member?status= key (messages live in the member page). */
const slipErrorStatus: Record<StorePaymentSlipError, string> = {
  "db-failed": "payment-proof-save-failed",
  "duplicate-slip": "payment-proof-duplicate",
  "invalid-file": "payment-proof-invalid",
  "too-large": "payment-proof-too-large",
  "upload-failed": "payment-proof-upload-failed",
};

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

  // Eligibility, unit targeting, duplicate check and capacity are enforced atomically in
  // SQL (event row lock), so concurrent sign-ups can never oversell; a full event waitlists.
  const { data, error } = await supabase.rpc("register_for_event", { p_event_id: eventId });

  if (error) {
    if (error.code === "23505") {
      redirect("/member?status=already-registered");
    }
    redirect(`/member?status=${eventErrorToStatus(error.message, "registration-failed")}`);
  }

  const result = data as { status: string; waitlist_position: number | null } | null;

  if (result?.status === "waitlist") {
    redirect(`/member?status=registration-waitlisted&rank=${result.waitlist_position ?? ""}`);
  }

  redirect(`/member?status=${result?.status === "pending_payment" ? "registered-payment-required" : "registered"}`);
}

export async function uploadEventPaymentProof(formData: FormData) {
  const registrationId = getString(formData, "registrationId");
  const transferredAt = getString(formData, "transferredAt");
  const proof = formData.get("paymentProof");

  if (!registrationId || !(proof instanceof File) || proof.size === 0) {
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

  await requireModuleOpen(supabase, member.club_id, "events");

  const { data: registration } = await admin
    .from("event_registrations")
    .select("id, event_id, status, created_at, events(name, member_price)")
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

  // A rejected slip is replaced on the same payment row (the admin sees one row per registration).
  const { data: existingPayment } = await admin
    .from("payment_records")
    .select("id, status")
    .eq("event_registration_id", registration.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const result = await storePaymentSlip({
    amount: Number(relatedEvent.member_price),
    clubId: member.club_id,
    description: `ค่าสมัครกิจกรรม ${relatedEvent.name ?? ""}`.trim(),
    eventRegistrationId: registration.id,
    existingPaymentId:
      existingPayment && existingPayment.status !== "approved" && existingPayment.status !== "refunded" ? existingPayment.id : null,
    file: proof,
    memberId: member.id,
    notBefore: registration.created_at,
    purpose: "event",
    transferredAt: fromBangkokInputValue(transferredAt),
    userId: user.id,
  });

  if (!result.ok) {
    redirect(`/member?status=${slipErrorStatus[result.error]}`);
  }

  // Checked automatically and everything matched: the seat is paid. Otherwise an admin checks it.
  const registrationStatus = result.status === "approved" ? "paid" : "payment_review";
  const { error: registrationError } = await admin
    .from("event_registrations")
    .update({ status: registrationStatus, updated_by: user.id })
    .eq("id", registration.id);

  if (registrationError) {
    redirect("/member?status=payment-proof-save-failed");
  }

  await admin.from("audit_logs").insert({
    action: "payment.proof_uploaded",
    actor_user_id: user.id,
    after_data: { payment_id: result.paymentId, registration_status: registrationStatus, status: result.status },
    club_id: member.club_id,
    entity_id: registration.id,
    entity_type: "event_registrations",
    metadata: { event_id: registration.event_id, source: "member.portal", warnings: result.warnings },
  });

  redirect(`/member?status=${result.status === "approved" ? "payment-proof-approved" : "payment-proof-submitted"}`);
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
    !["registered", "pending_payment", "payment_review", "waitlist"].includes(registration.status)
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
  status?: string;
  waitlisted: boolean;
};

/**
 * Where a lesson action sends the member back: the full lessons screen (with an anchor for the
 * part that changed) when the form says `returnTo=/member/lessons`, else the member home as before.
 */
function lessonUrl(formData: FormData, query: string, anchor?: string) {
  const base = lessonReturnPath(formData.get("returnTo"));
  return `${base}?${query}${base === "/member/lessons" && anchor ? `#${anchor}` : ""}`;
}

async function requireMemberForLessons(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(lessonReturnPath(formData.get("returnTo")))}`);
  }

  const { data: member } = await supabase
    .from("members")
    .select("id, club_id, status")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member) {
    redirect(lessonUrl(formData, "status=member-not-approved"));
  }

  return { member, supabase, userId: user.id };
}

export async function bookLessonSlot(formData: FormData) {
  const slotId = getString(formData, "slotId");

  if (!slotId) {
    redirect(lessonUrl(formData, "status=lesson-booking-failed", "slots"));
  }

  const { member, supabase, userId } = await requireMemberForLessons(formData);
  await requireModuleOpen(supabase, member.club_id, "lessons");
  const { data, error } = await supabase.rpc("book_lesson_slot", { p_slot_id: slotId });

  if (error) {
    redirect(lessonUrl(formData, `status=${rpcErrorToStatus(error.message, "lesson-booking-failed")}`, "slots"));
  }

  const result = data as LessonRpcResult;
  await createAdminClient().from("audit_logs").insert({
    action: "lesson_booking.created_by_member",
    actor_user_id: userId,
    after_data: { position: result.position, slot_id: slotId, status: result.status ?? null, waitlisted: result.waitlisted },
    club_id: member.club_id,
    entity_id: result.booking_id,
    entity_type: "lesson_bookings",
    metadata: { source: "member.portal" },
  });

  redirect(
    lessonUrl(
      formData,
      result.waitlisted ? `status=lesson-waitlisted&rank=${result.position - result.capacity}` : "status=lesson-booked",
      "my-bookings",
    ),
  );
}

export async function changeLessonSlot(formData: FormData) {
  const bookingId = getString(formData, "bookingId");
  const slotId = getString(formData, "slotId");

  if (!bookingId || !slotId) {
    redirect(lessonUrl(formData, "status=lesson-change-failed", "slots"));
  }

  const { member, supabase, userId } = await requireMemberForLessons(formData);
  await requireModuleOpen(supabase, member.club_id, "lessons");
  const { data, error } = await supabase.rpc("change_lesson_booking", {
    p_booking_id: bookingId,
    p_slot_id: slotId,
  });

  if (error) {
    redirect(lessonUrl(formData, `status=${rpcErrorToStatus(error.message, "lesson-change-failed")}`, "slots"));
  }

  const result = data as LessonRpcResult;
  await createAdminClient().from("audit_logs").insert({
    action: "lesson_booking.rescheduled_by_member",
    actor_user_id: userId,
    after_data: { position: result.position, slot_id: slotId, status: result.status ?? null, waitlisted: result.waitlisted },
    club_id: member.club_id,
    entity_id: bookingId,
    entity_type: "lesson_bookings",
    metadata: { source: "member.portal" },
  });

  redirect(
    lessonUrl(
      formData,
      result.waitlisted ? `status=lesson-changed-waitlisted&rank=${result.position - result.capacity}` : "status=lesson-changed",
      "my-bookings",
    ),
  );
}

export async function cancelLessonBooking(formData: FormData) {
  const bookingId = getString(formData, "bookingId");

  if (!bookingId) {
    redirect(lessonUrl(formData, "status=lesson-cancel-failed", "my-bookings"));
  }

  const { member, supabase, userId } = await requireMemberForLessons(formData);
  // acceptLate=on: the member agreed to cancel after the cutoff without a credit refund (lessons v2).
  // Only sent when asked for, so the one-argument RPC of older databases keeps working.
  const acceptLate = formData.get("acceptLate") === "on" || formData.get("acceptLate") === "true";
  const { data, error } = await supabase.rpc(
    "cancel_lesson_booking",
    acceptLate ? { p_accept_late: true, p_booking_id: bookingId } : { p_booking_id: bookingId },
  );

  if (error) {
    redirect(lessonUrl(formData, `status=${rpcErrorToStatus(error.message, "lesson-cancel-failed")}`, "my-bookings"));
  }

  const result = data as { booking_id: string; credit_refunded?: number; position: number; slot_id: string; status?: string };
  await createAdminClient().from("audit_logs").insert({
    action: "lesson_booking.cancelled_by_member",
    actor_user_id: userId,
    after_data: { credit_refunded: result.credit_refunded ?? null, status: result.status ?? "cancelled" },
    before_data: { id: bookingId, position: result.position, slot_id: result.slot_id },
    club_id: member.club_id,
    entity_id: bookingId,
    entity_type: "lesson_bookings",
    metadata: { source: "member.portal" },
  });

  redirect(
    lessonUrl(formData, result.status === "late_cancelled" ? "status=lesson-late-cancelled" : "status=lesson-cancelled", "my-bookings"),
  );
}

/** Accept a seat offered from the waitlist (lessons v2: booking status 'offered'). */
export async function confirmLessonOffer(formData: FormData) {
  const bookingId = getString(formData, "bookingId");

  if (!bookingId) {
    redirect(lessonUrl(formData, "status=lesson-booking-failed", "my-bookings"));
  }

  const { member, supabase, userId } = await requireMemberForLessons(formData);
  await requireModuleOpen(supabase, member.club_id, "lessons");
  const { data, error } = await supabase.rpc("confirm_lesson_offer", { p_booking_id: bookingId });

  if (error) {
    redirect(lessonUrl(formData, `status=${rpcErrorToStatus(error.message, "lesson-booking-failed")}`, "my-bookings"));
  }

  const result = data as { already?: boolean; credits_remaining?: number | null; slot_id: string };
  if (!result.already) {
    await createAdminClient().from("audit_logs").insert({
      action: "lesson_booking.offer_confirmed",
      actor_user_id: userId,
      after_data: { credits_remaining: result.credits_remaining ?? null, slot_id: result.slot_id, status: "booked" },
      before_data: { status: "offered" },
      club_id: member.club_id,
      entity_id: bookingId,
      entity_type: "lesson_bookings",
      metadata: { source: "member.portal" },
    });
  }

  redirect(lessonUrl(formData, "status=lesson-booked", "my-bookings"));
}

export async function acknowledgeLessonAnnouncement(formData: FormData) {
  const version = Number.parseInt(getString(formData, "version"), 10);
  const toLessons = lessonReturnPath(formData.get("returnTo")) === "/member/lessons";

  if (!Number.isFinite(version) || version <= 0 || formData.get("accepted") !== "on") {
    redirect(lessonUrl(formData, "status=lesson-announcement-required", "slots"));
  }

  const { member, supabase } = await requireMemberForLessons(formData);
  const { error } = await supabase.rpc("ack_lesson_announcement", {
    p_club_id: member.club_id,
    p_version: version,
  });

  if (error) {
    redirect(lessonUrl(formData, "status=lesson-announcement-failed", "slots"));
  }

  redirect(toLessons ? "/member/lessons?status=lesson-announcement-acked#slots" : "/member?status=lesson-announcement-acked#lessons");
}

// ---------- lesson packages (lessons v2): request, then pay by slip ----------

/** request_lesson_package error code → /member/lessons?status= key. */
const packageErrorStatus: Record<string, string> = {
  MEMBER_INACTIVE: "member-not-approved",
  MODULE_DISABLED: "module-disabled",
  NOT_MEMBER: "member-not-approved",
  NO_PACKAGE: "package-closed",
  PACKAGE_LIMIT: "package-limit",
};

/** storePaymentSlip error → /member/lessons?status= key. */
const packageSlipErrorStatus: Record<StorePaymentSlipError, string> = {
  "db-failed": "package-slip-save-failed",
  "duplicate-slip": "package-slip-duplicate",
  "invalid-file": "package-slip-invalid",
  "too-large": "package-slip-too-large",
  "upload-failed": "package-slip-upload-failed",
};

/** "ซื้อแพ็กเกจ": a free package is active at once; a paid one waits for the slip (payment screen). */
export async function requestLessonPackage(formData: FormData) {
  const packageId = getString(formData, "packageId");

  if (!packageId) {
    redirect("/member/lessons?status=package-failed#packages");
  }

  const { member, supabase, userId } = await requireMemberForLessons(formData);
  if (member.status !== "active") {
    redirect("/member/lessons?status=member-not-approved#packages");
  }
  await requireModuleOpen(supabase, member.club_id, "lessons");
  const { data, error } = await supabase.rpc("request_lesson_package", { p_package_id: packageId });

  if (error) {
    const code = rpcErrorCode(error.message);
    const status =
      classifyDbError(error) === "schema-outdated" ? "package-unavailable" : (code && packageErrorStatus[code]) || "package-failed";
    if (status === "package-failed") logDbError("member.requestLessonPackage", error);
    redirect(`/member/lessons?status=${status}#packages`);
  }

  const result = data as {
    amount: number;
    enrollment_id: string;
    existing?: boolean;
    package_name: string;
    payment_id: string | null;
    status: "active" | "pending_payment";
  };
  if (!result.existing) {
    await recordAudit(createAdminClient(), {
      action: result.status === "active" ? "lesson_package.claimed_free" : "lesson_package.requested",
      actorUserId: userId,
      after: { amount: result.amount, package_id: packageId, payment_id: result.payment_id, status: result.status },
      clubId: member.club_id,
      entityId: result.enrollment_id,
      entityType: "lesson_enrollments",
      metadata: { package_name: result.package_name, source: "member.portal" },
    });
  }

  if (result.status === "active") {
    redirect("/member/lessons?status=package-activated#credits");
  }
  redirect(
    `/member/lessons?status=${result.existing ? "package-pending" : "package-requested"}&pay=${result.enrollment_id}#pay-${result.enrollment_id}`,
  );
}

/** Slip for a lesson package (purpose 'lesson_package', reference = the enrollment). */
export async function uploadLessonPackageSlip(formData: FormData) {
  const enrollmentId = getString(formData, "enrollmentId");
  const transferredAt = getString(formData, "transferredAt");
  const proof = formData.get("slip");
  const back = (status: string) =>
    enrollmentId ? `/member/lessons?status=${status}&pay=${enrollmentId}#pay-${enrollmentId}` : `/member/lessons?status=${status}#credits`;

  if (!/^[0-9a-f-]{36}$/i.test(enrollmentId) || !(proof instanceof File) || proof.size === 0) {
    redirect(back("package-slip-invalid"));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/member/lessons");
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("members")
    .select("id, club_id, status")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member || member.status !== "active") {
    redirect(back("member-not-approved"));
  }

  await requireModuleOpen(supabase, member.club_id, "lessons");

  const { data: enrollment, error: enrollmentError } = await admin
    .from("lesson_enrollments")
    .select("id, club_id, status, price, package_name, payment_record_id, created_at")
    .eq("id", enrollmentId)
    .eq("member_id", member.id)
    .eq("club_id", member.club_id)
    .maybeSingle();

  if (enrollmentError) {
    logDbError("member.uploadLessonPackageSlip enrollment", enrollmentError);
    redirect(back(classifyDbError(enrollmentError) === "schema-outdated" ? "package-unavailable" : "package-slip-save-failed"));
  }
  if (!enrollment || enrollment.status !== "pending_payment" || Number(enrollment.price) <= 0) {
    redirect(back("package-slip-closed"));
  }

  const { data: payment } = enrollment.payment_record_id
    ? await admin.from("payment_records").select("id, status").eq("id", enrollment.payment_record_id).maybeSingle()
    : { data: null };

  if (payment && (payment.status === "approved" || payment.status === "refunded")) {
    redirect(back("package-slip-closed"));
  }

  const result = await storePaymentSlip({
    amount: Number(enrollment.price),
    clubId: member.club_id,
    description: `แพ็กเกจเรียน: ${enrollment.package_name}`,
    existingPaymentId: payment?.id ?? null,
    file: proof,
    memberId: member.id,
    notBefore: enrollment.created_at,
    purpose: "lesson_package",
    referenceId: enrollment.id,
    transferredAt: fromBangkokInputValue(transferredAt),
    userId: user.id,
  });

  if (!result.ok) {
    redirect(back(packageSlipErrorStatus[result.error]));
  }

  if (!enrollment.payment_record_id) {
    const { error: linkError } = await admin
      .from("lesson_enrollments")
      .update({ payment_record_id: result.paymentId, updated_by: user.id })
      .eq("id", enrollment.id);
    if (linkError) logDbError("member.uploadLessonPackageSlip link", linkError);
  }

  await recordAudit(admin, {
    action: "payment.proof_uploaded",
    actorUserId: user.id,
    after: { payment_id: result.paymentId, status: result.status },
    clubId: member.club_id,
    entityId: enrollment.id,
    entityType: "lesson_enrollments",
    metadata: { package_name: enrollment.package_name, purpose: "lesson_package", source: "member.portal", warnings: result.warnings },
  });

  // Checked automatically and everything matched: the approval trigger has already added the credits.
  redirect(`/member/lessons?status=${result.status === "approved" ? "package-slip-approved" : "package-slip-submitted"}#credits`);
}

export async function markNotificationsRead() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/member");
  }

  await supabase.rpc("mark_my_notifications_read");
  redirect("/member?status=notifications-read#inbox");
}
