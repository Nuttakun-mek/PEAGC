import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Check, ListTodo, LogOut, MapPin, ShieldAlert, UserPlus, UsersRound } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EventsMemberHandicap } from "@/components/events-member-handicap";
import { EventsRegistrationExtras } from "@/components/events-member-registration-extras";
import { EventsMemberScoreCards } from "@/components/events-member-score-cards";
import { LessonsMemberSummary } from "@/components/lessons-member-summary";
import { MembershipMemberCard } from "@/components/membership-member-card";
import { MemberSection, memberCard } from "@/components/member-section";
import { EnvBadge } from "@/components/env-badge";
import { MemberTabBar } from "@/components/member-tab-bar";
import { PaymentSlipInput } from "@/components/payment-slip-input";
import { MemberPaymentHistory } from "@/components/payments-member-history";
import { PointsMemberSection } from "@/components/points-member-section";
import { PromptPayPaymentCard } from "@/components/promptpay-payment-card";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { type ControlSize, buttonClass, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import {
  UNSET,
  formatBaht,
  formatFee,
  formatThaiDate,
  formatThaiDateLong,
  formatThaiDateShort,
  formatThaiDateTime,
  formatThaiTime,
  orUnset,
} from "@/lib/display";
import { appIcons } from "@/lib/icons";
import {
  type LessonBookingSettings,
  bangkokDate,
  cancelDeadline,
  defaultLessonBookingSettings,
  lessonStartAt,
  needsAnnouncementAck,
} from "@/lib/lessons/booking";
import { resolveAccess } from "@/lib/auth/access";
import { type ModuleState, defaultModuleState } from "@/lib/modules";
import { getClubModules } from "@/lib/modules-server";
import { loadPaymentSettings } from "@/lib/payments/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  markNotificationsRead,
  cancelEventRegistration,
  cancelLessonBooking,
  registerForEvent,
  uploadEventPaymentProof,
} from "./actions";

type MemberPageProps = {
  searchParams: Promise<{ bypass?: string; rank?: string; status?: string }>;
};

const AwardIcon = appIcons.awards;
const CalendarIcon = appIcons.calendar;
const CoachIcon = appIcons.coach;
const EditIcon = appIcons.edit;
const EventsIcon = appIcons.events;
const LessonsIcon = appIcons.lessons;
const NewsIcon = appIcons.news;
const NotificationsIcon = appIcons.notifications;
const PaymentsIcon = appIcons.payments;
const RescheduleIcon = appIcons.reschedule;
const ScoresIcon = appIcons.scores;
const UploadIcon = appIcons.upload;
const WaitlistIcon = appIcons.waitlist;

/** Shown wherever an event or lesson has no venue yet. */
const NO_VENUE = "รอแจ้งสนาม";

const statusMessages: Record<string, string> = {
  "admin-required": "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล",
  "already-registered": "สมัครกิจกรรมนี้ไว้แล้ว",
  "lesson-already-booked": "จองรอบนี้ไว้แล้ว",
  "lesson-announcement-acked": "รับทราบประกาศแล้ว",
  "lesson-announcement-failed": "บันทึกไม่สำเร็จ ลองอีกครั้ง",
  "lesson-announcement-required": "กดรับทราบประกาศก่อนจอง",
  "lesson-cancel-locked": "เลยกำหนดยกเลิกแล้ว ติดต่อผู้ดูแล",
  "lesson-changed-waitlisted": "เปลี่ยนรอบแล้ว อยู่ในคิวสำรอง",
  "lesson-limit": "จองครบจำนวนสูงสุดแล้ว",
  "lesson-not-open": "ยังไม่เปิดลงทะเบียน",
  "lesson-overlap": "เวลาชนกับรอบที่จองไว้",
  "lesson-started": "รอบนี้เริ่มเรียนแล้ว",
  "lesson-waitlisted": "รอบนี้เต็ม คุณอยู่ในคิวสำรอง",
  "lesson-window-closed": "ปิดลงทะเบียนแล้ว",
  "lesson-booked": "จองสำเร็จ",
  "lesson-booking-failed": "จองไม่สำเร็จ ลองอีกครั้ง",
  "lesson-cancel-closed": "ไม่พบรายการจอง",
  "lesson-cancel-failed": "ยกเลิกไม่สำเร็จ ลองอีกครั้ง",
  "lesson-cancelled": "ยกเลิกการจองแล้ว",
  "lesson-change-closed": "เปลี่ยนรอบไม่ได้แล้ว",
  "lesson-change-failed": "เปลี่ยนรอบไม่สำเร็จ ลองอีกครั้ง",
  "lesson-changed": "เปลี่ยนรอบแล้ว",
  "lesson-closed": "รอบนี้ปิดรับแล้ว",
  "lesson-full": "รอบนี้เต็มแล้ว",
  "lesson-late-cancelled": "ยกเลิกแล้ว (เลยกำหนด ไม่คืนเครดิต)",
  "lesson-no-credit": "เครดิตเรียนไม่พอ ซื้อแพ็กเกจก่อนจอง",
  "lesson-no-show-blocked": "ขาดเรียนเกินกำหนด งดจองชั่วคราว",
  "lesson-offer-expired": "หมดเวลายืนยันที่ว่างแล้ว",
  "lesson-offer-gone": "รายการนี้ไม่ได้รอการยืนยันแล้ว",
  "lesson-priority-window": "ช่วงนี้เปิดให้พนักงาน กฟภ. จองก่อน",
  "lesson-week-limit": "จองครบจำนวนต่อสัปดาห์แล้ว",
  "lesson-use-change": "มีรอบของคอร์สนี้ในวันเดียวกันแล้ว",
  "member-not-approved": "รอผู้ดูแลอนุมัติก่อนใช้งาน",
  "pending-review": "ส่งข้อมูลแล้ว รอผู้ดูแลตรวจสอบ",
  "profile-approved": "ยืนยันตัวตนสำเร็จ ใช้งานได้ทันที",
  "profile-saved": "บันทึกข้อมูลแล้ว",
  registered: "สมัครกิจกรรมแล้ว",
  "registered-payment-required": "สมัครแล้ว แนบสลิปโอนเงินในหัวข้อ “สิ่งที่ต้องทำ”",
  "module-disabled": "ส่วนนี้ยังไม่เปิดให้บริการ ติดตามประกาศจากชมรม",
  "notifications-read": "อ่านการแจ้งเตือนทั้งหมดแล้ว",
  "registration-waitlisted": "กิจกรรมเต็มแล้ว คุณอยู่ในคิวสำรอง มีที่ว่างจะเลื่อนให้และแจ้งให้ทราบ",
  "payment-proof-closed": "รายการนี้แนบสลิปไม่ได้แล้ว",
  "payment-proof-approved": "ตรวจสลิปผ่านแล้ว ชำระเรียบร้อย",
  "payment-proof-duplicate": "สลิปนี้เคยใช้ชำระรายการอื่นแล้ว แนบสลิปของการโอนครั้งนี้",
  "payment-proof-invalid": "ไฟล์ต้องเป็นรูป JPG, PNG, WebP หรือ PDF",
  "payment-proof-too-large": "ไฟล์ใหญ่เกิน 10 MB",
  "payment-proof-save-failed": "บันทึกสลิปไม่สำเร็จ ลองอีกครั้ง",
  "payment-proof-submitted": "ส่งสลิปแล้ว รอผู้ดูแลตรวจสอบ",
  "payment-proof-upload-failed": "อัปโหลดไม่สำเร็จ ลองอีกครั้ง",
  "registration-cancel-closed": "ยกเลิกไม่ได้ เนื่องจากชำระเงินแล้ว",
  "registration-cancel-failed": "ยกเลิกไม่สำเร็จ ลองอีกครั้ง",
  "registration-cancelled": "ยกเลิกการสมัครแล้ว",
  "registration-closed": "กิจกรรมนี้ปิดรับสมัครแล้ว",
  "registration-failed": "สมัครไม่สำเร็จ ลองอีกครั้ง",
  "registration-full": "กิจกรรมนี้เต็มแล้ว",
  "handicap-failed": "บันทึก Handicap Index ทางการไม่สำเร็จ ลองอีกครั้ง",
  "handicap-invalid": "Handicap Index ต้องอยู่ระหว่าง +10 ถึง 54",
  "handicap-saved": "บันทึก Handicap Index ทางการแล้ว",
  "score-confirm-closed": "การแข่งขันนี้ปิดแล้ว ยืนยันการ์ดไม่ได้",
  "score-confirm-denied": "ยืนยันการ์ดใบนี้ไม่ได้ ยืนยันได้เฉพาะการ์ดของตัวเองหรือของคนในก๊วน",
  "score-confirm-failed": "ยืนยันสกอร์ไม่สำเร็จ ลองอีกครั้ง",
  "score-confirm-player-first": "รอเจ้าของการ์ดยืนยันก่อน แล้ว marker จึงยืนยันได้",
  "score-confirm-superseded": "การ์ดนี้มีการแก้ไขแล้ว ตรวจการ์ดใบใหม่อีกครั้ง",
  "score-confirmed": "ยืนยันสกอร์แล้ว รอ marker ในก๊วนยืนยันอีกคน",
  "score-marked": "ยืนยันในฐานะ marker แล้ว",
  "score-verified": "ยืนยันครบแล้ว สกอร์นำไปจัดอันดับแล้ว",
};

