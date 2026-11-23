"use client";

import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import { useId, useRef, useState } from "react";

import { buttonClass, fieldHint, fieldInput, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { NO_SLIP_REASON_MIN, paymentRecordStatusLabels } from "@/lib/payments";

/** Less common outcomes, kept out of the way of อนุมัติ / ไม่อนุมัติ. */
const otherStatuses = ["review", "refunded", "pending"] as const;

/**
 * Fields and buttons of the payment review form. Each button submits `paymentStatus` with its own
 * value (approved / rejected / review / refunded / pending), the same values the old dropdown sent.
 * Approving without a slip needs a written reason first; the server checks it again.
 */
export function PaymentDecisionFields({
  defaultAmount,
  defaultNote,
  defaultTransferredAt,
  disabled,
  hasSlip,
}: {
  defaultAmount: number;
  defaultNote: string;
  /** `datetime-local` value in Bangkok time, or "". */
  defaultTransferredAt: string;
  disabled?: boolean;
  hasSlip: boolean;
}) {
  const id = useId();
  const noteRef = useRef<HTMLInputElement>(null);
  const [reasonError, setReasonError] = useState("");

  function checkReason(event: React.MouseEvent<HTMLButtonElement>) {
    if (hasSlip) return;
    const note = noteRef.current?.value.trim() ?? "";
    if (note.length >= NO_SLIP_REASON_MIN) return;
    event.preventDefault();
    setReasonError(
      note
        ? `เหตุผลต้องยาวอย่างน้อย ${NO_SLIP_REASON_MIN} ตัวอักษร`
        : "ยังไม่มีสลิป เขียนเหตุผลก่อนอนุมัติ เช่น รับเงินสดหน้างาน",
    );
    noteRef.current?.focus();
  }

  return (
    <fieldset
      className="grid min-w-0 gap-4"
      disabled={disabled}
      onKeyDown={(event) => {
        // Enter in a field would press the first button (อนุมัติ); the admin picks the outcome instead.
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}
    >
      <legend className="sr-only">ผลการตรวจ</legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>ยอดที่ได้รับ</span>
          <span className="relative mt-1.5 block">
            <input
              className={`${fieldInputClass("md", { margin: false })} pr-12 tabular-nums`}
              defaultValue={defaultAmount}
              inputMode="decimal"
              min="0"
              name="amount"
              step="0.01"
              type="number"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-subtle">บาท</span>
          </span>
        </label>
        <label className="block">
          <span className={fieldLabel}>วันเวลาที่โอน</span>
          <input className={fieldInput} defaultValue={defaultTransferredAt} name="transferredAt" type="datetime-local" />
        </label>
      </div>

      <label className="block">
        <span className={fieldLabel}>
          {hasSlip ? (
            "หมายเหตุ"
          ) : (
            <>
              เหตุผล / หมายเหตุ <span className="text-ink-subtle">(ต้องกรอกถ้าจะอนุมัติโดยไม่มีสลิป)</span>
            </>
          )}
        </span>
        <input
          aria-describedby={`${id}-note`}
          aria-invalid={reasonError ? true : undefined}
          className={`${fieldInput} aria-invalid:border-danger`}
          defaultValue={defaultNote}
          name="note"
          onInput={() => {
            if (reasonError) setReasonError("");
          }}
          placeholder={hasSlip ? "เช่น ยอดตรง / ชื่อบัญชีไม่ตรง" : "เช่น รับเงินสดหน้างาน / ตรวจยอดในบัญชีธนาคารแล้ว"}
          ref={noteRef}
        />
        {reasonError ? (
          <span className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-danger" id={`${id}-note`} role="alert">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {reasonError}
          </span>
        ) : (
          <span className={fieldHint} id={`${id}-note`}>
            เก็บไว้ในประวัติการตรวจ สมาชิกไม่เห็นข้อความนี้
          </span>
        )}
      </label>

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <button
          className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}
          name="paymentStatus"
          onClick={checkReason}
          type="submit"
          value="approved"
        >
          <Check className="size-5" aria-hidden="true" />
          อนุมัติ
        </button>
        <button className={`${buttonClass("danger", "lg")} w-full sm:w-auto`} name="paymentStatus" type="submit" value="rejected">
          <X className="size-5" aria-hidden="true" />
          ไม่อนุมัติ
        </button>
        <span className="text-xs text-ink-subtle sm:ml-1">ไม่อนุมัติ = สมาชิกต้องส่งสลิปใหม่</span>
      </div>

      <details className="group/other rounded-lg border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-muted outline-none hover:bg-canvas focus-visible:ring-4 focus-visible:ring-brand-600/20 [&::-webkit-details-marker]:hidden">
          บันทึกเป็นสถานะอื่น (คืนเงิน รอตรวจ รอชำระ)
          <ChevronDown className="size-4 shrink-0 transition group-open/other:rotate-180" aria-hidden="true" />
        </summary>
        <div className="flex flex-wrap gap-2 border-t border-line p-3">
          {otherStatuses.map((status) => (
            <button className={buttonClass("secondary", "sm")} key={status} name="paymentStatus" type="submit" value={status}>
              {paymentRecordStatusLabels[status]}
            </button>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
