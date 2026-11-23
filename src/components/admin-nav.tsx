"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Menu, Pin, PinOff, Search, X } from "lucide-react";

import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { EnvBadge } from "@/components/env-badge";
import { openCommandPalette } from "@/components/platform-command-palette";
import { appIcons } from "@/lib/icons";
import { type NavBadgeKey, type NavGroup, type NavItem, adminNav, adminTabBar, isNavActive } from "@/lib/nav";
import { MAX_PINS, PINS_STORAGE_KEY, parsePins, togglePin } from "@/lib/nav-pins";

export type NavBadges = Partial<Record<NavBadgeKey, number>>;

// ---------- pinned items (per viewer, localStorage; a convenience only) ----------

const PINS_EVENT = "peagc:admin-pins";
/** Used when the browser blocks storage (private mode, blocked site data). */
let memoryPins: string | null = null;

function readPins() {
  try {
    return window.localStorage.getItem(PINS_STORAGE_KEY);
  } catch {
    return memoryPins;
  }
}

function writePins(pins: string[]) {
  const value = JSON.stringify(pins);
  memoryPins = value;
  try {
    window.localStorage.setItem(PINS_STORAGE_KEY, value);
  } catch {
    // Storage blocked: keep the pins for this page view only.
  }
  window.dispatchEvent(new Event(PINS_EVENT));
}

function subscribePins(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PINS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PINS_EVENT, onChange);
  };
}

function usePins(items: NavItem[]) {
  const raw = useSyncExternalStore(subscribePins, readPins, () => null);
  const hrefKey = items.map((item) => item.href).join("|");
  const pins = useMemo(() => parsePins(raw, hrefKey.split("|")), [raw, hrefKey]);
  return { pins, toggle: (href: string) => writePins(togglePin(pins, href)) };
}

// ---------- pieces ----------

function Brand() {
  return (
    <Link className="flex items-center gap-3" href="/admin">
      <ClubCrest priority size={44} />
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-semibold text-brand-600">ชมรมกอล์ฟ</span>
        <span className="block text-xs text-ink-subtle">การไฟฟ้าส่วนภูมิภาค</span>
      </span>
    </Link>
  );
}

function CountBadge({ active, value }: { active: boolean; value?: number }) {
  if (!value) return null;
  return (
    <span
      className={`ml-auto min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${active ? "bg-white text-brand-600" : "bg-warning-bg text-warning"}`}
    >
      {value > 99 ? "99+" : value}
      <span className="sr-only"> รายการรอดำเนินการ</span>
    </span>
  );
}

