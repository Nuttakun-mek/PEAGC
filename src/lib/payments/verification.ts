// Shape of payment_records.verification (jsonb) written by storePaymentSlip, and how the admin
// review panel summarises it.

import { type DuplicateWarning, duplicateWarningText } from "./duplicates";

export type AutoCheckState = "passed" | "failed" | "unavailable" | "skipped";

export type PaymentVerification = {
  auto?: {
    amount?: number | null;
    checked_at: string;
    code?: number | null;
    message?: string | null;
    provider: "slipok";
    reasons: string[];
    receiver?: { account: string | null; bank: string | null; name: string | null };
    sender?: { bank: string | null; name: string | null };
    state: AutoCheckState;
    trans_ref?: string | null;
    transferred_at?: string | null;
  };
  duplicates?: DuplicateWarning[];
  expected_amount?: number;
  file?: { height?: number | null; mime: string; sha256: string; size: number; width?: number | null };
  /** Earlier slip files of this payment (member sent a new one after a rejection). */
  history?: Array<{ file_id: string; replaced_at: string }>;
  verified_by?: "slipok";
  version?: 1;
};

export function readVerification(value: unknown): PaymentVerification {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as PaymentVerification) : {};
}

export type VerificationSummary = {
  duplicates: string[];
  /** "ผ่านอัตโนมัติ" / "ต้องตรวจเอง", or null when no automatic check ran. */
  label: string | null;
  reasons: string[];
  tone: "success" | "warning" | "neutral";
};

const unavailableText = "ตรวจอัตโนมัติไม่ได้ตอนนี้ (บริการตรวจสลิปไม่ตอบ) ตรวจเองจากรูปสลิป";

export function summarizeVerification(value: unknown): VerificationSummary {
  const verification = readVerification(value);
  const duplicates = (verification.duplicates ?? []).map(duplicateWarningText);
  const auto = verification.auto;

  if (!auto || auto.state === "skipped") {
    return { duplicates, label: duplicates.length ? "ต้องตรวจเอง" : null, reasons: auto?.reasons ?? [], tone: duplicates.length ? "warning" : "neutral" };
  }
  if (auto.state === "passed" && !duplicates.length) {
    return { duplicates, label: "ผ่านอัตโนมัติ", reasons: [], tone: "success" };
  }
  const reasons = auto.state === "unavailable" ? [unavailableText] : auto.reasons;
  return { duplicates, label: "ต้องตรวจเอง", reasons, tone: "warning" };
}
