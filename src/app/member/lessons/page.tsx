import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Check, Clock3, NotebookText, Ticket } from "lucide-react";

import { acknowledgeLessonAnnouncement } from "@/app/member/actions";
import { LessonBookingCountdown } from "@/components/lesson-booking-countdown";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { LessonsMemberBookingCard } from "@/components/lessons-member-booking-card";
import { LessonsMemberCredits, LessonsMemberPackages } from "@/components/lessons-member-credits";
import { LessonsMemberHistory } from "@/components/lessons-member-history";
import { LessonsMemberSlotBrowser, type MySlotBooking } from "@/components/lessons-member-slot-browser";
import { MemberSection } from "@/components/member-section";
import { MemberTabBar } from "@/components/member-tab-bar";
import { StatusBanner, toneForStatus, type BannerTone } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { formatThaiDateShort, formatThaiDateTime } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { hasLessonAnnouncement, lessonStartAt, needsAnnouncementAck } from "@/lib/lessons/booking";
import { isUpcomingStatus } from "@/lib/lessons/labels";
import {
  type BookingEligibility,
  bookingActions,
  isHistoryStatus,
  memberBookingPhase,
} from "@/lib/lessons/member-view";
import { describeLessonRules } from "@/lib/lessons/rules";
import { getClubModules } from "@/lib/modules-server";
import { createClient } from "@/lib/supabase/server";

import {
  type LessonMember,
  type MemberLessonsData,
  lessonMemberColumns,
  loadMemberLessons,
  sampleLessonMember,
  sampleMemberLessons,
} from "./load";

type PageProps = {
  searchParams: Promise<{ bypass?: string; move?: string; pay?: string; rank?: string; status?: string }>;
};

const CalendarIcon = appIcons.calendar;
const LessonsIcon = appIcons.lessons;
const PaymentsIcon = appIcons.payments;

