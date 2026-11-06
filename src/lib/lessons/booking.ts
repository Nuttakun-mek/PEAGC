// Pure helpers for the lesson booking flow (FCFS queue, waitlist, booking window).
// Shared by the member portal, admin pages, and server actions. No I/O here.

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
  MEMBER_INACTIVE: "member-not-approved",
  NOT_MEMBER: "member-not-approved",
  NOT_OPEN: "lesson-not-open",
  NOT_TARGETED: "lesson-closed",
  NO_BOOKING: "lesson-cancel-closed",
  NO_SESSION: "lesson-closed",
  OVERLAP: "lesson-overlap",
  SESSION_CLOSED: "lesson-closed",
  STARTED: "lesson-started",
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

export function formatBangkokDateTime(iso: string | null | undefined) {
  if (!iso) {
    return "-";
  }
  return `${new Date(iso).toLocaleString("th-TH", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: BANGKOK_TZ,
    year: "2-digit",
  })} น.`;
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

/** Parses "16:30-17:30, 17:30-18:30" into ordered ranges. Returns null when any range is invalid. */
export function parseTimeRanges(input: string): TimeRange[] | null {
  const ranges = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [start = "", end = ""] = item.split("-").map((part) => part.trim().replace(/^(\d):/, "0$1:"));
      return { end_time: end, start_time: start };
    });

  if (!ranges.length) {
    return null;
  }
  for (const range of ranges) {
    if (!HHMM.test(range.start_time) || !HHMM.test(range.end_time) || range.start_time >= range.end_time) {
      return null;
    }
  }
  return ranges;
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
