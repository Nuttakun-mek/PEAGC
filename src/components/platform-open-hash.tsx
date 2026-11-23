"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Opens what the URL hash points at, on every admin page: `#create` opens the page's first
 * "+ เพิ่ม…" panel (CreatePanel), any other `#id` opens that `<details>` row. Used by the quick
 * actions in the search palette and by links that land on one row.
 */
export function PlatformOpenHash() {
  const pathname = usePathname();

  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target =
        id === "create" ? document.querySelector<HTMLDetailsElement>("details[data-create-panel]") : document.getElementById(id);
      if (!(target instanceof HTMLDetailsElement)) return;
      if (!target.open) target.open = true;
      if (id === "create") {
        target.scrollIntoView({ block: "start" });
        target.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
      }
    };
    open();
    // The new page's content can commit a frame after the URL changes.
    const frame = window.requestAnimationFrame(open);
    window.addEventListener("hashchange", open);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", open);
    };
  }, [pathname]);

  return null;
}