/** ?status= keys from the lesson actions → banner text (tone from the key unless given). */
const statusMessages: Record<string, { text: string; tone?: BannerTone }> = {
  "lesson-already-booked": { text: "จองรอบนี้ไว้แล้ว" },
  "lesson-announcement-acked": { text: "รับทราบประกาศแล้ว เลือกรอบเรียนได้เลย" },
  "lesson-announcement-failed": { text: "บันทึกไม่สำเร็จ ลองอีกครั้ง" },
  "lesson-announcement-required": { text: "กดรับทราบประกาศก่อนจอง" },
  "lesson-booked": { text: "จองสำเร็จ" },
  "lesson-booking-failed": { text: "จองไม่สำเร็จ ลองอีกครั้ง" },
  "lesson-cancel-closed": { text: "ไม่พบรายการจองนี้แล้ว" },
  "lesson-cancel-failed": { text: "ยกเลิกไม่สำเร็จ ลองอีกครั้ง" },
  "lesson-cancel-locked": { text: "เลยกำหนดยกเลิกแล้ว ถ้ามาไม่ได้ให้แจ้งผู้ดูแล" },
  "lesson-cancelled": { text: "ยกเลิกการจองแล้ว" },
  "lesson-change-closed": { text: "เปลี่ยนรอบไม่ได้แล้ว เลยกำหนดเปลี่ยนรอบ" },
  "lesson-change-failed": { text: "เปลี่ยนรอบไม่สำเร็จ ลองอีกครั้ง" },
  "lesson-changed": { text: "เปลี่ยนรอบแล้ว" },
  "lesson-changed-waitlisted": { text: "เปลี่ยนรอบแล้ว อยู่ในคิวสำรอง" },
  "lesson-closed": { text: "รอบนี้ปิดรับแล้ว" },
  "lesson-full": { text: "รอบนี้เต็มแล้ว" },
  "lesson-late-cancelled": { text: "ยกเลิกแล้ว (เลยกำหนด ไม่คืนเครดิต)", tone: "warning" },
  "lesson-limit": { text: "จองล่วงหน้าค้างไว้ครบจำนวนแล้ว เรียนจบหรือยกเลิกรอบเดิมก่อน" },
  "lesson-no-credit": { text: "เครดิตเรียนไม่พอ ซื้อแพ็กเกจก่อนจอง", tone: "error" },
  "lesson-no-show-blocked": { text: "ขาดเรียนเกินกำหนด งดจองชั่วคราว" },
  "lesson-not-open": { text: "ยังไม่เปิดลงทะเบียน" },
  "lesson-offer-expired": { text: "หมดเวลายืนยันที่ว่างแล้ว" },
  "lesson-offer-gone": { text: "รายการนี้ไม่ได้รอการยืนยันแล้ว" },
  "lesson-overlap": { text: "เวลาชนกับรอบที่จองไว้" },
  "lesson-priority-window": { text: "ช่วงนี้เปิดให้พนักงาน กฟภ. จองก่อน", tone: "warning" },
  "lesson-started": { text: "รอบนี้เริ่มเรียนแล้ว" },
  "lesson-waitlisted": { text: "รอบนี้เต็ม คุณอยู่ในคิวสำรอง มีที่ว่างจะแจ้งให้กดยืนยัน" },
  "lesson-week-limit": { text: "จองครบจำนวนต่อสัปดาห์แล้ว" },
  "lesson-window-closed": { text: "ปิดลงทะเบียนแล้ว" },
  "member-not-approved": { text: "รอผู้ดูแลอนุมัติก่อนใช้งาน" },
  "module-disabled": { text: "ส่วนนี้ยังไม่เปิดให้บริการ ติดตามประกาศจากชมรม" },
  "package-activated": { text: "รับแพ็กเกจแล้ว ใช้เครดิตจองรอบเรียนได้เลย", tone: "success" },
  "package-closed": { text: "แพ็กเกจนี้ปิดขายแล้ว" },
  "package-failed": { text: "สั่งซื้อไม่สำเร็จ ลองอีกครั้ง" },
  "package-limit": { text: "ใช้สิทธิ์แพ็กเกจนี้ครบแล้ว" },
  "package-pending": { text: "แพ็กเกจนี้รอชำระเงินอยู่แล้ว โอนเงินแล้วแนบสลิปด้านล่าง" },
  "package-requested": { text: "สั่งซื้อแล้ว โอนเงินตามยอดแล้วแนบสลิปด้านล่าง", tone: "info" },
  "package-slip-approved": { text: "ตรวจสลิปผ่านแล้ว เครดิตเข้าแล้ว" },
  "package-slip-closed": { text: "รายการนี้แนบสลิปไม่ได้แล้ว" },
  "package-slip-duplicate": { text: "สลิปนี้เคยใช้ชำระรายการอื่นแล้ว ใช้สลิปของการโอนครั้งนี้" },
  "package-slip-invalid": { text: "แนบสลิปเป็นรูป JPG, PNG, WebP หรือ PDF" },
  "package-slip-save-failed": { text: "บันทึกสลิปไม่สำเร็จ ลองอีกครั้ง" },
  "package-slip-submitted": { text: "ส่งสลิปแล้ว ผู้ดูแลตรวจผ่านแล้วเครดิตจะเข้าเอง" },
  "package-slip-too-large": { text: "ไฟล์ใหญ่เกิน 10 MB" },
  "package-slip-upload-failed": { text: "อัปโหลดไม่สำเร็จ ลองอีกครั้ง" },
  "package-unavailable": { text: "ยังซื้อแพ็กเกจทางหน้านี้ไม่ได้ ติดต่อผู้ดูแลชมรม", tone: "warning" },
};

/** Rules always shown on top; the rest sits under "กติกาอื่น". */
const mainRuleKeys = new Set(["max_bookings_per_member", "cancel_cutoff_hours", "offer"]);
/** On a database without lessons v2 only these rules are enforced. */
const v1RuleKeys = new Set(["max_bookings_per_member", "cancel_cutoff_hours", "change_cutoff_hours"]);

/** One timestamp per request (server component), so every rule on the page uses the same "now". */
function requestTime() {
  return Date.now();
}

