import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Pencil,
  ShieldAlert,
  Trophy,
  UserRound,
} from "lucide-react";

import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type MemberPageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

const statusMessages: Record<string, string> = {
  "admin-required": "บัญชีนี้ยังไม่มีสิทธิ์ Admin",
  "pending-review": "ส่งข้อมูลสมัครแล้ว กรุณารอ Admin ตรวจสอบกับฐานข้อมูลพนักงาน",
  "profile-saved": "บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว",
};

const memberStatusLabels: Record<string, string> = {
  active: "อนุมัติแล้ว",
  archived: "ถูกเก็บถาวร",
  guest: "แขก",
  inactive: "ไม่ใช้งาน",
  pending_verification: "รอตรวจสอบพนักงาน",
};

export default async function MemberPage({ searchParams }: MemberPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "member",
    nextPath: "/member",
    requiredRole: "member",
    searchParams: params,
  });
  const supabase = access.isBypass ? null : await createClient();
  const { data: member } = supabase
    ? await supabase
        .from("members")
        .select(
          "full_name, nickname, employee_code, department, affiliation, handicap, organization, skill_level, status",
        )
        .eq("user_id", access.userId)
        .maybeSingle()
    : { data: null };
  const displayName = member?.nickname || member?.full_name || access.displayName;
  const profileHref = access.isBypass ? "/profile?bypass=member" : "/profile";
  const isPending = member?.status === "pending_verification";

  return (
    <main className="min-h-screen bg-[#f6f7f2] px-4 py-6 text-[#11221d]">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#5b6f62]">Member Portal</p>
              <h1 className="mt-1 text-3xl font-semibold text-[#0f2d26]">
                สวัสดี {displayName}
              </h1>
            </div>
            <div className="flex size-12 items-center justify-center rounded-md bg-[#0f2d26] text-white">
              <UserRound className="size-5" aria-hidden="true" />
            </div>
          </div>

          {params.status && statusMessages[params.status] ? (
            <div className="mt-5 rounded-md bg-[#e6f4df] px-4 py-3 text-sm font-medium text-[#24613f]">
              {statusMessages[params.status]}
            </div>
          ) : null}

          {access.isBypass ? (
            <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff4d8] px-4 py-3 text-sm text-[#8a6112]">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>โหมดทดลอง ไม่ได้ดึงข้อมูลจริงจากบัญชีผู้ใช้</span>
            </div>
          ) : !access.isProfileComplete ? (
            <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff4d8] px-4 py-3 text-sm text-[#8a6112]">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>กรุณากรอกข้อมูลส่วนตัวให้ครบก่อนสมัครกิจกรรม</span>
            </div>
          ) : isPending ? (
            <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff4d8] px-4 py-3 text-sm text-[#8a6112]">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                ข้อมูลอยู่ระหว่างรอ Admin ตรวจสอบรหัสพนักงาน หน่วยงาน และสังกัดก่อนอนุมัติ
              </span>
            </div>
          ) : null}

          <div className="mt-6 rounded-lg border border-[#dfe5da] bg-[#fbfcf8] p-5">
            <p className="text-sm font-semibold text-[#5b6f62]">Digital Member Card</p>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-[#687a6d]">ชื่อ</span>
                <span className="font-semibold text-[#0f2d26]">
                  {member?.full_name ?? "สมาชิกทดลอง"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#687a6d]">รหัสพนักงาน</span>
                <span className="font-semibold text-[#0f2d26]">
                  {member?.employee_code ?? "-"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#687a6d]">Handicap</span>
                <span className="font-semibold text-[#0f2d26]">
                  {member?.handicap ?? "-"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#687a6d]">สถานะ</span>
                <span
                  className={`font-semibold ${
                    isPending ? "text-[#8a6112]" : "text-[#24613f]"
                  }`}
                >
                  {member?.status ? memberStatusLabels[member.status] : "ทดลอง"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#687a6d]">หน่วยงาน</span>
                <span className="font-semibold text-[#0f2d26]">
                  {member?.department ?? member?.organization ?? "-"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#687a6d]">สังกัด</span>
                <span className="font-semibold text-[#0f2d26]">
                  {member?.affiliation ?? "-"}
                </span>
              </div>
            </div>
          </div>

          <Link
            className="mt-5 flex h-12 items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
            href={profileHref}
          >
            <Pencil className="size-4" aria-hidden="true" />
            แก้ไขข้อมูลส่วนตัว
          </Link>
        </section>

        <section className="grid gap-4">
          {[
            {
              detail: "ยังไม่มีกิจกรรมที่เปิดรับสมัครใน MVP นี้",
              icon: CalendarDays,
              title: "กิจกรรมที่เปิดรับสมัคร",
            },
            {
              detail: "Pairing และ Tee Time จะเชื่อมกับ Event ใน sprint ถัดไป",
              icon: ClipboardCheck,
              title: "ก๊วนและ Tee Time",
            },
            {
              detail: "Leaderboard จะเริ่มหลัง Basic Competition",
              icon: Trophy,
              title: "ผลการแข่งขัน",
            },
          ].map((item) => (
            <article
              className="rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm"
              key={item.title}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-md bg-[#edf4ea] text-[#0f6b4f]">
                    <item.icon className="size-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[#0f2d26]">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-sm text-[#687a6d]">{item.detail}</p>
                  </div>
                </div>
                <ChevronRight className="size-5 text-[#9aa8a1]" aria-hidden="true" />
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
