import Link from "next/link";
import { AlertTriangle, Check, ChevronRight } from "lucide-react";

import { confirmLessonOffer } from "@/app/member/actions";
import { loadMemberLessons, sampleMemberLessons } from "@/app/member/lessons/load";
import { LessonBookingCountdown } from "@/components/lesson-booking-countdown";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { bookingBadgeLabel } from "@/components/lessons-member-booking-card";
import { MemberSection } from "@/components/member-section";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/styles";
import { formatThaiDate, formatThaiDateShort, formatThaiDateTime } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { lessonStartAt, needsAnnouncementAck } from "@/lib/lessons/booking";
import { expiryWarnings } from "@/lib/lessons/credits";
import { formatCredits, isUpcomingStatus } from "@/lib/lessons/labels";
import { bookingActions } from "@/lib/lessons/member-view";
import { createClient } from "@/lib/supabase/server";

const LessonsIcon = appIcons.lessons;

/** One timestamp per request (server component), so every rule on the page uses the same "now". */
function requestTime() {
  return Date.now();
}

/**
 * "คลาสเรียน" on the member home: seats waiting for a yes (with the confirm button), credits
 * left, the next few bookings and one button to the full lessons screen (/member/lessons).
 * Loads its own data; on a database without lessons v2 it shows only the bookings.
 */
