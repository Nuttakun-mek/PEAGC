"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

/** How long a success/info result stays on screen before it fades out on its own. */
const AUTO_HIDE_MS = 7000;

/**
 * Client wrapper for StatusBanner. A floating banner is the result of the action that was just
 * submitted: it shows as a toast that stays visible wherever the form was on the page, and it
 * goes away once the admin moves on (types into a form, opens another item, submits again) so
 * the message of the previous item never sits on top of the next one. Successes also fade out
 * by themselves; errors stay until dismissed or acted on.
 */
export function StatusBannerShell({
  children,
  className,
  floating,
  tone,
}: {
  children: React.ReactNode;
  className: string;
  floating: boolean;
  tone: "success" | "info" | "warning" | "error";
}) {
  // Every server render (each save) delivers a new `children` element, so remembering which
  // one was dismissed brings the banner back for the next save even if the text is the same.
  const [dismissed, setDismissed] = useState<React.ReactNode>(null);
  const hidden = dismissed !== null && dismissed === children;
  const autoHide = floating && (tone === "success" || tone === "info");

  useEffect(() => {
    if (!floating || hidden) return;

    // The result is shown; drop it from the address bar so reload/back does not replay it.
    const url = new URL(window.location.href);
    if (url.searchParams.has("status")) {
      url.searchParams.delete("status");
      // `null` state lets the Next router copy its own state and sync to the new URL.
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    const dismiss = () => setDismissed(children);
    const onInput = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("form")) dismiss();
    };
    const onClick = (event: MouseEvent) => {
      const summary = event.target instanceof Element ? event.target.closest("summary") : null;
      if (summary?.parentElement instanceof HTMLDetailsElement && !summary.parentElement.open) dismiss();
    };
    const onSubmit = () => dismiss();

    document.addEventListener("input", onInput, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    const timer = autoHide ? window.setTimeout(dismiss, AUTO_HIDE_MS) : null;

    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      if (timer) window.clearTimeout(timer);
    };
  }, [autoHide, children, floating, hidden]);

  if (hidden) {
    return null;
  }

  // Screen readers announce the result: errors right away, everything else when idle.
  const live = tone === "error" ? ({ "aria-live": "assertive", role: "alert" } as const) : ({ "aria-live": "polite", role: "status" } as const);

  if (!floating) {
    return (
      <div aria-atomic="true" className={className} {...live}>
        {children}
      </div>
    );
  }

  return (
    <div aria-atomic="true" className="status-toast-region" {...live}>
      <div className={`status-toast ${className}`}>
        {children}
        <button
          aria-label="ปิดข้อความ"
          className="-m-1 rounded p-1 opacity-70 transition hover:opacity-100"
          onClick={() => setDismissed(children)}
          type="button"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
        {autoHide ? <span aria-hidden="true" className="status-toast-timer" style={{ animationDuration: `${AUTO_HIDE_MS}ms` }} /> : null}
      </div>
    </div>
  );
}
