// Admin lessons area (/admin/lessons, lessons v2 UI): tab keys, calendar query + links, redirect
// targets, status keys for the result banners, and small view helpers. Pure (no I/O); tested in
// admin.test.ts. Relative imports: keep this module loadable without the "@/" alias.
import { formatThaiDateShort } from "../display";
import { addDays } from "./booking";
import { slotFill, teachingHours } from "./calendar";
import { isSeatStatus } from "./labels";
import type { PlanCounts } from "./planner";
import type { LessonRosterRow, LessonSlotRow, LessonVenue } from "./types";

// ---------- tabs ----------

/** Tabs shown in the tab bar (audit p.20). `create` (the wizard) is reached from the header button. */
export const lessonsAdminTabs = [
  { key: "calendar", label: "ปฏิทิน" },
  { key: "courses", label: "คอร์สและแพ็กเกจ" },
  { key: "coaches", label: "ผู้สอนและสถานที่" },
  { key: "settings", label: "กติกา" },
  { key: "announcement", label: "ประกาศ" },
] as const;

export type LessonsAdminTab = (typeof lessonsAdminTabs)[number]["key"] | "create";

/** Old and friendly keys still in links (dashboard, palette, audit log, older redirects). */
const tabAliases: Record<string, LessonsAdminTab> = {
  announcement: "announcement",
  calendar: "calendar",
  coaches: "coaches",
  courses: "courses",
  create: "create",
  packages: "courses",
  rules: "settings",
  settings: "settings",
  slots: "calendar",
  venues: "coaches",
};

export function parseLessonsTab(value: string | null | undefined): LessonsAdminTab {
  return (value && tabAliases[value]) || "calendar";
}

// ---------- calendar query ----------

export const calendarViews = ["week", "month", "list"] as const;
export type CalendarView = (typeof calendarViews)[number];

export type CalendarQuery = {
  coach: string;
  course: string;
  /** anchor date YYYY-MM-DD (any day of the shown week / month) */
  date: string;
  /** selected round: opens the side panel */
  slot: string;
  venue: string;
  view: CalendarView;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

type RawParams = Partial<Record<keyof CalendarQuery, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** URL params -> calendar state. Unknown values fall back to this week, no filters. */
export function parseCalendarQuery(params: RawParams, today: string): CalendarQuery {
  const view = one(params.view);
  const date = one(params.date);
  const id = (value: string) => (isUuid(value) ? value : "");
  return {
    coach: id(one(params.coach)),
    course: id(one(params.course)),
    date: isIsoDate(date) ? date : today,
    slot: id(one(params.slot)),
    venue: id(one(params.venue)),
    view: (calendarViews as readonly string[]).includes(view) ? (view as CalendarView) : "week",
  };
}

export type LessonsHrefInput = Partial<CalendarQuery> & {
  bypass?: boolean;
  hash?: string;
  /** extra params, e.g. { member: "สมชาย" } on the courses tab */
  extra?: Record<string, string | null | undefined>;
  tab?: LessonsAdminTab;
};

/** "/admin/lessons?view=month&date=2026-11-01#…" — defaults (calendar tab, week view) are left out. */
export function lessonsAdminHref(input: LessonsHrefInput = {}) {
  const search = new URLSearchParams();
  if (input.tab && input.tab !== "calendar") search.set("tab", input.tab);
  if (input.view && input.view !== "week") search.set("view", input.view);
  for (const key of ["date", "course", "coach", "venue", "slot"] as const) {
    const value = input[key];
    if (value) search.set(key, value);
  }
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (value) search.set(key, value);
  }
  if (input.bypass) search.set("bypass", "admin");
  const query = search.toString();
  return `/admin/lessons${query ? `?${query}` : ""}${input.hash ? `#${input.hash}` : ""}`;
}

/**
 * Where a check-in QR points: the member check-in page (coach portal / member screens track)
 * reads `token` and calls rpc("check_in_lesson", { p_token }).
 */
export function lessonCheckInPath(token: string) {
  return `/member/check-in?token=${encodeURIComponent(token)}`;
}

// ---------- redirects ----------

/**
 * Where a lessons form returns to (hidden "returnTo" field). Only /admin/lessons pages are
 * accepted, so a crafted form cannot redirect elsewhere; an old `status` is dropped.
 */
