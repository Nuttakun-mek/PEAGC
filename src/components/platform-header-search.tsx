"use client";

import { useSyncExternalStore } from "react";
import { Search } from "lucide-react";

import { openCommandPalette } from "@/components/platform-command-palette";

const subscribeNothing = () => () => {};
const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/**
 * Header search box. With JavaScript it opens the command palette (typing, click, Enter); without
 * it, it is still a plain GET form that searches the member list (`/admin/members?q=`).
 */
export function PlatformHeaderSearch({ memberSearch }: { memberSearch: boolean }) {
  const mac = useSyncExternalStore(subscribeNothing, isMac, () => false);

  return (
    <form action={memberSearch ? "/admin/members" : "/admin"} className="relative w-full max-w-md" role="search">
      <label className="sr-only" htmlFor="admin-member-search">
        ค้นหาสมาชิก กิจกรรม หรือหน้า
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
      <input
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        className="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-16 outline-none transition focus:border-brand-600 focus:bg-white focus:ring-4 focus:ring-brand-600/10"
        id="admin-member-search"
        name="q"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
          // A printable key, Enter or ↓ moves the search into the palette with what is typed so far.
          if (event.key.length === 1 || event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            const typed = event.currentTarget.value + (event.key.length === 1 ? event.key : "");
            event.currentTarget.value = "";
            openCommandPalette(typed);
          }
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          openCommandPalette(event.currentTarget.value);
        }}
        onPaste={(event) => {
          event.preventDefault();
          openCommandPalette(event.clipboardData.getData("text"));
        }}
        placeholder="ค้นหาสมาชิก กิจกรรม หรือหน้า"
        type="search"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-white px-1.5 font-sans text-xs text-ink-subtle"
      >
        {mac ? "⌘K" : "Ctrl K"}
      </kbd>
    </form>
  );
}
