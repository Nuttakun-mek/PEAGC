import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Database,
  GraduationCap,
  Megaphone,
  ShieldAlert,
  UserCheck,
  UsersRound,
} from "lucide-react";

import { resolveAccess } from "@/lib/auth/access";
import { formatThaiDateWithWeekday } from "@/lib/display";
import { bangkokDate, getBookingPhase } from "@/lib/lessons/booking";
import { defaultModuleState, moduleCatalog } from "@/lib/modules";
import { getClubModules } from "@/lib/modules-server";
import { logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

type AdminPageProps = {
  searchParams: Promise<{ bypass?: string }>;
};

type Counts = {
  awaitingPayment: number;
  awaitingSlipReview: number;
  bookingPhase: ReturnType<typeof getBookingPhase>;
  directory: number;
  events: number;
  lessonBookings: number;
  members: number;
  pendingMembers: number;
  upcomingOpenSlots: number;
};

const sampleCounts: Counts = {
  awaitingPayment: 3,
  awaitingSlipReview: 2,
  bookingPhase: "open",
  directory: 1240,
  events: 3,
  lessonBookings: 8,
  members: 24,
  pendingMembers: 1,
  upcomingOpenSlots: 6,
};

/**
 * Card numbers use the same scope as the pages they link to (this club, rows not archived),
 * so the dashboard can no longer say "6" while the page behind it lists nothing. Payments are
 * split: slips waiting for review vs. registrations that have not paid yet.
 */
async function getClubCounts(clubId: string): Promise<Counts> {
  const supabase = await createClient();
  const head = { count: "exact", head: true } as const;
  const today = bangkokDate();
  const [members, events, slips, directory, bookings, pendingMembers, awaitingPayment, openSlots, settings] = await Promise.all([
    supabase.from("members").select("id", head).eq("club_id", clubId).is("archived_at", null),
    supabase.from("events").select("id", head).eq("club_id", clubId).is("archived_at", null).gte("event_date", today),
    supabase.from("payment_records").select("id", head).eq("club_id", clubId).in("status", ["pending", "review"]).not("slip_file_id", "is", null),
    supabase.from("employee_directory").select("id", head).eq("club_id", clubId).is("archived_at", null),
    supabase.from("lesson_bookings").select("id, lesson_slots!inner(lesson_date)", head).eq("club_id", clubId).eq("status", "booked").gte("lesson_slots.lesson_date", today),
    supabase.from("members").select("id", head).eq("club_id", clubId).eq("status", "pending_verification").is("archived_at", null),
    supabase.from("event_registrations").select("id", head).eq("club_id", clubId).eq("status", "pending_payment"),
    supabase.from("lesson_slots").select("id", head).eq("club_id", clubId).eq("status", "open").is("archived_at", null).gte("lesson_date", today),
    supabase.from("lesson_booking_settings").select("booking_open_at, booking_close_at").eq("club_id", clubId).maybeSingle(),
  ]);

  const count = (result: { count: number | null; error: { code?: string; message?: string } | null }, label: string) => {
    if (result.error) logDbError(`admin.dashboard ${label}`, result.error);
    return result.count ?? 0;
  };

  return {
    awaitingPayment: count(awaitingPayment, "awaiting payment"),
    awaitingSlipReview: count(slips, "slips"),
    bookingPhase: getBookingPhase(settings.data),
    directory: count(directory, "directory"),
    events: count(events, "events"),
    lessonBookings: count(bookings, "lesson bookings"),
    members: count(members, "members"),
    pendingMembers: count(pendingMembers, "pending members"),
    upcomingOpenSlots: count(openSlots, "open slots"),
  };
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin",
    requiredRole: "admin",
    searchParams: params,
  });
  const counts = access.isBypass || !access.clubId ? sampleCounts : await getClubCounts(access.clubId);
  const moduleState = access.isBypass
    ? defaultModuleState
    : await getClubModules(await createClient(), access.clubId);
  const suffix = access.isBypass ? "?bypass=admin" : "";
  const join = (path: string, query: string) => `${path}?${query}${access.isBypass ? "&bypass=admin" : ""}`;

  const todo = [
    counts.awaitingSlipReview > 0 && {
      detail: "สมาชิกส่งสลิปแล้ว รอตรวจและอนุมัติ",
      href: join("/admin/payments", "stage=awaiting_review"),
      icon: CircleDollarSign,
      title: `สลิปรอตรวจ ${counts.awaitingSlipReview} รายการ`,
      tone: "amber",
    },
    counts.pendingMembers > 0 && {
      detail: "ข้อมูลไม่ตรงฐานสมาคม ต้องตรวจและอนุมัติเอง",
      href: join("/admin/members", "filter=pending_verification"),
      icon: UserCheck,
      title: `สมาชิกรออนุมัติ ${counts.pendingMembers} คน`,
      tone: "amber",
    },
    counts.upcomingOpenSlots > 0 && counts.bookingPhase !== "open" && {
      detail:
        counts.bookingPhase === "before"
          ? "ตั้งเวลาเปิดลงทะเบียนไว้ล่วงหน้า สมาชิกยังจองไม่ได้จนถึงเวลานั้น"
          : counts.bookingPhase === "after"
            ? "ช่วงลงทะเบียนปิดแล้ว สมาชิกจองรอบเรียนไม่ได้"
            : "ยังไม่ได้เปิดลงทะเบียน สมาชิกเห็นรอบเรียนเป็น \"ยังไม่เปิด\"",
      href: `/admin/lessons${suffix}#booking-window`,
      icon: GraduationCap,
      title: `รอบเรียน ${counts.upcomingOpenSlots} รอบ ยังจองไม่ได้`,
      tone: "red",
    },
  ].filter(Boolean) as Array<{ detail: string; href: string; icon: typeof UsersRound; title: string; tone: "amber" | "red" }>;

  const stats = [
    { href: `/admin/members${suffix}`, icon: UsersRound, label: "สมาชิก", unit: "คน", value: counts.members },
    { href: `/admin/events${suffix}`, icon: CalendarDays, label: "กิจกรรมที่กำลังจะมาถึง", unit: "กิจกรรม", value: counts.events },
    { href: `/admin/lessons${suffix}`, icon: GraduationCap, label: "การจองเรียนที่กำลังจะมาถึง", unit: "ที่นั่ง", value: counts.lessonBookings },
    { href: join("/admin/payments", "stage=awaiting_payment"), icon: CircleDollarSign, label: "ผู้สมัครที่ยังไม่ชำระ", unit: "ราย", value: counts.awaitingPayment },
  ];

  const menu = [
    { detail: "ค้นหา เพิ่ม แก้ไข อนุมัติ และลบสมาชิก", href: `/admin/members${suffix}`, icon: UsersRound, title: "จัดการสมาชิก" },
    { detail: `รายชื่อสมาชิกสมาคม ${counts.directory.toLocaleString("th-TH")} รายชื่อ ใช้เทียบใบสมัคร`, href: `/admin/employees${suffix}`, icon: Database, title: "ฐานสมาชิกสมาคม" },
    { detail: "สร้างกิจกรรม เปิดรับสมัคร จัดก๊วน และเช็กอิน", href: `/admin/events${suffix}`, icon: CalendarDays, title: "กิจกรรม" },
    { detail: "คอร์สเรียน รอบเรียน ช่วงเปิดจอง และการเข้าเรียน", href: `/admin/lessons${suffix}`, icon: GraduationCap, title: "ตารางเรียน" },
    { detail: "ตรวจสลิปและติดตามผู้ที่ยังไม่ชำระ", href: `/admin/payments${suffix}`, icon: CircleDollarSign, title: "ตรวจการชำระเงิน" },
    { detail: "ประกาศข่าว และบันทึกรางวัล", href: `/admin/content${suffix}`, icon: Megaphone, title: "ข่าวและรางวัล" },
    { detail: "รายรับ การใช้ที่นั่งเรียน และการเข้าร่วมกิจกรรม", href: `/admin/reports${suffix}`, icon: BarChart3, title: "รายงาน" },
  ];

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137] sm:px-6">
      <section className="mx-auto w-full max-w-6xl">
        <div className="golf-visual flex flex-col gap-5 rounded-2xl bg-[linear-gradient(135deg,#5a1a45_0%,#722257_55%,#8e2c6e_100%)] p-6 text-white shadow-[0_18px_40px_rgba(114,34,87,0.22)] sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div>
            <p className="text-sm font-semibold text-[#efd798]">{formatThaiDateWithWeekday(bangkokDate())}</p>
            <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">สวัสดี {access.displayName}</h1>
            <p className="mt-2 text-sm text-white/75">ภาพรวมงานของชมรมวันนี้</p>
          </div>
          <Link
            className="flex h-11 w-fit items-center gap-2 rounded-lg bg-[#C69214] px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(0,0,0,0.15)] transition hover:bg-[#b07d0c]"
            href={access.isBypass ? "/member?bypass=member" : "/member"}
          >
            ดูหน้าสมาชิก
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {access.isBypass ? (
          <div className="mt-5 flex items-start gap-3 rounded-lg bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>โหมดผู้ดูแลทดลอง ใช้ตรวจหน้าจอก่อนเปิดระบบเข้าสู่ระบบจริง และต้องปิดก่อนเปิดใช้งาน</span>
          </div>
        ) : null}

        <section className="mt-5 rounded-xl border border-[#e2e8ef] bg-white/95 p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[#344054]">งานที่ต้องทำ</h2>
          {todo.length ? (
            <ul className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {todo.map((item) => (
                <li key={item.title}>
                  <Link
                    className={`flex h-full items-start gap-3 rounded-lg border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${item.tone === "red" ? "border-[#f3c6cb] bg-[#fff7f7]" : "border-[#efd9a6] bg-[#fffbf0]"}`}
                    href={item.href}
                  >
                    <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${item.tone === "red" ? "bg-[#fdecec] text-[#b42318]" : "bg-[#fff5d8] text-[#805300]"}`}>
                      <item.icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[#2f3137]">{item.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-[#6b6475]">{item.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-sm text-[#16794b]">
              <span className="size-2 rounded-full bg-[#16794b]" aria-hidden="true" />
              ไม่มีงานค้าง ทุกอย่างเรียบร้อย
            </p>
          )}
        </section>

        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {stats.map((item) => (
            <Link
              className="group rounded-xl border border-[#e2e8ef] bg-white/95 p-4 shadow-sm transition hover:border-[#c9b3c2] hover:shadow-md sm:p-5"
              href={item.href}
              key={item.label}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold leading-5 text-[#6b6475]">{item.label}</p>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#f8edf4] text-[#722257]">
                  <item.icon className="size-4" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-[#1f2937]">
                {item.value.toLocaleString("th-TH")}
                <span className="ml-1.5 text-sm font-semibold text-[#6b6475]">{item.unit}</span>
              </p>
            </Link>
          ))}
        </div>

        <Link
          className="mt-5 flex flex-col gap-3 rounded-xl border border-[#e2e8ef] bg-white/95 p-4 shadow-sm transition hover:border-[#c9b3c2] sm:flex-row sm:items-center sm:justify-between"
          href={`/admin/settings${suffix}`}
        >
          <p className="text-sm font-semibold text-[#344054]">ระบบที่เปิดให้สมาชิกใช้งาน</p>
          <div className="flex flex-wrap gap-2">
            {moduleCatalog.map((item) => (
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${moduleState[item.key] ? "bg-[#edf9f3] text-[#16794b]" : "bg-[#f1f3ef] text-[#98a2b3]"}`}
                key={item.key}
              >
                {moduleState[item.key] ? "● " : "○ "}
                {item.label}
              </span>
            ))}
            <span className="rounded-full border border-[#d9d3e6] px-3 py-1 text-xs font-semibold text-[#722257]">ตั้งค่า →</span>
          </div>
        </Link>

        <section className="mt-5">
          <h2 className="text-base font-semibold text-[#344054]">เมนูจัดการระบบ</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {menu.map((item) => (
              <Link
                className="group flex items-start gap-4 rounded-xl border border-[#e2e8ef] bg-white/95 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c9b3c2] hover:shadow-md"
                href={item.href}
                key={item.title}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#722257] text-white shadow-[0_8px_16px_rgba(114,34,87,0.2)]">
                  <item.icon className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 font-semibold text-[#722257]">
                    {item.title}
                    <ArrowRight className="size-4 shrink-0 text-[#c9b3c2] transition group-hover:translate-x-0.5 group-hover:text-[#722257]" aria-hidden="true" />
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-[#6b6475]">{item.detail}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