export function safeLessonsReturnTo(value: unknown, fallback = "/admin/lessons") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!/^\/admin\/lessons(?:[/?#]|$)/.test(trimmed) || trimmed.includes("//") || trimmed.includes("\\")) {
    return fallback;
  }
  return withStatus(trimmed, null);
}

/** Sets (or with null removes) `status` in a path, keeping the other params and the #hash. */
export function withStatus(path: string, status: string | null) {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const queryAt = beforeHash.indexOf("?");
  const pathname = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const search = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");
  search.delete("status");
  if (status) search.set("status", status);
  const query = search.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

// ---------- result banners ----------

export type ClosureResult = { bookings?: number | null; credits_refunded?: number | null; members?: number | null; slots?: number | null };

const count = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};

/** close_lesson_day result -> "day-closed:3:9:7:8" (rounds, bookings, credits refunded, members notified). */
export function closureStatusKey(result: ClosureResult | null | undefined) {
  return `day-closed:${count(result?.slots)}:${count(result?.bookings)}:${count(result?.credits_refunded)}:${count(result?.members)}`;
}

/** "งดเรียนแล้ว ยกเลิก 3 รอบ · การจอง 9 รายการ · คืนเครดิต 7 ครั้ง · แจ้งสมาชิก 8 คน" */
export function closureStatusMessage(status: string) {
  const match = /^day-closed:(\d+):(\d+):(\d+):(\d+)$/.exec(status);
  if (!match) return null;
  const [slots, bookings, credits, members] = match.slice(1).map(Number);
  if (!slots && !bookings) {
    return "บันทึกวันงดเรียนแล้ว วันนั้นไม่มีรอบที่ต้องยกเลิก";
  }
  const parts = [`ยกเลิก ${slots} รอบ`, `การจอง ${bookings} รายการ`];
  if (credits) parts.push(`คืนเครดิต ${credits} ครั้ง`);
  parts.push(`แจ้งสมาชิก ${members} คน`);
  return `งดเรียนแล้ว ${parts.join(" · ")}`;
}

/** Wizard result: "generated:<created>:<duplicate>:<overlap>:<coach>:<venue>:<opened 0|1>". */
export function generatedStatusKey(created: number, counts: Pick<PlanCounts, "coach" | "duplicate" | "overlap" | "venue">, opened: boolean) {
  return `generated:${count(created)}:${count(counts.duplicate)}:${count(counts.overlap)}:${count(counts.coach)}:${count(counts.venue)}:${opened ? 1 : 0}`;
}

/**
 * Banner text for a "generated:…" status. Also reads the old 2–3 part form
 * ("generated:12:3" / "generated:12:3:opened") from before the wizard.
 */
export function generatedStatusMessage(status: string, notBookableYet = "") {
  const parts = status.split(":").slice(1);
  if (!parts.length || parts.some((part, index) => !(index === 2 && part === "opened") && !/^\d+$/.test(part))) {
    return null;
  }
  let created = Number(parts[0]);
  const skipped: string[] = [];
  let opened = false;
  if (parts.length >= 6) {
    const [duplicate, overlap, coach, venue] = parts.slice(1, 5).map(Number);
    if (duplicate) skipped.push(`${duplicate} รอบที่มีอยู่แล้ว`);
    if (overlap) skipped.push(`${overlap} รอบที่เวลาซ้อนกันเอง`);
    if (coach) skipped.push(`${coach} รอบที่ชนผู้สอน`);
    if (venue) skipped.push(`${venue} รอบที่ชนสถานที่`);
    opened = parts[5] === "1";
  } else {
    created = Number(parts[0]);
    if (Number(parts[1])) skipped.push(`${Number(parts[1])} รอบที่มีอยู่แล้ว`);
    opened = parts[2] === "opened";
  }
  const list = skipped.length > 1 ? `${skipped.slice(0, -1).join(", ")} และ ${skipped[skipped.length - 1]}` : skipped[0];
  return `สร้าง ${created} รอบเรียนแล้ว${list ? ` (ข้าม ${list})` : ""}${opened ? " และเปิดให้สมาชิกจองได้เลย" : notBookableYet}`;
}

// ---------- slot editor ----------

export type SlotCapacityInput = {
  /** non-cancelled bookings (v1 meaning of booked_count) */
  activeBookings?: number | null;
  capacity: number | null;
  /** v2 counters; null/undefined on a database without the lessons v2 migration */
  seatsTaken?: number | null;
  waitlistCapacity: number;
  waitlistCount?: number | null;
};