const eventRegistrationStatusLabels: Record<string, string> = {
  checked_in: "ลงทะเบียนหน้างานแล้ว",
  paid: "ชำระเงินแล้ว",
  payment_review: "รอตรวจสลิป",
  pending_payment: "รอชำระเงิน",
  registered: "สมัครแล้ว",
  waitlist: "คิวสำรอง",
};

const skillLevelLabels: Record<string, string> = {
  advanced: "ชำนาญ",
  beginner: "เริ่มต้น",
  intermediate: "ปานกลาง",
};

/** Registration states the member may still cancel themselves (same list the server action accepts). */
const cancellableRegistration = ["registered", "pending_payment", "payment_review", "waitlist"];

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

type PairingGroup = { group_no?: number | null; start_hole?: number | null; tee_time?: string | null };

/** "17:00:00", "18:30:00" → "17:00–18:30 น.". */
function formatTimeRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return UNSET;
  if (!end) return formatThaiTime(start);
  return `${formatThaiTime(start).replace(/ น\.$/, "")}–${formatThaiTime(end)}`;
}

/** A lesson is still ahead until it ends (Bangkok wall clock). */
function lessonNotOver(date: string | null | undefined, endTime: string | null | undefined) {
  return Boolean(date) && lessonStartAt(date as string, endTime || "23:59").getTime() > Date.now();
}

function isPastCancelCutoff(deadline: Date) {
  return Date.now() > deadline.getTime();
}

/** Upcoming items soonest first, then past items newest first. */
function upcomingThenPast<T>(items: T[], isUpcoming: (item: T) => boolean, sortKey: (item: T) => string) {
  const upcoming = items.filter(isUpcoming).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const past = items.filter((item) => !isUpcoming(item)).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  return [...upcoming, ...past];
}