function NavLink({
  active,
  badges,
  closed,
  editing,
  item,
  onNavigate,
}: {
  active: boolean;
  badges: NavBadges;
  closed: boolean;
  editing: boolean;
  item: NavItem;
  onNavigate?: () => void;
}) {
  const Icon = appIcons[item.icon];
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`group relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm transition ${editing ? "pr-12" : ""} ${
        active ? "bg-brand-600 font-semibold text-white" : "font-medium text-ink-muted hover:bg-brand-50 hover:text-brand-600"
      }`}
      href={item.href}
      onClick={onNavigate}
    >
      <Icon className={`size-5 shrink-0 ${active ? "text-white" : "text-ink-subtle group-hover:text-brand-600"}`} aria-hidden="true" />
      <span className="truncate">{item.label}</span>
      {closed ? (
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${active ? "bg-white/15 text-white" : "bg-neutral-bg text-neutral"}`}
          title="ปิดสำหรับสมาชิก"
        >
          ปิดอยู่
        </span>
      ) : (
        <CountBadge active={active} value={item.badge ? badges[item.badge] : undefined} />
      )}
    </Link>
  );
}

function PinToggle({ active, disabled, item, onToggle, pinned }: { active: boolean; disabled: boolean; item: NavItem; onToggle: () => void; pinned: boolean }) {
  const Icon = pinned ? PinOff : Pin;
  return (
    <button
      aria-label={pinned ? `เลิกปักหมุด ${item.label}` : `ปักหมุด ${item.label}`}
      aria-pressed={pinned}
      className={`absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "text-white hover:bg-white/15" : pinned ? "text-brand-600 hover:bg-brand-50" : "text-ink-subtle hover:bg-brand-50 hover:text-brand-600"
      }`}
      disabled={disabled}
      onClick={onToggle}
      title={disabled ? `ปักหมุดได้สูงสุด ${MAX_PINS} รายการ` : undefined}
      type="button"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

type GroupsProps = {
  badges: NavBadges;
  closed: string[];
  editing: boolean;
  nav: NavGroup[];
  onEdit: (value: boolean) => void;
  onNavigate?: () => void;
  onToggle: (href: string) => void;
  pathname: string;
  pins: string[];
};

function NavGroups({ badges, closed, editing, nav, onEdit, onNavigate, onToggle, pathname, pins }: GroupsProps) {
  const items = nav.flatMap((group) => group.items);
  const pinnedItems = pins.map((href) => items.find((item) => item.href === href)).filter((item): item is NavItem => Boolean(item));
  const full = pins.length >= MAX_PINS;

  const row = (item: NavItem, key: string) => {
    const active = isNavActive(pathname, item.href);
    const pinned = pins.includes(item.href);
    return (
      <li className="relative" key={key}>
        <NavLink
          active={active}
          badges={badges}
          closed={closed.includes(item.href)}
          editing={editing}
          item={item}
          onNavigate={onNavigate}
        />
        {editing ? <PinToggle active={active} disabled={!pinned && full} item={item} onToggle={() => onToggle(item.href)} pinned={pinned} /> : null}
      </li>
    );
  };

  return (
    <div className="grid gap-5">
      {editing ? (
        <div className="rounded-lg border border-brand-600/20 bg-brand-50 px-3 py-2.5 text-sm text-ink" role="status">
          <p>
            กดหมุดหลังเมนูที่ใช้บ่อย ปักได้ {MAX_PINS} รายการ
            <span className="text-ink-muted"> (เลือกแล้ว <span className="tabular-nums">{pins.length}</span>)</span>
          </p>
          <button className="mt-1.5 text-sm font-semibold text-brand-600 underline-offset-2 hover:underline" onClick={() => onEdit(false)} type="button">
            เสร็จ
          </button>
        </div>
      ) : null}

      {pinnedItems.length ? (
        <div>
          <div className="flex items-center justify-between px-3 pb-1.5">
            <p className="text-xs font-medium text-ink-subtle">ปักหมุด</p>
            {!editing ? (
              <button className="rounded text-xs font-medium text-brand-600 underline-offset-2 hover:underline" onClick={() => onEdit(true)} type="button">
                แก้ไข
              </button>
            ) : null}
          </div>
          <ul className="grid gap-0.5">{pinnedItems.map((item) => row(item, `pin-${item.href}`))}</ul>
        </div>
      ) : null}

      {nav.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-xs font-medium text-ink-subtle">{group.label}</p>
          <ul className="grid gap-0.5">{group.items.map((item) => row(item, item.href))}</ul>
        </div>
      ))}

      {!editing && !pinnedItems.length ? (
        <button
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-ink-subtle transition hover:bg-brand-50 hover:text-brand-600"
          onClick={() => onEdit(true)}
          type="button"
        >
          <Pin className="size-4" aria-hidden="true" />
          ปักหมุดเมนูที่ใช้บ่อย
        </button>
      ) : null}
    </div>
  );
}

/**
 * Admin navigation. Desktop: a sticky sidebar grouped by job (only the areas the person's roles
 * may open), current page highlighted, pending work counted, up to four pinned items on top.
 * Phones: a top bar with the current page name and search, a bottom tab bar for the daily jobs,
 * and the full menu in a drawer.
 */
export function AdminNav({
  badges,
  closed,
  footer,
  nav = adminNav,
  tabBar = adminTabBar,
  userCard,
}: {
  badges: NavBadges;
  closed: string[];
  footer: React.ReactNode;
  /** Role-filtered menu (src/lib/nav.ts filterNavForRoles). */
  nav?: NavGroup[];
  /** Role-filtered phone tab bar (tabBarForRoles). */
  tabBar?: NavItem[];
  userCard: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const items = useMemo(() => nav.flatMap((group) => group.items), [nav]);
  const { pins, toggle } = usePins(items);
  const current = items.find((item) => isNavActive(pathname, item.href));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groupsProps = { badges, closed, editing, nav, onEdit: setEditing, onToggle: toggle, pathname, pins };

  return (
    <>
      {/* Phones / tablets: top bar */}
      <header className="app-topbar sticky top-0 z-40 flex h-14 items-center justify-between gap-3 px-4 lg:hidden">
        <Link aria-label={CLUB_NAME} className="flex min-w-0 items-center gap-2.5" href="/admin">
          <ClubCrest priority size={36} />
          <span className="truncate text-base font-semibold text-brand-600">{current?.label ?? "ผู้ดูแลชมรม"}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          <EnvBadge />
          <button
            aria-haspopup="dialog"
            aria-label="ค้นหา"
            className="flex size-10 items-center justify-center rounded-lg text-ink-muted transition hover:bg-brand-50 hover:text-brand-600"
            onClick={() => openCommandPalette()}
            type="button"
          >
            <Search className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Phones / tablets: bottom tab bar */}
      <nav
        aria-label="เมนูลัด"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabBar.length + 1}, minmax(0, 1fr))` }}>
          {tabBar.map((item) => {
            const Icon = appIcons[item.icon];
            const active = isNavActive(pathname, item.href);
            const count = item.badge ? badges[item.badge] : 0;
            return (
              <li key={item.href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-16 flex-col items-center justify-center gap-1 text-xs ${active ? "font-semibold text-brand-600" : "font-medium text-ink-subtle"}`}
                  href={item.href}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {item.label}
                  {count ? (
                    <span className="absolute left-1/2 top-2 ml-2 min-w-5 rounded-full bg-warning px-1.5 text-center text-xs font-semibold leading-5 text-white tabular-nums">
                      {count > 99 ? "99+" : count}
                      <span className="sr-only"> รายการรอดำเนินการ</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              aria-controls="admin-drawer"
              aria-expanded={open}
              className="flex h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium text-ink-subtle"
              onClick={() => setOpen(true)}
              type="button"
            >
              <Menu className="size-5" aria-hidden="true" />
              เมนูทั้งหมด
            </button>
          </li>
        </ul>
      </nav>

      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-50 bg-[#1d1320]/45 backdrop-blur-[2px] transition-opacity lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setOpen(false)}
      />
      <nav
        aria-label="เมนูผู้ดูแล"
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col bg-white shadow-2xl transition-transform duration-200 lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}
        id="admin-drawer"
        inert={!open}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <Brand />
          <button
            aria-label="ปิดเมนู"
            className="flex size-10 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-neutral-bg"
            onClick={() => setOpen(false)}
            type="button"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavGroups {...groupsProps} onNavigate={() => setOpen(false)} />
        </div>
        <div className="border-t border-line p-3">
          {userCard}
          {footer}
        </div>
      </nav>

      {/* Desktop */}
      <aside className="hidden border-r border-line bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col">
        <div className="px-5 py-5">
          <Brand />
        </div>
        <nav aria-label="เมนูผู้ดูแล" className="flex-1 overflow-y-auto px-3 pb-4">
          <NavGroups {...groupsProps} />
        </nav>
        <div className="border-t border-line p-3">
          {userCard}
          {footer}
        </div>
      </aside>
    </>
  );
}
