"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";

import { recordAudit } from "@/lib/audit";
import { requireStaffClub } from "@/lib/auth/staff";
import { MAX_SLIP_RETENTION_DAYS, MIN_SLIP_RETENTION_DAYS } from "@/lib/payments/settings";
import { normalizePromptPayId } from "@/lib/promptpay";
import { classifyDbError, failureStatus, logDbError } from "@/lib/supabase/errors";

/** Pages that show the payment settings form; the action returns to the one it came from. */
const returnPaths = ["/admin/settings", "/admin/payments/settings"] as const;

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function back(path: string, status: string): never {
  redirect(`${path}?status=${status}#payment-settings`);
}

/** Club bank / PromptPay account, automatic slip check and slip retention (finance officers may edit). */
export async function savePaymentSettings(formData: FormData) {
  const requested = getString(formData, "returnTo");
  const returnTo = (returnPaths as readonly string[]).includes(requested) ? requested : returnPaths[1];
  const { clubId, supabase, userId } = await requireStaffClub(["platform_owner", "club_admin", "finance_officer"], returnTo);

  const promptPayRaw = getString(formData, "promptpayId");
  const promptPayId = promptPayRaw ? normalizePromptPayId(promptPayRaw) : null;
  if (promptPayRaw && !promptPayId) back(returnTo, "payment-settings-promptpay-invalid");

  const bankAccountNo = getString(formData, "bankAccountNo");
  if (bankAccountNo && !/^[0-9][0-9\s-]{4,28}[0-9]$/.test(bankAccountNo)) back(returnTo, "payment-settings-account-invalid");

  const retention = Number(getString(formData, "slipRetentionDays") || "365");
  if (!Number.isInteger(retention) || retention < MIN_SLIP_RETENTION_DAYS || retention > MAX_SLIP_RETENTION_DAYS) {
    back(returnTo, "payment-settings-retention-invalid");
  }

  const accountName = getString(formData, "accountName").slice(0, 120);
  const bankName = getString(formData, "bankName").slice(0, 120);
  const note = getString(formData, "note").slice(0, 500);

  const base = {
    account_name: accountName || null,
    bank_account_no: bankAccountNo.replace(/\s+/g, "") || null,
    bank_name: bankName || null,
    club_id: clubId,
    note: note || null,
    promptpay_id: promptPayId,
    updated_by: userId,
  };
  const payload = { ...base, auto_verify: formData.get("autoVerify") === "on", slip_retention_days: retention };

  const { data: before } = await supabase.from("club_payment_settings").select("*").eq("club_id", clubId).maybeSingle();
  let result = await supabase.from("club_payment_settings").upsert(payload, { onConflict: "club_id" }).select("club_id").maybeSingle();
  let partial = false;
  // The two options arrive with the payments migration; the account itself can be saved before.
  if (result.error && classifyDbError(result.error) === "schema-outdated") {
    logDbError("club_payment_settings.upsert (base columns)", result.error);
    result = await supabase.from("club_payment_settings").upsert(base, { onConflict: "club_id" }).select("club_id").maybeSingle();
    partial = true;
  }

  if (result.error || !result.data) {
    logDbError("club_payment_settings.upsert", result.error);
    back(returnTo, failureStatus("payment-settings-failed", result.error));
  }

  await recordAudit(supabase, {
    action: "payment_settings.updated",
    actorUserId: userId,
    after: partial ? base : payload,
    before,
    clubId,
    entityId: clubId,
    entityType: "club_payment_settings",
    metadata: { source: returnTo },
  });

  back(returnTo, partial ? "payment-settings-partial" : "payment-settings-saved");
}
