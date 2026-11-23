// Duplicate slip rules (audit: "ใช้ hash จับสลิปซ้ำได้ชั้นแรก", and the bank transaction reference
// as the second layer):
//   * the same file (sha256) already approved for another payment → blocked
//   * the same file on another payment that is waiting, rejected or refunded → warning for the admin
//   * the same bank transaction reference on another payment that was not rejected → blocked
//     (also enforced by the unique index payment_records_slip_transaction_ref_key)

export type DuplicateCandidate = { created_at?: string | null; id: string; status: string };

export type DuplicateWarning = { payment_id: string; reason: "same-file"; status: string };

export type DuplicateCheck = { blocked: boolean; warnings: DuplicateWarning[] };

export function checkFileDuplicates(sameFile: DuplicateCandidate[], currentPaymentId?: string | null): DuplicateCheck {
  const others = sameFile.filter((row) => row.id !== currentPaymentId);
  return {
    blocked: others.some((row) => row.status === "approved"),
    warnings: others.map((row) => ({ payment_id: row.id, reason: "same-file" as const, status: row.status })),
  };
}

export function isTransactionRefTaken(sameRef: DuplicateCandidate[], currentPaymentId?: string | null) {
  return sameRef.some((row) => row.id !== currentPaymentId && row.status !== "rejected");
}

const statusText: Record<string, string> = {
  approved: "อนุมัติแล้ว",
  pending: "รอชำระ",
  refunded: "คืนเงินแล้ว",
  rejected: "ไม่อนุมัติ",
  review: "รอตรวจ",
};

/** Thai warning line for the admin review panel. */
export function duplicateWarningText(warning: DuplicateWarning) {
  return `ไฟล์เดียวกับสลิปของอีกรายการ (${statusText[warning.status] ?? warning.status})`;
}
