// Where an event registration stands with its money, derived from the registration status and
// its latest payment record. "Waiting for payment" (no slip yet) and "waiting for slip review"
// are separate stages so the admin counters no longer mix them.

export type PaymentStage =
  | "awaiting_payment"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "refunded"
  | "not_required"
  | "waitlist";

export const paymentStageOrder: PaymentStage[] = [
  "awaiting_review",
  "awaiting_payment",
  "rejected",
  "approved",
  "refunded",
  "waitlist",
  "not_required",
];

export const paymentStageLabels: Record<PaymentStage, string> = {
  approved: "ชำระแล้ว",
  awaiting_payment: "รอชำระ",
  awaiting_review: "รอตรวจสลิป",
  not_required: "ไม่ต้องชำระ",
  refunded: "คืนเงินแล้ว",
  rejected: "สลิปไม่ผ่าน",
  waitlist: "คิวสำรอง",
};

/** Labels for payment_records.status values. */
export const paymentRecordStatusLabels: Record<string, string> = {
  approved: "อนุมัติแล้ว",
  pending: "รอชำระ",
  refunded: "คืนเงินแล้ว",
  rejected: "ไม่อนุมัติ",
  review: "รอตรวจสลิป",
};

export type PaymentLike = { slip_file_id: string | null; status: string } | null | undefined;

export function paymentStage(input: { payment: PaymentLike; price: number | null | undefined; registrationStatus: string }): PaymentStage {
  const { payment, registrationStatus } = input;
  const price = Number(input.price ?? 0);

  if (payment?.status === "refunded") return "refunded";
  if (payment?.status === "approved" || registrationStatus === "paid") return "approved";
  if (registrationStatus === "waitlist") return "waitlist";
  if (payment?.status === "rejected") return "rejected";
  if (payment?.slip_file_id && (payment.status === "review" || payment.status === "pending")) return "awaiting_review";
  if (price <= 0) return "not_required";
  return "awaiting_payment";
}

/** Approving money without a slip needs a written reason of at least this many characters. */
export const NO_SLIP_REASON_MIN = 5;

export function needsNoSlipReason(input: { hasSlip: boolean; note: string; status: string }) {
  return input.status === "approved" && !input.hasSlip && input.note.trim().length < NO_SLIP_REASON_MIN;
}

/** Stage of a payment that is not tied to an event registration (lesson package, membership fee …). */
export function paymentRecordStage(payment: { slip_file_id: string | null; status: string }): PaymentStage {
  if (payment.status === "refunded") return "refunded";
  if (payment.status === "approved") return "approved";
  if (payment.status === "rejected") return "rejected";
  if (payment.slip_file_id && (payment.status === "review" || payment.status === "pending")) return "awaiting_review";
  return "awaiting_payment";
}
