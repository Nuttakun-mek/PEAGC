"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";

import { recordAudit } from "@/lib/audit";
import { fromBangkokInputValue } from "@/lib/lessons/booking";
import { needsNoSlipReason } from "@/lib/payments";
import { paymentItemTitle } from "@/lib/payments/labels";
import { notifyPaymentDecision } from "@/lib/payments/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyDbError, failureStatus, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const paymentAdminRoles = ["platform_owner", "club_admin", "finance_officer"];

type Keep = { event?: string; purpose?: string; q?: string; stage?: string };

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function getNumber(formData: FormData, key: string) {
  const value = getString(formData, key);
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

/** Back to the list with the row open: event rows by registration, other rows by payment. */
function redirectPayments(status: string, target?: { payment?: string; registration?: string }, keep?: Keep): never {
  const params = new URLSearchParams({ status });

  if (target?.registration) params.set("registration", target.registration);
  else if (target?.payment) params.set("payment", target.payment);
  // Keep the list the admin was working in (filters live in their own params, not in `status`).
  for (const [key, value] of Object.entries(keep ?? {})) {
    if (value) params.set(key, value);
  }
  const anchor = target?.registration ? `#registration-${target.registration}` : target?.payment ? `#payment-${target.payment}` : "";

  redirect(`/admin/payments?${params.toString()}${anchor}`);
}

function keepFilters(formData: FormData): Keep {
  return {
    event: getString(formData, "keepEvent"),
    purpose: getString(formData, "keepPurpose"),
    q: getString(formData, "keepQ"),
    stage: getString(formData, "keepStage"),
  };
}

async function requirePaymentAdminClub() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/payments");
  }

  const { data: role, error } = await supabase
    .from("user_roles")
    .select("club_id, role_key")
    .eq("user_id", user.id)
    .in("role_key", paymentAdminRoles)
    .limit(1)
    .maybeSingle();

  if (error || !role) {
    redirect("/member?status=admin-required");
  }

  return { clubId: role.club_id as string, supabase, userId: user.id };
}

type PaymentRow = {
  amount: number;
  description?: string | null;
  id: string;
  member_id?: string | null;
  purpose?: string | null;
  receipt_no?: string | null;
  slip_file_id: string | null;
  slip_sha256?: string | null;
  status: string;
};

/**
 * Saves the reviewer's decision for any payment purpose. Event payments also move the
 * registration (paid / pending_payment / payment_review, waitlist kept). Lesson package and
 * membership fee payments only change status here; their own database triggers activate (or on
 * refund undo) what was paid for, and the receipt number is assigned by trigger on approval.
 */
