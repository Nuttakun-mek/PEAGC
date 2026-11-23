"use client";

import { ImageCaptureInput } from "@/components/image-capture-input";

/**
 * Transfer slip picker for any payment form: "เลือกรูปหรือ PDF" (gallery / bank-app screenshot)
 * or "ถ่ายรูป" (rear camera). Photos are shrunk to 1600px JPEG 0.85 before the form is sent,
 * PDFs are kept as they are. The server checks the file again (storePaymentSlip).
 */
export function PaymentSlipInput({
  disabled,
  hint,
  label = "สลิปโอนเงิน",
  name = "slip",
  required,
}: {
  disabled?: boolean;
  hint?: string;
  label?: string;
  name?: string;
  required?: boolean;
}) {
  return <ImageCaptureInput allowPdf camera disabled={disabled} hint={hint} label={label} name={name} preset="slip" required={required} />;
}
