import Link from "next/link";
import { CalendarPlus, Check, MapPin } from "lucide-react";

import { cancelLessonBooking, confirmLessonOffer } from "@/app/member/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LessonBookingCountdown } from "@/components/lesson-booking-countdown";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/styles";
import { formatThaiDateLong, formatThaiDateShort, formatThaiDateTime } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { lessonBookingStatusLabel } from "@/lib/lessons/labels";
import type { BookingActions, MemberBooking } from "@/lib/lessons/member-view";

const CoachIcon = appIcons.coach;
const LessonsIcon = appIcons.lessons;
const RescheduleIcon = appIcons.reschedule;
const WaitlistIcon = appIcons.waitlist;

/** Shown wherever a lesson has no venue yet (same wording as the member home). */
export const NO_LESSON_VENUE = "รอแจ้งสนาม";

export function bookingBadgeLabel(booking: Pick<MemberBooking, "rank" | "status">) {
  if (booking.status === "waitlist" && booking.rank) return `คิวสำรอง ลำดับ ${booking.rank}`;
  return lessonBookingStatusLabel(booking.status);
}

/**
 * One of the member's upcoming bookings on /member/lessons: date, time, place, coach, status and
 * the things the member can still do (confirm an offered seat, change, cancel, add to calendar).
 */
