"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search, X } from "lucide-react";

import { appIcons, type AppIconName } from "@/lib/icons";
import { type PaletteEntry, type PaletteScopes, QUICK_ACTION_GROUP, type SearchGroup, type SearchResponse, withBypass } from "@/lib/palette";
import { matchPages, normalizeQuery } from "@/lib/search/rank";

/** Other components open the palette with `openCommandPalette()` (header search, phone top bar). */
export const OPEN_PALETTE_EVENT = "peagc:open-command-palette";

export function openCommandPalette(query = "") {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: { query } }));
}

type Option = {
  detail?: string;
  group: string;
  href: string;
  icon: AppIconName;
  id: string;
  label: string;
};

type Remote = { error?: boolean; groups: SearchGroup[]; query: string };

const groupIcons: Record<SearchGroup["key"], AppIconName> = { courses: "lessons", events: "events", members: "members" };
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

function isBypassUrl() {
  try {
    return new URLSearchParams(window.location.search).get("bypass") === "admin";
  } catch {
    return false;
  }
}

/**
 * Search everything an admin may open: menu pages, quick actions, members (name, nickname, member
 * code, employee code, phone), events and lesson courses. Ctrl+K / ⌘K opens it anywhere in /admin.
 * Keyboard: ↑ ↓ choose, Enter opens, Esc closes. ARIA combobox + listbox (WAI-ARIA 1.2 pattern).
 */
