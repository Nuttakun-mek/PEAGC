"use client";

import { X } from "lucide-react";
import { useState } from "react";

/**
 * Client wrapper for StatusBanner. A floating banner sticks to the top of the viewport so the
 * result of a save is visible even when the form that was submitted sits far down the page
 * (the lesson generator, edit panels at the bottom of long lists), and can be dismissed.
 */
export function StatusBannerShell({
  children,
  className,
  floating,
}: {
  children: React.ReactNode;
  className: string;
  floating: boolean;
}) {
  // Every server render (each save) delivers a new `children` element, so remembering which
  // one was dismissed brings the banner back for the next save even if the text is the same.
  const [dismissed, setDismissed] = useState<React.ReactNode>(null);

  if (dismissed !== null && dismissed === children) {
    return null;
  }

  return (
    <div
      className={`${className} ${floating ? "sticky top-3 z-30 shadow-[0_12px_32px_rgba(16,24,40,0.14)] lg:top-20" : ""}`}
      role="status"
    >
      {children}
      {floating ? (
        <button
          aria-label="ปิดข้อความ"
          className="-m-1 rounded p-1 opacity-70 transition hover:opacity-100"
          onClick={() => setDismissed(children)}
          type="button"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
