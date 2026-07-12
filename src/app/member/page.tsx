import Link from "next/link";
import {
  CalendarDays,
  Award,
  ChevronRight,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  GraduationCap,
  LogOut,
  MailCheck,
  MapPin,
  Pencil,
  ShieldAlert,
  Trophy,
  Upload,
  Newspaper,
} from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { MemberAvatar } from "@/components/member-avatar";
import { InteractiveSlotBoard } from "@/components/interactive-slot-board";
import { resolveAccess } from "@/lib/auth/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

import {
  bookLessonSlot,
  cancelEventRegistration,
  cancelLessonBooking,
  changeLessonSlot,
  registerForEvent,
  uploadEventPaymentProof,
} from "./actions";

type MemberPageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

const statusMessages: Record<string, string> = {
  "admin-required": "บัญชีนี้ยังไม่มีสิทธิ์ผู้ดูแลระบบ",
  "already-registered": "คุณสมัครกิจกรรมนี้ไว้แล้ว",
  "lesson-already-booked": "คุณจองรอบเรียนนี้ไว้แล้ว",
  "lesson-booked": "จองเรียนเรียบร้อยแล้ว",
  "lesson-booking-failed": "จองเรียนไม่สำเร็จ กรุณาลองใหม่",
  "lesson-cancel-closed": "ไม่สามารถยกเลิกรอบเรียนนี้ได้ เนื่องจากเริ่มเรียนแล้วหรือสถานะรายการเปลี่ยนไป",
  "lesson-cancel-failed": "ยกเลิกการจองเรียนไม่สำเร็จ กรุณาลองใหม่",
  "lesson-cancelled": "ยกเลิกการจองเรียนเรียบร้อยแล้ว",
  "lesson-change-closed": "ไม่สามารถเปลี่ยนเวลาเรียนได้ เนื่องจากปิดรับเปลี่ยนรอบหรือเลยเวลา cutoff แล้ว",
  "lesson-change-failed": "เปลี่ยนเวลาเรียนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  "lesson-changed": "เปลี่ยนเวลาเรียนเรียบร้อยแล้ว",
  "lesson-closed": "รอบเรียนนี้ปิดรับจองแล้ว",
  "lesson-full": "รอบเรียนนี้เต็มแล้ว",
  "lesson-use-change": "คุณมีรอบเรียนของคอร์สนี้ในวันเดียวกันแล้ว กรุณาใช้ปุ่มเปลี่ยนเวลา",
  "member-not-approved": "ต้องรอผู้ดูแลอนุมัติสมาชิกก่อน จึงจะสมัครกิจกรรมได้",
  "pending-review": "ส่งข้อมูลสมัครแล้ว กรุณารอผู้ดูแลตรวจสอบกับฐานข้อมูลพนักงาน",
  "profile-approved": "ตรวจสอบข้อมูลพนักงานตรงกันแล้ว บัญชีสมาชิกพร้อมใช้งานทันที",
  "profile-saved": "บันทึกประวัติส่วนตัวเรียบร้อยแล้ว",
  registered: "สมัครกิจกรรมเรียบร้อยแล้ว",
  "registered-payment-required": "สมัครกิจกรรมเรียบร้อยแล้ว กรุณาแนบหลักฐานการชำระเงินในรายการของฉัน",
  "payment-proof-closed": "รายการนี้ไม่อยู่ในสถานะที่แนบหลักฐานการชำระเงินได้",
  "payment-proof-invalid": "กรุณาแนบไฟล์ JPG, PNG, WebP หรือ PDF ขนาดไม่เกิน 8 MB",
  "payment-proof-save-failed": "บันทึกหลักฐานการชำระเงินไม่สำเร็จ กรุณาลองใหม่",
  "payment-proof-submitted": "ส่งหลักฐานการชำระเงินแล้ว กรุณารอผู้ดูแลตรวจสอบ",
  "payment-proof-upload-failed": "อัปโหลดหลักฐานการชำระเงินไม่สำเร็จ กรุณาลองใหม่",
  "registration-cancel-closed": "ไม่สามารถยกเลิกการสมัครนี้ได้ เนื่องจากชำระเงินแล้วหรือสถานะรายการเปลี่ยนไป",
  "registration-cancel-failed": "ยกเลิกการสมัครกิจกรรมไม่สำเร็จ กรุณาลองใหม่",
  "registration-cancelled": "ยกเลิกการสมัครกิจกรรมเรียบร้อยแล้ว",
  "registration-closed": "กิจกรรมนี้ปิดรับสมัครแล้ว",
  "registration-failed": "สมัครกิจกรรมไม่สำเร็จ กรุณาลองใหม่",
  "registration-full": "กิจกรรมนี้มีผู้สมัครครบจำนวนแล้ว",
};

