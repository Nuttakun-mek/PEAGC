import {
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  DatabaseZap,
  Flag,
  LayoutDashboard,
  ListChecks,
  LogIn,
  LogOut,
  ShieldCheck,
  Trophy,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import { hasSupabasePublicConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const metrics = [
  { label: "สมาชิก", value: "0", detail: "พร้อมสำหรับระบบสมาชิก", icon: UsersRound },
  { label: "กิจกรรม", value: "0", detail: "รอสร้างกิจกรรมแรก", icon: CalendarDays },
  { label: "Slip รอตรวจ", value: "0", detail: "คิวตรวจสอบการชำระเงิน", icon: CircleDollarSign },
  { label: "Leaderboard", value: "0", detail: "หลังระบบแข่งขันพื้นฐาน", icon: Trophy },
];

const workflow = [
  { title: "สมาชิก", status: "Sprint 2", icon: UsersRound },
  { title: "กิจกรรม", status: "Sprint 3", icon: CalendarDays },
  { title: "ชำระเงิน", status: "Sprint 4", icon: CircleDollarSign },
  { title: "จัดก๊วน", status: "Sprint 5", icon: ClipboardCheck },
  { title: "แข่งขัน", status: "Sprint 6", icon: Trophy },
];

const sprintFocus = [
  "ฐาน Next.js App Router",
  "Admin workspace แบบ responsive",
  "ร่าง schema สำหรับ Supabase",
  "โมเดล RBAC และ audit log",
  "ลำดับงานสำหรับ MVP 1",
];

const navItems = [
  { label: "แดชบอร์ด", href: "/", icon: LayoutDashboard, active: true },
  { label: "สมาชิก", href: "/admin/members", icon: UsersRound },
  { label: "กิจกรรม", href: "/admin/events", icon: CalendarDays },
  { label: "การชำระเงิน", href: "/admin", icon: CircleDollarSign },
  { label: "จัดก๊วน", href: "/admin", icon: Flag },
  { label: "การแข่งขัน", href: "/admin", icon: Trophy },
];

export default async function Home() {
  const isSupabaseReady = hasSupabasePublicConfig();
  let userEmail: string | null = null;

  if (isSupabaseReady) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userEmail = data.user?.email ?? null;
  }

  return (
    <main className="min-h-screen bg-transparent text-peagc-dark-gray">
      <div className="grid min-h-screen lg:grid-cols-[280px_1fr]">
        <aside className="border-b border-peagc-border bg-peagc-purple px-5 py-5 text-white lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-4 lg:block">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-md bg-peagc-gold text-sm font-bold text-peagc-purple">
                  PEA
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#fff5d8]">PEAGC</p>
                  <p className="text-xs text-[#d8c8e8]">Golf Club OS</p>
                </div>
              </div>
            </div>
            <div className="rounded-md border border-white/15 px-3 py-2 text-right lg:mt-7 lg:text-left">
              <p className="text-xs text-[#d8c8e8]">ระยะงาน</p>
              <p className="text-sm font-semibold text-white">Foundation</p>
            </div>
          </div>

          <nav className="mt-5 grid grid-cols-2 gap-2 lg:mt-8 lg:grid-cols-1">
            {navItems.map((item) => (
              <Link
                key={item.label}
                className={`flex h-11 items-center gap-3 rounded-md px-3 text-left text-sm transition ${
                  item.active
                    ? "bg-white text-peagc-purple"
                    : "text-[#efe6f8] hover:bg-white/10"
                }`}
                href={item.href}
              >
                <item.icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <section className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <header className="flex flex-col gap-4 border-b border-peagc-border pb-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#8b5b7a]">
                ระบบเว็บชมรมกอล์ฟแบบ Thai-first
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-peagc-purple sm:text-4xl">
                แดชบอร์ดบริหาร PEAGC
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              {userEmail ? (
                <form action={signOut}>
                  <button
                    className="flex h-11 items-center gap-2 rounded-md border border-peagc-border-strong bg-white px-4 text-sm font-semibold text-peagc-purple transition hover:border-peagc-purple"
                    type="submit"
                  >
                    <LogOut className="size-4" aria-hidden="true" />
                    ออกจากระบบ
                  </button>
                </form>
              ) : (
                <Link
                  className="flex h-11 items-center gap-2 rounded-md border border-peagc-border-strong bg-white px-4 text-sm font-semibold text-peagc-purple transition hover:border-peagc-purple"
                  href="/login"
                >
                  <LogIn className="size-4" aria-hidden="true" />
                  เข้าสู่ระบบ
                </Link>
              )}
              <Link
                className="flex h-11 items-center gap-2 rounded-md bg-peagc-purple px-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(114,34,87,0.08)] transition hover:bg-[#8b2d6b]"
                href={userEmail ? "/profile" : "/login?next=/profile"}
              >
                <UsersRound className="size-4" aria-hidden="true" />
                กรอกข้อมูลส่วนตัว
              </Link>
              <Link
                className="flex h-11 items-center gap-2 rounded-md border border-peagc-border-strong bg-white px-4 text-sm font-semibold text-peagc-purple transition hover:border-peagc-purple"
                href="/admin"
              >
                <CalendarDays className="size-4" aria-hidden="true" />
                หน้า Admin
              </Link>
            </div>
          </header>

          <section className="golf-visual mt-6 rounded-lg border border-peagc-border bg-white/95 p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)] backdrop-blur">
            <div className="relative z-10 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-center">
              <div>
                <p className="text-sm font-semibold text-peagc-gold">PEA Golf Club</p>
                <h2 className="mt-2 max-w-2xl text-2xl font-semibold text-peagc-purple sm:text-3xl">
                  Golf operations workspace for members, lessons, events, and club admin
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-peagc-muted">
                  Clean card-based workspace with purple and gold identity, unit-targeted announcements, member profiles, and academy booking workflows.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: "Member", value: "Profile" },
                  { label: "Academy", value: "Slots" },
                  { label: "Events", value: "Targeted" },
                ].map((item) => (
                  <div className="rounded-lg border border-peagc-border bg-white/75 p-3" key={item.label}>
                    <p className="text-xs font-semibold text-peagc-muted">{item.label}</p>
                    <p className="mt-1 text-sm font-semibold text-peagc-purple">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <article
                key={metric.label}
                className="rounded-lg border border-peagc-border bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-peagc-muted">
                      {metric.label}
                    </p>
                    <p className="mt-2 text-3xl font-semibold text-peagc-purple">
                      {metric.value}
                    </p>
                  </div>
                  <div className="flex size-11 items-center justify-center rounded-md bg-peagc-purple-soft text-peagc-purple">
                    <metric.icon className="size-5" aria-hidden="true" />
                  </div>
                </div>
                <p className="mt-4 text-sm text-peagc-muted">{metric.detail}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <section className="rounded-lg border border-peagc-border bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#8b5b7a]">
                    แผน MVP 1
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-peagc-purple">
                    Club & Event Core
                  </h2>
                </div>
                <span className="w-fit rounded-md bg-[#fff5d8] px-3 py-1 text-sm font-semibold text-[#805300]">
                  สร้างก่อน
                </span>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-5">
                {workflow.map((item) => (
                  <article
                    key={item.title}
                    className="min-h-32 rounded-lg border border-peagc-border bg-white/70 p-4"
                  >
                    <div className="flex size-10 items-center justify-center rounded-md bg-peagc-purple text-white">
                      <item.icon className="size-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-peagc-purple">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm text-peagc-muted">{item.status}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-peagc-border bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#8b5b7a]">
                    Sprint 0
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-peagc-purple">
                    งานตั้งต้น
                  </h2>
                </div>
                <ShieldCheck className="size-6 text-peagc-purple" aria-hidden="true" />
              </div>
              <ul className="mt-5 space-y-3">
                {sprintFocus.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm">
                    <BadgeCheck
                      className="mt-0.5 size-4 shrink-0 text-peagc-purple"
                      aria-hidden="true"
                    />
                    <span className="text-[#3f3a48]">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="mt-6 rounded-lg border border-peagc-border bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex size-11 items-center justify-center rounded-md bg-peagc-purple-soft text-peagc-purple">
                  <DatabaseZap className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#8b5b7a]">
                    Supabase
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-peagc-purple">
                    {userEmail
                      ? `เข้าสู่ระบบด้วย ${userEmail}`
                      : isSupabaseReady
                        ? "เชื่อมต่อ configuration แล้ว"
                        : "ยังไม่ได้ตั้งค่า environment"}
                  </h2>
                </div>
              </div>
              <span
                className={`w-fit rounded-md px-3 py-1 text-sm font-semibold ${
                  isSupabaseReady
                    ? "bg-peagc-purple-soft text-peagc-purple"
                    : "bg-[#fff5d8] text-[#805300]"
                }`}
              >
                {userEmail ? "Signed in" : isSupabaseReady ? "Ready" : "Pending"}
              </span>
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-peagc-border bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#8b5b7a]">
                  หลักการออกแบบระบบ
                </p>
                <h2 className="mt-1 text-xl font-semibold text-peagc-purple">
                  ข้อกำหนดสำคัญ
                </h2>
              </div>
              <ListChecks className="size-6 text-peagc-gold" aria-hidden="true" />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                "บันทึก audit ทุกการเปลี่ยนแปลงสำคัญ",
                "แยกชั้นคะแนนเสมอและไม่แก้ทับข้อมูลเดิม",
                "ออกแบบ mobile workflow ก่อนเพิ่มความหนาแน่นบน desktop",
              ].map((rule) => (
                <div
                  key={rule}
                  className="rounded-lg border border-peagc-border bg-white/70 px-4 py-3 text-sm font-medium text-[#3f3a48]"
                >
                  {rule}
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
