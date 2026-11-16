"use client";

import { AlertTriangle } from "lucide-react";
import { useRef } from "react";

type ConfirmSubmitButtonProps = {
  children: React.ReactNode;
  className?: string;
  /** Label of the confirm button in the dialog. */
  confirmLabel?: string;
  message: string;
  title?: string;
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
  message,
  title = "ยืนยันการทำรายการ",
}: ConfirmSubmitButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmedRef = useRef(false);

  return (
    <>
      <button
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
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#fdecec] text-[#b42318]">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-[#2f3137]">{title}</p>
            <p className="mt-1.5 text-sm leading-6 text-[#5d5866]">{message}</p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[#eef0f3] bg-[#fafbfc] px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
          <button
            className="h-10 rounded-md border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#3f3a48] transition hover:bg-[#f6f4f8]"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ยกเลิก
          </button>
          <button
            className="h-10 rounded-md bg-[#b42318] px-4 text-sm font-semibold text-white transition hover:bg-[#912018]"
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