const memberStatusLabels: Record<string, string> = {
  active: "อนุมัติแล้ว",
  archived: "ถูกเก็บถาวร",
  guest: "แขก",
  inactive: "ไม่ใช้งาน",
  pending_verification: "รอตรวจสอบพนักงาน",
};

const eventRegistrationStatusLabels: Record<string, string> = {
  checked_in: "ลงทะเบียนหน้างานแล้ว",
  paid: "ชำระเงินแล้ว",
  payment_review: "กำลังตรวจสอบการชำระเงิน",
  pending_payment: "รอชำระเงิน",
  registered: "สมัครแล้ว",
  waitlist: "รายชื่อสำรอง",
};

const lessonBookingStatusLabels: Record<string, string> = {
  attended: "เข้าเรียนแล้ว",
  booked: "จองแล้ว",
  no_show: "ไม่ได้เข้าเรียน",
};

const sampleOpenEvents = [
  {
    capacity: 72,
    event_date: "2026-08-15",
    id: "sample-event-1",
    member_price: 2200,
    name: "ออกรอบประจำเดือน PEAGC",
    target_bureaus: [],
    target_departments: [],
    target_divisions: [],
    target_sections: [],
    target_work_lines: [],
    tee_off_time: "11:30",
    venue: "สนามกอล์ฟรอยัล",
  },
];

const sampleLessonSlots = [
  {
    allow_member_reschedule: true,
    booked_count: 2,
    capacity: 6,
    coach_name: "ผู้ฝึกสอน กฟภ.",
    end_time: "18:30",
    id: "sample-slot-1",
    program_id: "sample-program-1",
    lesson_date: "2026-08-20",
    lesson_programs: { name: "พื้นฐานกอล์ฟ", price: 1200 },
    reschedule_cutoff_hours: 12,
    start_time: "17:00",
    target_bureaus: [],
    target_departments: [],
    target_divisions: [],
    target_sections: [],
    target_work_lines: [],
    title: "ฝึกวงสวิงรอบเย็น",
    venue: "สนามฝึกซ้อม เอ",
  },
];

