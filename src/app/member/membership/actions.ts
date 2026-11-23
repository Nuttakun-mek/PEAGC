"use server";

import { recordAudit } from "@/lib/audit";
import { redirectAfterAction as redirect } from "@/lib/navigation";
import { pointsErrorToStatus } from "@/lib/points/rules";
import { storePaymentSlip } from "@/lib/payments/slip-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { formatThaiDate } from "@/lib/display";

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function requireUser(nextPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return { supabase, user };
}

async function myMember(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("members")
    .select("id, club_id, status, full_name")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data as { club_id: string; full_name: string; id: string; status: string } | null;
}

// ---------- ค่าบำรุงรายปี ----------

const termErrors: Record<string, string> = {
  MEMBER_NOT_APPROVED: "fee-not-approved",
  MEMBER_NOT_FOUND: "fee-not-approved",
  NOT_DUE_YET: "fee-not-due",
  NO_FEE: "fee-none",
};

/** Member sends the transfer slip for the annual fee: open (or reuse) the term, then store the slip. */
export async function payMembershipFee(formData: FormData) {
  const { supabase, user } = await requireUser("/member/membership");
  const slip = formData.get("slip");
  if (!(slip instanceof File) || slip.size === 0) {
    redirect("/member/membership?status=fee-slip-required#fee");
  }

  const member = await myMember(supabase, user.id);
  if (!member) {
    redirect("/member/membership?status=fee-not-approved#fee");
  }

  const { data, error } = await supabase.rpc("request_membership_term");
  if (error) {
    const key = Object.entries(termErrors).find(([code]) => error.message?.includes(code))?.[1];
    if (!key) logDbError("membership.request_term", error);
    redirect(`/member/membership?status=${key ?? (classifyDbError(error) === "schema-outdated" ? "fee-unavailable" : "fee-failed")}#fee`);
  }
  const term = data as { fee: number | string; payment_record_id: string | null; period_end: string; period_start: string; term_id: string };
  const amount = Number(term.fee);

  // A slip already sent for this term is replaced (e.g. after a rejection) instead of adding a row.
  let existingPaymentId: string | null = null;
  if (term.payment_record_id) {
    const { data: payment } = await supabase
      .from("payment_records")
      .select("id, status")
      .eq("id", term.payment_record_id)
      .maybeSingle();
    if (payment?.status === "review" || payment?.status === "pending") {
      redirect("/member/membership?status=fee-in-review#fee");
    }
    if (payment?.status === "rejected") existingPaymentId = payment.id as string;
  }

  const result = await storePaymentSlip({
    amount,
    clubId: member.club_id,
    description: `ค่าบำรุงสมาชิก ${formatThaiDate(term.period_start)} – ${formatThaiDate(term.period_end)}`,
    existingPaymentId,
    file: slip as File,
    memberId: member.id,
    purpose: "membership_fee",
    referenceId: term.term_id,
    userId: user.id,
  });
  if (!result.ok) {
    redirect(`/member/membership?status=fee-${result.error}#fee`);
  }

  const { error: linkError } = await createAdminClient()
    .from("membership_terms")
    .update({ payment_record_id: result.paymentId, updated_by: user.id })
    .eq("id", term.term_id)
    .eq("member_id", member.id);
  if (linkError) logDbError("membership_terms.link_payment", linkError);

  redirect(`/member/membership?status=${result.status === "approved" ? "fee-approved" : "fee-submitted"}#fee`);
}

// ---------- PDPA ----------

/** "ขอลบข้อมูล": one open request per member; admins see it on the member list. */
export async function requestDataDeletion(formData: FormData) {
  const { supabase, user } = await requireUser("/profile");
  const member = await myMember(supabase, user.id);
  if (!member) {
    redirect("/profile?status=member-failed#privacy");
  }
  const note = getString(formData, "note").slice(0, 500) || null;

  const { error } = await supabase.from("member_data_requests").insert({
    club_id: member.club_id,
    created_by: user.id,
    member_id: member.id,
    note,
    request_type: "delete",
    status: "open",
  });
  if (error) {
    if (error.code === "23505") redirect("/profile?status=delete-already-requested#privacy");
    logDbError("member_data_requests.insert", error);
    redirect(`/profile?status=${classifyDbError(error) === "schema-outdated" ? "delete-unavailable" : "delete-request-failed"}#privacy`);
  }

  // Members cannot write audit_logs under RLS; the service role records it after the checks above.
  await recordAudit(createAdminClient(), {
    action: "member.data_deletion_requested",
    actorUserId: user.id,
    after: { note },
    clubId: member.club_id,
    entityId: member.id,
    entityType: "members",
    metadata: { source: "member.profile" },
  });

  redirect("/profile?status=delete-requested#privacy");
}

// ---------- แต้มสะสม ----------

/** Redeem a reward; balance and stock are checked inside the RPC with row locks. */
export async function redeemPointReward(formData: FormData) {
  const rewardId = getString(formData, "rewardId");
  const back = "/member";
  if (!rewardId) {
    redirect(`${back}?status=points-reward-closed#points`);
  }
  const { supabase } = await requireUser(back);
  const { error } = await supabase.rpc("redeem_point_reward", { p_reward: rewardId });
  if (error) {
    const key = pointsErrorToStatus(error.message, "points-redeem-failed");
    if (key === "points-redeem-failed") logDbError("points.redeem", error);
    redirect(`${back}?status=${key}#points`);
  }
  redirect(`${back}?status=points-redeemed#points`);
}

/** Member cancels their own request before it is handed over; the points come back. */
export async function cancelMyRedemption(formData: FormData) {
  const redemptionId = getString(formData, "redemptionId");
  const back = "/member";
  if (!redemptionId) {
    redirect(`${back}?status=points-redemption-closed#points`);
  }
  const { supabase } = await requireUser(back);
  const { error } = await supabase.rpc("set_point_redemption_status", {
    p_note: "สมาชิกยกเลิกเอง",
    p_redemption: redemptionId,
    p_status: "cancelled",
  });
  if (error) {
    const key = pointsErrorToStatus(error.message, "points-cancel-failed");
    if (key === "points-cancel-failed") logDbError("points.cancel_own", error);
    redirect(`${back}?status=${key}#points`);
  }
  redirect(`${back}?status=points-redemption-cancelled#points`);
}
