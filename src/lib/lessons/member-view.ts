// Member lesson screens (/member/lessons and the summary on /member): pure view logic shared by
// the server pages and the client slot browser. Works on lessons v2 data and on the older v1
// schema, where the waitlist was "booked beyond capacity" and there were no credits or offers.
// Relative imports: keep this file free of server-only code so vitest and client components can use it.
import { addDays, type BookingPhase, getBookingPhase, lessonStartAt, weekdayOf } from "./booking";
import { slotFill } from "./calendar";
import { coversProgram, isUsableEnrollment, type CreditEnrollment } from "./credits";
import type { LessonBookingStatus, SkillLevel } from "./types";

/** One of the member's bookings with the slot it is for (v1 and v2 rows normalised). */
export type MemberBooking = {
  bookedAt: string | null;
  checkedInAt: string | null;
  /** v2: the booking holds a credit (refunded on a timely cancel) */
  creditHeld: boolean;
  id: string;
  offerExpiresAt: string | null;
  /** seat 1..capacity, capacity+1.. on the waitlist; null when unknown */
  position: number | null;
  /** คิวสำรองลำดับ (1-based) while waitlisted */
  rank: number | null;
  slot: {
    allowReschedule: boolean;
    capacity: number;
    coach: string | null;
    date: string;
    endTime: string;
    id: string;
    program: string | null;
    programId: string | null;
    rescheduleCutoffHours: number | null;
    startTime: string;
    status: string;
    title: string;
    venue: string | null;
  };
  status: LessonBookingStatus;
};

/** A coach note the member may read (lesson_coach_notes, visible_to_member). */
export type MemberCoachNote = {
  bookingId: string | null;
  coach: string | null;
  createdAt: string;
  id: string;
  note: string;
  skillLevel: SkillLevel | null;
  videoUrl: string | null;
};

// ---------- time of day ----------

export type TimeOfDay = "morning" | "afternoon" | "evening";

export const timeOfDayLabels: Record<TimeOfDay, string> = {
  afternoon: "บ่าย",
  evening: "เย็น",
  morning: "เช้า",
};

/** Before 12:00 = เช้า, 12:00–15:59 = บ่าย, from 16:00 = เย็น (after-work lessons). */
export function timeOfDay(startTime: string): TimeOfDay {
  const hour = Number(startTime.slice(0, 2));
  if (hour < 12) return "morning";
  if (hour < 16) return "afternoon";
  return "evening";
}

// ---------- unit targeting (same rule as SQL _lesson_target_match) ----------

type Targets = {
  target_bureaus?: string[] | null;
  target_departments?: string[] | null;
  target_divisions?: string[] | null;
  target_sections?: string[] | null;
  target_work_lines?: string[] | null;
};

