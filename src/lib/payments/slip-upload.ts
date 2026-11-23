import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit } from "@/lib/audit";
import { inspectUpload } from "@/lib/files/inspect";
import { discardStoredFile, storeInspectedFile } from "@/lib/files/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";

import { checkFileDuplicates, duplicateWarningText, isTransactionRefTaken } from "./duplicates";
import { paymentItemTitle } from "./labels";
import { notifyPaymentDecision } from "./notify";
import { type PaymentSettings, loadPaymentSettings } from "./settings";
import { checkSlipWithSlipOk, getSlipOkConfig, slipOkRejectionReason } from "./slipok";
import type { PaymentVerification } from "./verification";
import { evaluateSlip } from "./verify";

export const PAYMENT_PROOF_BUCKET = "payment-proofs";
/** `files.category` of every payment slip (older event slips used "event_payment_proof"). */
export const PAYMENT_PROOF_CATEGORY = "payment_proof";
export const paymentProofCategories = [PAYMENT_PROOF_CATEGORY, "event_payment_proof"];

export type SlipPurpose = "event" | "lesson_package" | "membership_fee" | "other";

export type StorePaymentSlipInput = {
  amount: number;
  clubId: string;
  description?: string | null;
  eventRegistrationId?: string | null;
  /** Re-upload for this payment row (e.g. after a rejection) instead of inserting a new one. */
  existingPaymentId?: string | null;
  file: File;
  memberId: string;
  /** The slip may not be older than this (when the registration/order was created). */
  notBefore?: string | null;
  purpose: SlipPurpose;
  referenceId?: string | null;
  /** Transfer time typed by the member; the time read from the slip QR wins when available. */
  transferredAt?: string | null;
  userId: string;
};

export type StorePaymentSlipError = "invalid-file" | "too-large" | "duplicate-slip" | "upload-failed" | "db-failed";

export type StorePaymentSlipResult =
  | { ok: true; paymentId: string; status: "review" | "approved"; warnings: string[] }
  | { error: StorePaymentSlipError; message: string; ok: false };

const errorMessages: Record<StorePaymentSlipError, string> = {
  "db-failed": "บันทึกสลิปไม่สำเร็จ ลองอีกครั้ง",
  "duplicate-slip": "สลิปนี้เคยใช้ชำระรายการอื่นแล้ว ใช้สลิปของการโอนครั้งนี้",
  "invalid-file": "ไฟล์ต้องเป็นรูป JPG, PNG, WebP หรือ PDF",
  "too-large": "ไฟล์ใหญ่เกิน 10 MB",
  "upload-failed": "อัปโหลดไม่สำเร็จ ลองอีกครั้ง",
};

function fail(error: StorePaymentSlipError, message = errorMessages[error]): StorePaymentSlipResult {
  return { error, message, ok: false };
}

type ExistingPayment = { id: string; slip_file_id: string | null; status: string; verification: unknown };

async function runAutomaticCheck({
  file,
  input,
  settings,
}: {
  file: { bytes: Uint8Array; ext: string; kind: string; mime: string };
  input: StorePaymentSlipInput;
  settings: PaymentSettings | null;
}): Promise<PaymentVerification["auto"]> {
  const config = getSlipOkConfig();
  if (!config || settings?.autoVerify === false || !(input.amount > 0)) return undefined;

  const checkedAt = new Date().toISOString();
  if (file.kind === "pdf") {
    return { checked_at: checkedAt, provider: "slipok", reasons: ["สลิปเป็นไฟล์ PDF ตรวจอัตโนมัติไม่ได้"], state: "skipped" };
  }

  const result = await checkSlipWithSlipOk(new Blob([file.bytes as BlobPart], { type: file.mime }), config, { fileName: `slip.${file.ext}` });
  if (result.kind === "unavailable") {
    console.warn("[payments] SlipOK unavailable:", result.code ?? "-", result.message);
    return { checked_at: checkedAt, code: result.code, message: result.message, provider: "slipok", reasons: [], state: "unavailable" };
  }

  const slip = result.slip;
  const evaluation = slip
    ? evaluateSlip({ expectedAmount: input.amount, notBefore: input.notBefore, settings, slip })
    : null;
  const reasons =
    result.kind === "rejected"
      ? [slipOkRejectionReason(result.code, result.message), ...(evaluation?.reasons ?? [])]
      : (evaluation?.reasons ?? []);

  return {
    amount: slip?.amount ?? null,
    checked_at: checkedAt,
    code: result.kind === "rejected" ? result.code : null,
    message: result.kind === "rejected" ? result.message : null,
    provider: "slipok",
    reasons: [...new Set(reasons)],
    receiver: slip ? { account: slip.receiver.account ?? slip.receiver.proxy, bank: slip.receiver.bank, name: slip.receiver.displayName ?? slip.receiver.name } : undefined,
    sender: slip ? { bank: slip.sender.bank, name: slip.sender.displayName ?? slip.sender.name } : undefined,
    state: result.kind === "ok" && evaluation?.passed ? "passed" : "failed",
    trans_ref: slip?.transRef ?? null,
    transferred_at: slip?.transferredAt ?? null,
  };
}

