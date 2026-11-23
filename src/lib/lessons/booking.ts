// Pure helpers for the lesson booking flow (FCFS queue, waitlist, booking window).
// Shared by the member portal, admin pages, and server actions. No I/O here.

// Relative import: vitest has no "@/" alias configured.
import { formatThaiDateTime } from "../display";

export const BANGKOK_TZ = "Asia/Bangkok";
export const BANGKOK_OFFSET = "+07:00";

export type BookingPhase = "unset" | "before" | "open" | "after";

export type LessonBookingSettings = {
  announcement_body: string;
  announcement_title: string;
  announcement_version: number;
  booking_close_at: string | null;
  booking_open_at: string | null;
  cancel_cutoff_hours: number;
  max_bookings_per_member: number;
};

export const defaultLessonBookingSettings: LessonBookingSettings = {
  announcement_body: "",
  announcement_title: "",
  announcement_version: 0,
  booking_close_at: null,
  booking_open_at: null,
  cancel_cutoff_hours: 24,
  max_bookings_per_member: 2,
};

export function getBookingPhase(
  settings: Pick<LessonBookingSettings, "booking_open_at" | "booking_close_at"> | null | undefined,
  now: number = Date.now(),
): BookingPhase {
  if (!settings?.booking_open_at) {
    return "unset";
  }

  const openAt = Date.parse(settings.booking_open_at);
  const closeAt = settings.booking_close_at ? Date.parse(settings.booking_close_at) : null;

  if (now < openAt) {
    return "before";
  }
  if (closeAt !== null && now > closeAt) {
    return "after";
  }
  return "open";
}

export function hasLessonAnnouncement(
  settings: Pick<LessonBookingSettings, "announcement_version" | "announcement_title" | "announcement_body"> | null | undefined,
) {
  return Boolean(
    settings &&
      settings.announcement_version > 0 &&
      (settings.announcement_title.trim() || settings.announcement_body.trim()),
  );
}

export function needsAnnouncementAck(
  settings: Pick<LessonBookingSettings, "announcement_version" | "announcement_title" | "announcement_body"> | null | undefined,
  ackVersion: number | null | undefined,
) {
  return hasLessonAnnouncement(settings) && (ackVersion ?? 0) < (settings?.announcement_version ?? 0);
}

/** Lesson start as an absolute instant. `time` may be "HH:MM" or "HH:MM:SS". */
export function lessonStartAt(date: string, time: string) {
  const hhmmss = time.length === 5 ? `${time}:00` : time.slice(0, 8);
  return new Date(`${date}T${hhmmss}${BANGKOK_OFFSET}`);
}

/** Google Calendar "add event" link for a lesson (times are Bangkok wall-clock). */
export function googleCalendarUrl(input: {
  date: string;
  details?: string | null;
  endTime: string;
  location?: string | null;
  startTime: string;
  title: string;
}) {
  const stamp = (time: string) =>
    lessonStartAt(input.date, time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    dates: `${stamp(input.startTime)}/${stamp(input.endTime)}`,
    text: input.title,
  });
  if (input.details) params.set("details", input.details);
  if (input.location) params.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function cancelDeadline(date: string, time: string, cutoffHours: number) {
  return new Date(lessonStartAt(date, time).getTime() - cutoffHours * 60 * 60 * 1000);
}

export type QueueStatus =
  | { kind: "confirmed"; position: number }
  | { kind: "waitlisted"; position: number; waitlistRank: number };

export function queueStatus(position: number, capacity: number): QueueStatus {
  if (position <= capacity) {
    return { kind: "confirmed", position };
  }
  return { kind: "waitlisted", position, waitlistRank: position - capacity };
}

export function queueStatusLabel(position: number, capacity: number) {
  const status = queueStatus(position, capacity);
  return status.kind === "confirmed" ? "ได้ที่นั่งแล้ว" : `สำรองลำดับ ${status.waitlistRank}`;
}

/** Seat summary for one slot from its non-cancelled booking count. */
export function seatSummary(bookedCount: number, capacity: number, waitlistCapacity: number) {
  const confirmed = Math.min(bookedCount, capacity);
  const waitlisted = Math.max(0, bookedCount - capacity);
  return {
    confirmed,
    free: Math.max(0, capacity - confirmed),
    waitlistFree: Math.max(0, waitlistCapacity - waitlisted),
    waitlisted,
  };
}

