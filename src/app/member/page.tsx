import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  Pencil,
  ShieldAlert,
  Trophy,
  UserRound,
} from "lucide-react";

import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

import { registerForEvent } from "./actions";

type MemberPageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

const statusMessages: Record<string, string> = {
  "admin-required": "บัญชีนี้ยังไม่มีสิทธิ์ Admin",
  "already-registered": "คุณสมัครกิจกรรมนี้ไว้แล้ว",
  "member-not-approved": "ต้องรอ Admin อนุมัติสมาชิกก่อน จึงจะสมัครกิจกรรมได้",
  "pending-review": "ส่งข้อมูลสมัครแล้ว กรุณารอ Admin ตรวจสอบกับฐานข้อมูลพนักงาน",
  "profile-saved": "บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว",
  registered: "สมัครกิจกรรมเรียบร้อยแล้ว กรุณารอติดตามขั้นตอนชำระเงิน",
  "registration-closed": "กิจกรรมนี้ปิดรับสมัครแล้ว",
  "registration-failed": "สมัครกิจกรรมไม่สำเร็จ กรุณาลองใหม่",
};

const memberStatusLabels: Record<string, string> = {
  active: "อนุมัติแล้ว",
  archived: "ถูกเก็บถาวร",
  guest: "แขก",
  inactive: "ไม่ใช้งาน",
  pending_verification: "รอตรวจสอบพนักงาน",
};

const sampleOpenEvents = [
  {
    event_date: "2026-08-15",
    id: "sample-event-1",
    member_price: 2200,
    name: "PEAGC Monthly Round",
    tee_off_time: "11:30",
    venue: "Royal Golf Club",
  },
];

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
          "id, full_name, nickname, employee_code, department, affiliation, handicap, organization, skill_level, status",
        )
        .eq("user_id", access.userId)
        .maybeSingle()
    : { data: null };
  const displayName = member?.nickname || member?.full_name || access.displayName;
  const profileHref = access.isBypass ? "/profile?bypass=member" : "/profile";
  const isPending = member?.status === "pending_verification";
  const { data: openEvents } = supabase
    ? await supabase
        .from("events")
        .select("id, name, venue, event_date, tee_off_time, member_price")
        .eq("status", "open")
        .is("archived_at", null)
        .order("event_date", { ascending: true })
        .limit(5)
    : { data: sampleOpenEvents };
  const eventIds = openEvents?.map((event) => event.id) ?? [];
  const { data: registrations } =
    supabase && member?.id && eventIds.length
      ? await supabase
          .from("event_registrations")
          .select("event_id, status")
          .eq("member_id", member.id)
          .in("event_id", eventIds)
          .not("status", "in", "(cancelled,no_show)")
      : { data: [] };
  const registrationByEvent = new Map(
    registrations?.map((item) => [item.event_id, item.status]) ?? [],
  );
  const canRegister = !access.isBypass && member?.status === "active";

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
          <article className="rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-md bg-[#edf4ea] text-[#0f6b4f]">
                  <CalendarDays className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[#0f2d26]">
                    กิจกรรมที่เปิดรับสมัคร
                  </h2>
                  <p className="mt-1 text-sm text-[#687a6d]">
                    สมาชิกที่ผ่านอนุมัติแล้วสามารถสมัครกิจกรรมที่เปิดรับได้
                  </p>
                </div>
              </div>
              <ChevronRight className="size-5 text-[#9aa8a1]" aria-hidden="true" />
            </div>

            <div className="mt-4 grid gap-3">
              {openEvents?.length ? (
                openEvents.map((event) => {
                  const registrationStatus = registrationByEvent.get(event.id);

                  return (
                    <div
                      className="rounded-md border border-[#dfe5da] bg-[#fbfcf8] p-4"
                      key={event.id}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-[#0f2d26]">{event.name}</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-sm text-[#687a6d]">
                            <span className="flex items-center gap-1">
                              <CalendarDays className="size-4" aria-hidden="true" />
                              {event.event_date} · {event.tee_off_time?.slice(0, 5) ?? "-"}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="size-4" aria-hidden="true" />
                              {event.venue ?? "ยังไม่ระบุสนาม"}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 sm:items-end">
                          <span className="w-fit rounded-md bg-white px-3 py-1 text-sm font-semibold text-[#0f2d26]">
                            {event.member_price.toLocaleString()} บาท
                          </span>
                          {registrationStatus ? (
                            <span className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#e6f4df] px-3 text-sm font-semibold text-[#24613f]">
                              <CheckCircle2 className="size-4" aria-hidden="true" />
                              สมัครแล้ว
                            </span>
                          ) : canRegister ? (
                            <form action={registerForEvent}>
                              <input name="eventId" type="hidden" value={event.id} />
                              <button
                                className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
                                type="submit"
                              >
                                <ClipboardCheck className="size-4" aria-hidden="true" />
                                สมัครกิจกรรม
                              </button>
                            </form>
                          ) : (
                            <span className="w-fit rounded-md bg-[#edf1ec] px-3 py-2 text-sm font-medium text-[#687a6d]">
                              {access.isBypass
                                ? "โหมดทดลอง"
                                : "รออนุมัติสมาชิก"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-md border border-[#dfe5da] bg-[#fbfcf8] p-4 text-sm text-[#687a6d]">
                  ยังไม่มีกิจกรรมที่เปิดรับสมัคร
                </div>
              )}
            </div>
          </article>

          {[
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
