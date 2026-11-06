import Link from "next/link";
import {
  CalendarDays,
  CircleDollarSign,
  Database,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  LogOut,
  Search,
  UsersRound,
} from "lucide-react";

import { signOut } from "@/app/actions/auth";

const adminNavigation = [
  { href: "/admin", icon: LayoutDashboard, label: "ภาพรวม" },
  { href: "/admin/members", icon: UsersRound, label: "สมาชิก" },
  { href: "/admin/employees", icon: Database, label: "ฐานสมาชิกสมาคม" },
  { href: "/admin/events", icon: CalendarDays, label: "กิจกรรม" },
  { href: "/admin/lessons", icon: GraduationCap, label: "ตารางเรียน" },
  { href: "/admin/payments", icon: CircleDollarSign, label: "ตรวจการชำระเงิน" },
  { href: "/admin/content", icon: Megaphone, label: "ข่าว คะแนน และรางวัล" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f2f5f8] lg:flex">
      <aside className="border-b border-[#e2e8ef] bg-white text-[#344054] lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="px-4 py-4 lg:px-5 lg:py-6">
          <Link className="flex items-center gap-3" href="/admin">
            <span className="flex size-10 items-center justify-center rounded-md bg-[#C69214] text-base font-bold text-white">
              กฟ
            </span>
            <span>
              <span className="block text-sm font-bold text-[#722257]">PEAGC</span>
              <span className="block text-xs text-[#667085]">ระบบบริหารชมรมกอล์ฟ</span>
            </span>
          </Link>
        </div>

        <nav
          aria-label="เมนูผู้ดูแลระบบ"
          className="flex gap-2 overflow-x-auto px-4 pb-4 lg:grid lg:overflow-visible lg:px-3 lg:pb-0"
        >
          {adminNavigation.map((item) => (
            <Link
              className="flex h-11 shrink-0 items-center gap-3 rounded-md px-3 text-sm font-semibold text-[#475467] transition hover:bg-[#f8edf4] hover:text-[#722257]"
              href={item.href}
              key={item.href}
            >
              <item.icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-[#e2e8ef] p-3 lg:mt-auto">
          <form action={signOut}>
            <button className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold text-[#667085] transition hover:bg-[#f8edf4] hover:text-[#722257]" type="submit">
              <LogOut className="size-4" aria-hidden="true" />
              ออกจากระบบ
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="app-topbar sticky top-0 z-20 hidden h-16 items-center justify-between px-6 lg:flex">
          <div>
            <p className="text-sm font-bold text-[#344054]">ศูนย์ควบคุม PEAGC</p>
            <p className="text-xs text-[#667085]">ระบบสมาชิก กิจกรรม และตารางเรียน</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="relative hidden xl:block">
              <Search className="absolute left-3 top-2.5 size-4 text-[#98a2b3]" aria-hidden="true" />
              <input className="h-9 w-72 rounded-md border border-[#e2e8ef] bg-[#f8fafc] pl-9 pr-3 text-sm outline-none focus:border-[#722257]" placeholder="ค้นหาข้อมูลในระบบ" />
            </label>
            <span className="rounded-md bg-[#edf9f3] px-3 py-2 text-xs font-bold text-[#16794b]">ระบบออนไลน์</span>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