/**
 * Why a slot edit must be refused, as a `?status=` key, or null. The database never demotes a
 * seat holder when capacity drops, so the editor refuses capacity below the seats already taken
 * (and a waitlist smaller than the queue). Without v2 counters: capacity + waitlist ≥ bookings.
 */
export function slotCapacityProblem(input: SlotCapacityInput) {
  if (!input.capacity || input.capacity < 1 || !Number.isInteger(input.capacity)) {
    return "slot-missing";
  }
  if (input.waitlistCapacity < 0 || !Number.isInteger(input.waitlistCapacity)) {
    return "slot-missing";
  }
  if (typeof input.seatsTaken === "number") {
    if (input.capacity < input.seatsTaken) return `slot-capacity-below-seats:${input.seatsTaken}`;
    if (typeof input.waitlistCount === "number" && input.waitlistCapacity < input.waitlistCount) {
      return `slot-waitlist-below-queue:${input.waitlistCount}`;
    }
    return null;
  }
  if (input.capacity + input.waitlistCapacity < (input.activeBookings ?? 0)) {
    return "slot-capacity-too-low";
  }
  return null;
}

// ---------- roster ----------

export type RosterGroups<T extends Pick<LessonRosterRow, "booking_status">> = { inactive: T[]; seats: T[]; waitlist: T[] };

/** Seat holders, คิวสำรอง and the rest (cancelled / late / closed), keeping the RPC order. */
export function rosterGroups<T extends Pick<LessonRosterRow, "booking_status">>(rows: readonly T[]): RosterGroups<T> {
  const groups: RosterGroups<T> = { inactive: [], seats: [], waitlist: [] };
  for (const row of rows) {
    if (isSeatStatus(row.booking_status)) groups.seats.push(row);
    else if (row.booking_status === "waitlist") groups.waitlist.push(row);
    else groups.inactive.push(row);
  }
  return groups;
}

// ---------- move targets ----------

export type MoveTargetSlot = Pick<LessonSlotRow, "booked_count" | "capacity" | "end_time" | "id" | "lesson_date" | "seats_taken" | "start_time" | "status" | "waitlist_count"> & {
  program_id?: string | null;
  title?: string | null;
};

export type MoveTarget = { free: number; id: string; label: string; sameCourse: boolean };

/**
 * Rounds a booking can be moved to: open or closed for booking, not started (by date), not the
 * current round; same course first, then by date and time. Full rounds stay in the list (the RPC
 * answers FULL) but say so.
 */