/** What the booking button should offer for a slot the member has not booked yet. */
export type SlotOffer = "book" | "waitlist" | "full" | "closed" | "not-open" | "window-closed";

export function slotOffer(input: {
  bookedCount: number;
  capacity: number;
  phase: BookingPhase;
  slotStatus: string;
  waitlistCapacity: number;
}): SlotOffer {
  if (input.slotStatus !== "open") {
    return "closed";
  }
  if (input.phase === "before" || input.phase === "unset") {
    return "not-open";
  }
  if (input.phase === "after") {
    return "window-closed";
  }
  if (input.bookedCount < input.capacity) {
    return "book";
  }
  if (input.bookedCount < input.capacity + input.waitlistCapacity) {
    return "waitlist";
  }
  return "full";
}

/** Maps `raise exception 'CODE'` from the lesson RPCs to `?status=` keys on /member. */
export const lessonRpcStatus: Record<string, string> = {
  ANNOUNCEMENT: "lesson-announcement-required",
  CANCEL_LOCKED: "lesson-cancel-locked",
  CHANGE_CLOSED: "lesson-change-closed",
  CLOSED: "lesson-window-closed",
  DUPLICATE: "lesson-already-booked",
  FULL: "lesson-full",
  LIMIT: "lesson-limit",
  MODULE_DISABLED: "module-disabled",
  MEMBER_INACTIVE: "member-not-approved",
  NOT_MEMBER: "member-not-approved",
  NOT_OPEN: "lesson-not-open",
  NOT_TARGETED: "lesson-closed",
  NO_BOOKING: "lesson-cancel-closed",
  NO_CREDIT: "lesson-no-credit",
  NO_OFFER: "lesson-offer-gone",
  NO_SESSION: "lesson-closed",
  NO_SHOW_BLOCKED: "lesson-no-show-blocked",
  OFFER_EXPIRED: "lesson-offer-expired",
  OVERLAP: "lesson-overlap",
  PRIORITY_WINDOW: "lesson-priority-window",
  SESSION_CLOSED: "lesson-closed",
  STARTED: "lesson-started",
  WEEK_LIMIT: "lesson-week-limit",
  lesson_slot_full: "lesson-full",
};

export function rpcErrorToStatus(message: string | null | undefined, fallback: string) {
  const code = (message ?? "").match(/^[A-Za-z_]+/)?.[0];
  return (code && lessonRpcStatus[code]) || fallback;
}

// ---------- Bangkok date helpers ----------

const bangkokYmd = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: BANGKOK_TZ,
  year: "numeric",
});

/** Calendar date (YYYY-MM-DD) in Bangkok for an instant. */
export function bangkokDate(at: Date | number = Date.now()) {
  return bangkokYmd.format(at);
}

/** Day of week (0 = Sunday) for a YYYY-MM-DD calendar date. */
export function weekdayOf(date: string) {
  return new Date(`${date}T12:00:00${BANGKOK_OFFSET}`).getUTCDay();
}

export function addDays(date: string, days: number) {
  return bangkokDate(new Date(`${date}T12:00:00${BANGKOK_OFFSET}`).getTime() + days * 86_400_000);
}

/** ISO instant -> value for `<input type="datetime-local">` shown in Bangkok time. */
export function toBangkokInputValue(iso: string | null | undefined) {
  if (!iso) {
    return "";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      timeZone: BANGKOK_TZ,
      year: "numeric",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/** `<input type="datetime-local">` value typed as Bangkok time -> ISO instant. */
export function fromBangkokInputValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}:00${BANGKOK_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Timestamp in Bangkok time, "16 พ.ย. 69 · 10:21 น." (UNSET "ยังไม่ระบุ" when empty). Kept as an
 * alias of formatThaiDateTime so older callers show the same format as the rest of the app.
 */
export function formatBangkokDateTime(iso: string | null | undefined) {
  return formatThaiDateTime(iso);
}

export function formatBangkokDay(date: string) {
  return new Date(`${date}T12:00:00${BANGKOK_OFFSET}`).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "long",
    timeZone: BANGKOK_TZ,
    weekday: "long",
    year: "numeric",
  });
}

