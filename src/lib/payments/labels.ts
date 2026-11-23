// Thai names for what a payment is for (payment_records.purpose).

export const paymentPurposes = ["event", "lesson_package", "membership_fee", "other"] as const;
export type PaymentPurpose = (typeof paymentPurposes)[number];

export function isPaymentPurpose(value: unknown): value is PaymentPurpose {
  return typeof value === "string" && (paymentPurposes as readonly string[]).includes(value);
}

/** Filter tab / column label. */
export const paymentPurposeLabels: Record<PaymentPurpose, string> = {
  event: "กิจกรรม",
  lesson_package: "แพ็กเกจเรียน",
  membership_fee: "ค่าบำรุง",
  other: "อื่นๆ",
};

/** Line item on a receipt or notification when nothing more specific is known. */
export const paymentPurposeItems: Record<PaymentPurpose, string> = {
  event: "ค่าสมัครกิจกรรม",
  lesson_package: "ค่าแพ็กเกจเรียนกอล์ฟ",
  membership_fee: "ค่าบำรุงสมาชิก",
  other: "ค่าใช้จ่ายของชมรม",
};

/** "ค่าสมัครกิจกรรม ออกรอบประจำเดือน" / the stored description / the purpose's generic item. */
export function paymentItemTitle(purpose: string, { description, eventName }: { description?: string | null; eventName?: string | null } = {}) {
  const key: PaymentPurpose = isPaymentPurpose(purpose) ? purpose : "other";
  if (key === "event" && eventName?.trim()) return `${paymentPurposeItems.event} ${eventName.trim()}`;
  return description?.trim() || paymentPurposeItems[key];
}