export function moveTargets(slots: readonly MoveTargetSlot[], current: { id: string; program_id?: string | null }, today: string): MoveTarget[] {
  return slots
    .filter((slot) => slot.id !== current.id && (slot.status === "open" || slot.status === "closed") && slot.lesson_date >= today)
    .map((slot) => {
      const fill = slotFill(slot);
      const time = `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`;
      return {
        date: slot.lesson_date,
        free: fill.free,
        id: slot.id,
        label: `${formatThaiDateShort(slot.lesson_date)} · ${time} · ${slot.title ?? "รอบเรียน"} · ${fill.free ? `ว่าง ${fill.free} ที่` : "เต็ม"}`,
        sameCourse: Boolean(current.program_id) && slot.program_id === current.program_id,
        start: slot.start_time,
      };
    })
    .sort((a, b) => Number(b.sameCourse) - Number(a.sameCourse) || a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .map(({ free, id, label, sameCourse }) => ({ free, id, label, sameCourse }));
}

// ---------- day closure ----------

/** What closing one day would touch (rounds not cancelled / finished, people booked or queued). */
export function dayCloseSummary(slots: ReadonlyArray<Pick<LessonSlotRow, "booked_count" | "capacity" | "seats_taken" | "status" | "venue_id" | "waitlist_count">>, venueId?: string | null) {
  const affected = slots.filter(
    (slot) => (slot.status === "open" || slot.status === "closed" || slot.status === "draft") && (!venueId || slot.venue_id === venueId),
  );
  const people = affected.reduce((sum, slot) => {
    const fill = slotFill(slot);
    return sum + fill.taken + fill.waitlist;
  }, 0);
  return { people, slots: affected.length };
}

// ---------- coaches and venues ----------

/** Hours and rounds per coach id for the given rounds (cancelled / draft rounds excluded). */
export function coachHours(slots: ReadonlyArray<Pick<LessonSlotRow, "coach_id" | "end_time" | "start_time" | "status">>) {
  const result = new Map<string, { hours: number; rounds: number }>();
  const ids = new Set(slots.map((slot) => slot.coach_id).filter((id): id is string => Boolean(id)));
  for (const id of ids) {
    const own = slots.filter((slot) => slot.coach_id === id && slot.status !== "cancelled" && slot.status !== "draft" && slot.status !== "archived");
    result.set(id, { hours: teachingHours(own, id), rounds: own.length });
  }
  return result;
}

/** "12 ชม.", "1.5 ชม.", "ยังไม่มีรอบสอน" */
export function formatHours(hours: number) {
  if (!hours) return "ยังไม่มีรอบสอน";
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded.toLocaleString("th-TH")} ชม.`;
}

/** Bay labels "1".."n" for a multi-bay venue; none for a single-bay venue. */
export function bayOptions(venue: Pick<LessonVenue, "bay_count"> | null | undefined) {
  const bays = Math.max(0, Math.trunc(venue?.bay_count ?? 0));
  return bays > 1 ? Array.from({ length: Math.min(bays, 500) }, (_, index) => String(index + 1)) : [];
}

/** Seats per round a venue (or one bay of it) suggests; 8 when no venue is picked. */
export function suggestedCapacity(venue: Pick<LessonVenue, "bay_count" | "capacity_per_bay"> | null | undefined, bayLabel?: string | null) {
  if (!venue) return 8;
  return (bayLabel ?? "").trim() ? venue.capacity_per_bay : venue.bay_count * venue.capacity_per_bay;
}

// ---------- packages and credits ----------

/** "ทุกคอร์ส" for an any-course package, else the course name. */
export function packageScopeLabel(programId: string | null | undefined, programs: ReadonlyArray<{ id: string; name: string }>) {
  if (!programId) return "ทุกคอร์ส";
  return programs.find((program) => program.id === programId)?.name ?? "คอร์สที่เก็บถาวรแล้ว";
}

/** "+3", "-2", "3", "−2" (Thai keyboards type U+2212 sometimes) -> integer in ±1..1000, or an error. */
export function parseCreditDelta(raw: unknown): { delta: number } | { error: string } {
  const text = String(raw ?? "").trim().replace(/−/g, "-").replace(/\s+/g, "");
  if (!/^[+-]?\d+$/.test(text)) {
    return { error: "ใส่จำนวนเครดิตเป็นตัวเลข เช่น 2 หรือ -1" };
  }
  const delta = Number(text);
  if (!delta) return { error: "จำนวนเครดิตต้องไม่เป็น 0" };
  if (Math.abs(delta) > 1000) return { error: "ปรับได้ครั้งละไม่เกิน 1,000 ครั้ง" };
  return { delta };
}

/** Next / previous anchors for the calendar header. */
export function calendarStep(view: CalendarView, date: string, direction: 1 | -1) {
  if (view === "month") {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7)) - 1 + direction;
    const y = year + Math.floor(month / 12);
    const m = ((month % 12) + 12) % 12;
    return `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }
  return addDays(date, 7 * direction);
}

// ---------- row shapes used by the admin page and its components ----------

export type AdminLessonProgram = {
  coach_name: string | null;
  /** v2: lesson_coaches.id picked as the course's usual coach */
  default_coach_id?: string | null;
  default_venue_id?: string | null;
  description: string | null;
  id: string;
  level: string;
  name: string;
  price: number;
  /** v2: bookings take a credit from a package */
  requires_package?: boolean;
  status: string;
};

export type AdminLessonSlot = LessonSlotRow & {
  allow_member_reschedule?: boolean;
  note?: string | null;
  program_id: string;
  /** course name (joined) */
  program_name: string | null;
  reschedule_cutoff_hours?: number;
  target_bureaus?: string[] | null;
  target_departments?: string[] | null;
  target_divisions?: string[] | null;
  target_sections?: string[] | null;
  target_work_lines?: string[] | null;
  title: string;
};

/** "ชื่อ นามสกุล (ชื่อเล่น)" for coach pickers and lists; shared by server and client components. */
export function coachLabel(coach: { full_name: string; nickname: string | null }) {
  return coach.nickname ? `${coach.full_name} (${coach.nickname})` : coach.full_name;
}