type MemberUnits = {
  bureau?: string | null;
  department?: string | null;
  division?: string | null;
  section?: string | null;
  work_line?: string | null;
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function matchesList(targets: string[] | null | undefined, value: string | null | undefined) {
  if (!targets?.length) return true;
  const mine = normalize(value);
  return targets.some((target) => normalize(target) === mine);
}

/** A slot with target units is only offered to members of those units (empty list = everyone). */
export function matchesMemberTargets(item: Targets, member: MemberUnits | null | undefined) {
  return (
    matchesList(item.target_work_lines, member?.work_line) &&
    matchesList(item.target_bureaus, member?.bureau) &&
    matchesList(item.target_divisions, member?.division) &&
    matchesList(item.target_departments, member?.department) &&
    matchesList(item.target_sections, member?.section)
  );
}

// ---------- bookings ----------

/**
 * Status to show for a booking. v1 databases have no 'waitlist' status: a 'booked' row beyond
 * the slot's capacity is on the waitlist.
 */
export function effectiveBookingStatus(status: string, position: number | null | undefined, capacity: number): LessonBookingStatus {
  if (status === "booked" && typeof position === "number" && position > capacity) return "waitlist";
  return status as LessonBookingStatus;
}

/** คิวสำรองลำดับที่ … (1-based) for a waitlisted booking, else null. */
export function waitlistRank(status: string, position: number | null | undefined, capacity: number) {
  if (typeof position !== "number") return null;
  if (status === "waitlist" || (status === "booked" && position > capacity)) return Math.max(1, position - capacity);
  return null;
}

export type BookingRuleInput = {
  allowReschedule?: boolean | null;
  date: string;
  endTime: string;
  /** slot.reschedule_cutoff_hours (falls back to the club's change cutoff) */
  rescheduleCutoffHours?: number | null;
  startTime: string;
  status: LessonBookingStatus;
  offerExpiresAt?: string | null;
};

export type BookingRuleContext = {
  cancelCutoffHours: number;
  changeCutoffHours: number;
  now?: number;
  /** lessons v2 database: late cancel (no refund), explicit waitlist and offers exist */
  v2: boolean;
};

export type BookingActions = {
  /** lesson has not started */
  ahead: boolean;
  canCancel: boolean;
  canChange: boolean;
  canConfirmOffer: boolean;
  cancelDeadline: Date;
  /** v1 only: seat holder after the cutoff cannot cancel online */
  cancelLocked: boolean;
  changeDeadline: Date;
  /** cancelling now keeps the credit (v2 "ยกเลิกช้า") */
  lateCancel: boolean;
};

const HOUR = 3_600_000;

/** What the member may still do with one booking (mirrors the cancel / change / confirm RPCs). */
export function bookingActions(booking: BookingRuleInput, context: BookingRuleContext): BookingActions {
  const now = context.now ?? Date.now();
  const start = lessonStartAt(booking.date, booking.startTime).getTime();
  const ahead = start > now;
  const upcoming = booking.status === "booked" || booking.status === "waitlist" || booking.status === "offered";
  const cancelDeadline = new Date(start - Math.max(0, context.cancelCutoffHours) * HOUR);
  const changeCutoff = booking.rescheduleCutoffHours ?? context.changeCutoffHours;
  const changeDeadline = new Date(start - Math.max(0, changeCutoff) * HOUR);
  const pastCancelCutoff = now > cancelDeadline.getTime();
  const late = booking.status === "booked" && pastCancelCutoff;

  const canCancel = upcoming && ahead && (context.v2 || !late);
  const seatRuleApplies = booking.status === "booked" || !context.v2;
  const canChange =
    upcoming &&
    ahead &&
    (!seatRuleApplies || (booking.allowReschedule !== false && now <= changeDeadline.getTime()));
  const canConfirmOffer =
    context.v2 &&
    booking.status === "offered" &&
    ahead &&
    Boolean(booking.offerExpiresAt) &&
    Date.parse(booking.offerExpiresAt as string) > now;

  return {
    ahead,
    canCancel,
    canChange,
    canConfirmOffer,
    cancelDeadline,
    cancelLocked: upcoming && ahead && !context.v2 && late,
    changeDeadline,
    lateCancel: context.v2 && canCancel && late,
  };
}

/** "เหลือ 1 ชม. 20 นาที", "เหลือ 5 นาที", "หมดเวลาแล้ว" until an offer expires. */
export function offerTimeLeft(expiresAt: string | null | undefined, now: number = Date.now()) {
  if (!expiresAt) return "หมดเวลาแล้ว";
  const minutes = Math.floor((Date.parse(expiresAt) - now) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return "หมดเวลาแล้ว";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `เหลือ ${rest} นาที`;
  return rest ? `เหลือ ${hours} ชม. ${rest} นาที` : `เหลือ ${hours} ชม.`;
}

// ---------- slots ----------

export type BrowserSlot = {
  /** lesson_slots.booked_count (v1: seats + waitlist) */
  bookedCount: number;
  capacity: number;
  coach: string | null;
  coachId: string | null;
  date: string;
  endTime: string;
  id: string;
  program: string;
  programId: string | null;
  /** course needs a lesson package (credit) */
  requiresPackage: boolean;
  /** v2 trigger-maintained counts; null on v1 databases */
  seatsTaken: number | null;
  startTime: string;
  status: string;
  title: string;
  venue: string | null;
  waitlistCapacity: number;
  waitlistCount: number | null;
};

export type SlotAvailability = "book" | "waitlist" | "full" | "closed" | "started";

/** Seats / waitlist of a slot for the member list. */
export function slotSeats(slot: Pick<BrowserSlot, "bookedCount" | "capacity" | "seatsTaken" | "status" | "waitlistCapacity" | "waitlistCount">) {
  const fill = slotFill({
    booked_count: slot.bookedCount,
    capacity: slot.capacity,
    seats_taken: slot.seatsTaken,
    status: slot.status,
    waitlist_count: slot.waitlistCount,
  });
  const waitlistFree = Math.max(0, slot.waitlistCapacity - fill.waitlist);
  return { ...fill, waitlistFree };
}

export function slotAvailability(slot: BrowserSlot, now: number = Date.now()): SlotAvailability {
  if (slot.status !== "open") return "closed";
  if (lessonStartAt(slot.date, slot.startTime).getTime() <= now) return "started";
  const seats = slotSeats(slot);
  if (seats.free > 0) return "book";
  if (seats.waitlistFree > 0) return "waitlist";
  return "full";
}

/** "ว่าง 2 จาก 4 ที่", "เต็ม · คิวสำรอง 1/2 คน", "เต็ม (คิวสำรองเต็มแล้ว)". */
export function slotSeatsText(slot: Parameters<typeof slotSeats>[0]) {
  const seats = slotSeats(slot);
  if (seats.free > 0) {
    return `ว่าง ${seats.free} จาก ${seats.capacity} ที่${seats.waitlist ? ` · คิวสำรอง ${seats.waitlist} คน` : ""}`;
  }
  if (slot.waitlistCapacity > 0) {
    return seats.waitlistFree > 0
      ? `เต็ม · คิวสำรอง ${seats.waitlist}/${slot.waitlistCapacity} คน`
      : "เต็ม (คิวสำรองเต็มแล้ว)";
  }
  return "เต็มแล้ว";
}

export type SlotBlocker =
  | "not-active"
  | "not-open"
  | "window-closed"
  | "blocked"
  | "limit"
  | "need-credit"
  | "announcement";

export type BookingEligibility = {
  /** the member's own credits (v2); null = credits not used (v1 or no packages) */
  enrollments: readonly CreditEnrollment[] | null;
  /** member status is active (can book at all) */
  isActive: boolean;
  /** booked + waitlist + offered not yet started (my_lesson_overview.active_bookings) */
  activeBookings: number;
  maxActiveBookings: number;
  mustAckAnnouncement: boolean;
  noShowBlockedUntil: string | null;
  phase: BookingPhase;
};

/**
 * Why the member cannot book (or join the waitlist of) a slot that has room, or null.
 * `moving` = choosing a new slot for an existing booking: the limit and the credit check do not
 * apply (change_lesson_booking keeps the credit the booking already holds).
 */
export function slotBlocker(
  slot: Pick<BrowserSlot, "date" | "programId" | "requiresPackage" | "startTime">,
  eligibility: BookingEligibility,
  options: { moving?: boolean; now?: number } = {},
): SlotBlocker | null {
  const now = options.now ?? Date.now();
  if (!eligibility.isActive) return "not-active";
  if (eligibility.mustAckAnnouncement) return "announcement";
  if (eligibility.phase === "before" || eligibility.phase === "unset") return "not-open";
  if (eligibility.phase === "after") return "window-closed";
  if (eligibility.noShowBlockedUntil && Date.parse(eligibility.noShowBlockedUntil) > now) return "blocked";
  if (options.moving) return null;
  if (eligibility.maxActiveBookings > 0 && eligibility.activeBookings >= eligibility.maxActiveBookings) return "limit";
  if (slot.requiresPackage && eligibility.enrollments) {
    const lessonStart = lessonStartAt(slot.date, slot.startTime).getTime();
    const covered = eligibility.enrollments.some(
      (item) =>
        isUsableEnrollment(item, now) &&
        coversProgram(item, slot.programId) &&
        Date.parse(item.expires_at as string) > lessonStart,
    );
    if (!covered) return "need-credit";
  }
  return null;
}

export const slotBlockerLabels: Record<SlotBlocker, string> = {
  announcement: "กดรับทราบประกาศก่อนจอง",
  blocked: "งดจองชั่วคราว (ขาดเรียนเกินกำหนด)",
  limit: "จองค้างครบจำนวนแล้ว",
  "need-credit": "ต้องมีเครดิตเรียนก่อนจอง",
  "not-active": "จองได้เมื่อสมาชิกได้รับการอนุมัติ",
  "not-open": "ยังไม่เปิดจอง",
  "window-closed": "ปิดจองแล้ว",
};

/** Booking phase for this member: employees may start `employee_priority_days` earlier (v2 overview). */
export function memberBookingPhase(
  settings: { booking_close_at: string | null; booking_open_at: string | null },
  personalOpenAt: string | null | undefined,
  now: number = Date.now(),
): BookingPhase {
  return getBookingPhase(
    { booking_close_at: settings.booking_close_at, booking_open_at: personalOpenAt ?? settings.booking_open_at },
    now,
  );
}

// ---------- day strip ----------

const weekdayShort = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."] as const;
const monthShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;

export type StripDay = {
  date: string;
  dayOfMonth: number;
  isToday: boolean;
  month: string;
  /** rounds that day */
  slots: number;
  /** rounds that still take bookings or waitlist */
  open: number;
  weekday: string;
};

/**
 * Days from `today` for the date picker: always `minDays` days, extended to the last date that
 * has a round (capped at `maxDays`).
 */
export function dayStrip(
  slots: ReadonlyArray<Pick<BrowserSlot, "date"> & { bookable?: boolean }>,
  today: string,
  { maxDays = 42, minDays = 14 }: { maxDays?: number; minDays?: number } = {},
): StripDay[] {
  const counts = new Map<string, { open: number; slots: number }>();
  let last = addDays(today, minDays - 1);
  const cap = addDays(today, maxDays - 1);
  for (const slot of slots) {
    if (slot.date < today || slot.date > cap) continue;
    const entry = counts.get(slot.date) ?? { open: 0, slots: 0 };
    entry.slots += 1;
    if (slot.bookable !== false) entry.open += 1;
    counts.set(slot.date, entry);
    if (slot.date > last) last = slot.date;
  }
  const days: StripDay[] = [];
  for (let date = today; date <= last; date = addDays(date, 1)) {
    const entry = counts.get(date) ?? { open: 0, slots: 0 };
    days.push({
      date,
      dayOfMonth: Number(date.slice(8, 10)),
      isToday: date === today,
      month: monthShort[Number(date.slice(5, 7)) - 1],
      open: entry.open,
      slots: entry.slots,
      weekday: weekdayShort[weekdayOf(date)],
    });
  }
  return days;
}

// ---------- history ----------

export const historyStatuses: readonly LessonBookingStatus[] = ["attended", "no_show", "late_cancelled", "closed"];

/** Past lessons for "ประวัติการเรียน": attended / no-show (and late cancels, club closures), newest first. */
export function isHistoryStatus(status: string) {
  return (historyStatuses as readonly string[]).includes(status);
}

/** Notes grouped by booking id (newest first inside each group). */
export function notesByBooking<T extends Pick<MemberCoachNote, "bookingId" | "createdAt">>(notes: readonly T[]) {
  const map = new Map<string, T[]>();
  for (const note of [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!note.bookingId) continue;
    const list = map.get(note.bookingId) ?? [];
    list.push(note);
    map.set(note.bookingId, list);
  }
  return map;
}

// ---------- return paths for member lesson actions ----------

export const lessonReturnPaths = ["/member", "/member/lessons"] as const;
export type LessonReturnPath = (typeof lessonReturnPaths)[number];

/** Only the two member lesson screens are valid `returnTo` values (no open redirects). */
export function lessonReturnPath(value: unknown): LessonReturnPath {
  return typeof value === "string" && (lessonReturnPaths as readonly string[]).includes(value)
    ? (value as LessonReturnPath)
    : "/member";
}
