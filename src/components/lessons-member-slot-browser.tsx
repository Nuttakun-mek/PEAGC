"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, MapPin, RefreshCw, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { bookLessonSlot, changeLessonSlot } from "@/app/member/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { formatThaiDateLong, formatThaiDateShort } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { lessonStartAt } from "@/lib/lessons/booking";
import { pickEnrollment } from "@/lib/lessons/credits";
import { formatCredits, lessonBookingStatusLabel } from "@/lib/lessons/labels";
import {
  type BookingEligibility,
  type BrowserSlot,
  type SlotAvailability,
  type TimeOfDay,
  dayStrip,
  slotAvailability,
  slotBlocker,
  slotBlockerLabels,
  slotSeats,
  slotSeatsText,
  timeOfDay,
  timeOfDayLabels,
} from "@/lib/lessons/member-view";
import type { LessonBookingStatus } from "@/lib/lessons/types";
import type { StatusTone } from "@/lib/status";
import { createClient } from "@/lib/supabase/client";

const CalendarIcon = appIcons.calendar;
const CoachIcon = appIcons.coach;
const RescheduleIcon = appIcons.reschedule;
const WaitlistIcon = appIcons.waitlist;

export type MySlotBooking = { bookingId: string; rank: number | null; status: LessonBookingStatus };

export type MovingBooking = {
  bookingId: string;
  /** "พ. 25 พ.ย. 69 16:30–17:30 น." */
  label: string;
  slotId: string;
};

const availabilityBadge: Record<Exclude<SlotAvailability, "closed" | "started">, { label: string; tone: StatusTone }> = {
  book: { label: "ว่าง", tone: "info" },
  full: { label: "เต็ม", tone: "warning" },
  waitlist: { label: "เต็ม · มีคิวสำรอง", tone: "warning" },
};

const periods: Array<TimeOfDay | "all"> = ["all", "morning", "afternoon", "evening"];

const fillBar: Record<StatusTone, string> = {
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-neutral",
  success: "bg-success",
  warning: "bg-warning",
};

function chipClass(active: boolean) {
  return `inline-flex h-11 shrink-0 items-center justify-center rounded-full border px-4 text-base font-medium transition ${
    active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-ink hover:border-brand-600/50"
  }`;
}

/**
 * "รอบเรียนที่เปิดจอง" on /member/lessons: pick a day from the strip, narrow by time of day, coach
 * and course, then book, join the waitlist (คิวสำรอง) or move an existing booking here. Seat counts
 * update live. Every action asks once before it is sent.
 */