export function PlatformCommandPalette({ entries, scopes }: { entries: PaletteEntry[]; scopes: PaletteScopes }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const cache = useRef(new Map<string, SearchGroup[]>());
  const baseId = useId();
  const listId = `${baseId}-list`;

  const [open, setOpen] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Remote | null>(null);
  const [activeState, setActiveState] = useState({ index: 0, query: "" });

  const normalized = normalizeQuery(query);
  const wantsRemote = open && normalized.length >= MIN_QUERY && (scopes.members || scopes.events || scopes.courses);

  const show = useCallback((initial = "") => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBypass(isBypassUrl());
    setQuery(initial);
    if (!dialog.open) dialog.showModal();
    setOpen(true);
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }, []);

  const hide = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  // Ctrl+K / ⌘K anywhere, and the open event from the header search and the phone top bar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialogRef.current?.open) hide();
        else show();
      }
    };
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      show(detail?.query ?? "");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [hide, show]);

  // Debounced server search; answers for a query are cached while the page stays open.
  useEffect(() => {
    if (!wantsRemote) return;
    const cached = cache.current.get(`${bypass}:${normalized}`);
    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        if (cached) {
          setRemote({ groups: cached, query: normalized });
          return;
        }
        try {
          const params = new URLSearchParams({ q: normalized });
          if (bypass) params.set("bypass", "admin");
          const response = await fetch(`/api/admin/search?${params.toString()}`, { signal: controller.signal });
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as SearchResponse;
          cache.current.set(`${bypass}:${normalized}`, body.groups);
          setRemote({ groups: body.groups, query: normalized });
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error("[palette] search failed", error);
          setRemote({ error: true, groups: [], query: normalized });
        }
      },
      cached ? 0 : DEBOUNCE_MS,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [bypass, normalized, wantsRemote]);

  const current = remote && remote.query === normalized ? remote : null;
  const loading = wantsRemote && !current;

  const sections = useMemo(() => {
    const list: Array<{ label: string; options: Option[] }> = [];
    const fromEntry = (entry: PaletteEntry): Option => ({
      detail: entry.kind === "page" ? entry.group : undefined,
      group: entry.kind === "action" ? QUICK_ACTION_GROUP : "หน้า",
      href: withBypass(entry.href, bypass),
      icon: entry.icon,
      id: `${baseId}-${entry.kind}-${entry.href}`,
      label: entry.label,
    });
    const actions = entries.filter((entry) => entry.kind === "action");
    const pages = entries.filter((entry) => entry.kind === "page");

    if (!normalized) {
      if (actions.length) list.push({ label: QUICK_ACTION_GROUP, options: actions.slice(0, 5).map(fromEntry) });
      if (pages.length) list.push({ label: "หน้า", options: pages.map(fromEntry) });
      return list;
    }

    const matchedPages = matchPages(pages, normalized, 5);
    if (matchedPages.length) list.push({ label: "หน้า", options: matchedPages.map(fromEntry) });
    for (const group of current?.groups ?? []) {
      list.push({
        label: group.label,
        options: group.items.map((hit) => ({
          detail: hit.detail,
          group: group.label,
          href: withBypass(hit.href, bypass),
          icon: groupIcons[group.key],
          id: `${baseId}-${group.key}-${hit.id}`,
          label: hit.label,
        })),
      });
    }
    const matchedActions = matchPages(actions, normalized, 3);
    if (matchedActions.length) list.push({ label: QUICK_ACTION_GROUP, options: matchedActions.map(fromEntry) });
    if (scopes.members) {
      list.push({
        label: "ค้นหาต่อ",
        options: [
          {
            group: "ค้นหาต่อ",
            href: withBypass(`/admin/members?q=${encodeURIComponent(query.trim())}`, bypass),
            icon: "search",
            id: `${baseId}-all-members`,
            label: `ค้นหา "${query.trim()}" ในรายชื่อสมาชิก`,
          },
        ],
      });
    }
    return list;
  }, [baseId, bypass, current, entries, normalized, query, scopes.members]);

  const options = useMemo(() => sections.flatMap((section) => section.options), [sections]);
  const resultCount = options.filter((option) => option.group !== "ค้นหาต่อ").length;
  const rawActive = activeState.query === query ? activeState.index : 0;
  const active = options.length ? Math.min(rawActive, options.length - 1) : -1;
  const activeOption = active >= 0 ? options[active] : null;

  useEffect(() => {
    if (!activeOption) return;
    const element = document.getElementById(activeOption.id);
    element?.scrollIntoView({ block: "nearest" });
  }, [activeOption]);

  const go = (option: Option) => {
    hide();
    const target = new URL(option.href, window.location.href);
    // Same page, new #hash (e.g. "#create"): a router push would not fire hashchange.
    if (target.pathname === window.location.pathname && target.search === window.location.search && target.hash) {
      window.location.hash = target.hash;
      return;
    }
    router.push(option.href);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveState({ index: (active + step + options.length) % options.length, query });
    } else if (event.key === "Home" && event.ctrlKey) {
      event.preventDefault();
      setActiveState({ index: 0, query });
    } else if (event.key === "End" && event.ctrlKey) {
      event.preventDefault();
      setActiveState({ index: Math.max(0, options.length - 1), query });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeOption) go(activeOption);
    }
  };

  const statusText = !normalized
    ? ""
    : loading
      ? "กำลังค้นหา"
      : current?.error
        ? "ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง"
        : resultCount
          ? `พบ ${resultCount} รายการ`
          : `ไม่พบ "${query.trim()}"`;

  return (
    <dialog
      aria-label="ค้นหาและไปยังหน้า"
      className="command-palette"
      onClick={(event) => {
        // A click on the backdrop (outside the panel) closes it.
        if (event.target === dialogRef.current) hide();
      }}
      onClose={() => {
        setOpen(false);
        setQuery("");
        returnFocus.current?.focus?.();
      }}
      ref={dialogRef}
    >
      <div className="flex max-h-[min(36rem,calc(100dvh-6rem))] flex-col">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
          <input
            aria-activedescendant={activeOption?.id}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={open && options.length > 0}
            aria-label="ค้นหา"
            autoComplete="off"
            className="h-14 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle"
            enterKeyHint="go"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="ชื่อสมาชิก เลขสมาชิก เบอร์โทร กิจกรรม หรือชื่อหน้า"
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="text"
            value={query}
          />
          <button
            aria-label="ปิดการค้นหา"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-neutral-bg hover:text-ink"
            onClick={hide}
            type="button"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <p aria-live="polite" className="sr-only" role="status">
          {statusText}
        </p>

        <div aria-label="ผลการค้นหา" className="min-h-0 flex-1 overflow-y-auto px-2 py-2" id={listId} role="listbox">
          {sections.map((section) => {
            const headingId = `${baseId}-group-${section.label}`;
            return (
              <div aria-labelledby={headingId} className="py-1" key={section.label} role="group">
                <div className="px-3 pb-1 pt-2 text-xs font-medium text-ink-subtle" id={headingId} role="presentation">
                  {section.label}
                </div>
                {section.options.map((option) => {
                  const Icon = appIcons[option.icon];
                  const selected = activeOption?.id === option.id;
                  return (
                    <Link
                      aria-selected={selected}
                      className={`flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-sm ${selected ? "bg-brand-50 text-brand-700" : "text-ink"}`}
                      href={option.href}
                      id={option.id}
                      key={option.id}
                      onClick={(event) => {
                        // Ctrl/⌘/Shift-click keeps the browser's "open in new tab/window".
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                        event.preventDefault();
                        go(option);
                      }}
                      onMouseMove={() => {
                        const index = options.findIndex((item) => item.id === option.id);
                        if (index !== active) setActiveState({ index, query });
                      }}
                      role="option"
                      tabIndex={-1}
                    >
                      <Icon className={`size-4 shrink-0 ${selected ? "text-brand-600" : "text-ink-subtle"}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{option.label}</span>
                        {option.detail ? <span className="block truncate text-xs text-ink-subtle">{option.detail}</span> : null}
                      </span>
                      {selected ? <CornerDownLeft className="size-4 shrink-0 text-brand-600" aria-hidden="true" /> : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}

          {normalized && loading ? <p className="px-3 py-3 text-sm text-ink-muted">กำลังค้นหา…</p> : null}
          {normalized && !loading && current?.error ? (
            <p className="px-3 py-3 text-sm text-danger">ค้นหาไม่สำเร็จ ลองพิมพ์ใหม่อีกครั้ง</p>
          ) : null}
          {normalized && !loading && !current?.error && resultCount === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm font-medium text-ink">ไม่พบ &quot;{query.trim()}&quot;</p>
              <p className="mt-1 text-sm text-ink-muted">
                {normalized.length < MIN_QUERY
                  ? "พิมพ์อย่างน้อย 2 ตัวอักษร"
                  : "ลองค้นด้วยชื่อ ชื่อเล่น เลขสมาชิก รหัสพนักงาน เบอร์โทร หรือชื่อกิจกรรม"}
              </p>
            </div>
          ) : null}
        </div>

        <div aria-hidden="true" className="hidden items-center gap-4 border-t border-line px-4 py-2 text-xs text-ink-subtle sm:flex">
          <span>
            <kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> เลือก
          </span>
          <span>
            <kbd className="font-sans">Enter</kbd> เปิด
          </span>
          <span>
            <kbd className="font-sans">Esc</kbd> ปิด
          </span>
        </div>
      </div>
    </dialog>
  );
}