function groupText(group: PairingGroup) {
  return [
    `ก๊วน ${group.group_no ?? UNSET}`,
    group.tee_time ? `ออกตัว ${formatThaiTime(group.tee_time)}` : null,
    group.start_hole ? `หลุม ${group.start_hole}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Icon + one line of detail (date, venue, coach …). `label` names the icon for screen readers. */
function Meta({ children, icon: Icon, label }: { children: React.ReactNode; icon: LucideIcon; label?: string }) {
  return (
    <p className="flex items-start gap-2">
      <Icon className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      <span className="min-w-0">
        {label ? <span className="sr-only">{label}: </span> : null}
        {children}
      </span>
    </p>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-canvas px-4 py-4 text-sm text-ink-muted">{children}</p>;
}

function CancelRegistrationForm({
  className = "",
  eventName,
  registrationId,
  size = "md",
}: {
  className?: string;
  eventName: string;
  registrationId: string;
  size?: ControlSize;
}) {
  return (
    <form action={cancelEventRegistration} className={className}>
      <input name="registrationId" type="hidden" value={registrationId} />
      <ConfirmSubmitButton
        className={`${buttonClass("danger", size)} w-full`}
        confirmLabel="ยกเลิกการสมัคร"
        message={`ยกเลิกการสมัคร “${eventName}” ใช่หรือไม่`}
        title="ยกเลิกการสมัครกิจกรรม"
      >
        ยกเลิกการสมัคร
      </ConfirmSubmitButton>
    </form>
  );
}

/** One thing the member has to do, with the button or form that does it. */
function TodoItem({
  children,
  icon: Icon,
  title,
}: {
  children?: React.ReactNode;
  icon: LucideIcon;
  title: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink">{title}</p>
        {children ? <div className="mt-1 text-sm text-ink-muted">{children}</div> : null}
      </div>
    </li>
  );
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
          "id, club_id, member_code, avatar_url, title_prefix, first_name, last_name, full_name, nickname, employee_code, position, work_line, bureau, division, department, section, affiliation, handicap, organization, skill_level, status, joined_at, association_member_code, association_member_type, association_membership_status, lesson_announcement_ack_version",
        )
        .eq("user_id", access.userId)
        .maybeSingle()
    : { data: null };
  const demoMember =
    access.isBypass && params.status === "pending-review"
      ? {
          avatar_url: null,
          affiliation: "PEA",
          association_member_code: "PEA-GC-0001",
          association_member_type: "สามัญ",
          association_membership_status: "active",
          club_id: null as string | null,
          department: "กองบริการ",
          joined_at: "2026-07-01",
          lesson_announcement_ack_version: 0,
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
  // One name everywhere: the member's full name (the same name admins see).
  const displayName = currentMember?.full_name || access.displayName;
  const profileHref = access.isBypass ? "/profile?bypass=member" : "/profile";
  const lessonsHref = access.isBypass ? "/member/lessons?bypass=member" : "/member/lessons";
  const isPending = currentMember?.status === "pending_verification";
  const isActive = currentMember?.status === "active";
  // Admin on/off switches per module (see /admin/settings). Demo mode shows everything.
  const modules: ModuleState = access.isBypass
    ? { events: true, lessons: true, news: true, scores: true }
    : supabase && currentMember?.club_id
      ? await getClubModules(supabase, currentMember.club_id)
      : { ...defaultModuleState };
  const nothingOpen = !Object.values(modules).some(Boolean);

  if (!currentMember && !access.isBypass) {
    return (
      <AuthCard
        description="บัญชีนี้ยังไม่ได้สมัครสมาชิกชมรม กรอกรหัสพนักงานและเบอร์โทรเพื่อเริ่มใช้งาน"
        title="สมัครสมาชิก"
      >
        <Link className={`${buttonClass("primary", "lg")} mt-6 w-full`} href="/profile">
          <EditIcon className="size-4" aria-hidden="true" />
          กรอกข้อมูลสมาชิก
        </Link>
        <form action={signOut} className="mt-3">
          <button className={`${buttonClass("secondary", "lg")} w-full`} type="submit">
            <LogOut className="size-4" aria-hidden="true" /> ออกจากระบบ
          </button>
        </form>
      </AuthCard>
    );
  }
  // ---- data: two parallel batches instead of ~15 sequential round-trips ----
  type QueueRow = { booking_id: string; capacity: number; queue_position: number; slot_id: string; waitlist_capacity: number };
  const memberId = currentMember?.id;
  const clubId = currentMember?.club_id;
  const [
    { data: openEvents },
    { data: registrations },
    { data: lessonBookings },
    { data: lessonSettingsRow },
    { data: myQueue },
    { data: scoreHistory },
    { data: announcements },
    { data: awards },
    { data: notifications },
  ] = await Promise.all([
    supabase
      ? !modules.events
        ? { data: [] }
        : supabase
            .from("events")
            .select("id, name, venue, event_date, tee_off_time, capacity, member_price, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections")
            .eq("status", "open")
            .is("archived_at", null)
            .order("event_date", { ascending: true })
            .limit(5)
      : { data: sampleOpenEvents },
    supabase && memberId && modules.events
      ? supabase
          .from("event_registrations")
          .select(
            "id, event_id, status, created_at, checked_in_at, promoted_at, events(name, event_date, tee_off_time, venue, member_price, status), event_pairing_groups(group_no, tee_time, start_hole)",
          )
          .eq("member_id", memberId)
          .not("status", "in", "(cancelled,no_show)")
          .order("created_at", { ascending: false })
          .limit(20)
      : { data: [] },
    supabase && memberId && modules.lessons
      ? supabase
          .from("lesson_bookings")
          .select(
            "id, slot_id, status, booked_at, lesson_slots(program_id, title, coach_name, lesson_date, start_time, end_time, venue, status, capacity, allow_member_reschedule, lesson_programs(name, coach_name))",
          )
          .eq("member_id", memberId)
          .not("status", "in", "(cancelled,late_cancelled,closed)")
          .order("booked_at", { ascending: false })
          .limit(20)
      : { data: [] },
    supabase && clubId
      ? supabase
          .from("lesson_booking_settings")
          .select("booking_open_at, booking_close_at, max_bookings_per_member, cancel_cutoff_hours, announcement_title, announcement_body, announcement_version")
          .eq("club_id", clubId)
          .maybeSingle()
      : { data: null },
    supabase && memberId && modules.lessons ? supabase.rpc("my_lesson_bookings") : { data: [] as QueueRow[] },
    supabase && memberId && modules.scores
      ? supabase
          .from("event_registrations")
          .select(
            "id, gross_score, net_score, stableford_points, handicap_used, flight, overall_rank, score_status, events(name, event_date, venue)",
          )
          .eq("member_id", memberId)
          .not("status", "in", "(cancelled,no_show)")
          .order("created_at", { ascending: false })
          .limit(12)
      : { data: supabase ? [] : sampleScoreHistory },
    supabase && clubId && modules.news
      ? supabase.from("club_announcements").select("id, title, summary, category, published_at, is_pinned").eq("club_id", clubId).eq("status", "published").order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(4)
      : { data: [] },
    supabase && memberId && modules.scores
      ? supabase.from("member_awards").select("id, title, award_type, awarded_at, note, events(name)").eq("member_id", memberId).order("awarded_at", { ascending: false }).limit(8)
      : { data: [] },
    supabase && memberId
      ? supabase
          .from("member_notifications")
          .select("id, subject, body, created_at, read_at")
          .eq("member_id", memberId)
          .order("created_at", { ascending: false })
          .limit(8)
      : { data: [] },
  ]);

  const visibleOpenEvents =
    openEvents?.filter((event) => isVisibleForMember(event, currentMember)) ?? [];
  const latestScoredRegistration = scoreHistory?.find((score) => score.score_status !== "not_entered");

  // Second batch: queries that depend on the first.
  const [{ data: memberPayments }, { data: seatCountRows }, { data: holeScores }] = await Promise.all([
    memberId && registrations?.length && !access.isBypass
      ? createAdminClient()
          .from("payment_records")
          .select("id, event_registration_id, status, transferred_at, slip_file_id")
          .in("event_registration_id", registrations.map((item) => item.id))
          .order("created_at", { ascending: true })
      : { data: [] },
    supabase && !access.isBypass && visibleOpenEvents.length
      ? supabase.rpc("event_seat_counts", { p_event_ids: visibleOpenEvents.map((event) => event.id) })
      : { data: [] },
    // only the round that is displayed, not every hole the member ever played
    supabase && memberId && latestScoredRegistration?.id
      ? supabase
          .from("golf_hole_scores")
          .select("event_registration_id, hole_number, par, strokes, putts")
          .eq("member_id", memberId)
          .eq("event_registration_id", latestScoredRegistration.id)
          .order("hole_number")
      : { data: [] },
  ]);

  const paymentByRegistration = new Map(
    memberPayments?.map((payment) => [payment.event_registration_id, payment]) ?? [],
  );
  const registrationByEvent = new Map(
    registrations?.map((item) => [item.event_id, item]) ?? [],
  );
  const seatsByEvent = new Map(
    ((seatCountRows ?? []) as { event_id: string; seats: number; waitlist: number }[]).map((row) => [row.event_id, row]),
  );
  const lessonSettings: LessonBookingSettings = lessonSettingsRow
    ? { ...defaultLessonBookingSettings, ...lessonSettingsRow }
    : access.isBypass
      ? { ...defaultLessonBookingSettings, booking_open_at: "2026-01-01T00:00:00.000Z" }
      : { ...defaultLessonBookingSettings, booking_open_at: null };
  const queueByBooking = new Map<string, number>(
    ((myQueue ?? []) as QueueRow[]).map((item) => [item.booking_id, item.queue_position]),
  );
  const mustAckAnnouncement =
    !access.isBypass && needsAnnouncementAck(lessonSettings, currentMember?.lesson_announcement_ack_version);
  const canRegister = !access.isBypass && currentMember?.status === "active";
  const unreadCount = notifications?.filter((item) => !item.read_at).length ?? 0;
  const latestHoleScores = holeScores ?? [];
  const today = bangkokDate();

  // ---- the member's own lessons and events: upcoming soonest first, then past ----
  const myLessons = (lessonBookings ?? []).flatMap((booking) => {
    const slot = firstRelated(booking.lesson_slots);
    if (!slot) return [];
    const position = queueByBooking.get(booking.id);
    return [
      {
        booking,
        position,
        program: firstRelated(slot.lesson_programs),
        slot,
        // Booked, but behind the last seat: on the waitlist.
        waitlisted:
          booking.status === "waitlist" ||
          booking.status === "offered" ||
          (booking.status === "booked" && position !== undefined && position > slot.capacity),
      },
    ];
  });
  type MyLesson = (typeof myLessons)[number];
  const lessonIsAhead = (item: MyLesson) =>
    ["booked", "waitlist", "offered"].includes(item.booking.status) &&
    item.slot.status !== "cancelled" &&
    lessonNotOver(item.slot.lesson_date, item.slot.end_time);
  const sortedLessons = upcomingThenPast(myLessons, lessonIsAhead, (item) => `${item.slot.lesson_date} ${item.slot.start_time}`);
  const nextLesson = sortedLessons.find((item) => lessonIsAhead(item) && !item.waitlisted);
  // Seats offered from the waitlist (lessons v2) wait for the member's yes: a to-do item.
  const lessonOffers = modules.lessons ? myLessons.filter((item) => item.booking.status === "offered" && lessonIsAhead(item)) : [];

  const myRegistrations = (registrations ?? []).map((registration) => ({
    event: firstRelated(registration.events),
    group: firstRelated(registration.event_pairing_groups) as PairingGroup | null,
    registration,
  }));
  type MyRegistration = (typeof myRegistrations)[number];
  const eventIsAhead = ({ event }: MyRegistration) =>
    Boolean(event?.event_date && event.event_date >= today && event.status !== "cancelled");
  const sortedRegistrations = upcomingThenPast(
    myRegistrations,
    eventIsAhead,
    (item) => `${item.event?.event_date ?? ""} ${item.event?.tee_off_time ?? ""}`,
  );
  const nextEvent = sortedRegistrations.find((item) => eventIsAhead(item) && item.registration.status !== "waitlist");
  const pendingSlips = sortedRegistrations.filter(
    (item) => item.registration.status === "pending_payment" && Number(item.event?.member_price ?? 0) > 0,
  );
  const paymentSettings = pendingSlips.length && supabase ? await loadPaymentSettings(supabase, clubId) : null;
  // Open events not signed up for yet; signed-up ones are listed under "ที่สมัครไว้".
  const signUpEvents = visibleOpenEvents.filter((event) => !registrationByEvent.has(event.id));

  // ---- สิ่งที่ต้องทำ ----
  const needsProfile = !access.isBypass && !access.isProfileComplete;
  const blockedOther = !access.isBypass && Boolean(currentMember) && !isActive && !isPending;
  const needsAck = modules.lessons && mustAckAnnouncement;
  const todoCount =
    pendingSlips.length +
    [isPending, blockedOther, needsProfile, needsAck, lessonOffers.length > 0, unreadCount > 0].filter(Boolean).length;
  // Activation steps: only shown until the member is active.
  const showPipeline = !isActive;
  const memberPipeline = [
    { done: true, label: "บัญชี" },
    { done: Boolean(currentMember), label: "ประวัติ" },
    { done: isActive, label: isPending ? "รอตรวจสอบ" : "ยืนยันตัวตน" },
    { done: isActive, label: "พร้อมใช้งาน" },
  ];
  const currentStep = memberPipeline.findIndex((step) => !step.done);

  // ---- นัดครั้งถัดไป: the next lesson and the next event, soonest first ----
  const nextItems: { key: string; node: React.ReactNode; sortKey: string }[] = [];
  if (nextLesson) {
    const { booking, program, slot } = nextLesson;
    const deadline = cancelDeadline(slot.lesson_date, slot.start_time, lessonSettings.cancel_cutoff_hours);
    const cancelLocked = isPastCancelCutoff(deadline);
    const coach = slot.coach_name ?? program?.coach_name ?? null;
    const canMove = modules.lessons && canRegister && slot.allow_member_reschedule !== false;
    const timeRange = formatTimeRange(slot.start_time, slot.end_time);
    nextItems.push({
      key: `lesson-${booking.id}`,
      sortKey: `${slot.lesson_date} ${slot.start_time}`,
      node: (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex min-w-0 items-start gap-1.5 text-sm font-medium text-ink-muted">
              <LessonsIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {[program?.name, slot.title].filter(Boolean).join(" · ") || "คลาสเรียน"}
            </p>
            <StatusBadge kind="booking" status="booked">ได้ที่นั่งแล้ว</StatusBadge>
          </div>
          <p className="mt-2 text-h3 font-semibold text-ink">{formatThaiDateLong(slot.lesson_date)}</p>
          <p className="text-h3 font-semibold tabular-nums text-brand-600">{timeRange}</p>
          <div className="mt-2 grid gap-1 text-base text-ink-muted">
            <Meta icon={MapPin} label="สถานที่">{slot.venue || NO_VENUE}</Meta>
            {coach ? <Meta icon={CoachIcon}>ผู้สอน {coach}</Meta> : null}
          </div>
          {canMove || !cancelLocked ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {canMove ? (
                <a className={`${buttonClass("secondary", "lg")} flex-1 sm:flex-none`} href={`/member/lessons?move=${booking.id}#slots`}>
                  <RescheduleIcon className="size-4" aria-hidden="true" />
                  เปลี่ยนรอบ
                </a>
              ) : null}
              {cancelLocked ? null : (
                <form action={cancelLessonBooking} className="flex-1 sm:flex-none">
                  <input name="bookingId" type="hidden" value={booking.id} />
                  <ConfirmSubmitButton
                    className={`${buttonClass("danger", "lg")} w-full`}
                    confirmLabel="ยกเลิกการจอง"
                    message={`ยกเลิกรอบเรียน ${formatThaiDateShort(slot.lesson_date)} ${timeRange} ใช่หรือไม่`}
                    title="ยกเลิกการจองรอบเรียน"
                  >
                    ยกเลิกการจอง
                  </ConfirmSubmitButton>
                </form>
              )}
            </div>
          ) : null}
          <p className="mt-2 text-sm text-ink-subtle">
            {cancelLocked
              ? "เลยกำหนดยกเลิกแล้ว ถ้ามาไม่ได้ให้แจ้งผู้ดูแล"
              : `ยกเลิกได้ถึง ${formatThaiDateTime(deadline.toISOString())}`}
          </p>
        </>
      ),
    });
  }
  if (nextEvent?.event) {
    const event = nextEvent.event;
    const { group, registration } = nextEvent;
    const needsSlip = registration.status === "pending_payment" && Number(event.member_price ?? 0) > 0;
    nextItems.push({
      key: `event-${registration.id}`,
      sortKey: `${event.event_date} ${event.tee_off_time ?? ""}`,
      node: (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex min-w-0 items-start gap-1.5 text-sm font-medium text-ink-muted">
              <EventsIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {event.name ?? "กิจกรรมออกรอบ"}
            </p>
            <StatusBadge kind="registration" status={registration.status}>
              {eventRegistrationStatusLabels[registration.status] ?? registration.status}
            </StatusBadge>
          </div>
          <p className="mt-2 text-h3 font-semibold text-ink">{formatThaiDateLong(event.event_date)}</p>
          {event.tee_off_time ? (
            <p className="text-h3 font-semibold tabular-nums text-brand-600">ออกรอบ {formatThaiTime(event.tee_off_time)}</p>
          ) : null}
          <div className="mt-2 grid gap-1 text-base text-ink-muted">
            <Meta icon={MapPin} label="สนาม">{event.venue || NO_VENUE}</Meta>
            {group ? <Meta icon={UsersRound} label="ก๊วน">{groupText(group)}</Meta> : null}
          </div>
          {needsSlip ? (
            <p className="mt-2 text-sm font-medium text-warning">
              ยังไม่ได้แนบสลิป{" "}
              <a className="font-semibold text-brand-600 underline underline-offset-4" href="#todo">
                แนบสลิป
              </a>
            </p>
          ) : null}
          {event.status === "open" && cancellableRegistration.includes(registration.status) ? (
            <CancelRegistrationForm
              className="mt-4 sm:w-fit"
              eventName={event.name ?? "กิจกรรม"}
              registrationId={registration.id}
              size="lg"
            />
          ) : null}
        </>
      ),
    });
  }
  nextItems.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const nextEmptyText = modules.lessons && modules.events
    ? "ยังไม่มีรอบเรียนหรือกิจกรรมที่จองไว้"
    : modules.lessons
      ? "ยังไม่มีรอบเรียนที่จองไว้"
      : "ยังไม่มีกิจกรรมที่สมัครไว้";

  const latestScoreEvent = latestScoredRegistration ? firstRelated(latestScoredRegistration.events) : null;
  const holeByNumber = new Map(latestHoleScores.map((hole) => [hole.hole_number, hole]));
  const holes = Array.from({ length: 18 }, (_, index) => index + 1);
  const todoLink = `${buttonClass("secondary", "md")} mt-3`;

  return (
    <main className="min-h-screen bg-canvas px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 text-ink sm:px-6 lg:pb-10 lg:pt-8">
      <div className="mx-auto grid w-full max-w-7xl gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-6">
        <div className="grid min-w-0 gap-5">
          <div className="grid gap-4" id="top">
            <header className="flex items-center gap-3">
              <a className="skip-link" href="#member-content">ข้ามไปยังเนื้อหา</a>
              <ClubCrest priority size={44} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-subtle">{CLUB_NAME}</p>
                <h1 className="text-h2 font-semibold text-brand-600 sm:text-display">สวัสดี {displayName}</h1>
              </div>
              <EnvBadge className="ml-auto self-start" />
            </header>
            <span className="sr-only" id="member-content" tabIndex={-1} />

            {params.status && statusMessages[params.status] ? (
              <StatusBanner floating tone={toneForStatus(params.status)}>
                {statusMessages[params.status]}
                {params.rank && /^\d+$/.test(params.rank) ? ` (สำรองลำดับ ${params.rank})` : ""}
              </StatusBanner>
            ) : null}

            {access.isBypass ? (
              <StatusBanner tone="warning">โหมดทดลอง ข้อมูลในหน้านี้เป็นตัวอย่าง</StatusBanner>
            ) : null}

            {nothingOpen ? (
              <div className={memberCard}>
                <p className="text-h3 font-semibold text-ink">ยังไม่เปิดจองเรียนและสมัครกิจกรรม</p>
                <p className="mt-1 text-sm text-ink-muted">ชมรมกำลังเตรียมข้อมูล ติดตามประกาศจากชมรม</p>
              </div>
            ) : null}

            {modules.lessons || modules.events ? (
              <MemberSection icon={CalendarIcon} id="next-session" title="นัดครั้งถัดไป">
                {nextItems.length ? (
                  <ul className="divide-y divide-line">
                    {nextItems.map((item) => (
                      <li className="py-4 first:pt-0 last:pb-0" key={item.key}>
                        {item.node}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-base text-ink-muted">
                    {nextEmptyText}{" "}
                    <a
                      className="font-semibold text-brand-600 underline underline-offset-4"
                      href={modules.lessons ? lessonsHref : "#events"}
                    >
                      {modules.lessons ? "ดูรอบเรียนที่เปิดจอง" : "ดูกิจกรรมที่เปิดรับสมัคร"}
                    </a>
                  </p>
                )}
              </MemberSection>
            ) : null}

            {showPipeline || todoCount ? (
              <MemberSection
                description={todoCount ? `${todoCount} รายการ` : undefined}
                icon={ListTodo}
                id="todo"
                title="สิ่งที่ต้องทำ"
              >
                {showPipeline ? (
                  <ol aria-label="ขั้นตอนเปิดใช้งานสมาชิก" className={`grid grid-cols-4 gap-1 rounded-lg bg-canvas p-3 ${todoCount ? "mb-4" : ""}`}>
                    {memberPipeline.map((step, index) => {
                      const current = index === currentStep;
                      return (
                        <li
                          aria-current={current ? "step" : undefined}
                          className="flex flex-col items-center gap-1.5 text-center"
                          key={step.label}
                        >
                          <span
                            className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold ${
                              step.done
                                ? "bg-brand-600 text-white"
                                : current
                                  ? "border-2 border-gold-500 bg-white text-gold-ink"
                                  : "border-2 border-line bg-white text-ink-subtle"
                            }`}
                          >
                            {step.done ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                          </span>
                          <span className={`text-xs ${step.done || current ? "font-semibold text-ink" : "font-medium text-ink-subtle"}`}>
                            {step.label}
                            {step.done ? <span className="sr-only"> (เสร็จแล้ว)</span> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}

                {todoCount ? (
                  <ul className="divide-y divide-line">
                    {isPending ? (
                      <TodoItem icon={ShieldAlert} title="รอผู้ดูแลตรวจสอบข้อมูลสมาชิก">
                        <p>ตรวจแล้วจึงจองเรียนและสมัครกิจกรรมได้ อนุมัติแล้วจะแจ้งทางอีเมล</p>
                        <Link className={todoLink} href={profileHref}>
                          ตรวจข้อมูลของฉัน
                        </Link>
                      </TodoItem>
                    ) : null}
                    {blockedOther ? (
                      <TodoItem icon={ShieldAlert} title="บัญชียังจองเรียนและสมัครกิจกรรมไม่ได้">
                        ติดต่อผู้ดูแลชมรมเพื่อเปิดใช้งาน
                      </TodoItem>
                    ) : null}
                    {needsProfile ? (
                      <TodoItem icon={EditIcon} title="กรอกข้อมูลส่วนตัวให้ครบ">
                        <p>ต้องมีชื่อและเบอร์โทรก่อนสมัครกิจกรรม</p>
                        <Link className={todoLink} href={profileHref}>
                          กรอกข้อมูล
                        </Link>
                      </TodoItem>
                    ) : null}
                    {needsAck ? (
                      <TodoItem icon={LessonsIcon} title="อ่านประกาศคลาสเรียน">
                        <p>กดรับทราบก่อนจองรอบเรียน</p>
                        <a className={todoLink} href={`${lessonsHref}#slots`}>
                          อ่านประกาศ
                        </a>
                      </TodoItem>
                    ) : null}
                    {lessonOffers.length ? (
                      <TodoItem icon={WaitlistIcon} title={`มีที่ว่างรอคุณยืนยัน ${lessonOffers.length} รอบ`}>
                        <p>ยืนยันก่อนหมดเวลา ไม่อย่างนั้นที่นั่งจะส่งต่อให้คนถัดไป</p>
                        <a className={todoLink} href="#lessons">
                          ไปยืนยัน
                        </a>
                      </TodoItem>
                    ) : null}
                    {pendingSlips.map(({ event, registration }) => {
                      const payment = paymentByRegistration.get(registration.id);
                      return (
                        <TodoItem icon={PaymentsIcon} key={registration.id} title={`แนบสลิปค่าสมัคร ${event?.name ?? "กิจกรรม"}`}>
                          <p>
                            ยอดโอน <span className="font-semibold tabular-nums text-ink">{formatBaht(event?.member_price)}</span>
                            {" · "}
                            {formatThaiDateShort(event?.event_date)}
                          </p>
                          {payment?.status === "rejected" ? (
                            <p className="mt-1 font-medium text-danger">สลิปเดิมไม่ผ่านการตรวจ ส่งใหม่อีกครั้ง</p>
                          ) : null}
                          <PromptPayPaymentCard
                            amount={Number(event?.member_price ?? 0)}
                            className="mt-3"
                            description={`ค่าสมัคร ${event?.name ?? "กิจกรรม"}`}
                            settings={paymentSettings}
                          />
                          <form action={uploadEventPaymentProof} className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-start">
                            <input name="registrationId" type="hidden" value={registration.id} />
                            <PaymentSlipInput name="paymentProof" required />
                            <div>
                              <label className={fieldLabel} htmlFor={`slip-at-${registration.id}`}>
                                วันและเวลาที่โอน
                              </label>
                              <input
                                className={fieldInputClass("lg")}
                                id={`slip-at-${registration.id}`}
                                name="transferredAt"
                                type="datetime-local"
                              />
                            </div>
                            <SubmitButton
                              className={`${buttonClass("primary", "lg")} w-full sm:col-span-2 sm:w-fit`}
                              pendingText="กำลังส่งสลิป..."
                            >
                              <UploadIcon className="size-4" aria-hidden="true" /> ส่งสลิป
                            </SubmitButton>
                          </form>
                        </TodoItem>
                      );
                    })}
                    {unreadCount ? (
                      <TodoItem icon={NotificationsIcon} title={`แจ้งเตือนใหม่ ${unreadCount} รายการ`}>
                        <a className={todoLink} href="#inbox">
                          อ่านแจ้งเตือน
                        </a>
                      </TodoItem>
                    ) : null}
                  </ul>
                ) : null}
              </MemberSection>
            ) : null}
          </div>

          {modules.lessons ? (
            <LessonsMemberSummary
              announcementAckVersion={currentMember?.lesson_announcement_ack_version}
              canBook={canRegister}
              clubId={clubId}
              isBypass={access.isBypass}
              memberId={memberId}
            />
          ) : null}

          {modules.events ? (
            <MemberSection
              description={
                access.isBypass
                  ? "โหมดทดลอง สมัครจริงไม่ได้"
                  : !canRegister
                    ? "สมัครได้เมื่อสมาชิกได้รับการอนุมัติแล้ว"
                    : undefined
              }
              icon={EventsIcon}
              id="events"
              title="กิจกรรมออกรอบ"
            >
              <h3 className="text-base font-semibold text-ink">เปิดรับสมัคร</h3>
              {signUpEvents.length ? (
                <ul className="mt-2 grid gap-3">
                  {signUpEvents.map((event) => {
                    const counts = seatsByEvent.get(event.id);
                    const full = Boolean(event.capacity) && (counts?.seats ?? 0) >= event.capacity;
                    const seatsLeft = counts && event.capacity ? event.capacity - counts.seats : null;
                    const fee = Number(event.member_price ?? 0);
                    const teeOff = event.tee_off_time ? ` · ออกรอบ ${formatThaiTime(event.tee_off_time)}` : "";
                    return (
                      <li className="rounded-lg border border-line p-4" key={event.id}>
                        <p className="text-h3 font-semibold text-ink">{event.name}</p>
                        <div className="mt-2 grid gap-1 text-sm text-ink-muted">
                          <Meta icon={CalendarIcon} label="วันที่">
                            {formatThaiDateShort(event.event_date)}
                            {teeOff}
                          </Meta>
                          <Meta icon={MapPin} label="สนาม">{event.venue || NO_VENUE}</Meta>
                          {event.capacity ? (
                            <Meta icon={UsersRound} label="จำนวนที่รับ">
                              <span className="tabular-nums">
                                รับ {event.capacity} คน
                                {seatsLeft === null
                                  ? ""
                                  : seatsLeft > 0
                                    ? ` · เหลือ ${seatsLeft} ที่`
                                    : ` · เต็มแล้ว (สำรอง ${counts?.waitlist ?? 0} คน)`}
                              </span>
                            </Meta>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-base text-ink-muted">
                            ค่าสมัคร <span className="font-semibold tabular-nums text-ink">{formatFee(event.member_price)}</span>
                          </p>
                          {canRegister ? (
                            <form action={registerForEvent} className="w-full sm:w-auto">
                              <input name="eventId" type="hidden" value={event.id} />
                              <ConfirmSubmitButton
                                className={`${buttonClass("primary", "lg")} w-full`}
                                confirmLabel={full ? "ต่อคิวสำรอง" : "สมัคร"}
                                details={
                                  <>
                                    <dl className="grid gap-1.5 rounded-lg bg-canvas p-3">
                                      <div>
                                        <dt className="sr-only">กิจกรรม</dt>
                                        <dd className="font-semibold text-ink">{event.name}</dd>
                                      </div>
                                      <div className="flex gap-2">
                                        <dt className="w-16 shrink-0 text-ink-subtle">วันที่</dt>
                                        <dd>
                                          {formatThaiDateLong(event.event_date)}
                                          {teeOff}
                                        </dd>
                                      </div>
                                      <div className="flex gap-2">
                                        <dt className="w-16 shrink-0 text-ink-subtle">สนาม</dt>
                                        <dd>{event.venue || NO_VENUE}</dd>
                                      </div>
                                      <div className="flex gap-2">
                                        <dt className="w-16 shrink-0 text-ink-subtle">ค่าสมัคร</dt>
                                        <dd className="font-semibold tabular-nums text-ink">{formatFee(event.member_price)}</dd>
                                      </div>
                                    </dl>
                                    {fee > 0 && !full ? <p className="mt-2">หลังสมัคร แนบสลิปโอนเงินในหน้านี้</p> : null}
                                  </>
                                }
                                message={
                                  full
                                    ? "กิจกรรมเต็มแล้ว จะได้อยู่ในคิวสำรอง มีที่ว่างจะเลื่อนให้และแจ้งให้ทราบ"
                                    : "ตรวจรายละเอียดก่อนสมัคร"
                                }
                                title={full ? "ยืนยันต่อคิวสำรอง" : "ยืนยันสมัครกิจกรรม"}
                                tone="primary"
                              >
                                {full ? (
                                  <WaitlistIcon className="size-4" aria-hidden="true" />
                                ) : (
                                  <UserPlus className="size-4" aria-hidden="true" />
                                )}
                                {full ? "ต่อคิวสำรอง" : "สมัครกิจกรรม"}
                              </ConfirmSubmitButton>
                            </form>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mt-2">
                  <EmptyNote>
                    {visibleOpenEvents.length
                      ? "สมัครครบทุกกิจกรรมที่เปิดอยู่แล้ว"
                      : "ยังไม่มีกิจกรรมที่เปิดรับสมัคร ติดตามประกาศจากชมรม"}
                  </EmptyNote>
                </div>
              )}

              {sortedRegistrations.length ? (
                <div className="mt-6">
                  <h3 className="text-base font-semibold text-ink">ที่สมัครไว้</h3>
                  <ul className="mt-2 divide-y divide-line">
                    {sortedRegistrations.map((item) => {
                      const { event, group, registration } = item;
                      return (
                        <li className="py-3" key={registration.id}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="min-w-0 font-semibold text-ink">{event?.name ?? "กิจกรรม"}</p>
                            <StatusBadge kind="registration" status={registration.status}>
                              {eventRegistrationStatusLabels[registration.status] ?? registration.status}
                            </StatusBadge>
                          </div>
                          <div className="mt-1.5 grid gap-1 text-sm text-ink-muted sm:flex sm:flex-wrap sm:gap-x-4">
                            <Meta icon={CalendarIcon} label="วันที่">
                              {formatThaiDateShort(event?.event_date)}
                              {event?.tee_off_time ? ` · ออกรอบ ${formatThaiTime(event.tee_off_time)}` : ""}
                            </Meta>
                            <Meta icon={MapPin} label="สนาม">{event?.venue || NO_VENUE}</Meta>
                          </div>
                          {group ? (
                            <p className="mt-1.5 flex items-start gap-2 text-sm font-medium text-ink">
                              <UsersRound className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                              {groupText(group)}
                            </p>
                          ) : eventIsAhead(item) && registration.status !== "waitlist" ? (
                            <p className="mt-1.5 text-sm text-ink-subtle">ก๊วนและเวลาออกตัวจะแจ้งที่นี่เมื่อจัดก๊วนแล้ว</p>
                          ) : null}
                          {registration.checked_in_at && registration.status !== "checked_in" ? (
                            <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-success">
                              <Check className="size-4" aria-hidden="true" />
                              เช็กอินแล้ว
                            </p>
                          ) : null}
                          {registration.status === "waitlist" ? (
                            <p className="mt-1.5 flex items-start gap-2 text-sm text-warning">
                              <WaitlistIcon className="mt-1 size-4 shrink-0" aria-hidden="true" />
                              มีที่ว่างจะเลื่อนให้และแจ้งให้ทราบ
                            </p>
                          ) : null}
                          {registration.status === "pending_payment" && Number(event?.member_price ?? 0) > 0 ? (
                            <p className="mt-1.5 text-sm font-medium text-warning">
                              ยังไม่ได้แนบสลิป{" "}
                              <a className="font-semibold text-brand-600 underline underline-offset-4" href="#todo">
                                แนบสลิป
                              </a>
                            </p>
                          ) : null}
                          {registration.status === "payment_review" ? (
                            <p className="mt-1.5 text-sm text-ink-muted">ได้รับสลิปแล้ว ผู้ดูแลกำลังตรวจ</p>
                          ) : null}
                          <EventsRegistrationExtras
                            allEventIds={sortedRegistrations.map((entry) => entry.registration.event_id).join(",")}
                            eventDate={event?.event_date}
                            eventId={registration.event_id}
                            isBypass={access.isBypass}
                            registrationId={registration.id}
                            status={registration.status}
                          />
                          {event?.status === "open" && cancellableRegistration.includes(registration.status) ? (
                            <CancelRegistrationForm
                              className="mt-3 w-fit"
                              eventName={event?.name ?? "กิจกรรม"}
                              registrationId={registration.id}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </MemberSection>
          ) : null}

          {modules.news && announcements?.length ? (
            <MemberSection icon={NewsIcon} id="news" title="ข่าวจากชมรม">
              <ul className="divide-y divide-line">
                {announcements.slice(0, 2).map((news) => (
                  <li className="py-3 first:pt-0 last:pb-0" key={news.id}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
                      {news.is_pinned ? (
                        <span className="rounded-full bg-gold-500 px-2 font-medium text-gold-ink">ประกาศสำคัญ</span>
                      ) : null}
                      {news.category ? <span className="font-medium">{news.category}</span> : null}
                      <span>{formatThaiDateShort(news.published_at)}</span>
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-ink">{news.title}</h3>
                    {news.summary ? <p className="mt-1 line-clamp-3 text-sm text-ink-muted">{news.summary}</p> : null}
                  </li>
                ))}
              </ul>
            </MemberSection>
          ) : null}

          {modules.scores ? (
            <MemberSection icon={ScoresIcon} id="scores" title="สกอร์และผลการแข่งขัน">
              <EventsMemberScoreCards isBypass={access.isBypass} />
              {latestScoredRegistration ? (
                <section aria-label="สกอร์ล่าสุด" className="mb-4 overflow-hidden rounded-lg border border-line">
                  <div className="flex flex-wrap items-end justify-between gap-3 bg-canvas px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink-subtle">สกอร์ล่าสุด</p>
                      <p className="font-semibold text-ink">{latestScoreEvent?.name ?? "รายการล่าสุด"}</p>
                      {latestScoreEvent?.event_date ? (
                        <p className="text-sm text-ink-muted">{formatThaiDateShort(latestScoreEvent.event_date)}</p>
                      ) : null}
                    </div>
                    <dl className="flex gap-6 text-center">
                      <div>
                        <dt className="text-xs font-medium text-ink-subtle">สกอร์รวม (Gross)</dt>
                        <dd className="text-kpi font-semibold tabular-nums text-ink">
                          {latestScoredRegistration.gross_score ?? <span className="text-sm font-medium text-ink-subtle">{UNSET}</span>}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-ink-subtle">สกอร์สุทธิ (Net)</dt>
                        <dd className="text-kpi font-semibold tabular-nums text-brand-600">
                          {latestScoredRegistration.net_score ?? <span className="text-sm font-medium text-ink-subtle">{UNSET}</span>}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  {latestHoleScores.length ? (
                    <div className="overflow-x-auto border-t border-line">
                      <table className="w-full min-w-[720px] text-center text-sm tabular-nums">
                        <caption className="sr-only">สกอร์รายหลุม</caption>
                        <thead>
                          <tr className="border-b border-line">
                            <th className="px-2 py-2 text-left text-xs font-medium text-ink-subtle" scope="row">
                              หลุม
                            </th>
                            {holes.map((hole) => (
                              <th className="border-l border-line px-1 py-2 text-xs font-medium text-ink-subtle" key={hole} scope="col">
                                {hole}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-line">
                            <th className="px-2 py-2 text-left text-xs font-medium text-ink-subtle" scope="row">
                              พาร์
                            </th>
                            {holes.map((hole) => (
                              <td className="border-l border-line px-1 py-2 text-ink-muted" key={hole}>
                                {holeByNumber.get(hole)?.par ?? ""}
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <th className="px-2 py-2 text-left text-xs font-medium text-ink-subtle" scope="row">
                              สกอร์
                            </th>
                            {holes.map((hole) => (
                              <td className="border-l border-line px-1 py-2 font-semibold text-ink" key={hole}>
                                {holeByNumber.get(hole)?.strokes ?? ""}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {scoreHistory?.length ? (
                <ul className="grid gap-3">
                  {scoreHistory.map((score) => {
                    const event = firstRelated(score.events);
                    const entered = Boolean(score.score_status) && score.score_status !== "not_entered";
                    return (
                      <li className="rounded-lg border border-line p-4" key={score.id}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink">{event?.name ?? "กิจกรรม"}</p>
                            <p className="mt-0.5 text-sm text-ink-muted">
                              {formatThaiDateShort(event?.event_date)} · {event?.venue || NO_VENUE}
                            </p>
                          </div>
                          <StatusBadge kind="score" status={score.score_status ?? "not_entered"}>
                            {getScoreStatusLabel(score.score_status)}
                          </StatusBadge>
                        </div>
                        {entered ? (
                          <dl className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                            {[
                              ["สกอร์รวม (Gross)", orUnset(score.gross_score)],
                              ["สกอร์สุทธิ (Net)", orUnset(score.net_score)],
                              ["สเตเบิลฟอร์ด", orUnset(score.stableford_points)],
                              ["ไฟลท์", orUnset(score.flight)],
                              ["อันดับ", score.overall_rank ? String(score.overall_rank) : UNSET],
                            ].map(([label, value]) => (
                              <div className="min-w-0 rounded-md bg-canvas px-3 py-2" key={label}>
                                <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
                                <dd className="mt-0.5 font-semibold tabular-nums text-ink">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyNote>ยังไม่มีสกอร์ ผลจะขึ้นที่นี่หลังผู้ดูแลประกาศผล</EmptyNote>
              )}

              <div className="mt-6">
                <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
                  <AwardIcon className="size-4 text-gold-700" aria-hidden="true" />
                  รางวัล
                </h3>
                {awards?.length ? (
                  <ul className="mt-2 grid gap-3 sm:grid-cols-2">
                    {awards.map((award) => (
                      <li className="flex items-start gap-3 rounded-lg border border-line p-4" key={award.id}>
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-500 text-gold-ink">
                          <AwardIcon className="size-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{award.title}</p>
                          <p className="mt-0.5 text-sm text-ink-muted">{firstRelated(award.events)?.name ?? award.award_type}</p>
                          <p className="mt-1 text-xs text-ink-subtle">{formatThaiDate(award.awarded_at)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-ink-muted">ยังไม่มีรางวัล</p>
                )}
              </div>
              <EventsMemberHandicap clubId={clubId} isBypass={access.isBypass} manualHandicap={currentMember?.handicap} memberId={memberId} />
            </MemberSection>
          ) : null}

          <PointsMemberSection clubId={currentMember?.club_id} isBypass={access.isBypass} memberId={memberId} memberStatus={currentMember?.status} status={params.status} />
        </div>

        <aside aria-labelledby="me-title" className="grid min-w-0 content-start gap-4" id="me">
          <h2 className="text-h2 font-semibold text-ink" id="me-title">
            ข้อมูลของฉัน
          </h2>
          <MembershipMemberCard displayName={displayName} isBypass={access.isBypass} member={currentMember} userId={access.userId} />

          <div className={memberCard}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                ["แต้มต่อ", orUnset(currentMember?.handicap)],
                ["ระดับฝีมือ", skillLevelLabels[currentMember?.skill_level ?? ""] ?? UNSET],
                ["หน่วยงาน", orUnset(currentMember?.department ?? currentMember?.organization)],
                ["ตำแหน่ง", orUnset(currentMember?.position ?? currentMember?.affiliation)],
              ].map(([label, value]) => (
                <div className="min-w-0" key={label}>
                  <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
                  <dd className="mt-0.5 font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <Link className={`${buttonClass("secondary", "lg")} mt-4 w-full`} href={profileHref}>
              <EditIcon className="size-4" aria-hidden="true" />
              แก้ไขข้อมูลส่วนตัว
            </Link>
          </div>

          <MemberPaymentHistory isBypass={access.isBypass} memberId={memberId} />

          {notifications?.length ? (
            <MemberSection
              action={
                unreadCount ? (
                  <form action={markNotificationsRead}>
                    <button className={buttonClass("ghost", "sm")} type="submit">
                      อ่านทั้งหมด
                    </button>
                  </form>
                ) : undefined
              }
              icon={NotificationsIcon}
              id="inbox"
              title={
                <>
                  การแจ้งเตือน
                  {unreadCount ? (
                    <span className="ml-2 inline-flex rounded-full bg-gold-500 px-2 align-middle text-xs font-semibold leading-5 text-gold-ink">
                      {unreadCount} ใหม่
                    </span>
                  ) : null}
                </>
              }
            >
              <ul className="grid gap-2">
                {notifications.map((item) => (
                  <li
                    className={`rounded-lg px-3 py-2.5 ${item.read_at ? "bg-canvas" : "border-l-4 border-gold-500 bg-white ring-1 ring-inset ring-line"}`}
                    key={item.id}
                  >
                    <p className="text-sm font-semibold text-ink">
                      {item.read_at ? null : <span className="sr-only">ใหม่: </span>}
                      {item.subject}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">{item.body}</p>
                    <p className="mt-1 text-xs text-ink-subtle">{formatThaiDateTime(item.created_at)}</p>
                  </li>
                ))}
              </ul>
            </MemberSection>
          ) : null}

          <form action={signOut}>
            <button className={`${buttonClass("secondary", "lg")} w-full`} type="submit">
              <LogOut className="size-4" aria-hidden="true" />
              ออกจากระบบ
            </button>
          </form>
        </aside>
      </div>

      <MemberTabBar
        events={modules.events}
        hrefs={{ lessons: lessonsHref }}
        lessons={modules.lessons}
        scores={modules.scores}
        unread={unreadCount}
      />
    </main>
  );
}
