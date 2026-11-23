"use client";

import { AlertTriangle, CircleHelp } from "lucide-react";
import { useRef } from "react";

type ConfirmSubmitButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "onClick" | "ref" | "title" | "type"> & {
  children: React.ReactNode;
  className?: string;
  /** Label of the confirm button in the dialog. */
  confirmLabel?: string;
  /** Extra content under the message, e.g. a summary of what is being confirmed (fee, date, rules). */
  details?: React.ReactNode;
  message: string;
  title?: string;
  /** "danger" (default) for delete/cancel/reject; "primary" for non-destructive confirms such as signing up. */
  tone?: "danger" | "primary";
};

/**
 * Submit button that asks first, in a Thai dialog styled like the rest of the app (instead of the
 * browser's `confirm()` box). Escape, the backdrop and "ยกเลิก" all cancel; the dialog opens with focus on "ยกเลิก"
 * (first in DOM order) so Enter never confirms a destructive action by accident.
 */
export function ConfirmSubmitButton({
  children,
  className,
  confirmLabel = "ยืนยัน",
  details,
  message,
  title = "ยืนยันการทำรายการ",
  tone = "danger",
  ...buttonProps
}: ConfirmSubmitButtonProps) {
  const danger = tone === "danger";
  const Icon = danger ? AlertTriangle : CircleHelp;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmedRef = useRef(false);

  return (
    <>
      <button
        {...buttonProps}
        className={className}
        onClick={(event) => {
          if (confirmedRef.current) {
            confirmedRef.current = false;
            return;
          }
          event.preventDefault();
          dialogRef.current?.showModal();
        }}
        ref={buttonRef}
        type="submit"
      >
        {children}
      </button>
      <dialog
        aria-label={title}
        className="confirm-dialog"
        onClick={(event) => {
          // A click on the backdrop lands on the <dialog> itself.
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        ref={dialogRef}
      >
        <div className="flex gap-4 p-5 sm:p-6">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${danger ? "bg-danger-bg text-danger" : "bg-brand-50 text-brand-600"}`}>
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-ink">{title}</p>
            <p className="mt-1.5 text-sm text-ink-muted">{message}</p>
            {details ? <div className="mt-3 text-sm text-ink-muted">{details}</div> : null}
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line bg-canvas px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
          <button
            className="h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink-muted transition hover:bg-neutral-bg"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ยกเลิก
          </button>
          <button
            className={`h-11 rounded-lg px-4 text-sm font-semibold text-white transition ${danger ? "bg-danger hover:bg-[#912018]" : "bg-brand-600 hover:bg-brand-700"}`}
            onClick={() => {
              dialogRef.current?.close();
              confirmedRef.current = true;
              buttonRef.current?.click();
            }}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
