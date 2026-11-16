"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { NO_SLIP_REASON_MIN } from "@/lib/payments";

const options = [
  { label: "รอตรวจสลิป", value: "review" },
  { label: "อนุมัติ (ชำระแล้ว)", value: "approved" },
  { label: "ไม่อนุมัติ (ให้สมาชิกส่งสลิปใหม่)", value: "rejected" },
  { label: "คืนเงินแล้ว", value: "refunded" },
  { label: "รอชำระ (ยังไม่ได้รับเงิน)", value: "pending" },
];

/**
 * Status + note of the payment review form. Approving without a slip turns the note into a
 * required "reason" field, so the browser asks for it before the server does.
 */
export function PaymentDecisionFields({
  defaultNote,
  defaultStatus,
  disabled,
  hasSlip,
  inputClass,
}: {
  defaultNote: string;
  defaultStatus: string;
  disabled?: boolean;
  hasSlip: boolean;
  inputClass: string;
}) {
  const [status, setStatus] = useState(defaultStatus);
  const needsReason = status === "approved" && !hasSlip;

  return (
    <>
      <label className="block">
        <span className="text-sm font-semibold text-[#3f3a48]">ผลการตรวจ</span>
        <select
          className={`${inputClass} bg-white`}
          disabled={disabled}
          name="paymentStatus"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-[#3f3a48]">
          {needsReason ? (
            <>
              เหตุผลที่อนุมัติโดยไม่มีสลิป <span className="text-[#b42318]">*</span>
            </>
          ) : (
            "หมายเหตุการตรวจสอบ"
          )}
        </span>
        <input
          className={`${inputClass} ${needsReason ? "border-[#d7a52c] bg-[#fffdf6]" : ""}`}
          data-invalid-message={`กรุณาระบุเหตุผลอย่างน้อย ${NO_SLIP_REASON_MIN} ตัวอักษร`}
          data-required-message="กรุณาระบุเหตุผลที่อนุมัติโดยไม่มีสลิป เช่น รับเงินสดหน้างาน"
          defaultValue={defaultNote}
          disabled={disabled}
          minLength={needsReason ? NO_SLIP_REASON_MIN : undefined}
          name="note"
          placeholder={needsReason ? "เช่น รับเงินสดหน้างาน / ตรวจยอดจากบัญชีธนาคารแล้ว" : "ผลการตรวจยอดเงิน หรือเหตุผลที่ไม่อนุมัติ"}
          required={needsReason}
        />
        {needsReason ? (
          <span className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-[#805300]">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            ยังไม่มีสลิปจากสมาชิก เหตุผลนี้จะถูกบันทึกไว้ในประวัติการตรวจ
          </span>
        ) : null}
      </label>
    </>
  );
}
