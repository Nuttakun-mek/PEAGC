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
  { label: "แดชบอร์ด", icon: LayoutDashboard, active: true },
  { label: "สมาชิก", icon: UsersRound },
  { label: "กิจกรรม", icon: CalendarDays },
  { label: "การชำระเงิน", icon: CircleDollarSign },
  { label: "จัดก๊วน", icon: Flag },
  { label: "การแข่งขัน", icon: Trophy },
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
    <main className="min-h-screen bg-[#f6f7f2] text-[#11221d]">
      <div className="grid min-h-screen lg:grid-cols-[280px_1fr]">
        <aside className="border-b border-[#dfe5da] bg-[#0f2d26] px-5 py-5 text-white lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-4 lg:block">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-md bg-[#d6b25e] text-sm font-bold text-[#0f2d26]">
                  PEA
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#f5edd7]">PEAGC</p>
                  <p className="text-xs text-[#bed2c8]">Golf Club OS</p>
                </div>
              </div>
            </div>
            <div className="rounded-md border border-white/15 px-3 py-2 text-right lg:mt-7 lg:text-left">
              <p className="text-xs text-[#bed2c8]">ระยะงาน</p>
              <p className="text-sm font-semibold text-white">Foundation</p>
            </div>
          </div>

          <nav className="mt-5 grid grid-cols-2 gap-2 lg:mt-8 lg:grid-cols-1">
            {navItems.map((item) => (
              <button
                key={item.label}
                className={`flex h-11 items-center gap-3 rounded-md px-3 text-left text-sm transition ${
                  item.active
                    ? "bg-white text-[#0f2d26]"
                    : "text-[#dce9e2] hover:bg-white/10"
                }`}
                type="button"
              >
                <item.icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <header className="flex flex-col gap-4 border-b border-[#dfe5da] pb-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#5b6f62]">
                ระบบเว็บชมรมกอล์ฟแบบ Thai-first
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-[#0f2d26] sm:text-4xl">
                แดชบอร์ดบริหาร PEAGC
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              {userEmail ? (
                <form action={signOut}>
                  <button
                    className="flex h-11 items-center gap-2 rounded-md border border-[#cbd6c7] bg-white px-4 text-sm font-semibold text-[#0f2d26] transition hover:border-[#0f2d26]"
                    type="submit"
                  >
                    <LogOut className="size-4" aria-hidden="true" />
                    ออกจากระบบ
                  </button>
                </form>
              ) : (
                <Link
                  className="flex h-11 items-center gap-2 rounded-md border border-[#cbd6c7] bg-white px-4 text-sm font-semibold text-[#0f2d26] transition hover:border-[#0f2d26]"
                  href="/login"
                >
                  <LogIn className="size-4" aria-hidden="true" />
                  เข้าสู่ระบบ
                </Link>
              )}
              <button
                className="flex h-11 items-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#17453b]"
                type="button"
              >
                <UsersRound className="size-4" aria-hidden="true" />
                เพิ่มสมาชิก
              </button>
              <button
                className="flex h-11 items-center gap-2 rounded-md border border-[#cbd6c7] bg-white px-4 text-sm font-semibold text-[#0f2d26] transition hover:border-[#0f2d26]"
                type="button"
              >
                <CalendarDays className="size-4" aria-hidden="true" />
                สร้างกิจกรรม
              </button>
            </div>
          </header>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <article
                key={metric.label}
                className="rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#687a6d]">
                      {metric.label}
                    </p>
                    <p className="mt-2 text-3xl font-semibold text-[#0f2d26]">
                      {metric.value}
                    </p>
                  </div>
                  <div className="flex size-11 items-center justify-center rounded-md bg-[#edf4ea] text-[#0f6b4f]">
                    <metric.icon className="size-5" aria-hidden="true" />
                  </div>
                </div>
                <p className="mt-4 text-sm text-[#687a6d]">{metric.detail}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <section className="rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#5b6f62]">
                    แผน MVP 1
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-[#0f2d26]">
                    Club & Event Core
                  </h2>
                </div>
                <span className="w-fit rounded-md bg-[#fff4d8] px-3 py-1 text-sm font-semibold text-[#8a6112]">
                  สร้างก่อน
                </span>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-5">
                {workflow.map((item) => (
                  <article
                    key={item.title}
                    className="min-h-32 rounded-lg border border-[#dfe5da] bg-[#fbfcf8] p-4"
                  >
                    <div className="flex size-10 items-center justify-center rounded-md bg-[#0f2d26] text-white">
                      <item.icon className="size-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-[#0f2d26]">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm text-[#687a6d]">{item.status}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#5b6f62]">
                    Sprint 0
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-[#0f2d26]">
                    งานตั้งต้น
                  </h2>
                </div>
                <ShieldCheck className="size-6 text-[#0f6b4f]" aria-hidden="true" />
              </div>
              <ul className="mt-5 space-y-3">
                {sprintFocus.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm">
                    <BadgeCheck
                      className="mt-0.5 size-4 shrink-0 text-[#0f6b4f]"
                      aria-hidden="true"
                    />
                    <span className="text-[#405249]">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="mt-6 rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex size-11 items-center justify-center rounded-md bg-[#edf4ea] text-[#0f6b4f]">
                  <DatabaseZap className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#5b6f62]">
                    Supabase
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-[#0f2d26]">
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
                    ? "bg-[#e6f4df] text-[#24613f]"
                    : "bg-[#fff4d8] text-[#8a6112]"
                }`}
              >
                {userEmail ? "Signed in" : isSupabaseReady ? "Ready" : "Pending"}
              </span>
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#5b6f62]">
                  หลักการออกแบบระบบ
                </p>
                <h2 className="mt-1 text-xl font-semibold text-[#0f2d26]">
                  ข้อกำหนดสำคัญ
                </h2>
              </div>
              <ListChecks className="size-6 text-[#d6a642]" aria-hidden="true" />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                "บันทึก audit ทุกการเปลี่ยนแปลงสำคัญ",
                "แยกชั้นคะแนนเสมอและไม่แก้ทับข้อมูลเดิม",
                "ออกแบบ mobile workflow ก่อนเพิ่มความหนาแน่นบน desktop",
              ].map((rule) => (
                <div
                  key={rule}
                  className="rounded-lg border border-[#dfe5da] bg-[#fbfcf8] px-4 py-3 text-sm font-medium text-[#405249]"
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