export function formatCountdown(ms: number) {
  if (ms <= 0) {
    return "00:00:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = pad(Math.floor((totalSeconds % 86_400) / 3600));
  const minutes = pad(Math.floor((totalSeconds % 3600) / 60));
  const seconds = pad(totalSeconds % 60);
  return `${days ? `${days} วัน ` : ""}${hours}:${minutes}:${seconds}`;
}

// ---------- bulk slot generator ----------

export type TimeRange = { end_time: string; start_time: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "9.00", "09:00", "9:00 น." -> "09:00"; anything else is returned trimmed for the error message. */
function normalizeClock(value: string) {
  const cleaned = value.trim().replace(/\s*น\.?$/, "").replace(".", ":");
  return cleaned.replace(/^(\d):/, "0$1:");
}

/**
 * Parses "16:30-17:30, 17:30-18:30" into ordered ranges, explaining the first bad entry in Thai.
 * Accepts "." as the hour separator, en/em dashes or "ถึง" between times, and "," / ";" / new
 * lines between ranges, because that is how staff type times.
 */
export function parseTimeRangesDetailed(input: string): { ranges: TimeRange[] } | { error: string } {
  const items = input
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!items.length) {
    return { error: "กรุณาใส่ช่วงเวลา เช่น 09:00-10:00" };
  }

  const ranges: TimeRange[] = [];
  for (const item of items) {
    const parts = item.split(/\s*(?:-|–|—|ถึง)\s*/).filter(Boolean);
    if (parts.length !== 2) {
      return {
        error: parts.length === 1
          ? `ช่วงเวลา "${item}" ไม่มีเวลาสิ้นสุด กรุณาใส่แบบ 09:00-10:00`
          : `อ่านช่วงเวลา "${item}" ไม่ได้ กรุณาใส่แบบ 09:00-10:00 คั่นแต่ละช่วงด้วยจุลภาค`,
      };
    }
    const [start, end] = parts.map(normalizeClock);
    if (!HHMM.test(start) || !HHMM.test(end)) {
      return { error: `เวลาใน "${item}" ไม่ถูกต้อง ใช้รูปแบบ 24 ชั่วโมง เช่น 09:00-10:00` };
    }
    if (start >= end) {
      return { error: `ช่วงเวลา "${item}" เวลาเริ่มต้องก่อนเวลาสิ้นสุด` };
    }
    ranges.push({ end_time: end, start_time: start });
  }
  return { ranges };
}

/** Parses "16:30-17:30, 17:30-18:30" into ordered ranges. Returns null when any range is invalid. */
export function parseTimeRanges(input: string): TimeRange[] | null {
  const result = parseTimeRangesDetailed(input);
  return "ranges" in result ? result.ranges : null;
}

export type SlotPlanInput = {
  from: string;
  times: TimeRange[];
  to: string;
  weekdays: number[];
};

export type SlotPlanItem = { end_time: string; lesson_date: string; start_time: string };

export const MAX_GENERATED_SLOTS = 300;

export function planSlots(input: SlotPlanInput): { error: string } | { items: SlotPlanItem[] } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from > input.to) {
    return { error: "ช่วงวันที่ไม่ถูกต้อง" };
  }
  if (!input.times.length) {
    return { error: "กรุณาใส่ช่วงเวลาอย่างน้อย 1 ช่วง" };
  }
  if (!input.weekdays.length) {
    return { error: "กรุณาเลือกวันในสัปดาห์อย่างน้อย 1 วัน" };
  }

  const items: SlotPlanItem[] = [];
  for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
    if (!input.weekdays.includes(weekdayOf(date))) {
      continue;
    }
    for (const range of input.times) {
      items.push({ end_time: range.end_time, lesson_date: date, start_time: range.start_time });
    }
    if (items.length > MAX_GENERATED_SLOTS) {
      return { error: `สร้างได้ครั้งละไม่เกิน ${MAX_GENERATED_SLOTS} รอบ` };
    }
  }

  if (!items.length) {
    return { error: "ไม่มีวันที่ตรงกับวันในสัปดาห์ที่เลือก" };
  }
  return { items };
}