export function LessonsMemberSlotBrowser({
  demo,
  eligibility,
  mine,
  moving,
  packagesHref,
  rulesNote,
  slots: initialSlots,
  today,
}: {
  demo: boolean;
  eligibility: BookingEligibility;
  /** slot id → the member's own booking in it */
  mine: Record<string, MySlotBooking>;
  /** choosing a new slot for this booking (from "เปลี่ยนรอบ") */
  moving: (MovingBooking & { cancelHref: string }) | null;
  /** link to the package list when the club sells packages */
  packagesHref: string | null;
  /** one line of the club rules for the confirm dialog, e.g. "ยกเลิกก่อนเรียน 24 ชม. คืนเครดิต" */
  rulesNote: string | null;
  slots: BrowserSlot[];
  today: string;
}) {
  const router = useRouter();
  const [slots, setSlots] = useState(initialSlots);
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState(false);
  const [period, setPeriod] = useState<TimeOfDay | "all">("all");
  const [coach, setCoach] = useState("all");
  const [course, setCourse] = useState("all");
  const [onlyOpen, setOnlyOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    if (demo) return () => window.clearInterval(timer);
    const supabase = createClient();
    const channel = supabase
      .channel("member-lesson-browser")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lesson_slots" }, (payload) => {
        const next = payload.new as {
          booked_count?: number;
          capacity?: number;
          id?: string;
          seats_taken?: number;
          status?: string;
          waitlist_capacity?: number;
          waitlist_count?: number;
        };
        if (!next.id) return;
        setSlots((items) =>
          items.map((item) =>
            item.id === next.id
              ? {
                  ...item,
                  bookedCount: next.booked_count ?? item.bookedCount,
                  capacity: next.capacity ?? item.capacity,
                  seatsTaken: next.seats_taken ?? item.seatsTaken,
                  status: next.status ?? item.status,
                  waitlistCapacity: next.waitlist_capacity ?? item.waitlistCapacity,
                  waitlistCount: next.waitlist_count ?? item.waitlistCount,
                }
              : item,
          ),
        );
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [demo]);

  // Rounds that already started are hidden unless the member holds them.
  const upcoming = useMemo(
    () => slots.filter((slot) => mine[slot.id] || lessonStartAt(slot.date, slot.startTime).getTime() > now),
    [slots, mine, now],
  );
  const strip = useMemo(
    () =>
      dayStrip(
        upcoming.map((slot) => {
          const availability = slotAvailability(slot, now);
          return { bookable: availability === "book" || availability === "waitlist", date: slot.date };
        }),
        today,
      ),
    [upcoming, now, today],
  );
  const firstDay = strip.find((day) => day.slots > 0)?.date ?? "all";
  const [selectedDate, setSelectedDate] = useState<string>(() => (upcoming.length > 12 ? firstDay : "all"));

  const coaches = useMemo(() => [...new Set(upcoming.map((slot) => slot.coach).filter((name): name is string => Boolean(name)))].sort(), [upcoming]);
  const courses = useMemo(
    () => [...new Map(upcoming.filter((slot) => slot.programId).map((slot) => [slot.programId as string, slot.program])).entries()],
    [upcoming],
  );

  const visible = upcoming.filter((slot) => {
    if (selectedDate !== "all" && slot.date !== selectedDate) return false;
    if (period !== "all" && timeOfDay(slot.startTime) !== period) return false;
    if (coach !== "all" && slot.coach !== coach) return false;
    if (course !== "all" && slot.programId !== course) return false;
    if (onlyOpen && !mine[slot.id]) {
      const availability = slotAvailability(slot, now);
      if (availability !== "book" && availability !== "waitlist") return false;
    }
    return true;
  });
  const dates = [...new Set(visible.map((slot) => slot.date))].sort();
  const filtered = period !== "all" || coach !== "all" || course !== "all" || onlyOpen;

  function resetFilters() {
    setPeriod("all");
    setCoach("all");
    setCourse("all");
    setOnlyOpen(false);
  }

  return (
    <div className="grid gap-4">
      {moving ? (
        <div className="rounded-lg border border-brand-600/30 bg-brand-50 p-4">
          <p className="flex items-start gap-2 text-base font-semibold text-ink">
            <RescheduleIcon className="mt-1 size-4 shrink-0 text-brand-600" aria-hidden="true" />
            เลือกรอบใหม่แทนรอบ {moving.label}
          </p>
          <p className="mt-1 text-sm text-ink-muted">กด “ย้ายมารอบนี้” ที่รอบที่ต้องการ รอบเดิมจะถูกยกเลิกให้</p>
          <a className={`${buttonClass("secondary", "md")} mt-3`} href={moving.cancelHref}>
            ไม่เปลี่ยนรอบ
          </a>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-sm font-medium text-ink-muted" id="lesson-day-label">
          เลือกวัน
        </p>
        <div aria-labelledby="lesson-day-label" className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2" role="group">
          <button
            aria-pressed={selectedDate === "all"}
            className={`flex h-[4.5rem] w-16 shrink-0 snap-start flex-col items-center justify-center rounded-xl border text-sm font-semibold ${
              selectedDate === "all" ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-ink"
            }`}
            onClick={() => setSelectedDate("all")}
            type="button"
          >
            ทุกวัน
          </button>
          {strip.map((day) => {
            const active = selectedDate === day.date;
            const empty = day.slots === 0;
            return (
              <button
                aria-label={`${formatThaiDateLong(day.date)} ${empty ? "ไม่มีรอบ" : `${day.slots} รอบ ว่าง ${day.open} รอบ`}`}
                aria-pressed={active}
                className={`flex h-[4.5rem] w-16 shrink-0 snap-start flex-col items-center justify-center rounded-xl border ${
                  active
                    ? "border-brand-600 bg-brand-600 text-white"
                    : empty
                      ? "border-line bg-canvas text-ink-subtle"
                      : "border-line bg-white text-ink hover:border-brand-600/50"
                }`}
                key={day.date}
                onClick={() => setSelectedDate(day.date)}
                type="button"
              >
                <span className="text-xs font-medium">{day.isToday ? "วันนี้" : day.weekday}</span>
                <span className="text-h3 font-semibold tabular-nums leading-6">{day.dayOfMonth}</span>
                <span className={`text-xs tabular-nums ${active ? "text-white" : empty ? "text-ink-subtle" : "text-ink-muted"}`}>
                  {empty ? day.month : `${day.slots} รอบ`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3">
        <div aria-label="ช่วงเวลา" className="flex gap-2 overflow-x-auto pb-1" role="group">
          {periods.map((item) => (
            <button aria-pressed={period === item} className={chipClass(period === item)} key={item} onClick={() => setPeriod(item)} type="button">
              {item === "all" ? "ทุกช่วงเวลา" : timeOfDayLabels[item]}
            </button>
          ))}
        </div>
        {coaches.length > 1 || courses.length > 1 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {coaches.length > 1 ? (
              <div>
                <label className={fieldLabel} htmlFor="lesson-filter-coach">
                  ผู้สอน
                </label>
                <select className={fieldInputClass("lg")} id="lesson-filter-coach" onChange={(event) => setCoach(event.target.value)} value={coach}>
                  <option value="all">ผู้สอนทุกคน</option>
                  {coaches.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {courses.length > 1 ? (
              <div>
                <label className={fieldLabel} htmlFor="lesson-filter-course">
                  คอร์ส
                </label>
                <select className={fieldInputClass("lg")} id="lesson-filter-course" onChange={(event) => setCourse(event.target.value)} value={course}>
                  <option value="all">ทุกคอร์ส</option>
                  {courses.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex min-h-11 items-center gap-3 text-base text-ink">
            <input checked={onlyOpen} className="size-5 accent-brand-600" onChange={(event) => setOnlyOpen(event.target.checked)} type="checkbox" />
            เฉพาะรอบที่ยังจองได้
          </label>
          <div className="flex items-center gap-3 text-sm text-ink-muted">
            {!demo ? (
              <span className="flex items-center gap-1.5">
                <span className={`size-2 rounded-full ${live ? "bg-success" : "bg-warning"}`} aria-hidden="true" />
                {live ? "ที่นั่งอัปเดตสด" : "กำลังเชื่อมต่อ"}
              </span>
            ) : null}
            <button className={buttonClass("secondary", "sm")} onClick={() => router.refresh()} type="button">
              <RefreshCw className="size-4" aria-hidden="true" /> รีเฟรช
            </button>
          </div>
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-ink-muted">
        {visible.length ? `พบ ${visible.length} รอบ` : null}
      </p>

      {!dates.length ? (
        <div className="rounded-lg bg-canvas px-4 py-6 text-center">
          <p className="text-base text-ink-muted">
            {upcoming.length ? "ไม่มีรอบที่ตรงกับที่เลือก" : "ยังไม่มีรอบเรียนที่เปิดจอง ติดตามประกาศจากชมรม"}
          </p>
          {upcoming.length && (filtered || selectedDate !== "all") ? (
            <button
              className={`${buttonClass("secondary", "md")} mt-3`}
              onClick={() => {
                resetFilters();
                setSelectedDate("all");
              }}
              type="button"
            >
              ดูทุกรอบ
            </button>
          ) : null}
        </div>
      ) : null}

      {dates.map((date) => (
        <section aria-label={formatThaiDateLong(date)} className="grid gap-3" key={date}>
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
            <CalendarIcon className="size-4 text-ink-subtle" aria-hidden="true" />
            {formatThaiDateLong(date)}
          </h3>
          {visible
            .filter((slot) => slot.date === date)
            .map((slot) => (
              <SlotCard
                demo={demo}
                eligibility={eligibility}
                key={slot.id}
                mine={mine[slot.id] ?? null}
                moving={moving}
                now={now}
                packagesHref={packagesHref}
                rulesNote={rulesNote}
                slot={slot}
              />
            ))}
        </section>
      ))}
    </div>
  );
}

function SlotCard({
  demo,
  eligibility,
  mine,
  moving,
  now,
  packagesHref,
  rulesNote,
  slot,
}: {
  demo: boolean;
  eligibility: BookingEligibility;
  mine: MySlotBooking | null;
  moving: MovingBooking | null;
  now: number;
  packagesHref: string | null;
  rulesNote: string | null;
  slot: BrowserSlot;
}) {
  const availability = slotAvailability(slot, now);
  const seats = slotSeats(slot);
  const open = availability === "book" || availability === "waitlist";
  const isMovingFrom = moving?.slotId === slot.id;
  const blocker = open && !mine ? slotBlocker(slot, eligibility, { moving: Boolean(moving), now }) : null;
  const timeRange = formatTimeRange(slot.startTime, slot.endTime);
  const when = `${formatThaiDateShort(slot.date)} ${timeRange}`;
  const credit =
    slot.requiresPackage && eligibility.enrollments
      ? pickEnrollment(eligibility.enrollments, { lessonStart: lessonStartAt(slot.date, slot.startTime), programId: slot.programId }, now)
      : null;
  const badge = mine
    ? null
    : availability === "closed"
      ? { label: "ปิดรับรอบนี้", tone: "neutral" as const }
      : availability === "started"
        ? { label: "เริ่มเรียนแล้ว", tone: "neutral" as const }
        : availabilityBadge[availability];

  const summary = (
    <dl className="grid gap-1.5 rounded-lg bg-canvas p-3">
      <div>
        <dt className="sr-only">รอบเรียน</dt>
        <dd className="font-semibold text-ink">{slot.title}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-ink-subtle">วันที่</dt>
        <dd>{formatThaiDateLong(slot.date)}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-ink-subtle">เวลา</dt>
        <dd className="tabular-nums">{timeRange}</dd>
      </div>
      {slot.coach ? (
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-ink-subtle">ผู้สอน</dt>
          <dd>{slot.coach}</dd>
        </div>
      ) : null}
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-ink-subtle">สถานที่</dt>
        <dd>{slot.venue || "รอแจ้งสนาม"}</dd>
      </div>
    </dl>
  );

  return (
    <article
      className={`rounded-xl border p-4 ${mine ? "border-gold-500 bg-gold-500/10" : open ? "border-line bg-white" : "border-line bg-canvas"}`}
      id={`slot-${slot.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-h3 font-semibold tabular-nums text-ink">{timeRange}</p>
          <p className="mt-0.5 text-base text-ink">{slot.title}</p>
          {slot.program && slot.program !== slot.title ? <p className="text-sm text-ink-muted">{slot.program}</p> : null}
        </div>
        {mine ? (
          <StatusBadge className="shrink-0" kind="booking" status={mine.status}>
            {mine.status === "waitlist" && mine.rank ? `คิวสำรอง ลำดับ ${mine.rank}` : lessonBookingStatusLabel(mine.status)}
          </StatusBadge>
        ) : badge ? (
          <StatusBadge className="shrink-0" tone={badge.tone}>
            {badge.label}
          </StatusBadge>
        ) : null}
      </div>

      <div className="mt-2 grid gap-1 text-base text-ink-muted">
        {slot.coach ? (
          <p className="flex items-start gap-2">
            <CoachIcon className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            <span>ผู้สอน {slot.coach}</span>
          </p>
        ) : null}
        <p className="flex items-start gap-2">
          <MapPin className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <span>
            <span className="sr-only">สถานที่: </span>
            {slot.venue || "รอแจ้งสนาม"}
          </span>
        </p>
        <p className="flex items-start gap-2 tabular-nums">
          <UsersRound className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          {slotSeatsText(slot)}
        </p>
      </div>
      <div
        aria-hidden="true"
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
        title={`ที่นั่ง ${seats.taken}/${seats.capacity}`}
      >
        <div className={`h-full rounded-full ${fillBar[seats.tone]}`} style={{ width: `${seats.percent}%` }} />
      </div>

      <div className="mt-4">
        {mine ? (
          <a className={`${buttonClass("secondary", "lg")} w-full sm:w-auto`} href={`#booking-${mine.bookingId}`}>
            {isMovingFrom ? "รอบเดิมของคุณ" : "ดูการจองของฉัน"}
          </a>
        ) : !open ? (
          <p className="text-base text-ink-muted">{availability === "full" ? "เต็มแล้ว คิวสำรองก็เต็ม" : "จองรอบนี้ไม่ได้แล้ว"}</p>
        ) : blocker ? (
          <p className="text-base text-ink-muted">
            {slotBlockerLabels[blocker]}
            {blocker === "need-credit" && packagesHref ? (
              <>
                {" "}
                <a className="font-semibold text-brand-600 underline underline-offset-4" href={packagesHref}>
                  ซื้อแพ็กเกจ
                </a>
              </>
            ) : null}
          </p>
        ) : moving ? (
          <form action={changeLessonSlot}>
            <input name="bookingId" type="hidden" value={moving.bookingId} />
            <input name="slotId" type="hidden" value={slot.id} />
            <input name="returnTo" type="hidden" value="/member/lessons" />
            <ConfirmSubmitButton
              className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}
              confirmLabel="ย้ายรอบ"
              details={
                <>
                  <p className="mb-2">
                    จากรอบ <span className="font-semibold text-ink">{moving.label}</span>
                  </p>
                  {summary}
                  {availability === "waitlist" ? <p className="mt-2 font-medium text-warning">รอบนี้เต็มแล้ว จะได้อยู่คิวสำรอง</p> : null}
                </>
              }
              disabled={demo}
              message={`ย้ายไปรอบ ${when} ใช่หรือไม่`}
              title="ยืนยันเปลี่ยนรอบ"
              tone="primary"
            >
              <RescheduleIcon className="size-4" aria-hidden="true" />
              ย้ายมารอบนี้
            </ConfirmSubmitButton>
          </form>
        ) : (
          <form action={bookLessonSlot}>
            <input name="slotId" type="hidden" value={slot.id} />
            <input name="returnTo" type="hidden" value="/member/lessons" />
            <ConfirmSubmitButton
              className={`${buttonClass(availability === "waitlist" ? "gold" : "primary", "lg")} w-full sm:w-auto`}
              confirmLabel={availability === "waitlist" ? "เข้าคิวสำรอง" : "จองรอบนี้"}
              details={
                <>
                  {summary}
                  {availability === "waitlist" ? (
                    <p className="mt-2">รอบนี้เต็มแล้ว มีคนยกเลิกเมื่อไร จะแจ้งให้กดยืนยันรับที่นั่ง{credit ? " ยังไม่ตัดเครดิตจนกว่าจะได้ที่นั่ง" : ""}</p>
                  ) : credit ? (
                    <p className="mt-2">
                      ใช้เครดิต 1 ครั้งจาก “{credit.package_name}”{" "}
                      {credit.credits_remaining > 1 ? `เหลือ ${formatCredits(credit.credits_remaining - 1)}` : "(ครั้งสุดท้ายของแพ็กเกจนี้)"}
                    </p>
                  ) : null}
                  {rulesNote ? <p className="mt-2 text-ink-subtle">{rulesNote}</p> : null}
                </>
              }
              disabled={demo}
              message={availability === "waitlist" ? "เข้าคิวสำรองรอบนี้ใช่หรือไม่" : "ตรวจรายละเอียดก่อนจอง"}
              title={availability === "waitlist" ? "ยืนยันเข้าคิวสำรอง" : "ยืนยันการจอง"}
              tone="primary"
            >
              {availability === "waitlist" ? (
                <>
                  <WaitlistIcon className="size-4" aria-hidden="true" />
                  เข้าคิวสำรอง
                </>
              ) : (
                <>
                  <Check className="size-4" aria-hidden="true" />
                  จองรอบนี้
                </>
              )}
            </ConfirmSubmitButton>
          </form>
        )}
      </div>
    </article>
  );
}
