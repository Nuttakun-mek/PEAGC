"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { formatCountdown } from "@/lib/lessons/booking";

/**
 * Live "opens in HH:MM:SS" ticker. When the countdown reaches zero it refreshes the
 * server-rendered page so the booking buttons switch on for everyone at the same time.
 * Takes its colour from the surrounding notice.
 */
export function LessonBookingCountdown({ openAt }: { openAt: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(() => Date.parse(openAt) - Date.now());

  useEffect(() => {
    let refreshed = false;
    const tick = () => {
      const remaining = Date.parse(openAt) - Date.now();
      setLeft(remaining);
      if (remaining <= 0 && !refreshed) {
        refreshed = true;
        router.refresh();
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [openAt, router]);

  return (
    <span className="font-semibold tabular-nums" suppressHydrationWarning>
      {formatCountdown(left)}
    </span>
  );
}
