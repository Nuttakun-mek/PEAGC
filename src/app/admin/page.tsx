import Link from "next/link";
import {
  CalendarDays,
  CircleDollarSign,
  GraduationCap,
  ShieldAlert,
  UsersRound,
} from "lucide-react";

import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type AdminPageProps = {
  searchParams: Promise<{ bypass?: string }>;
};

async function getCount(
  table:
    | "employee_directory"
    | "members"
    | "events"
    | "payment_records"
    | "lesson_bookings",
) {
  const supabase = await createClient();
  const { count } = await supabase.from(table).select("id", {
    count: "exact",
    head: true,
  });

  return count ?? 0;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin",
    requiredRole: "admin",
    searchParams: params,
  });
  const [memberCount, eventCount, paymentCount, employeeCount, lessonBookingCount] = access.isBypass
    ? [24, 3, 5, 2, 8]
    : await Promise.all([
        getCount("members"),
        getCount("events"),
        getCount("payment_records"),
        getCount("employee_directory"),
        getCount("lesson_bookings"),
      ]);
  const modules = [
    {
      detail: "ฐานข้อมูลพนักงานสำหรับเทียบใบสมัครสมาชิก",
      href: access.isBypass ? "/admin/employees?bypass=admin" : "/admin/employees",
      icon: UsersRound,
      title: "ฐานข้อมูลพนักงาน",
      value: employeeCount,
    },
    {
      detail: "ค้นหา เพิ่ม แก้ไข และตรวจข้อมูลสมาชิก",
      href: access.isBypass ? "/admin/members?bypass=admin" : "/admin/members",
      icon: UsersRound,
      title: "จัดการสมาชิก",
      value: memberCount,
    },
    {
      detail: "สร้างกิจกรรม เปิดรับสมัคร และดูผู้เข้าร่วม",
      href: access.isBypass ? "/admin/events?bypass=admin" : "/admin/events",
      icon: CalendarDays,
      title: "จัดการกิจกรรม",
      value: eventCount,
    },
    {
      detail: "จัดคอร์สเรียน รอบเรียน จองเรียน และลงเวลาเข้าเรียน",
      href: access.isBypass ? "/admin/lessons?bypass=admin" : "/admin/lessons",
      icon: GraduationCap,
      title: "จัดการตารางเรียน",
      value: lessonBookingCount,
    },
    {
      detail: "ตรวจหลักฐานและสถานะการชำระเงิน",
      href: access.isBypass ? "/admin/payments?bypass=admin" : "/admin/payments",
      icon: CircleDollarSign,
      title: "ตรวจสอบการชำระเงิน",
      value: paymentCount,
    },
  ];

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-6xl">
        <div className="golf-visual flex flex-col gap-5 rounded-lg bg-[#722257] p-6 text-white shadow-[0_14px_34px_rgba(114,34,87,0.18)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#efd798]">ระบบผู้ดูแล</p>
            <h1 className="mt-1 text-3xl font-semibold text-white">
              แผงควบคุมผู้ดูแลระบบ
            </h1>
            <p className="mt-2 text-sm text-white/70">
              ผู้ใช้: {access.displayName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="flex h-11 items-center rounded-md border border-white/25 bg-white/10 px-4 text-sm font-semibold text-white"
              href={access.isBypass ? "/member?bypass=member" : "/member"}
            >
              ดูหน้าสมาชิก
            </Link>
            <Link
              className="flex h-11 items-center rounded-md bg-[#C69214] px-4 text-sm font-semibold text-white"
              href="/"
            >
              หน้าหลัก
            </Link>
          </div>
        </div>

        {access.isBypass ? (
          <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>โหมดผู้ดูแลทดลอง ใช้ตรวจหน้าจอก่อนเปิดระบบเข้าสู่ระบบจริง และต้องปิดก่อนเปิดใช้งาน</span>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {modules.slice(0, 4).map((item) => (
            <article
              className="rounded-lg border border-[#e2e8ef] bg-white/95 p-4 shadow-sm"
              key={item.title}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#6b6475]">{item.title}</p>
                  <p className="mt-2 text-3xl font-semibold text-[#1f2937]">
                    {item.value}
                  </p>
                </div>
                <div className="flex size-10 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                  <item.icon className="size-5" aria-hidden="true" />
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="border-b border-[#e6e2ee] px-5 py-4">
            <h2 className="text-xl font-semibold text-[#722257]">เมนูจัดการระบบ</h2>
          </div>
          <div className="divide-y divide-[#e6e2ee]">
            {modules.map((item) => (
              <Link
                className="grid gap-4 px-5 py-4 sm:grid-cols-[44px_1fr_88px] sm:items-center"
                href={item.href}
                key={item.title}
              >
                <div className="flex size-11 items-center justify-center rounded-md bg-[#722257] text-white">
                  <item.icon className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-semibold text-[#722257]">{item.title}</p>
                  <p className="mt-1 text-sm text-[#6b6475]">{item.detail}</p>
                </div>
                <span className="w-fit rounded-md bg-white/70 px-3 py-1 text-sm font-semibold text-[#3f3a48]">
                  {item.value}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