const sampleScoreHistory = [
  {
    events: {
      event_date: "2026-06-20",
      name: "ออกรอบกระชับมิตร PEAGC",
      venue: "สนามกอล์ฟกรุงเทพ",
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
      name: "ออกรอบประจำเดือน PEAGC",
      venue: "สนามกอล์ฟรอยัล",
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
          "id, member_code, avatar_url, title_prefix, first_name, last_name, full_name, nickname, employee_code, position, work_line, bureau, division, department, section, affiliation, handicap, organization, skill_level, status",
        )
        .eq("user_id", access.userId)
        .maybeSingle()
    : { data: null };
  const demoMember =
    access.isBypass && params.status === "pending-review"
      ? {
          avatar_url: null,
          affiliation: "PEA",
          department: "กองบริการ",
          employee_code: "497901",
          member_code: "PEAGC-0001",
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

  if (!currentMember && !access.isBypass) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-transparent px-4 py-8 text-[#2f3137]">
        <section className="golf-visual w-full max-w-xl rounded-lg border border-[#e6e2ee] bg-white/95 p-6 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#8b5b7a]">ระบบสมาชิก PEAGC</p>
              <h1 className="mt-2 text-3xl font-semibold text-[#722257]">เริ่มต้นโปรไฟล์สมาชิก</h1>
            </div>
            <MemberAvatar displayName={access.displayName} />
          </div>
          <p className="mt-4 text-sm leading-7 text-[#6b6475]">
            บัญชีนี้ยังไม่มีข้อมูลสมาชิก กรุณากรอกรหัสพนักงาน ชื่อ และเบอร์โทรก่อน ระบบจะเทียบฐานพนักงานและเปิดสิทธิ์สมัครกิจกรรมกับจองเรียนให้อัตโนมัติเมื่อข้อมูลตรงกัน
          </p>
          <Link className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white" href="/profile">
            <Pencil className="size-4" aria-hidden="true" />
            สร้างโปรไฟล์สมาชิก
          </Link>
          <form action={signOut} className="mt-3">
            <button className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[#d9d3e6] bg-white text-sm font-semibold text-[#722257]" type="submit">
              <LogOut className="size-4" aria-hidden="true" /> ออกจากระบบ
            </button>
          </form>
        </section>
      </main>
    );
  }
  const { data: openEvents } = supabase
    ? await supabase
        .from("events")
        .select("id, name, venue, event_date, tee_off_time, capacity, member_price, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections")
        .eq("status", "open")
        .is("archived_at", null)
        .order("event_date", { ascending: true })
        .limit(5)
    : { data: sampleOpenEvents };
  const visibleOpenEvents =
    openEvents?.filter((event) => isVisibleForMember(event, currentMember)) ?? [];
  const { data: registrations } =
    supabase && currentMember?.id
      ? await supabase
          .from("event_registrations")
          .select(
            "id, event_id, status, created_at, events(name, event_date, tee_off_time, venue, member_price, status)",
          )
          .eq("member_id", currentMember.id)
          .not("status", "in", "(cancelled,no_show)")
          .order("created_at", { ascending: false })
          .limit(20)
      : { data: [] };
  const { data: memberPayments } =
    currentMember?.id && registrations?.length && !access.isBypass
      ? await createAdminClient()
          .from("payment_records")
          .select("id, event_registration_id, status, transferred_at, slip_file_id")
          .in("event_registration_id", registrations.map((item) => item.id))
          .order("created_at", { ascending: false })
      : { data: [] };
  const paymentByRegistration = new Map(
    memberPayments?.map((payment) => [payment.event_registration_id, payment]) ?? [],
  );
  const registrationByEvent = new Map(
    registrations?.map((item) => [item.event_id, item]) ?? [],
  );
  const { data: lessonSlots } = supabase
    ? await supabase
        .from("lesson_slots")
        .select(
          "id, program_id, title, coach_name, venue, lesson_date, start_time, end_time, capacity, booked_count, allow_member_reschedule, reschedule_cutoff_hours, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections, lesson_programs(name, price)",
        )
        .eq("status", "open")
        .is("archived_at", null)
        .order("lesson_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(50)
    : { data: sampleLessonSlots };
  const visibleLessonSlots =
    lessonSlots?.filter((slot) => isVisibleForMember(slot, currentMember)) ?? [];
  const { data: lessonBookings } =
    supabase && currentMember?.id
      ? await supabase
          .from("lesson_bookings")
          .select(
            "id, slot_id, status, booked_at, lesson_slots(program_id, title, lesson_date, start_time, end_time, venue, status, allow_member_reschedule, lesson_programs(name))",
          )
          .eq("member_id", currentMember.id)
          .not("status", "in", "(cancelled)")
          .order("booked_at", { ascending: false })
          .limit(20)
      : { data: [] };
  const lessonBookingBySlot = new Map(
    lessonBookings?.map((item) => [item.slot_id, item]) ?? [],
  );
  const { data: allVisibleSlotBookings } =
    supabase && visibleLessonSlots.length
      ? await createAdminClient()
          .from("lesson_bookings")
          .select("slot_id, status")
          .in("slot_id", visibleLessonSlots.map((slot) => slot.id))
          .not("status", "in", "(cancelled)")
      : { data: [] };
  const bookedCountBySlot = new Map<string, number>();
  allVisibleSlotBookings?.forEach((booking) => {
    bookedCountBySlot.set(
      booking.slot_id,
      (bookedCountBySlot.get(booking.slot_id) ?? 0) + 1,
    );
  });
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
  const memberSlotTableItems = visibleLessonSlots.map((slot) => {
    const booking = lessonBookingBySlot.get(slot.id);
    const program = firstRelated(slot.lesson_programs);

    return {
      bookedCount: slot.booked_count ?? bookedCountBySlot.get(slot.id) ?? 0,
      capacity: slot.capacity,
      date: slot.lesson_date,
      endTime: slot.end_time,
      id: slot.id,
      isCurrent: Boolean(booking),
      program: program?.name ?? "คอร์สเรียนกอล์ฟ",
      startTime: slot.start_time,
      title: slot.title,
      venue: slot.venue,
    };
  });
  const currentLessonBooking = lessonBookings?.find((booking) => booking.status === "booked");
  const { data: announcements } = supabase && access.clubId
    ? await supabase.from("club_announcements").select("id, title, summary, category, published_at, is_pinned").eq("club_id", access.clubId).eq("status", "published").order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(4)
    : { data: [] };
  const { data: holeScores } = supabase && currentMember?.id
    ? await supabase.from("golf_hole_scores").select("event_registration_id, hole_number, par, strokes, putts").eq("member_id", currentMember.id).order("hole_number")
    : { data: [] };
  const { data: awards } = supabase && currentMember?.id
    ? await supabase.from("member_awards").select("id, title, award_type, awarded_at, note, events(name)").eq("member_id", currentMember.id).order("awarded_at", { ascending: false }).limit(8)
    : { data: [] };
  const latestScoredRegistration = scoreHistory?.find((score) => score.score_status !== "not_entered");
  const latestHoleScores = holeScores?.filter((score) => score.event_registration_id === latestScoredRegistration?.id) ?? [];
  const memberPipeline = [
    { done: true, label: "สร้างบัญชี" },
    { done: Boolean(currentMember), label: "กรอกประวัติ" },
    {
      done: currentMember?.status === "active" || currentMember?.status === "pending_verification",
      label: currentMember?.status === "pending_verification" ? "กำลังตรวจพนักงาน" : "ตรวจพนักงานแล้ว",
    },
    { done: currentMember?.status === "active", label: "พร้อมใช้งาน" },
  ];

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <div className="mx-auto grid w-full max-w-[1500px] gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="rounded-lg border border-[#e2e8ef] bg-white/95 p-5 shadow-[0_8px_24px_rgba(30,41,59,0.05)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#8b5b7a]">ระบบสมาชิก</p>
              <h1 className="mt-1 text-3xl font-semibold text-[#722257]">
                สวัสดี {displayName}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <MemberAvatar
                avatarUrl={currentMember?.avatar_url}
                displayName={displayName}
              />
              <form action={signOut}>
                <button
                  aria-label="ออกจากระบบ"
                  className="flex size-10 items-center justify-center rounded-md border border-[#d9d3e6] bg-white text-[#722257] transition hover:border-[#722257]"
                  title="ออกจากระบบ"
                  type="submit"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>

          {params.status && statusMessages[params.status] ? (
            <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">
              {statusMessages[params.status]}
            </div>
          ) : null}

          <div className="mt-5 rounded-lg border border-[#e6e2ee] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[#722257]">สถานะการเปิดใช้งานสมาชิก</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {memberPipeline.map((step, index) => (
                <div className={`rounded-md px-3 py-3 text-sm ${step.done ? "bg-[#f8edf4] text-[#722257]" : "bg-[#f4f6fa] text-[#8b8490]"}`} key={step.label}>
                  <span className={`mr-2 inline-flex size-6 items-center justify-center rounded-full text-xs font-bold ${step.done ? "bg-[#722257] text-white" : "bg-[#d9d3e6] text-[#6b6475]"}`}>
                    {step.done ? "✓" : index + 1}
                  </span>
                  <span className="font-semibold">{step.label}</span>
                </div>
              ))}
            </div>
          </div>

          {isPending ? (
            <div className="mt-5 grid gap-3 rounded-md border border-[#d7a52c] bg-[#fff9ed] px-4 py-3 text-sm text-[#805300]">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  สถานะสมาชิก: รอการตรวจสอบจากผู้ดูแลก่อน จึงจะจองเรียนหรือสมัครกิจกรรมได้
                </span>
              </div>
              <div className="flex items-start gap-3">
                <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  เมื่อผู้ดูแลอนุมัติ ระบบจะสร้างรายการแจ้งเตือนอีเมลเพื่อแจ้งว่าสมาชิกใช้งานได้แล้ว
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

          <div className="golf-visual mt-6 rounded-lg bg-[#722257] p-5 text-white shadow-[0_14px_30px_rgba(114,34,87,0.16)]">
            <div className="flex items-center gap-4 border-b border-white/15 pb-4">
              <MemberAvatar
                avatarUrl={currentMember?.avatar_url}
                displayName={displayName}
                size="large"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#efd798]">บัตรสมาชิกดิจิทัล</p>
                <p className="mt-1 truncate text-lg font-semibold text-white">
                  {currentMember?.full_name ?? displayName}
                </p>
                <p className="mt-1 text-sm text-white/65">
                  เลขสมาชิก {currentMember?.member_code ?? "รอกำหนด"}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 text-sm [&_span:first-child]:text-white/60 [&_span:last-child]:text-white">
              <div className="flex justify-between gap-4">
                <span className="text-[#6b6475]">เลขสมาชิก</span>
                <span className="font-semibold text-[#722257]">
                  {currentMember?.member_code ?? "รอกำหนด"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#6b6475]">รหัสพนักงาน</span>
                <span className="font-semibold text-[#722257]">
                  {currentMember?.employee_code ?? "-"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#6b6475]">แต้มต่อ</span>
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

        <section className="grid min-w-0 gap-4">
          <article className="overflow-hidden rounded-lg border border-[#e2e8ef] bg-white shadow-[0_8px_24px_rgba(30,41,59,.05)]">
            <div className="flex items-center justify-between border-b border-[#edf0f3] px-5 py-4">
              <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-md bg-[#e9f7fa] text-[#168aad]"><Newspaper className="size-4" /></span><div><h2 className="font-semibold text-[#243244]">ข่าวประชาสัมพันธ์ชมรม</h2><p className="text-xs text-[#667085]">ประกาศและข่าวล่าสุดสำหรับสมาชิก</p></div></div>
            </div>
            <div className="grid gap-px bg-[#edf0f3] sm:grid-cols-2 xl:grid-cols-4">
              {announcements?.length ? announcements.map((news, index) => (
                <div className="bg-white p-4" key={news.id}><div className="flex items-center justify-between"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${index === 0 ? "bg-[#fff4d7] text-[#8b6508]" : "bg-[#eef7fa] text-[#16738f]"}`}>{news.is_pinned ? "ประกาศสำคัญ" : news.category}</span><span className="text-[11px] text-[#98a2b3]">{new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(new Date(news.published_at))}</span></div><h3 className="mt-3 text-sm font-semibold text-[#344054]">{news.title}</h3><p className="mt-2 line-clamp-2 text-xs leading-5 text-[#667085]">{news.summary ?? "ติดตามรายละเอียดเพิ่มเติมจากชมรม"}</p></div>
              )) : <div className="col-span-full bg-white p-6 text-center text-sm text-[#667085]">ยังไม่มีประกาศใหม่</div>}
            </div>
          </article>
          <article className="rounded-lg border border-[#e6e2ee] bg-white/95 p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-[#fff5d8] text-[#8a6000]">
                <ClipboardCheck className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#722257]">รายการของฉัน</h2>
                <p className="mt-1 text-sm text-[#6b6475]">
                  ติดตามกิจกรรมและเวลาเรียนที่สมัครไว้ แม้รายการปิดรับแล้ว
                </p>
              </div>
            </div>

            {registrations?.length || lessonBookings?.length ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <section className="rounded-md border border-[#e6e2ee] bg-white/70 p-4">
                  <h3 className="text-sm font-semibold text-[#722257]">กิจกรรมของฉัน</h3>
                  <div className="mt-3 grid gap-3">
                    {registrations?.length ? (
                      registrations.map((registration) => {
                        const event = firstRelated(registration.events);
                        const payment = paymentByRegistration.get(registration.id);

                        return (
                          <div className="border-t border-[#ece8f1] pt-3 first:border-t-0 first:pt-0" key={registration.id}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="font-semibold text-[#3f3a48]">
                                {event?.name ?? "กิจกรรม"}
                              </p>
                              <span className="rounded-md bg-[#f8edf4] px-2 py-1 text-xs font-semibold text-[#722257]">
                                {eventRegistrationStatusLabels[registration.status] ??
                                  registration.status}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#6b6475]">
                              <span className="flex items-center gap-1">
                                <CalendarDays className="size-3.5" aria-hidden="true" />
                                {event?.event_date ?? "-"} ·{" "}
                                {event?.tee_off_time?.slice(0, 5) ?? "-"}
                              </span>
                              <span className="flex items-center gap-1">
                                <MapPin className="size-3.5" aria-hidden="true" />
                                {event?.venue ?? "ยังไม่ระบุสนาม"}
                              </span>
                            </div>
                            {registration.status === "pending_payment" &&
                            (event?.member_price ?? 0) > 0 ? (
                              <form
                                action={uploadEventPaymentProof}
                                className="mt-3 grid gap-3 rounded-md bg-[#fff9e8] p-3"
                              >
                                <input name="registrationId" type="hidden" value={registration.id} />
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-[#722257]">
                                    ยอดชำระ {(event?.member_price ?? 0).toLocaleString()} บาท
                                  </p>
                                  {payment?.status === "rejected" ? (
                                    <span className="text-xs font-semibold text-[#9f1d1d]">
                                      หลักฐานเดิมไม่ผ่าน กรุณาส่งใหม่
                                    </span>
                                  ) : null}
                                </div>
                                <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                                  <label className="text-xs font-semibold text-[#3f3a48]">
                                    หลักฐานการโอน
                                    <input
                                      accept="image/jpeg,image/png,image/webp,application/pdf"
                                      className="mt-1 block h-10 w-full rounded-md border border-[#d9d3e6] bg-white px-2 py-1 text-xs"
                                      name="paymentProof"
                                      required
                                      type="file"
                                    />
                                  </label>
                                  <label className="text-xs font-semibold text-[#3f3a48]">
                                    วันและเวลาที่โอน
                                    <input
                                      className="mt-1 h-10 w-full rounded-md border border-[#d9d3e6] bg-white px-2 text-xs"
                                      name="transferredAt"
                                      type="datetime-local"
                                    />
                                  </label>
                                  <button className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#722257] px-3 text-xs font-semibold text-white" type="submit">
                                    <Upload className="size-3.5" aria-hidden="true" /> ส่งหลักฐาน
                                  </button>
                                </div>
                              </form>
                            ) : null}
                            {registration.status === "payment_review" ? (
                              <p className="mt-3 rounded-md bg-[#fff5d8] px-3 py-2 text-xs font-medium text-[#805300]">
                                ได้รับหลักฐานแล้ว ผู้ดูแลกำลังตรวจสอบ
                              </p>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-[#6b6475]">ยังไม่มีกิจกรรมที่สมัครไว้</p>
                    )}
                  </div>
                </section>

                <section className="rounded-md border border-[#e6e2ee] bg-white/70 p-4">
                  <h3 className="text-sm font-semibold text-[#722257]">ตารางเรียนของฉัน</h3>
                  <div className="mt-3 grid gap-3">
                    {lessonBookings?.length ? (
                      lessonBookings.map((booking) => {
                        const slot = firstRelated(booking.lesson_slots);
                        const program = firstRelated(slot?.lesson_programs);

                        return (
                          <div className="border-t border-[#ece8f1] pt-3 first:border-t-0 first:pt-0" key={booking.id}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-[#3f3a48]">
                                  {slot?.title ?? "รอบเรียน"}
                                </p>
                                <p className="mt-1 text-xs text-[#6b6475]">
                                  {program?.name ?? "คอร์สเรียน"}
                                </p>
                              </div>
                              <span className="rounded-md bg-[#f8edf4] px-2 py-1 text-xs font-semibold text-[#722257]">
                                {lessonBookingStatusLabels[booking.status] ?? booking.status}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#6b6475]">
                              <span className="flex items-center gap-1">
                                <Clock className="size-3.5" aria-hidden="true" />
                                {slot?.lesson_date ?? "-"} ·{" "}
                                {slot?.start_time?.slice(0, 5) ?? "-"}-
                                {slot?.end_time?.slice(0, 5) ?? "-"}
                              </span>
                              <span className="flex items-center gap-1">
                                <MapPin className="size-3.5" aria-hidden="true" />
                                {slot?.venue ?? "ยังไม่ระบุสถานที่"}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-[#6b6475]">ยังไม่มีเวลาเรียนที่จองไว้</p>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-[#d9d3e6] bg-white/60 px-4 py-6 text-center text-sm text-[#6b6475]">
                เมื่อสมัครกิจกรรมหรือจองเวลาเรียน รายการจะปรากฏที่นี่
              </div>
            )}
          </article>

          <article className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                  <GraduationCap className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[#722257]">
                    จองเวลาเรียนกอล์ฟ
                  </h2>
                  <p className="mt-1 text-sm text-[#6b6475]">
                    เลือกรอบเรียนที่เปิดจองและติดตามสถานะเข้าเรียน
                  </p>
                </div>
              </div>
              <ChevronRight className="size-5 text-[#9a94a6]" aria-hidden="true" />
            </div>

            <div className="mt-4">
              <InteractiveSlotBoard
                bookAction={bookLessonSlot}
                canBook={canRegister}
                changeAction={changeLessonSlot}
                currentBookingId={currentLessonBooking?.id}
                key={memberSlotTableItems.map((slot) => `${slot.id}:${slot.bookedCount}:${slot.isCurrent}`).join("|")}
                slots={memberSlotTableItems}
              />
              <div className="mt-5 border-t border-[#e6e2ee] pt-4">
                <h3 className="text-sm font-semibold text-[#722257]">รายละเอียด เปลี่ยนเวลา และยกเลิก</h3>
              </div>
            </div>

            <div className="mt-3 grid gap-3">
              {visibleLessonSlots?.length ? (
                visibleLessonSlots.map((slot) => {
                  const booking = lessonBookingBySlot.get(slot.id);
                  const program = firstRelated(slot.lesson_programs);
                  const scheduleBooking = lessonBookings?.find((candidate) => {
                    const bookedSlot = firstRelated(candidate.lesson_slots);

                    return (
                      bookedSlot?.program_id === slot.program_id &&
                      bookedSlot?.lesson_date === slot.lesson_date
                    );
                  });

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
                            <div className="grid justify-items-end gap-2">
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
                              <form action={cancelLessonBooking}>
                                <input name="bookingId" type="hidden" value={booking.id} />
                                <ConfirmSubmitButton
                                  className="h-9 rounded-md px-3 text-sm font-semibold text-[#8a3442] transition hover:bg-[#fff0f1]"
                                  message="ยืนยันยกเลิกการจองเรียนรายการนี้หรือไม่"
                                >
                                  ยกเลิกการจอง
                                </ConfirmSubmitButton>
                              </form>
                            </div>
                          ) : scheduleBooking ? (
                            <span className="w-fit rounded-md bg-[#fff5d8] px-3 py-2 text-sm font-medium text-[#805300]">
                              ใช้ปุ่มเปลี่ยนเวลาจากรอบที่จอง
                            </span>
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
                  const registration = registrationByEvent.get(event.id);

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
                            {event.capacity ? <span>รับสมัคร {event.capacity} คน</span> : null}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 sm:items-end">
                          <span className="w-fit rounded-md bg-white px-3 py-1 text-sm font-semibold text-[#722257]">
                            {event.member_price.toLocaleString()} บาท
                          </span>
                          {registration ? (
                            <div className="grid justify-items-end gap-1">
                              <span className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#f8edf4] px-3 text-sm font-semibold text-[#722257]">
                                <CheckCircle2 className="size-4" aria-hidden="true" />
                                สมัครแล้ว
                              </span>
                              {["registered", "pending_payment", "payment_review"].includes(
                                registration.status,
                              ) ? (
                                <form action={cancelEventRegistration}>
                                  <input
                                    name="registrationId"
                                    type="hidden"
                                    value={registration.id}
                                  />
                                  <ConfirmSubmitButton
                                    className="h-9 rounded-md px-3 text-sm font-semibold text-[#8a3442] transition hover:bg-[#fff0f1]"
                                    message="ยืนยันยกเลิกการสมัครกิจกรรมนี้หรือไม่"
                                  >
                                    ยกเลิกการสมัคร
                                  </ConfirmSubmitButton>
                                </form>
                              ) : null}
                            </div>
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

            {latestScoredRegistration ? (
              <section className="mt-4 overflow-hidden rounded-lg border border-[#e2e8ef] bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#243244] px-4 py-3 text-white">
                  <div><p className="text-xs text-white/60">สกอร์ล่าสุด 18 หลุม</p><p className="mt-1 text-sm font-semibold">{firstRelated(latestScoredRegistration.events)?.name ?? "รายการล่าสุด"}</p></div>
                  <div className="flex gap-4 text-center"><div><p className="text-[10px] text-white/55">คะแนนรวม</p><p className="text-xl font-bold">{latestScoredRegistration.gross_score ?? "-"}</p></div><div><p className="text-[10px] text-white/55">คะแนนสุทธิ</p><p className="text-xl font-bold text-[#f1cf79]">{latestScoredRegistration.net_score ?? "-"}</p></div></div>
                </div>
                <div className="overflow-x-auto"><div className="min-w-[760px] p-3">{[
                  { label: "หลุม", values: Array.from({ length: 18 }, (_, index) => index + 1) },
                  { label: "พาร์", values: Array.from({ length: 18 }, (_, index) => latestHoleScores.find((item) => item.hole_number === index + 1)?.par ?? "-") },
                  { label: "สกอร์", values: Array.from({ length: 18 }, (_, index) => latestHoleScores.find((item) => item.hole_number === index + 1)?.strokes ?? "-") },
                ].map((row) => <div className="grid grid-cols-[54px_repeat(18,minmax(36px,1fr))] border-b border-[#edf0f3] last:border-0" key={row.label}><div className="px-2 py-2 text-xs font-semibold text-[#667085]">{row.label}</div>{row.values.map((value, index) => <div className={`border-l border-[#edf0f3] px-1 py-2 text-center text-xs ${row.label === "สกอร์" && value !== "-" ? "font-bold text-[#722257]" : "text-[#475467]"}`} key={index}>{value}</div>)}</div>)}</div></div>
              </section>
            ) : null}

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
                            ["คะแนนรวม", score.gross_score ?? "-"],
                            ["คะแนนสุทธิ", score.net_score ?? "-"],
                            ["สเตเบิลฟอร์ด", score.stableford_points ?? "-"],
                            ["กลุ่ม", score.flight ?? "-"],
                            ["อันดับ", score.overall_rank ? `#${score.overall_rank}` : "-"],
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

          <article className="rounded-lg border border-[#e2e8ef] bg-white p-5 shadow-[0_8px_24px_rgba(30,41,59,.05)]">
            <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-md bg-[#fff4d7] text-[#a87308]"><Award className="size-5" /></span><div><h2 className="text-lg font-semibold text-[#243244]">รางวัลและความสำเร็จ</h2><p className="mt-1 text-sm text-[#667085]">ผลงานที่ได้รับจากกิจกรรมและการแข่งขันของชมรม</p></div></div>
            {awards?.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{awards.map((award) => <div className="flex items-start gap-3 rounded-lg border border-[#ece5d2] bg-[#fffcf4] p-4" key={award.id}><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#C69214] text-white"><Trophy className="size-4" /></span><div><p className="font-semibold text-[#344054]">{award.title}</p><p className="mt-1 text-xs text-[#667085]">{firstRelated(award.events)?.name ?? award.award_type}</p><p className="mt-2 text-[11px] text-[#98701b]">{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(new Date(award.awarded_at))}</p></div></div>)}</div>
            ) : <div className="mt-4 rounded-lg border border-dashed border-[#dce3ea] p-6 text-center text-sm text-[#667085]">รางวัลจากการแข่งขันจะแสดงที่นี่</div>}
          </article>

          {[
            {
              detail: "การจัดกลุ่มและเวลาออกรอบจะแสดงเมื่อผู้ดูแลจัดตารางแล้ว",
              icon: ClipboardCheck,
              title: "กลุ่มและเวลาออกรอบ",
            },
            {
              detail: "ตารางอันดับจะแสดงเมื่อประกาศผลการแข่งขัน",
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
