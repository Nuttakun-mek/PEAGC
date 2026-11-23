"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Re-fetches the server-rendered page every `seconds` (no full reload, scroll stays put) while the
 * tab is visible, and right away when the phone screen comes back on.
 */
export function EventsAutoRefresh({ seconds = 30, updatedLabel }: { seconds?: number; updatedLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, seconds * 1000);
    const onVisibility = () => {
      setVisible(document.visibilityState === "visible");
      refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, seconds]);

  return (
    <p className="flex items-center gap-1.5 text-sm text-ink-muted" role="status">
      <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
      {pending ? "กำลังอัปเดต..." : `อัปเดตล่าสุด ${updatedLabel}${visible ? ` · อัปเดตเองทุก ${seconds} วินาที` : ""}`}
    </p>
  );
}
