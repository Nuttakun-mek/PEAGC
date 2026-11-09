"use server";

import { redirect } from "next/navigation";

import { fromBangkokInputValue } from "@/lib/lessons/booking";
import { createClient } from "@/lib/supabase/server";

const paymentAdminRoles = ["platform_owner", "club_admin", "finance_officer"];

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function getNumber(formData: FormData, key: string) {
  const value = getString(formData, key);
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function redirectPayments(status: string, registrationId?: string): never {
  const params = new URLSearchParams({ status });

  if (registrationId) {
    params.set("registration", registrationId);
  }

  redirect(`/admin/payments?${params.toString()}`);
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

export async function updatePaymentReview(formData: FormData) {
  const registrationId = getString(formData, "registrationId");
  const paymentId = getString(formData, "paymentId");
  const paymentStatus = getString(formData, "paymentStatus") || "review";
  const note = getString(formData, "note");
  const amount = getNumber(formData, "amount");
  const transferredAt = getString(formData, "transferredAt");

  if (!registrationId) {
    redirectPayments("missing-registration");
  }

  if (!["pending", "review", "approved", "rejected", "refunded"].includes(paymentStatus)) {
    redirectPayments("invalid-status", registrationId);
  }

  const { clubId, supabase, userId } = await requirePaymentAdminClub();
  const { data: registration } = await supabase
    .from("event_registrations")
    .select("id, club_id, status")
    .eq("club_id", clubId)
    .eq("id", registrationId)
    .maybeSingle();

  if (!registration) {
    redirectPayments("missing-registration");
  }

  const paymentPayload = {
    amount,
    club_id: clubId,
    event_registration_id: registrationId,
    note: note || null,
    reviewed_at: paymentStatus === "approved" || paymentStatus === "rejected" ? new Date().toISOString() : null,
    reviewed_by: paymentStatus === "approved" || paymentStatus === "rejected" ? userId : null,
    status: paymentStatus,
    // datetime-local carries no zone; the reviewer types Bangkok time
    transferred_at: fromBangkokInputValue(transferredAt),
    updated_by: userId,
  };

  const { data: beforePayment } = paymentId
    ? await supabase
        .from("payment_records")
        .select("*")
        .eq("club_id", clubId)
        .eq("id", paymentId)
        .maybeSingle()
    : { data: null };

  const paymentResult = paymentId
    ? await supabase
        .from("payment_records")
        .update(paymentPayload)
        .eq("club_id", clubId)
        .eq("id", paymentId)
        .select("id")
        .single()
    : await supabase
        .from("payment_records")
        .insert({
          ...paymentPayload,
          created_by: userId,
        })
        .select("id")
        .single();

  if (paymentResult.error || !paymentResult.data) {
    redirectPayments("payment-update-failed", registrationId);
  }

  // A waitlisted registration keeps its place in the queue; approving money must not
  // hand it a seat past capacity (the DB promotes it when a seat frees up).
  const registrationStatus =
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
    .eq("id", registrationId)
    .select("id");

  if (registrationError || !updatedRegistrations?.length) {
    redirectPayments("registration-update-failed", registrationId);
  }

  await supabase.from("audit_logs").insert({
    action: "payment.reviewed",
    actor_user_id: userId,
    after_data: {
      payment: paymentPayload,
      registration_status: registrationStatus,
    },
    before_data: {
      payment: beforePayment,
      registration_status: registration.status,
    },
    club_id: clubId,
    entity_id: paymentResult.data.id,
    entity_type: "payment_records",
    metadata: {
      registration_id: registrationId,
      source: "admin.payments",
    },
  });

  redirectPayments("payment-updated", registrationId);
}