export async function updatePaymentReview(formData: FormData) {
  const registrationId = getString(formData, "registrationId");
  const paymentId = getString(formData, "paymentId");
  const paymentStatus = getString(formData, "paymentStatus") || "review";
  const note = getString(formData, "note");
  const amount = getNumber(formData, "amount");
  const transferredAt = getString(formData, "transferredAt");
  const keep = keepFilters(formData);
  const target = registrationId ? { registration: registrationId } : { payment: paymentId };

  if (!registrationId && !paymentId) {
    redirectPayments("missing-registration", undefined, keep);
  }

  if (!["pending", "review", "approved", "rejected", "refunded"].includes(paymentStatus)) {
    redirectPayments("invalid-status", target, keep);
  }
  if (amount < 0) {
    redirectPayments("amount-invalid", target, keep);
  }

  const { clubId, supabase, userId } = await requirePaymentAdminClub();

  const { data: registration } = registrationId
    ? await supabase
        .from("event_registrations")
        .select("id, club_id, status, member_id, events(name)")
        .eq("club_id", clubId)
        .eq("id", registrationId)
        .maybeSingle()
    : { data: null };

  if (registrationId && !registration) {
    redirectPayments("missing-registration", undefined, keep);
  }

  const { data: beforePayment } = paymentId
    ? await supabase
        .from("payment_records")
        .select("*")
        .eq("club_id", clubId)
        .eq("id", paymentId)
        .maybeSingle()
    : { data: null };
  const before = beforePayment as PaymentRow | null;

  if (!registrationId && !before) {
    redirectPayments("missing-payment", undefined, keep);
  }

  // Money approved without the member's slip needs a written reason (cash at the venue,
  // checked against the bank statement, ...). The slip is read from the record, not the form.
  const hasSlip = Boolean(before?.slip_file_id);
  if (needsNoSlipReason({ hasSlip, note, status: paymentStatus })) {
    redirectPayments("approve-needs-reason", target, keep);
  }

  // A slip file can back one approved payment only (also enforced by a unique index).
  if (paymentStatus === "approved" && before?.slip_sha256 && before.status !== "approved") {
    const { data: twins } = await supabase
      .from("payment_records")
      .select("id")
      .eq("club_id", clubId)
      .eq("slip_sha256", before.slip_sha256)
      .eq("status", "approved")
      .neq("id", before.id)
      .limit(1);
    if (twins?.length) {
      redirectPayments("slip-duplicate-approved", target, keep);
    }
  }

  const decided = paymentStatus === "approved" || paymentStatus === "rejected";
  const paymentPayload = {
    amount,
    club_id: clubId,
    note: note || null,
    reviewed_at: decided ? new Date().toISOString() : null,
    reviewed_by: decided ? userId : null,
    status: paymentStatus,
    // datetime-local carries no zone; the reviewer types Bangkok time
    transferred_at: fromBangkokInputValue(transferredAt),
    updated_by: userId,
    ...(registrationId ? { event_registration_id: registrationId } : {}),
  };

  let paymentResult = before
    ? await supabase
        .from("payment_records")
        .update(paymentPayload)
        .eq("club_id", clubId)
        .eq("id", before.id)
        .select("id")
        .single()
    : await supabase
        .from("payment_records")
        .insert({ ...paymentPayload, created_by: userId, member_id: registration?.member_id ?? null, purpose: "event" })
        .select("id")
        .single();

  // Databases without the phase 2 columns: record the event payment the old way.
  if (!before && paymentResult.error && classifyDbError(paymentResult.error) === "schema-outdated") {
    paymentResult = await supabase.from("payment_records").insert({ ...paymentPayload, created_by: userId }).select("id").single();
  }

  if (paymentResult.error || !paymentResult.data) {
    logDbError("payment_records.review", paymentResult.error);
    const duplicateSlip = paymentStatus === "approved" && classifyDbError(paymentResult.error) === "duplicate";
    redirectPayments(duplicateSlip ? "slip-duplicate-approved" : failureStatus("payment-update-failed", paymentResult.error), target, keep);
  }
  const savedPaymentId = paymentResult.data.id as string;

  let registrationStatus: string | null = null;
  if (registration) {
    // A waitlisted registration keeps its place in the queue; approving money must not
    // hand it a seat past capacity (the DB promotes it when a seat frees up).
    registrationStatus =
      registration.status === "waitlist"
        ? "waitlist"
        : paymentStatus === "approved"
          ? "paid"
          : paymentStatus === "rejected"
            ? "pending_payment"
            : paymentStatus === "review"
              ? "payment_review"
              : registration.status;

    // .select() so an RLS-filtered update (0 rows, no error) is reported instead of ignored.
    const { data: updatedRegistrations, error: registrationError } = await supabase
      .from("event_registrations")
      .update({
        status: registrationStatus,
        updated_by: userId,
      })
      .eq("club_id", clubId)
      .eq("id", registration.id)
      .select("id");

    if (registrationError || !updatedRegistrations?.length) {
      logDbError("event_registrations.payment_status", registrationError);
      redirectPayments("registration-update-failed", target, keep);
    }
  }

  const { data: after } = await supabase.from("payment_records").select("*").eq("id", savedPaymentId).maybeSingle();
  const afterPayment = after as PaymentRow | null;
  const purpose = afterPayment?.purpose ?? before?.purpose ?? "event";

  await recordAudit(supabase, {
    action: "payment.reviewed",
    actorUserId: userId,
    after: { payment: afterPayment ?? paymentPayload, registration_status: registrationStatus },
    before: { payment: before, registration_status: registration?.status ?? null },
    clubId,
    entityId: savedPaymentId,
    entityType: "payment_records",
    metadata: {
      approved_without_slip: paymentStatus === "approved" && !hasSlip,
      purpose,
      registration_id: registrationId || null,
      source: "admin.payments",
    },
  });

  // Tell the member when the outcome changed (approve / reject / refund).
  if (["approved", "rejected", "refunded"].includes(paymentStatus) && before?.status !== paymentStatus) {
    const related = (registration as { events?: { name?: string } | Array<{ name?: string }> | null } | null)?.events;
    const eventName = Array.isArray(related) ? related[0]?.name : related?.name;
    await notifyPaymentDecision(createAdminClient(), {
      actorUserId: userId,
      amount,
      clubId,
      itemTitle: paymentItemTitle(purpose, { description: afterPayment?.description ?? before?.description, eventName }),
      memberId: afterPayment?.member_id ?? before?.member_id ?? registration?.member_id ?? null,
      paymentId: savedPaymentId,
      purpose,
      receiptNo: afterPayment?.receipt_no ?? null,
      status: paymentStatus as "approved" | "rejected" | "refunded",
    });
  }

  const approvedKey = registration ? "payment-approved" : "payment-approved-item";
  redirectPayments(paymentStatus === "approved" ? approvedKey : "payment-updated", target, keep);
}