async function eventName(admin: SupabaseClient, registrationId: string | null | undefined) {
  if (!registrationId) return null;
  const { data } = await admin.from("event_registrations").select("events(name)").eq("id", registrationId).maybeSingle();
  const related = (data as { events?: { name?: string } | Array<{ name?: string }> | null } | null)?.events;
  return (Array.isArray(related) ? related[0]?.name : related?.name) ?? null;
}

/**
 * Stores a member's transfer slip for any payment purpose:
 *  1. checks the real file type (magic bytes) and size, hashes it (sha256);
 *  2. refuses a file already used for an approved payment, warns about other re-use;
 *  3. uploads it to the private `payment-proofs` bucket at `{purpose}/{yyyy}/{mm}/{uuid}.{ext}`
 *     and records it in `files`;
 *  4. runs the automatic slip check when SlipOK is configured (never blocks on errors);
 *  5. inserts or updates the `payment_records` row with status 'review', and when every check
 *     passes approves it in a second update (so "after update of status" triggers fire),
 *     writes audit_logs and notifies the member.
 * Callers check first that this member may pay for this item; the service-role client is used.
 */
export async function storePaymentSlip(input: StorePaymentSlipInput): Promise<StorePaymentSlipResult> {
  const inspected = await inspectUpload(input.file);
  if (!inspected.ok) {
    return fail(inspected.problem === "too-large" ? "too-large" : "invalid-file", inspected.message);
  }
  const file = inspected.file;
  const admin = createAdminClient();

  let existing: ExistingPayment | null = null;
  if (input.existingPaymentId) {
    const { data, error } = await admin
      .from("payment_records")
      .select("id, status, slip_file_id, verification")
      .eq("id", input.existingPaymentId)
      .eq("club_id", input.clubId)
      .maybeSingle();
    if (error && classifyDbError(error) === "schema-outdated") {
      const legacy = await admin
        .from("payment_records")
        .select("id, status, slip_file_id")
        .eq("id", input.existingPaymentId)
        .eq("club_id", input.clubId)
        .maybeSingle();
      existing = legacy.data ? { ...(legacy.data as Omit<ExistingPayment, "verification">), verification: {} } : null;
    } else {
      existing = (data as ExistingPayment | null) ?? null;
    }
    if (!existing) return fail("db-failed");
    if (existing.status === "approved" || existing.status === "refunded") {
      return fail("db-failed", "รายการนี้ชำระเรียบร้อยแล้ว");
    }
  }

  // Layer 1: the same file (sha256) on another payment of this club.
  const { data: sameFile, error: sameFileError } = await admin
    .from("payment_records")
    .select("id, status, created_at")
    .eq("club_id", input.clubId)
    .eq("slip_sha256", file.sha256)
    .limit(20);
  if (sameFileError) logDbError("payment_records.same_sha256", sameFileError);
  const duplicates = checkFileDuplicates((sameFile ?? []) as Array<{ id: string; status: string }>, existing?.id);
  if (duplicates.blocked) {
    return fail("duplicate-slip", "สลิปนี้ใช้ชำระรายการอื่นที่อนุมัติแล้ว ใช้สลิปของการโอนครั้งนี้");
  }

  const storedResult = await storeInspectedFile(admin, file, {
    bucket: PAYMENT_PROOF_BUCKET,
    category: PAYMENT_PROOF_CATEGORY,
    clubId: input.clubId,
    pathCategory: input.purpose,
    userId: input.userId,
  });
  if (!storedResult.ok) return fail(storedResult.error);
  const stored = storedResult.stored;

  const settings = await loadPaymentSettings(admin, input.clubId);
  let auto: PaymentVerification["auto"];
  try {
    auto = await runAutomaticCheck({ file, input, settings });
  } catch (error) {
    // Defensive: the slip is already stored; a bug in the check must not lose it.
    console.error("[payments] automatic check:", error instanceof Error ? error.message : String(error));
    auto = { checked_at: new Date().toISOString(), provider: "slipok", reasons: [], state: "unavailable" };
  }

  // Layer 2: the bank transaction reference read from the slip QR.
  if (auto?.trans_ref) {
    const { data: sameRef } = await admin
      .from("payment_records")
      .select("id, status")
      .eq("club_id", input.clubId)
      .eq("slip_transaction_ref", auto.trans_ref);
    if (isTransactionRefTaken((sameRef ?? []) as Array<{ id: string; status: string }>, existing?.id)) {
      await discardStoredFile(admin, PAYMENT_PROOF_BUCKET, stored);
      return fail("duplicate-slip");
    }
  }

  const now = new Date().toISOString();
  const previous = (existing?.verification ?? {}) as PaymentVerification;
  const verification: PaymentVerification = {
    auto,
    duplicates: duplicates.warnings,
    expected_amount: input.amount,
    file: { height: file.dimensions?.height ?? null, mime: file.mime, sha256: file.sha256, size: file.size, width: file.dimensions?.width ?? null },
    history: [
      ...(previous.history ?? []),
      ...(existing?.slip_file_id ? [{ file_id: existing.slip_file_id, replaced_at: now }] : []),
    ],
    version: 1,
  };

  const legacyPayload = {
    amount: input.amount,
    club_id: input.clubId,
    event_registration_id: input.eventRegistrationId ?? null,
    slip_file_id: stored.fileId,
    status: "review",
    transferred_at: auto?.transferred_at ?? input.transferredAt ?? now,
    updated_by: input.userId,
  };
  const payload = {
    ...legacyPayload,
    description: input.description ?? null,
    member_id: input.memberId,
    purpose: input.purpose,
    reference_id: input.referenceId ?? null,
    slip_sha256: file.sha256,
    slip_transaction_ref: auto?.trans_ref ?? null,
    verification,
  };

  const write = (values: Record<string, unknown>) =>
    existing
      ? admin.from("payment_records").update(values).eq("id", existing.id).eq("club_id", input.clubId).select("id").single()
      : admin.from("payment_records").insert({ ...values, created_by: input.userId }).select("id").single();

  let saved = await write(payload);
  // Databases without the phase 2 columns still take an event slip the old way.
  if (saved.error && classifyDbError(saved.error) === "schema-outdated" && input.purpose === "event") {
    logDbError("payment_records.slip (legacy retry)", saved.error);
    saved = await write(legacyPayload);
  }
  if (saved.error || !saved.data) {
    logDbError("payment_records.slip", saved.error);
    await discardStoredFile(admin, PAYMENT_PROOF_BUCKET, stored);
    return fail(classifyDbError(saved.error) === "duplicate" ? "duplicate-slip" : "db-failed");
  }
  const paymentId = saved.data.id as string;
  const warnings = duplicates.warnings.map(duplicateWarningText);

  if (auto?.state !== "passed" || duplicates.warnings.length) {
    return { ok: true, paymentId, status: "review", warnings };
  }

  // Every check passed: approve in a second statement so status triggers (receipt number, lesson
  // credits, membership terms) see the change from 'review' to 'approved'.
  const approved = await admin
    .from("payment_records")
    .update({ reviewed_at: new Date().toISOString(), status: "approved", verification: { ...verification, verified_by: "slipok" } })
    .eq("id", paymentId)
    .eq("status", "review")
    .select("id")
    .maybeSingle();
  if (approved.error || !approved.data) {
    logDbError("payment_records.auto_approve", approved.error);
    return { ok: true, paymentId, status: "review", warnings };
  }

  await recordAudit(admin, {
    action: "payment.auto_approved",
    actorUserId: null,
    after: { status: "approved", trans_ref: auto.trans_ref, verified_by: "slipok" },
    before: { status: "review" },
    clubId: input.clubId,
    entityId: paymentId,
    entityType: "payment_records",
    metadata: { amount: input.amount, purpose: input.purpose, source: "slipok", uploaded_by: input.userId },
  });
  // receipt_no is assigned by a trigger (payments migration); older databases have none.
  const { data: receipt } = await admin.from("payment_records").select("receipt_no").eq("id", paymentId).maybeSingle();
  await notifyPaymentDecision(admin, {
    actorUserId: null,
    amount: input.amount,
    clubId: input.clubId,
    itemTitle: paymentItemTitle(input.purpose, {
      description: input.description,
      eventName: input.purpose === "event" ? await eventName(admin, input.eventRegistrationId) : null,
    }),
    memberId: input.memberId,
    paymentId,
    purpose: input.purpose,
    receiptNo: (receipt as { receipt_no?: string | null } | null)?.receipt_no ?? null,
    status: "approved",
  });

  return { ok: true, paymentId, status: "approved", warnings };
}
