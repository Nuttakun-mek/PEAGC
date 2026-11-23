"use client";

import { useEffect } from "react";

/**
 * Opens the `<details>` row named by the URL hash (e.g. #slot-…, #program-…), so "รายชื่อและแก้ไข"
 * links and post-save redirects land on an expanded row instead of a closed one.
 */
export function LessonsOpenHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      if (target instanceof HTMLDetailsElement) target.open = true;
    };
    open();
    // After a server-action redirect the router writes the new URL just after this effect runs.
    const frame = window.requestAnimationFrame(open);
    window.addEventListener("hashchange", open);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", open);
    };
  }, []);

  return null;
}
