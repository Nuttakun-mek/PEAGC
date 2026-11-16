"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Database,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  Menu,
  Settings2,
  UsersRound,
  X,
} from "lucide-react";

const items = [
  { href: "/admin", icon: LayoutDashboard, label: "ภาพรวม" },
  { href: "/admin/members", icon: UsersRound, label: "สมาชิก" },
  { href: "/admin/employees", icon: Database, label: "ฐานสมาชิกสมาคม" },
  { href: "/admin/events", icon: CalendarDays, label: "กิจกรรม" },
  { href: "/admin/lessons", icon: GraduationCap, label: "ตารางเรียน" },
  { href: "/admin/payments", icon: CircleDollarSign, label: "ตรวจการชำระเงิน" },
  { href: "/admin/content", icon: Megaphone, label: "ข่าว คะแนน และรางวัล" },
  { href: "/admin/reports", icon: BarChart3, label: "รายงาน" },
  { href: "/admin/settings", icon: Settings2, label: "เปิด/ปิดระบบ" },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link className="flex items-center gap-3" href="/admin">
      <span className="flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#d9a521] to-[#b07d0c] text-sm font-bold text-white shadow-[0_6px_14px_rgba(198,146,20,0.35)]">
        PEA
      </span>
      <span>
        <span className="block text-sm font-bold text-[#722257]">PEAGC</span>
        <span className="block text-xs text-[#667085]">ระบบบริหารชมรมกอล์ฟ</span>
      </span>
    </Link>
  );
}

function NavList({ closed, onNavigate, pathname }: { closed: string[]; onNavigate?: () => void; pathname: string }) {
  return (
    <ul className="grid gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              aria-current={active ? "page" : undefined}
              className={`group flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition ${
                active
                  ? "bg-[#722257] text-white shadow-[0_8px_18px_rgba(114,34,87,0.22)]"
                  : "text-[#475467] hover:bg-[#f8edf4] hover:text-[#722257]"
              }`}
              href={item.href}
              onClick={onNavigate}
            >
              <item.icon className={`size-[18px] shrink-0 ${active ? "text-[#f1cf79]" : "text-[#98a2b3] group-hover:text-[#722257]"}`} aria-hidden="true" />
              <span className="truncate">{item.label}</span>
              {closed.includes(item.href) ? (
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white/15 text-white" : "bg-[#f1f3ef] text-[#98a2b3]"}`}
                  title="ปิดสำหรับสมาชิก"
                >
                  ปิด
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Admin navigation. Desktop: a sticky sidebar with the current page highlighted. Phones and
 * tablets: a top bar with a menu button that opens the same list as a drawer, instead of the
 * old row of links that had to be scrolled sideways.
 */
export function AdminNav({ closed, footer, userCard }: { closed: string[]; footer: React.ReactNode; userCard: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = items.find((item) => isActive(pathname, item.href));

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

  return (
    <>
      {/* Phones / tablets */}
      <header className="app-topbar sticky top-0 z-40 flex h-14 items-center justify-between gap-3 px-4 lg:hidden">
        <Brand />
        <div className="flex min-w-0 items-center gap-2">
          {current ? <span className="hidden truncate text-sm font-semibold text-[#344054] sm:block">{current.label}</span> : null}
          <button
            aria-controls="admin-drawer"
            aria-expanded={open}
            aria-label="เปิดเมนู"
            className="flex size-10 items-center justify-center rounded-lg border border-[#e2e8ef] bg-white text-[#722257] transition hover:bg-[#f8edf4]"
            onClick={() => setOpen(true)}
            type="button"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-50 bg-[#1d1320]/45 backdrop-blur-[2px] transition-opacity lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setOpen(false)}
      />
      <nav
        aria-label="เมนูผู้ดูแลระบบ"
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col bg-white shadow-2xl transition-transform duration-200 lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}
        id="admin-drawer"
        inert={!open}
      >
        <div className="flex items-center justify-between border-b border-[#eef0f3] px-4 py-3">
          <Brand />
          <button
            aria-label="ปิดเมนู"
            className="flex size-10 items-center justify-center rounded-lg text-[#667085] transition hover:bg-[#f2f4f7]"
            onClick={() => setOpen(false)}
            type="button"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavList closed={closed} onNavigate={() => setOpen(false)} pathname={pathname} />
        </div>
        <div className="border-t border-[#eef0f3] p-3">
          {userCard}
          {footer}
        </div>
      </nav>

      {/* Desktop */}
      <aside className="hidden border-r border-[#e2e8ef] bg-white/95 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col">
        <div className="px-5 py-6">
          <Brand />
        </div>
        <nav aria-label="เมนูผู้ดูแลระบบ" className="flex-1 overflow-y-auto px-3">
          <NavList closed={closed} pathname={pathname} />
        </nav>
        <div className="border-t border-[#e2e8ef] p-3">
          {userCard}
          {footer}
        </div>
      </aside>
    </>
  );
}
