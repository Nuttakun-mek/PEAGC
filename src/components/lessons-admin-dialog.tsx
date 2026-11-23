"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Button that opens a dialog holding a whole form (e.g. "งดเรียนทั้งวัน" with its reason field),
 * for confirmations that need input — ConfirmSubmitButton only asks yes / no.
 */
export function LessonsAdminDialog({
  children,
  title,
  trigger,
  triggerClassName,
  triggerLabel,
}: {
  children: React.ReactNode;
  title: string;
  /** button content */
  trigger: React.ReactNode;
  triggerClassName: string;
  /** accessible name when the trigger shows only an icon or a short word */
  triggerLabel?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button aria-label={triggerLabel} className={triggerClassName} onClick={() => dialogRef.current?.showModal()} type="button">
        {trigger}
      </button>
      <dialog
        aria-label={title}
        className="confirm-dialog"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        ref={dialogRef}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <p className="text-base font-semibold text-ink">{title}</p>
          <button
            aria-label="ปิด"
            className="-m-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-neutral-bg hover:text-ink"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-left text-sm text-ink">{children}</div>
      </dialog>
    </>
  );
}

/**
 * Side panel of the lesson calendar: slides over the page from the right (full screen on phones).
 * Escape or the backdrop goes to `closeHref` (the same calendar without ?slot=).
 */
export function LessonsAdminDrawer({ children, closeHref, title }: { children: React.ReactNode; closeHref: string; title: string }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      router.push(closeHref, { scroll: false });
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [closeHref, router]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end print:hidden">
      <button
        aria-label="ปิดแผงรอบเรียน"
        className="absolute inset-0 cursor-default bg-ink/40"
        onClick={() => router.push(closeHref, { scroll: false })}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-label={title}
        aria-modal="true"
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-canvas shadow-card outline-none"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