export async function LessonsMemberSummary({
  announcementAckVersion,
  canBook,
  clubId,
  isBypass,
  memberId,
}: {
  announcementAckVersion: number | null | undefined;
  /** member is approved (active) */
  canBook: boolean;
  clubId: string | null | undefined;
  isBypass: boolean;
  memberId: string | null | undefined;
}) {
  const data = isBypass
    ? sampleMemberLessons()
    : memberId && clubId
      ? await loadMemberLessons(await createClient(), { club_id: clubId, id: memberId }, { scope: "summary" })
      : null;
  const q = isBypass ? "?bypass=member" : "";
  const lessonsHref = `/member/lessons${q}`;

  if (!data) {
    return (
      <MemberSection icon={LessonsIcon} id="lessons" title="คลาสเรียน">
        <Link className={`${buttonClass("primary", "lg")} w-full sm:w-fit`} href={lessonsHref}>
          ดูรอบเรียน
        </Link>
      </MemberSection>
    );
  }

  const now = requestTime();
  const { overview, rules, v2 } = data;
  const context = { cancelCutoffHours: rules.cancel_cutoff_hours, changeCutoffHours: rules.change_cutoff_hours, now, v2 };
  const upcoming = data.bookings.filter(
    (item) => isUpcomingStatus(item.status) && lessonStartAt(item.slot.date, item.slot.endTime).getTime() > now,
  );
  const offers = upcoming.filter(
    (item) => bookingActions({ ...item.slot, offerExpiresAt: item.offerExpiresAt, status: item.status }, context).canConfirmOffer,
  );
  const next = upcoming.filter((item) => !offers.includes(item)).slice(0, 3);
  const mustAck = !isBypass && needsAnnouncementAck(rules, announcementAckVersion);
  const warning = v2 ? expiryWarnings(data.enrollments, rules.credit_expiry_warning_days, now)[0] : undefined;
  const showCredits = v2 && Boolean(overview) && (data.enrollments.length > 0 || (overview?.credits_available ?? 0) > 0);
  const pendingPackages = overview?.pending_packages ?? 0;

  return (
    <MemberSection
      action={
        <Link className={buttonClass("ghost", "sm")} href={lessonsHref}>
          ทั้งหมด
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      }
      icon={LessonsIcon}
      id="lessons"
      title="คลาสเรียน"
    >
      <div className="grid gap-4">
        {offers.map((item) => (
          <div className="rounded-lg border border-info/20 bg-info-bg p-4 text-info" id={`lesson-offer-${item.id}`} key={item.id}>
            <p className="text-base font-semibold">มีที่ว่างรอคุณยืนยัน</p>
            <p className="mt-1 text-base text-ink">
              {item.slot.title} · {formatThaiDateShort(item.slot.date)} {formatTimeRange(item.slot.startTime, item.slot.endTime)}
            </p>
            {item.offerExpiresAt ? (
              <p className="mt-1 text-sm">
                ยืนยันภายใน {formatThaiDateTime(item.offerExpiresAt)} (เหลือ <LessonBookingCountdown openAt={item.offerExpiresAt} />)
              </p>
            ) : null}
            <form action={confirmLessonOffer} className="mt-3">
              <input name="bookingId" type="hidden" value={item.id} />
              <input name="returnTo" type="hidden" value="/member" />
              <SubmitButton className={`${buttonClass("primary", "lg")} w-full sm:w-fit`} disabled={isBypass || !canBook} pendingText="กำลังยืนยัน...">
                <Check className="size-5" aria-hidden="true" />
                ยืนยันรับที่นั่ง
              </SubmitButton>
            </form>
          </div>
        ))}

        {showCredits || pendingPackages ? (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-1 rounded-lg bg-canvas px-4 py-3">
            {showCredits ? (
              <div>
                <p className="text-sm font-medium text-ink-muted">เครดิตคงเหลือ</p>
                <p className="text-h2 font-semibold tabular-nums text-ink">{formatCredits(overview?.credits_available)}</p>
              </div>
            ) : null}
            {overview?.next_credit_expiry ? (
              <p className="text-sm text-ink-muted">หมดอายุเร็วสุด {formatThaiDate(overview.next_credit_expiry)}</p>
            ) : null}
            {pendingPackages ? (
              <Link className="text-base font-semibold text-brand-600 underline underline-offset-4" href={`${lessonsHref}#credits`}>
                รอชำระ {pendingPackages} แพ็กเกจ
              </Link>
            ) : null}
          </div>
        ) : null}

        {warning ? (
          <p className="flex items-start gap-2 rounded-lg bg-warning-bg px-3 py-2.5 text-base text-warning">
            <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden="true" />
            เครดิต “{warning.enrollment.package_name}” เหลือ {formatCredits(warning.enrollment.credits_remaining)}{" "}
            {warning.daysLeft <= 0 ? "หมดอายุวันนี้" : `หมดอายุใน ${warning.daysLeft} วัน`}
          </p>
        ) : null}

        {mustAck ? (
          <p className="rounded-lg bg-warning-bg px-3 py-2.5 text-base text-warning">
            มีประกาศคลาสเรียนใหม่ อ่านและกดรับทราบก่อนจอง{" "}
            <Link className="font-semibold underline underline-offset-4" href={`${lessonsHref}#slots`}>
              อ่านประกาศ
            </Link>
          </p>
        ) : null}

        {next.length ? (
          <div>
            <h3 className="text-base font-semibold text-ink">รอบที่จองไว้</h3>
            <ul className="mt-1 divide-y divide-line">
              {next.map((item) => (
                <li key={item.id}>
                  <Link className="flex items-center justify-between gap-3 py-3" href={`${lessonsHref}#booking-${item.id}`}>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-ink">
                        {formatThaiDateShort(item.slot.date)} · <span className="tabular-nums">{formatTimeRange(item.slot.startTime, item.slot.endTime)}</span>
                      </span>
                      <span className="block truncate text-sm text-ink-muted">
                        {item.slot.title}
                        {item.slot.coach ? ` · ${item.slot.coach}` : ""}
                      </span>
                    </span>
                    <StatusBadge className="shrink-0" kind="booking" status={item.status}>
                      {bookingBadgeLabel(item)}
                    </StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : !offers.length ? (
          <p className="text-base text-ink-muted">ยังไม่มีรอบที่จองไว้</p>
        ) : null}

        <Link className={`${buttonClass("primary", "lg")} w-full sm:w-fit`} href={lessonsHref}>
          <LessonsIcon className="size-4" aria-hidden="true" />
          {canBook || isBypass ? "จองรอบเรียน" : "ดูรอบเรียน"}
        </Link>
      </div>
    </MemberSection>
  );
}
