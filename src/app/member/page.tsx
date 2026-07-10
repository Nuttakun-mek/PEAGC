import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  GraduationCap,
  MailCheck,
  MapPin,
  Pencil,
  ShieldAlert,
  Trophy,
  UserRound,
} from "lucide-react";

import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

import { bookLessonSlot, changeLessonSlot, registerForEvent } from "./actions";

type MemberPageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

const statusMessages: Record<string, string> = {
  "admin-required": "บัญชีนี้ยังไม่มีสิทธิ์ Admin",
  "already-registered": "คุณสมัครกิจกรรมนี้ไว้แล้ว",
  "lesson-already-booked": "คุณจองรอบเรียนนี้ไว้แล้ว",
  "lesson-booked": "จองเรียนเรียบร้อยแล้ว",
  "lesson-booking-failed": "จองเรียนไม่สำเร็จ กรุณาลองใหม่",
  "lesson-closed": "รอบเรียนนี้ปิดรับจองแล้ว",
  "lesson-full": "รอบเรียนนี้เต็มแล้ว",
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

const sampleLessonSlots = [
  {
    capacity: 6,
    coach_name: "Coach PEA",
    end_time: "18:30",
    id: "sample-slot-1",
    lesson_date: "2026-08-20",
    lesson_programs: { name: "Golf Foundation", price: 1200 },
    start_time: "17:00",
    title: "Swing Clinic รอบเย็น",
    venue: "Driving Range A",
  },
];

const sampleScoreHistory = [
  {
    events: {
      event_date: "2026-06-20",
      name: "PEAGC Friendly Round",
      venue: "Bangkok Golf Club",
    },
    flight: "B",
    gross_score: 88,
    handicap_used: 14.2,
    id: "sample-score-1",
    net_score: 73.8,
    overall_rank: 6,
    score_status: "published",
    stableford_points: 34,
  },
  {
    events: {
      event_date: "2026-05-18",
      name: "PEAGC Monthly Round",
      venue: "Royal Golf Club",
    },
    flight: "B",
    gross_score: 91,
    handicap_used: 14.5,
    id: "sample-score-2",
    net_score: 76.5,
    overall_rank: 11,
    score_status: "verified",
    stableford_points: 31,
  },
];

function firstRelated<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeTarget(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function matchesTargetList(
  targets: string[] | null | undefined,
  memberValue: string | null | undefined,
) {
  if (!targets?.length) {
    return true;
  }

  const normalizedMemberValue = normalizeTarget(memberValue);

  return targets.some((target) => normalizeTarget(target) === normalizedMemberValue);
}

function isVisibleForMember<
  T extends {
    target_bureaus?: string[] | null;
    target_departments?: string[] | null;
    target_divisions?: string[] | null;
    target_sections?: string[] | null;
    target_work_lines?: string[] | null;
  },
>(
  item: T,
  member:
    | {
        bureau?: string | null;
        department?: string | null;
        division?: string | null;
        section?: string | null;
        work_line?: string | null;
      }
    | null
    | undefined,
) {
  return (
    matchesTargetList(item.target_work_lines, member?.work_line) &&
    matchesTargetList(item.target_bureaus, member?.bureau) &&
    matchesTargetList(item.target_divisions, member?.division) &&
    matchesTargetList(item.target_departments, member?.department) &&
    matchesTargetList(item.target_sections, member?.section)
  );
}

function getScoreStatusLabel(status: string | null | undefined) {
  if (status === "published") {
    return "ประกาศผลแล้ว";
  }

  if (status === "verified") {
    return "ตรวจแล้ว";
  }

  if (status === "submitted") {
    return "ส่งคะแนนแล้ว";
  }

  if (status === "draft") {
    return "ร่างคะแนน";
  }

  return "ยังไม่ลงคะแนน";
}

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
          "id, avatar_url, title_prefix, first_name, last_name, full_name, nickname, employee_code, position, work_line, bureau, division, department, section, affiliation, handicap, organization, skill_level, status",
        )
        .eq("user_id", access.userId)
        .maybeSingle()
    : { data: null };
  const demoMember =
    access.isBypass && params.status === "pending-review"
      ? {
          affiliation: "PEA",
          department: "กองบริการ",
          employee_code: "497901",
          position: "วิศวกร",
          work_line: "สายงานบริการ",
          bureau: "สำนักงานใหญ่",
          division: "ฝ่ายบริการ",
          section: "แผนกบริการ",
          title_prefix: "นาย",
          first_name: "สมาชิก",
          last_name: "ทดลอง",
          full_name: "สมาชิกทดลอง",
          handicap: 14.2,
          id: "demo-member",
          nickname: "Demo",
          organization: "PEA",
          skill_level: "intermediate",
          status: "pending_verification",
        }
      : null;
  const currentMember = member ?? demoMember;
  const displayName =
    currentMember?.nickname || currentMember?.full_name || access.displayName;
  const profileHref = access.isBypass ? "/profile?bypass=member" : "/profile";
  const isPending = currentMember?.status === "pending_verification";
  const { data: openEvents } = supabase
    ? await supabase
        .from("events")
        .select("id, name, venue, event_date, tee_off_time, member_price, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections")
        .eq("status", "open")
        .is("archived_at", null)
        .order("event_date", { ascending: true })
        .limit(5)
    : { data: sampleOpenEvents };
  const visibleOpenEvents =
    openEvents?.filter((event) => isVisibleForMember(event, currentMember)) ?? [];
  const eventIds = visibleOpenEvents.map((event) => event.id);
  const { data: registrations } =
    supabase && currentMember?.id && eventIds.length
      ? await supabase
          .from("event_registrations")
          .select("event_id, status")
          .eq("member_id", currentMember.id)
          .in("event_id", eventIds)
          .not("status", "in", "(cancelled,no_show)")
      : { data: [] };
  const registrationByEvent = new Map(
    registrations?.map((item) => [item.event_id, item.status]) ?? [],
  );
  const { data: lessonSlots } = supabase
    ? await supabase
        .from("lesson_slots")
        .select(
          "id, title, coach_name, venue, lesson_date, start_time, end_time, capacity, allow_member_reschedule, reschedule_cutoff_hours, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections, lesson_programs(name, price)",
        )
        .eq("status", "open")
        .is("archived_at", null)
        .order("lesson_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(5)
    : { data: sampleLessonSlots };
  const visibleLessonSlots =
    lessonSlots?.filter((slot) => isVisibleForMember(slot, currentMember)) ?? [];
  const lessonSlotIds = visibleLessonSlots.map((slot) => slot.id);
  const { data: lessonBookings } =
    supabase && currentMember?.id && lessonSlotIds.length
      ? await supabase
          .from("lesson_bookings")
          .select("id, slot_id, status")
          .eq("member_id", currentMember.id)
          .in("slot_id", lessonSlotIds)
          .not("status", "in", "(cancelled)")
      : { data: [] };
  const lessonBookingBySlot = new Map(
    lessonBookings?.map((item) => [item.slot_id, item]) ?? [],
  );
  const { data: scoreHistory } =
    supabase && currentMember?.id
      ? await supabase
          .from("event_registrations")
          .select(
            "id, gross_score, net_score, stableford_points, handicap_used, flight, overall_rank, score_status, events(name, event_date, venue)",
          )
          .eq("member_id", currentMember.id)
          .not("status", "in", "(cancelled,no_show)")
          .order("created_at", { ascending: false })
          .limit(12)
      : { data: sampleScoreHistory };
  const canRegister = !access.isBypass && currentMember?.status === "active";

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#8b5b7a]">Member Portal</p>
              <h1 className="mt-1 text-3xl font-semibold text-[#722257]">
                สวัสดี {displayName}
              </h1>
            </div>
            <div className="flex size-12 items-center justify-center rounded-md bg-[#722257] text-white">
              <UserRound className="size-5" aria-hidden="true" />
            </div>
          </div>

          {params.status && statusMessages[params.status] ? (
            <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">
              {statusMessages[params.status]}
            </div>
          ) : null}

          {isPending ? (
            <div className="mt-5 grid gap-3 rounded-md border border-[#d7a52c] bg-[#fff9ed] px-4 py-3 text-sm text-[#805300]">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  สถานะสมาชิก: รอการตรวจสอบจาก Admin ก่อน จึงจะจองเรียนหรือสมัครกิจกรรมได้
                </span>
              </div>
              <div className="flex items-start gap-3">
                <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  เมื่อ Admin อนุมัติ ระบบจะสร้างรายการแจ้งเตือนอีเมลเพื่อแจ้งว่าสมาชิกใช้งานได้แล้ว
                </span>
              </div>
            </div>
          ) : access.isBypass ? (
            <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>โหมดทดลอง ไม่ได้ดึงข้อมูลจริงจากบัญชีผู้ใช้</span>
            </div>
          ) : !access.isProfileComplete ? (
            <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>กรุณากรอกข้อมูลส่วนตัวให้ครบก่อนสมัครกิจกรรม</span>
            </div>
          ) : null}

          <div className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/70 p-5">
            <p className="text-sm font-semibold text-[#8b5b7a]">Digital Member Card</p>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-[#6b6475]">ชื่อ</span>
                <span className="font-semibold text-[#722257]">
                  {currentMember?.full_name ?? "สมาชิกทดลอง"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#6b6475]">รหัสพนักงาน</span>
                <span className="font-semibold text-[#722257]">
                  {currentMember?.employee_code ?? "-"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#6b6475]">Handicap</span>
                <span className="font-semibold text-[#722257]">
                  {currentMember?.handicap ?? "-"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#6b6475]">สถานะ</span>
                <span
                  className={`font-semibold ${
                    isPending ? "text-[#805300]" : "text-[#722257]"
                  }`}
                >
                  {currentMember?.status
                    ? memberStatusLabels[currentMember.status]
                    : "ทดลอง"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#6b6475]">หน่วยงาน</span>
                <span className="font-semibold text-[#722257]">
                  {currentMember?.department ?? currentMember?.organization ?? "-"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#6b6475]">สังกัด</span>
                <span className="font-semibold text-[#722257]">
                  {currentMember?.position
                    ? `${currentMember.position} · ${currentMember?.work_line ?? "-"}`
                    : currentMember?.affiliation ?? "-"}
                </span>
              </div>
            </div>
          </div>

          <Link
            className="mt-5 flex h-12 items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
            href={profileHref}
          >
            <Pencil className="size-4" aria-hidden="true" />
            แก้ไขข้อมูลส่วนตัว
          </Link>
        </section>

        <section className="grid gap-4">
          <article className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                  <GraduationCap className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[#722257]">
                    จองเรียน Academy
                  </h2>
                  <p className="mt-1 text-sm text-[#6b6475]">
                    เลือกรอบเรียนที่เปิดจองและติดตามสถานะเข้าเรียน
                  </p>
                </div>
              </div>
              <ChevronRight className="size-5 text-[#9a94a6]" aria-hidden="true" />
            </div>

            <div className="mt-4 grid gap-3">
              {visibleLessonSlots?.length ? (
                visibleLessonSlots.map((slot) => {
                  const booking = lessonBookingBySlot.get(slot.id);
                  const program = firstRelated(slot.lesson_programs);

                  return (
                    <div
                      className="rounded-md border border-[#e6e2ee] bg-white/70 p-4"
                      key={slot.id}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-[#722257]">{slot.title}</p>
                          <p className="mt-1 text-sm text-[#6b6475]">
                            {program?.name ?? "-"} · รับ {slot.capacity} คน
                          </p>
                          <div className="mt-2 flex flex-wrap gap-3 text-sm text-[#6b6475]">
                            <span className="flex items-center gap-1">
                              <Clock className="size-4" aria-hidden="true" />
                              {slot.lesson_date} · {slot.start_time?.slice(0, 5)}-
                              {slot.end_time?.slice(0, 5)}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="size-4" aria-hidden="true" />
                              {slot.venue ?? "ยังไม่ระบุสถานที่"}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 sm:items-end">
                          <span className="w-fit rounded-md bg-white px-3 py-1 text-sm font-semibold text-[#722257]">
                            {(program?.price ?? 0).toLocaleString()} บาท
                          </span>
                          {booking ? (
                            <div>
                            <span className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#f8edf4] px-3 text-sm font-semibold text-[#722257]">
                              <CheckCircle2 className="size-4" aria-hidden="true" />
                              จองแล้ว
                            </span>
                              {slot.allow_member_reschedule &&
                              visibleLessonSlots.some((candidate) => candidate.id !== slot.id) ? (
                                <form action={changeLessonSlot} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                                  <input name="bookingId" type="hidden" value={booking.id} />
                                  <select
                                    className="h-10 rounded-md border border-[#d9d3e6] bg-white px-3 text-sm outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                                    name="slotId"
                                  >
                                    {visibleLessonSlots
                                      .filter((candidate) => candidate.id !== slot.id)
                                      .map((candidate) => (
                                        <option key={candidate.id} value={candidate.id}>
                                          {candidate.lesson_date} {candidate.start_time?.slice(0, 5)} · {candidate.title}
                                        </option>
                                      ))}
                                  </select>
                                  <button
                                    className="h-10 rounded-md border border-[#d9d3e6] bg-white px-3 text-sm font-semibold text-[#722257]"
                                    type="submit"
                                  >
                                    เปลี่ยนเวลา
                                  </button>
                                </form>
                              ) : null}
                            </div>
                          ) : canRegister ? (
                            <form action={bookLessonSlot}>
                              <input name="slotId" type="hidden" value={slot.id} />
                              <button
                                className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
                                type="submit"
                              >
                                <GraduationCap className="size-4" aria-hidden="true" />
                                จองเรียน
                              </button>
                            </form>
                          ) : (
                            <span className="w-fit rounded-md bg-[#f4f6fa] px-3 py-2 text-sm font-medium text-[#6b6475]">
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
                <div className="rounded-md border border-[#e6e2ee] bg-white/70 p-4 text-sm text-[#6b6475]">
                  ยังไม่มีรอบเรียนที่เปิดจอง
                </div>
              )}
            </div>
          </article>

          <article className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                  <CalendarDays className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[#722257]">
                    กิจกรรมที่เปิดรับสมัคร
                  </h2>
                  <p className="mt-1 text-sm text-[#6b6475]">
                    สมาชิกที่ผ่านอนุมัติแล้วสามารถสมัครกิจกรรมที่เปิดรับได้
                  </p>
                </div>
              </div>
              <ChevronRight className="size-5 text-[#9a94a6]" aria-hidden="true" />
            </div>

            <div className="mt-4 grid gap-3">
              {visibleOpenEvents?.length ? (
                visibleOpenEvents.map((event) => {
                  const registrationStatus = registrationByEvent.get(event.id);

                  return (
                    <div
                      className="rounded-md border border-[#e6e2ee] bg-white/70 p-4"
                      key={event.id}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-[#722257]">{event.name}</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-sm text-[#6b6475]">
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
                          <span className="w-fit rounded-md bg-white px-3 py-1 text-sm font-semibold text-[#722257]">
                            {event.member_price.toLocaleString()} บาท
                          </span>
                          {registrationStatus ? (
                            <span className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#f8edf4] px-3 text-sm font-semibold text-[#722257]">
                              <CheckCircle2 className="size-4" aria-hidden="true" />
                              สมัครแล้ว
                            </span>
                          ) : canRegister ? (
                            <form action={registerForEvent}>
                              <input name="eventId" type="hidden" value={event.id} />
                              <button
                                className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
                                type="submit"
                              >
                                <ClipboardCheck className="size-4" aria-hidden="true" />
                                สมัครกิจกรรม
                              </button>
                            </form>
                          ) : (
                            <span className="w-fit rounded-md bg-[#f4f6fa] px-3 py-2 text-sm font-medium text-[#6b6475]">
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
                <div className="rounded-md border border-[#e6e2ee] bg-white/70 p-4 text-sm text-[#6b6475]">
                  ยังไม่มีกิจกรรมที่เปิดรับสมัคร
                </div>
              )}
            </div>
          </article>

          <article className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                  <Trophy className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[#722257]">
                    คะแนนและผลการแข่งขัน
                  </h2>
                  <p className="mt-1 text-sm text-[#6b6475]">
                    ประวัติคะแนนทั้งหมดจากกิจกรรมที่เคยเข้าร่วม
                  </p>
                </div>
              </div>
              <ChevronRight className="size-5 text-[#9a94a6]" aria-hidden="true" />
            </div>

            <div className="mt-4 grid gap-3">
              {scoreHistory?.length ? (
                scoreHistory.map((score) => {
                  const event = firstRelated(score.events);

                  return (
                    <div
                      className="rounded-md border border-[#e6e2ee] bg-white/70 p-4"
                      key={score.id}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-[#722257]">
                              {event?.name ?? "กิจกรรม"}
                            </p>
                            <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-[#6b6475]">
                              {getScoreStatusLabel(score.score_status)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-[#6b6475]">
                            {event?.event_date ?? "-"} · {event?.venue ?? "ยังไม่ระบุสนาม"}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                          {[
                            ["Gross", score.gross_score ?? "-"],
                            ["Net", score.net_score ?? "-"],
                            ["Stableford", score.stableford_points ?? "-"],
                            ["Flight", score.flight ?? "-"],
                            ["Rank", score.overall_rank ? `#${score.overall_rank}` : "-"],
                          ].map(([label, value]) => (
                            <div className="rounded-md bg-white px-3 py-2" key={label}>
                              <p className="text-xs font-semibold text-[#6b6475]">
                                {label}
                              </p>
                              <p className="mt-1 font-semibold text-[#722257]">
                                {value}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-md border border-[#e6e2ee] bg-white/70 p-4 text-sm text-[#6b6475]">
                  ยังไม่มีประวัติคะแนนจากกิจกรรมที่เข้าร่วม
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
              className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]"
              key={item.title}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                    <item.icon className="size-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[#722257]">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-sm text-[#6b6475]">{item.detail}</p>
                  </div>
                </div>
                <ChevronRight className="size-5 text-[#9a94a6]" aria-hidden="true" />
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