export default async function MemberLessonsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "member",
    nextPath: "/member/lessons",
    requiredRole: "member",
    searchParams: params,
  });
  const demo = access.isBypass;
  const q = demo ? "?bypass=member" : "";
  const homeHref = `/member${q}`;

  let member: LessonMember;
  let data: MemberLessonsData | null = null;
  let tabModules = { events: true, lessons: true, scores: true };

  if (demo) {
    member = sampleLessonMember;
    data = sampleMemberLessons();
  } else {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("members")
      .select(lessonMemberColumns)
      .eq("user_id", access.userId)
      .is("archived_at", null)
      .maybeSingle();
    if (!row) {
      redirect("/member");
    }
    member = row as unknown as LessonMember;
    tabModules = await getClubModules(supabase, member.club_id);
    if (tabModules.lessons) {
      data = await loadMemberLessons(supabase, member, { scope: "full" });
    }
  }

  const tabHrefs = {
    events: `/member${q}#events`,
    lessons: `/member/lessons${q}`,
    me: `/member${q}#me`,
    scores: `/member${q}#scores`,
    top: `/member${q}#top`,
  };
  const message = params.status ? statusMessages[params.status] : undefined;
  const rank = params.rank && /^\d+$/.test(params.rank) ? ` (คิวสำรองลำดับ ${params.rank})` : "";

  const header = (
    <>
      <Link className="inline-flex h-11 w-fit items-center gap-1.5 text-base font-semibold text-brand-600 hover:underline" href={homeHref}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        หน้าสมาชิก
      </Link>
      <PageHeader description="จองรอบเรียน เครดิต และประวัติการเรียน" title="เรียนกอล์ฟ" />
      {message ? (
        <StatusBanner floating tone={message.tone ?? toneForStatus(params.status)}>
          {message.text}
          {rank}
        </StatusBanner>
      ) : null}
      {demo ? <StatusBanner tone="warning">โหมดทดลอง ข้อมูลในหน้านี้เป็นตัวอย่าง กดจองจริงไม่ได้</StatusBanner> : null}
    </>
  );

  if (!data) {
    return (
      <main className="min-h-screen bg-canvas px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 text-ink sm:px-6 lg:pb-10">
        <div className="mx-auto grid w-full max-w-3xl gap-5">
          {header}
          <StatusBanner tone="info">ชมรมยังไม่เปิดจองเรียน ติดตามประกาศจากชมรม</StatusBanner>
        </div>
        <MemberTabBar current="lessons" events={tabModules.events} hrefs={tabHrefs} lessons={false} scores={tabModules.scores} />
      </main>
    );
  }

  const now = requestTime();
  const { overview, rules, v2 } = data;
  const isActive = member.status === "active";
  const mustAck = !demo && needsAnnouncementAck(rules, member.lesson_announcement_ack_version);
  const phase = memberBookingPhase(rules, overview?.booking_open_at);
  const ruleContext = { cancelCutoffHours: rules.cancel_cutoff_hours, changeCutoffHours: rules.change_cutoff_hours, now, v2 };

  const ended = (item: MemberLessonsData["bookings"][number]) => lessonStartAt(item.slot.date, item.slot.endTime).getTime() <= now;
  const upcoming = data.bookings
    .filter((item) => isUpcomingStatus(item.status) && !ended(item))
    // seats waiting for a yes first, then by date (already sorted)
    .sort((a, b) => Number(b.status === "offered") - Number(a.status === "offered"));
  const history = data.bookings.filter((item) => isHistoryStatus(item.status) || (item.status === "booked" && ended(item)));
  const actionsFor = (item: MemberLessonsData["bookings"][number]) =>
    bookingActions({ ...item.slot, offerExpiresAt: item.offerExpiresAt, status: item.status }, ruleContext);
  const offers = upcoming.filter((item) => actionsFor(item).canConfirmOffer);

  const mine: Record<string, MySlotBooking> = Object.fromEntries(
    upcoming.map((item) => [item.slot.id, { bookingId: item.id, rank: item.rank, status: item.status }]),
  );
  const activeCount = upcoming.filter((item) => lessonStartAt(item.slot.date, item.slot.startTime).getTime() > now).length;
  const eligibility: BookingEligibility = {
    activeBookings: overview?.active_bookings ?? activeCount,
    enrollments: v2 ? data.enrollments : null,
    isActive,
    maxActiveBookings: overview?.max_active_bookings ?? rules.max_bookings_per_member,
    mustAckAnnouncement: mustAck,
    noShowBlockedUntil: overview?.blocked_until ?? null,
    phase,
  };

  const movingBooking = params.move ? upcoming.find((item) => item.id === params.move) : undefined;
  const moving =
    movingBooking && actionsFor(movingBooking).canChange
      ? {
          bookingId: movingBooking.id,
          cancelHref: `/member/lessons${q}#booking-${movingBooking.id}`,
          label: `${formatThaiDateShort(movingBooking.slot.date)} ${formatTimeRange(movingBooking.slot.startTime, movingBooking.slot.endTime)}`,
          slotId: movingBooking.slot.id,
        }
      : null;

  const courseNames: Record<string, string> = {};
  for (const slot of data.slots) if (slot.programId) courseNames[slot.programId] = slot.program;
  for (const item of data.bookings) if (item.slot.programId && item.slot.program) courseNames[item.slot.programId] = item.slot.program;
  for (const item of data.packages) if (item.program_id && item.programName) courseNames[item.program_id] = item.programName;

  const usesCredits = v2 && (data.packages.length > 0 || data.enrollments.length > 0 || data.slots.some((slot) => slot.requiresPackage));
  const ruleLines = describeLessonRules(rules, { usesCredits }).filter((line) => v2 || v1RuleKeys.has(line.key));
  const mainRules = ruleLines.filter((line) => mainRuleKeys.has(line.key));
  const otherRules = ruleLines.filter((line) => !mainRuleKeys.has(line.key));
  const cancelRule = ruleLines.find((line) => line.key === "cancel_cutoff_hours")?.text ?? null;
  const showCredits = v2 && (data.enrollments.length > 0 || data.packages.length > 0);
  const showPackages = v2 && data.packages.length > 0;
  const personalOpen = overview?.booking_open_at ?? rules.booking_open_at;
  const publicOpen = overview?.public_booking_open_at ?? rules.booking_open_at;
  const blockedUntil = overview?.blocked_until && Date.parse(overview.blocked_until) > now ? overview.blocked_until : null;

  const nav = [
    { href: "#my-bookings", label: "การจองของฉัน" },
    { href: "#slots", label: "จองรอบเรียน" },
    ...(showCredits ? [{ href: "#credits", label: "เครดิต" }] : []),
    ...(showPackages ? [{ href: "#packages", label: "ซื้อแพ็กเกจ" }] : []),
    { href: "#history", label: "ประวัติ" },
  ];

  return (
    <main className="min-h-screen bg-canvas px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 text-ink sm:px-6 lg:pb-10">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        {header}

        {!isActive && !demo ? (
          <StatusBanner tone="info">จองเรียนได้เมื่อผู้ดูแลอนุมัติสมาชิกแล้ว</StatusBanner>
        ) : null}
        {blockedUntil ? (
          <StatusBanner title="งดจองล่วงหน้าชั่วคราว" tone="error">
            ขาดเรียน {overview?.recent_no_shows ?? rules.no_show_limit} ครั้งใน {rules.no_show_window_days} วัน จองใหม่ได้ตั้งแต่ {formatThaiDateTime(blockedUntil)}
          </StatusBanner>
        ) : null}

        {v2 ? (
          <div className="grid grid-cols-2 gap-3">
            <a className="rounded-xl border border-line bg-white p-4 shadow-card" href={showCredits ? "#credits" : "#slots"}>
              <p className="text-sm font-medium text-ink-muted">เครดิตคงเหลือ</p>
              <p className="text-kpi font-semibold tabular-nums text-ink">
                {overview?.credits_available ?? 0}
                <span className="ml-1 text-base font-medium text-ink-muted">ครั้ง</span>
              </p>
              <p className="text-sm text-ink-muted">
                {overview?.next_credit_expiry ? `หมดอายุเร็วสุด ${formatThaiDateShort(overview.next_credit_expiry)}` : overview?.pending_packages ? `รอชำระ ${overview.pending_packages} แพ็กเกจ` : "ซื้อแพ็กเกจเพื่อจอง"}
              </p>
            </a>
            <a className="rounded-xl border border-line bg-white p-4 shadow-card" href="#my-bookings">
              <p className="text-sm font-medium text-ink-muted">จองไว้</p>
              <p className="text-kpi font-semibold tabular-nums text-ink">
                {eligibility.activeBookings}
                {eligibility.maxActiveBookings > 0 ? <span className="ml-1 text-base font-medium text-ink-muted">/ {eligibility.maxActiveBookings} รอบ</span> : <span className="ml-1 text-base font-medium text-ink-muted">รอบ</span>}
              </p>
              <p className={`text-sm ${offers.length ? "font-semibold text-info" : "text-ink-muted"}`}>
                {offers.length ? `รอคุณยืนยัน ${offers.length} รอบ` : "ที่ยังไม่ถึงวันเรียน"}
              </p>
            </a>
          </div>
        ) : null}

        <nav aria-label="ส่วนของหน้าเรียนกอล์ฟ" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {nav.map((item) => (
            <a
              className="inline-flex h-11 shrink-0 items-center rounded-full border border-line bg-white px-4 text-base font-medium text-ink hover:border-brand-600/50"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <MemberSection
          className="scroll-mt-4"
          description={upcoming.length ? `${upcoming.length} รอบที่ยังไม่ถึงวันเรียน` : undefined}
          icon={CalendarIcon}
          id="my-bookings"
          title="การจองของฉัน"
        >
          {upcoming.length ? (
            <div className="grid gap-3">
              {upcoming.map((item) => {
                const actions = actionsFor(item);
                return (
                  <LessonsMemberBookingCard
                    actions={actions}
                    booking={item}
                    cancelCutoffHours={rules.cancel_cutoff_hours}
                    changeHref={actions.canChange && isActive ? `/member/lessons${q ? `${q}&` : "?"}move=${item.id}#slots` : null}
                    demo={demo}
                    key={item.id}
                  />
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg bg-canvas px-4 py-4">
              <p className="text-base text-ink-muted">ยังไม่มีรอบที่จองไว้</p>
              <a className={`${buttonClass("primary", "lg")} mt-3 w-full sm:w-fit`} href="#slots">
                <LessonsIcon className="size-4" aria-hidden="true" />
                เลือกรอบเรียน
              </a>
            </div>
          )}
        </MemberSection>

        <MemberSection className="scroll-mt-4" icon={LessonsIcon} id="slots" title={moving ? "เลือกรอบใหม่" : "จองรอบเรียน"}>
          <div className="grid gap-4">
            {ruleLines.length ? (
              <div className="rounded-lg bg-canvas p-4">
                <p className="text-sm font-medium text-ink-muted">กติกาการจอง</p>
                <ul className="mt-2 grid gap-1.5">
                  {mainRules.map((line) => (
                    <li className="flex items-start gap-2 text-base text-ink" key={line.key}>
                      <Check className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />
                      {line.text}
                    </li>
                  ))}
                </ul>
                {otherRules.length ? (
                  <details className="mt-2">
                    <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold text-brand-600">
                      กติกาอื่น ({otherRules.length})
                    </summary>
                    <ul className="grid gap-1.5 pb-1">
                      {otherRules.map((line) => (
                        <li className="flex items-start gap-2 text-base text-ink" key={line.key}>
                          <Check className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                          {line.text}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}

            {phase === "before" && personalOpen ? (
              <div className="rounded-lg bg-info-bg px-4 py-3 text-base text-info">
                <p className="flex items-start gap-2">
                  <Clock3 className="mt-1 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    เปิดจอง {formatThaiDateTime(personalOpen)} · อีก <LessonBookingCountdown openAt={personalOpen} />
                  </span>
                </p>
                {overview?.is_employee && publicOpen && publicOpen !== personalOpen ? (
                  <p className="mt-1 text-sm">พนักงาน กฟภ. จองได้ก่อนบุคคลภายนอก ({formatThaiDateTime(publicOpen)})</p>
                ) : null}
              </div>
            ) : null}
            {phase === "open" && overview?.is_employee && publicOpen && Date.parse(publicOpen) > now ? (
              <p className="rounded-lg bg-info-bg px-4 py-3 text-base text-info">
                ช่วงจองก่อนสำหรับพนักงาน กฟภ. บุคคลภายนอกจองได้ {formatThaiDateTime(publicOpen)}
              </p>
            ) : null}
            {phase === "after" ? <p className="rounded-lg bg-neutral-bg px-4 py-3 text-base text-neutral">ปิดจองแล้ว</p> : null}
            {phase === "unset" ? (
              <p className="rounded-lg bg-neutral-bg px-4 py-3 text-base text-neutral">ยังไม่เปิดจอง ติดตามประกาศจากชมรม</p>
            ) : null}
            {phase === "open" && rules.booking_close_at ? (
              <p className="flex items-center gap-2 text-base text-ink-muted">
                <Clock3 className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                ปิดรับจอง {formatThaiDateTime(rules.booking_close_at)}
              </p>
            ) : null}

            {mustAck ? (
              <div className="rounded-lg border border-gold-500/40 bg-warning-bg p-4" id="announcement">
                <p className="text-sm font-medium text-warning">
                  ประกาศคลาสเรียน{rules.announcement_version > 1 ? ` · ฉบับที่ ${rules.announcement_version}` : ""}
                </p>
                {rules.announcement_title ? <h3 className="mt-1 text-h3 font-semibold text-ink">{rules.announcement_title}</h3> : null}
                <div className="mt-3 whitespace-pre-wrap rounded-md bg-white px-4 py-3 text-base text-ink">{rules.announcement_body}</div>
                <form action={acknowledgeLessonAnnouncement} className="mt-4 grid gap-3">
                  <input name="version" type="hidden" value={rules.announcement_version} />
                  <input name="returnTo" type="hidden" value="/member/lessons" />
                  <label className="flex items-start gap-3 text-base text-ink">
                    <input className="mt-1 size-5 shrink-0" name="accepted" required type="checkbox" />
                    ฉันอ่านและยอมรับเงื่อนไขข้างต้นแล้ว
                  </label>
                  <button className={`${buttonClass("primary", "lg")} w-full sm:w-fit`} type="submit">
                    <Check className="size-4" aria-hidden="true" />
                    รับทราบ
                  </button>
                </form>
              </div>
            ) : (
              <>
                {hasLessonAnnouncement(rules) ? (
                  <details className="rounded-lg border border-line px-4 py-2">
                    <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold text-brand-600">
                      ดูประกาศ{rules.announcement_title ? ` · ${rules.announcement_title}` : ""}
                    </summary>
                    <div className="whitespace-pre-wrap pb-2 text-base text-ink">{rules.announcement_body}</div>
                  </details>
                ) : null}
                <LessonsMemberSlotBrowser
                  demo={demo}
                  eligibility={eligibility}
                  key={data.slots.map((slot) => `${slot.id}:${slot.bookedCount}:${slot.seatsTaken ?? ""}`).join("|") + (moving?.bookingId ?? "")}
                  mine={mine}
                  moving={moving}
                  packagesHref={showPackages ? "#packages" : null}
                  rulesNote={cancelRule}
                  slots={data.slots}
                  today={data.today}
                />
              </>
            )}
          </div>
        </MemberSection>

        {showCredits ? (
          <MemberSection className="scroll-mt-4" icon={Ticket} id="credits" title="เครดิตของฉัน">
            <LessonsMemberCredits
              courseNames={courseNames}
              demo={demo}
              enrollments={data.enrollments}
              now={now}
              packages={data.packages}
              paymentSettings={data.paymentSettings}
              payments={data.payments}
              warningDays={rules.credit_expiry_warning_days}
            />
          </MemberSection>
        ) : null}

        {showPackages ? (
          <MemberSection
            className="scroll-mt-4"
            description="ซื้อแล้วได้เครดิต จองรอบไหนก็ตัดเครดิตรอบละ 1 ครั้ง"
            icon={PaymentsIcon}
            id="packages"
            title="ซื้อแพ็กเกจ"
          >
            <LessonsMemberPackages
              courseNames={courseNames}
              demo={demo}
              enrollments={data.enrollments}
              isActive={isActive}
              packages={data.packages}
            />
          </MemberSection>
        ) : null}

        <MemberSection className="scroll-mt-4" icon={NotebookText} id="history" title="ประวัติการเรียน">
          <LessonsMemberHistory bookings={history} notes={data.notes} skillLevel={member.skill_level} />
        </MemberSection>
      </div>

      <MemberTabBar
        current="lessons"
        events={tabModules.events}
        hrefs={tabHrefs}
        lessons
        scores={tabModules.scores}
        unread={data.unread}
      />
    </main>
  );
}