export function LessonsMemberBookingCard({
  actions,
  booking,
  cancelCutoffHours,
  changeHref,
  demo,
}: {
  actions: BookingActions;
  booking: MemberBooking;
  cancelCutoffHours: number;
  /** "/member/lessons?move=<id>#slots" or null when the booking cannot move */
  changeHref: string | null;
  /** bypass preview: buttons are shown but do nothing */
  demo: boolean;
}) {
  const { slot, status } = booking;
  const timeRange = formatTimeRange(slot.startTime, slot.endTime);
  const when = `${formatThaiDateShort(slot.date)} ${timeRange}`;
  const heading = [slot.program, slot.title].filter((part, index, list) => part && list.indexOf(part) === index).join(" · ") || "รอบเรียน";
  const waitlisted = status === "waitlist";
  const offered = status === "offered";
  const showCalendar = actions.ahead && (status === "booked" || offered || waitlisted);

  const cancelLabel = waitlisted ? "ออกจากคิวสำรอง" : offered ? "ไม่รับที่นั่งนี้" : "ยกเลิกการจอง";
  const cancelDetails = actions.lateCancel ? (
    <p className="rounded-lg bg-danger-bg px-3 py-2 text-danger">
      เลยกำหนดยกเลิกคืนเครดิตแล้ว (ต้องยกเลิกก่อนเรียน {cancelCutoffHours} ชม.)
      {booking.creditHeld ? " ถ้ายกเลิกตอนนี้จะไม่ได้เครดิตคืน" : " จะบันทึกเป็นยกเลิกช้า"}
    </p>
  ) : booking.creditHeld ? (
    <p>ยกเลิกตอนนี้ได้เครดิตคืน 1 ครั้ง</p>
  ) : null;

  return (
    <article className="scroll-mt-24 rounded-xl border border-line bg-white p-4 sm:p-5" id={`booking-${booking.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex min-w-0 items-start gap-1.5 text-sm font-medium text-ink-muted">
          <LessonsIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {heading}
        </p>
        <StatusBadge kind="booking" status={status}>
          {bookingBadgeLabel(booking)}
        </StatusBadge>
      </div>
      <p className="mt-2 text-h3 font-semibold text-ink">{formatThaiDateLong(slot.date)}</p>
      <p className="text-h3 font-semibold tabular-nums text-brand-600">{timeRange}</p>
      <div className="mt-2 grid gap-1 text-base text-ink-muted">
        <p className="flex items-start gap-2">
          <MapPin className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <span>
            <span className="sr-only">สถานที่: </span>
            {slot.venue || NO_LESSON_VENUE}
          </span>
        </p>
        {slot.coach ? (
          <p className="flex items-start gap-2">
            <CoachIcon className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            <span>ผู้สอน {slot.coach}</span>
          </p>
        ) : null}
      </div>

      {waitlisted ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-bg px-3 py-2.5 text-base text-warning">
          <WaitlistIcon className="mt-1 size-4 shrink-0" aria-hidden="true" />
          มีคนยกเลิกเมื่อไร จะแจ้งให้กดยืนยันรับที่นั่ง
        </p>
      ) : null}

      {offered && actions.canConfirmOffer && booking.offerExpiresAt ? (
        <div className="mt-3 rounded-lg border border-info/20 bg-info-bg p-4 text-info">
          <p className="text-base font-semibold">มีที่ว่างให้คุณ กดยืนยันภายใน {formatThaiDateTime(booking.offerExpiresAt)}</p>
          <p className="mt-1 text-sm">
            เหลือเวลา <LessonBookingCountdown openAt={booking.offerExpiresAt} /> ไม่ยืนยันทันเวลา ที่นั่งจะส่งต่อให้คนถัดไป
          </p>
          <form action={confirmLessonOffer} className="mt-3">
            <input name="bookingId" type="hidden" value={booking.id} />
            <input name="returnTo" type="hidden" value="/member/lessons" />
            <SubmitButton className={`${buttonClass("primary", "lg")} w-full sm:w-fit`} disabled={demo} pendingText="กำลังยืนยัน...">
              <Check className="size-5" aria-hidden="true" />
              ยืนยันรับที่นั่ง
            </SubmitButton>
          </form>
        </div>
      ) : null}

      {actions.canChange || actions.canCancel || showCalendar ? (
        <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
          {actions.canChange && changeHref ? (
            <Link className={`${buttonClass("secondary", "lg")} w-full sm:w-auto`} href={changeHref}>
              <RescheduleIcon className="size-4" aria-hidden="true" />
              เปลี่ยนรอบ
            </Link>
          ) : null}
          {showCalendar ? (
            <a className={`${buttonClass("secondary", "lg")} w-full sm:w-auto`} href={`/api/calendar/lesson/${booking.id}`}>
              <CalendarPlus className="size-4" aria-hidden="true" />
              เพิ่มลงปฏิทิน
            </a>
          ) : null}
          {actions.canCancel ? (
            <form action={cancelLessonBooking} className="w-full sm:w-auto">
              <input name="bookingId" type="hidden" value={booking.id} />
              <input name="returnTo" type="hidden" value="/member/lessons" />
              {actions.lateCancel ? <input name="acceptLate" type="hidden" value="on" /> : null}
              <ConfirmSubmitButton
                className={`${buttonClass("danger", "lg")} w-full`}
                confirmLabel={actions.lateCancel ? "ยกเลิก ไม่คืนเครดิต" : cancelLabel}
                details={cancelDetails}
                disabled={demo}
                message={`${cancelLabel} รอบ ${when} ใช่หรือไม่`}
                title={actions.lateCancel ? "ยกเลิกช้า" : cancelLabel}
              >
                {cancelLabel}
              </ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}

      {status === "booked" && actions.ahead ? (
        <p className="mt-2 text-sm text-ink-muted">
          {actions.cancelLocked
            ? "เลยกำหนดยกเลิกแล้ว ถ้ามาไม่ได้ให้แจ้งผู้ดูแล"
            : actions.lateCancel
              ? "เลยกำหนดยกเลิกคืนเครดิตแล้ว ยกเลิกตอนนี้ไม่คืนเครดิต"
              : `${booking.creditHeld ? "ยกเลิกคืนเครดิตได้ถึง" : "ยกเลิกได้ถึง"} ${formatThaiDateTime(actions.cancelDeadline.toISOString())}`}
          {actions.canChange ? ` · เปลี่ยนรอบได้ถึง ${formatThaiDateTime(actions.changeDeadline.toISOString())}` : ""}
        </p>
      ) : null}
    </article>
  );
}
