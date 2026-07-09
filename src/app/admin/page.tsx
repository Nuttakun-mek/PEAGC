import Link from "next/link";
import {
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  ShieldAlert,
  Trophy,
  UsersRound,
} from "lucide-react";

import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type AdminPageProps = {
  searchParams: Promise<{ bypass?: string }>;
};

async function getCount(table: "members" | "events" | "payment_records") {
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
  const [memberCount, eventCount, paymentCount] = access.isBypass
    ? [24, 3, 5]
    : await Promise.all([
        getCount("members"),
        getCount("events"),
        getCount("payment_records"),
      ]);
  const modules = [
    {
      detail: "ค้นหา เพิ่ม แก้ไข และตรวจ profile สมาชิก",
      icon: UsersRound,
      title: "Member Management",
      value: memberCount,
    },
    {
      detail: "สร้างกิจกรรม เปิดรับสมัคร และดูผู้เข้าร่วม",
      icon: CalendarDays,
      title: "Event Management",
      value: eventCount,
    },
    {
      detail: "ตรวจ slip และสถานะการชำระเงิน",
      icon: CircleDollarSign,
      title: "Payment Review",
      value: paymentCount,
    },
    {
      detail: "จัดก๊วน Tee Time และ check-in หน้างาน",
      icon: ClipboardCheck,
      title: "Pairing & Check-in",
      value: 0,
    },
    {
      detail: "ตั้งค่าการแข่งขัน คะแนน และ leaderboard",
      icon: Trophy,
      title: "Competition",
      value: 0,
    },
  ];

  return (
    <main className="min-h-screen bg-[#f6f7f2] px-4 py-6 text-[#11221d]">
      <section className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-[#dfe5da] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#5b6f62]">Admin Portal</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#0f2d26]">
              แผงควบคุมผู้ดูแลระบบ
            </h1>
            <p className="mt-2 text-sm text-[#687a6d]">
              ผู้ใช้: {access.displayName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="flex h-11 items-center rounded-md border border-[#cbd6c7] bg-white px-4 text-sm font-semibold text-[#0f2d26]"
              href={access.isBypass ? "/member?bypass=member" : "/member"}
            >
              ดูหน้าสมาชิก
            </Link>
            <Link
              className="flex h-11 items-center rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
              href="/"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {access.isBypass ? (
          <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff4d8] px-4 py-3 text-sm text-[#8a6112]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>โหมด Admin ทดลอง ใช้ดูหน้าจอก่อนเปิด auth จริงและต้องปิดก่อน go live</span>
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {modules.slice(0, 3).map((item) => (
            <article
              className="rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm"
              key={item.title}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#687a6d]">{item.title}</p>
                  <p className="mt-2 text-3xl font-semibold text-[#0f2d26]">
                    {item.value}
                  </p>
                </div>
                <div className="flex size-11 items-center justify-center rounded-md bg-[#edf4ea] text-[#0f6b4f]">
                  <item.icon className="size-5" aria-hidden="true" />
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-[#dfe5da] bg-white shadow-sm">
          <div className="border-b border-[#dfe5da] px-5 py-4">
            <h2 className="text-xl font-semibold text-[#0f2d26]">Admin Modules</h2>
          </div>
          <div className="divide-y divide-[#dfe5da]">
            {modules.map((item) => (
              <div
                className="grid gap-4 px-5 py-4 sm:grid-cols-[44px_1fr_88px] sm:items-center"
                key={item.title}
              >
                <div className="flex size-11 items-center justify-center rounded-md bg-[#0f2d26] text-white">
                  <item.icon className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-semibold text-[#0f2d26]">{item.title}</p>
                  <p className="mt-1 text-sm text-[#687a6d]">{item.detail}</p>
                </div>
                <span className="w-fit rounded-md bg-[#fbfcf8] px-3 py-1 text-sm font-semibold text-[#405249]">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
