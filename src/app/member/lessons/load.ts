import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addDays, bangkokDate, lessonStartAt } from "@/lib/lessons/booking";
import {
  type BrowserSlot,
  type MemberBooking,
  type MemberCoachNote,
  effectiveBookingStatus,
  matchesMemberTargets,
  waitlistRank,
} from "@/lib/lessons/member-view";
import { type LessonRules, defaultLessonRules, lessonRuleColumns, parseLessonRules } from "@/lib/lessons/rules";
import { lessonSampleData, sampleLessonIds } from "@/lib/lessons/sample-data";
import type {
  LessonEnrollmentBalance,
  LessonPackage,
  MyLessonBookingRow,
  MyLessonOverview,
  SkillLevel,
} from "@/lib/lessons/types";
import { type PaymentSettings, loadPaymentSettings } from "@/lib/payments/settings";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";

// Data for the member lesson screens (/member/lessons and the summary on /member). The UAT
// database may not have the lessons v2 migration yet: every v2 query falls back to the older
// columns, and the credit / package / offer parts are simply left out (`v2: false`).

export type LessonMember = {
  bureau: string | null;
  club_id: string;
  department: string | null;
  division: string | null;
  full_name: string | null;
  id: string;
  lesson_announcement_ack_version: number | null;
  section: string | null;
  skill_level: string | null;
  status: string;
  work_line: string | null;
};

export const lessonMemberColumns =
  "id, club_id, status, full_name, work_line, bureau, division, department, section, skill_level, lesson_announcement_ack_version";

export type MemberPackage = LessonPackage & { programName: string | null };

export type MemberLessonPayment = { amount: number; id: string; status: string };

export type MemberLessonsData = {
  bookings: MemberBooking[];
  enrollments: LessonEnrollmentBalance[];
  notes: MemberCoachNote[];
  overview: MyLessonOverview | null;
  packages: MemberPackage[];
  /** payment_records of lesson packages by enrollment id */
  payments: Record<string, MemberLessonPayment>;
  paymentSettings: PaymentSettings | null;
  rules: LessonRules;
  /** settings row exists (else booking is not open: no window set) */
  settingsLoaded: boolean;
  slots: BrowserSlot[];
  today: string;
  unread: number;
  /** lessons v2 migration is on the database */
  v2: boolean;
};

type Result<T> = { data: T | null; error: { code?: string; details?: string | null; hint?: string | null; message: string } | null };

/** Runs `primary`; when the database is behind (missing column / function / table), runs `fallback`. */
async function withFallback<T>(context: string, primary: () => PromiseLike<Result<T>>, fallback?: () => PromiseLike<Result<T>>): Promise<Result<T>> {
  const first = await primary();
  if (!first.error) return first;
  if (fallback && classifyDbError(first.error) === "schema-outdated") {
    const second = await fallback();
    if (second.error) logDbError(`member.lessons ${context} (v1)`, second.error);
    return second;
  }
  if (classifyDbError(first.error) !== "schema-outdated") logDbError(`member.lessons ${context}`, first.error);
  return first;
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

type ProgramRow = { coach_name?: string | null; id?: string; name?: string | null; requires_package?: boolean | null };

type SlotRow = {
  allow_member_reschedule?: boolean | null;
  booked_count?: number | null;
  capacity: number;
  coach_id?: string | null;
  coach_name?: string | null;
  end_time: string;
  id: string;
  lesson_date: string;
  lesson_programs?: ProgramRow | ProgramRow[] | null;
  program_id?: string | null;
  reschedule_cutoff_hours?: number | null;
  seats_taken?: number | null;
  start_time: string;
  status: string;
  target_bureaus?: string[] | null;
  target_departments?: string[] | null;
  target_divisions?: string[] | null;
  target_sections?: string[] | null;
  target_work_lines?: string[] | null;
  title: string;
  venue?: string | null;
  waitlist_capacity?: number | null;
  waitlist_count?: number | null;
};

type BookingRow = {
  booked_at: string | null;
  checked_in_at?: string | null;
  id: string;
  lesson_slots: SlotRow | SlotRow[] | null;
  offer_expires_at?: string | null;
  slot_id: string;
  status: string;
};

const slotTargets = "target_work_lines, target_bureaus, target_divisions, target_departments, target_sections";
const slotColumnsV2 = `id, program_id, title, coach_name, coach_id, venue, lesson_date, start_time, end_time, capacity, waitlist_capacity, status, booked_count, seats_taken, waitlist_count, allow_member_reschedule, reschedule_cutoff_hours, ${slotTargets}, lesson_programs(id, name, coach_name, requires_package)`;
const slotColumnsV1 = `id, program_id, title, coach_name, venue, lesson_date, start_time, end_time, capacity, waitlist_capacity, status, booked_count, allow_member_reschedule, reschedule_cutoff_hours, ${slotTargets}, lesson_programs(id, name, coach_name)`;
const bookingSlotColumns =
  "id, program_id, title, coach_name, venue, lesson_date, start_time, end_time, status, capacity, allow_member_reschedule, reschedule_cutoff_hours, lesson_programs(name, coach_name)";
const bookingColumnsV2 = `id, slot_id, status, booked_at, checked_in_at, offer_expires_at, lesson_slots(${bookingSlotColumns})`;
const bookingColumnsV1 = `id, slot_id, status, booked_at, checked_in_at, lesson_slots(${bookingSlotColumns})`;

export function toBrowserSlot(slot: SlotRow): BrowserSlot {
  const program = firstRelated(slot.lesson_programs);
  return {
    bookedCount: slot.booked_count ?? 0,
    capacity: slot.capacity,
    coach: slot.coach_name ?? program?.coach_name ?? null,
    coachId: slot.coach_id ?? null,
    date: slot.lesson_date,
    endTime: slot.end_time,
    id: slot.id,
    program: program?.name ?? "คอร์สเรียนกอล์ฟ",
    programId: slot.program_id ?? null,
    requiresPackage: Boolean(program?.requires_package),
    seatsTaken: slot.seats_taken ?? null,
    startTime: slot.start_time,
    status: slot.status ?? "open",
    title: slot.title,
    venue: slot.venue ?? null,
    waitlistCapacity: slot.waitlist_capacity ?? 0,
    waitlistCount: slot.waitlist_count ?? null,
  };
}

function toMemberBooking(row: BookingRow, queue: Map<string, MyLessonBookingRow | { capacity: number; queue_position: number | null }>): MemberBooking | null {
  const slot = firstRelated(row.lesson_slots);
  if (!slot) return null;
  const program = firstRelated(slot.lesson_programs);
  const entry = queue.get(row.id);
  const capacity = entry?.capacity ?? slot.capacity;
  const position = entry?.queue_position ?? null;
  const status = effectiveBookingStatus(row.status, position, capacity);
  return {
    bookedAt: row.booked_at,
    checkedInAt: row.checked_in_at ?? null,
    creditHeld: Boolean(entry && "credit_enrollment_id" in entry && entry.credit_enrollment_id),
    id: row.id,
    offerExpiresAt: row.offer_expires_at ?? (entry && "offer_expires_at" in entry ? entry.offer_expires_at : null) ?? null,
    position,
    rank: waitlistRank(row.status, position, capacity),
    slot: {
      allowReschedule: slot.allow_member_reschedule !== false,
      capacity,
      coach: slot.coach_name ?? program?.coach_name ?? null,
      date: slot.lesson_date,
      endTime: slot.end_time,
      id: slot.id,
      program: program?.name ?? null,
      programId: slot.program_id ?? null,
      rescheduleCutoffHours: slot.reschedule_cutoff_hours ?? null,
      startTime: slot.start_time,
      status: slot.status,
      title: slot.title,
      venue: slot.venue ?? null,
    },
    status,
  };
}

/** Soonest first for what is still ahead, then newest first for the past. */
export function sortBookings(bookings: MemberBooking[], now: number = Date.now()) {
  const start = (item: MemberBooking) => lessonStartAt(item.slot.date, item.slot.startTime).getTime();
  const end = (item: MemberBooking) => lessonStartAt(item.slot.date, item.slot.endTime).getTime();
  const ahead = bookings.filter((item) => end(item) > now).sort((a, b) => start(a) - start(b));
  const past = bookings.filter((item) => end(item) <= now).sort((a, b) => start(b) - start(a));
  return [...ahead, ...past];
}

type Options = {
  /** summary on /member: skip slots, packages, notes and payments */
  scope: "full" | "summary";
};

/** Loads everything the member lesson screens need for a signed-in member. */
export async function loadMemberLessons(
  supabase: SupabaseClient,
  member: Pick<LessonMember, "club_id" | "id"> & Partial<LessonMember>,
  { scope }: Options,
): Promise<MemberLessonsData> {
  const today = bangkokDate();
  const full = scope === "full";

  // Lazy offer expiry (cheap, idempotent): an offer that ran out goes to the next person before we read.
  const expired = await supabase.rpc("expire_lesson_offers", { p_club_id: member.club_id });
  if (expired.error && classifyDbError(expired.error) !== "schema-outdated") logDbError("member.lessons expire offers", expired.error);

  const settingsSelect = (columns: string) =>
    supabase.from("lesson_booking_settings").select(columns).eq("club_id", member.club_id).maybeSingle();
  const bookingsSelect = (columns: string) =>
    supabase
      .from("lesson_bookings")
      .select(columns)
      .eq("member_id", member.id)
      .neq("status", "cancelled")
      .order("booked_at", { ascending: false })
      .limit(full ? 120 : 30);
  const slotsSelect = (columns: string) =>
    supabase
      .from("lesson_slots")
      .select(columns)
      .eq("club_id", member.club_id)
      .eq("status", "open")
      .is("archived_at", null)
      .gte("lesson_date", today)
      .order("lesson_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(300);

  const [settingsResult, overviewResult, queueResult, bookingsResult, enrollmentsResult, slotsResult, packagesResult, notesResult, paymentsResult, unreadResult] =
    await Promise.all([
      withFallback<Record<string, unknown>>(
        "settings",
        () => settingsSelect(lessonRuleColumns) as unknown as PromiseLike<Result<Record<string, unknown>>>,
        () =>
          settingsSelect(
            "booking_open_at, booking_close_at, max_bookings_per_member, cancel_cutoff_hours, announcement_title, announcement_body, announcement_version",
          ) as unknown as PromiseLike<Result<Record<string, unknown>>>,
      ),
      supabase.rpc("my_lesson_overview"),
      supabase.rpc("my_lesson_bookings"),
      withFallback<BookingRow[]>(
        "bookings",
        () => bookingsSelect(bookingColumnsV2) as unknown as PromiseLike<Result<BookingRow[]>>,
        () => bookingsSelect(bookingColumnsV1) as unknown as PromiseLike<Result<BookingRow[]>>,
      ),
      supabase
        .from("lesson_enrollment_balances")
        .select("*")
        .eq("member_id", member.id)
        .order("created_at", { ascending: false })
        .limit(40),
      full
        ? withFallback<SlotRow[]>(
            "slots",
            () => slotsSelect(slotColumnsV2) as unknown as PromiseLike<Result<SlotRow[]>>,
            () => slotsSelect(slotColumnsV1) as unknown as PromiseLike<Result<SlotRow[]>>,
          )
        : Promise.resolve({ data: [] as SlotRow[], error: null }),
      full
        ? supabase
            .from("lesson_packages")
            .select("id, club_id, program_id, name, description, credits, valid_days, price, max_per_member, sort_order, status, archived_at, lesson_programs(name)")
            .eq("club_id", member.club_id)
            .eq("status", "active")
            .is("archived_at", null)
            .order("sort_order", { ascending: true })
            .order("price", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      full
        ? supabase
            .from("lesson_coach_notes")
            .select("id, booking_id, note, skill_level, video_url, created_at, lesson_coaches(full_name, nickname)")
            .eq("member_id", member.id)
            .eq("visible_to_member", true)
            .order("created_at", { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("payment_records")
        .select("id, status, amount, reference_id, created_at")
        .eq("member_id", member.id)
        .eq("purpose", "lesson_package")
        .order("created_at", { ascending: false })
        .limit(20),
      full
        ? supabase.from("member_notifications").select("id", { count: "exact", head: true }).eq("member_id", member.id).is("read_at", null)
        : Promise.resolve({ count: 0, data: null, error: null }),
    ]);

  const v2 = !overviewResult.error;
  if (overviewResult.error && classifyDbError(overviewResult.error) !== "schema-outdated") {
    logDbError("member.lessons overview", overviewResult.error);
  }

  const queueRows = (queueResult.data ?? []) as Array<MyLessonBookingRow | { booking_id: string; capacity: number; queue_position: number | null }>;
  const queue = new Map(queueRows.map((row) => [row.booking_id, row]));
  const bookings = sortBookings(
    ((bookingsResult.data ?? []) as BookingRow[])
      .map((row) => toMemberBooking(row, queue))
      .filter((item): item is MemberBooking => item !== null),
  );

  const enrollments = v2 && !enrollmentsResult.error ? ((enrollmentsResult.data ?? []) as LessonEnrollmentBalance[]) : [];
  const payments: Record<string, MemberLessonPayment> = {};
  if (v2 && !paymentsResult.error) {
    for (const row of (paymentsResult.data ?? []) as Array<{ amount: number; id: string; reference_id: string | null; status: string }>) {
      // newest first: keep the latest payment row per enrollment
      if (row.reference_id && !payments[row.reference_id]) payments[row.reference_id] = { amount: Number(row.amount ?? 0), id: row.id, status: row.status };
    }
  }

  const slots = ((slotsResult.data ?? []) as SlotRow[]).filter((slot) => matchesMemberTargets(slot, member)).map(toBrowserSlot);

  const packages = v2 && !packagesResult.error
    ? ((packagesResult.data ?? []) as Array<LessonPackage & { lesson_programs?: { name?: string | null } | { name?: string | null }[] | null }>).map(
        ({ lesson_programs, ...item }) => ({ ...item, price: Number(item.price ?? 0), programName: firstRelated(lesson_programs)?.name ?? null }),
      )
    : [];

  const notes: MemberCoachNote[] = v2 && !notesResult.error
    ? (
        (notesResult.data ?? []) as Array<{
          booking_id: string | null;
          created_at: string;
          id: string;
          lesson_coaches?: { full_name?: string | null; nickname?: string | null } | { full_name?: string | null; nickname?: string | null }[] | null;
          note: string;
          skill_level: SkillLevel | null;
          video_url: string | null;
        }>
      ).map((row) => {
        const coach = firstRelated(row.lesson_coaches);
        return {
          bookingId: row.booking_id,
          coach: coach?.nickname || coach?.full_name || null,
          createdAt: row.created_at,
          id: row.id,
          note: row.note,
          skillLevel: row.skill_level,
          videoUrl: row.video_url,
        };
      })
    : [];

  const pendingPayment = enrollments.some((item) => item.status === "pending_payment");
  const paymentSettings = full && pendingPayment ? await loadPaymentSettings(supabase, member.club_id) : null;

  return {
    bookings,
    enrollments,
    notes,
    overview: v2 ? (overviewResult.data as MyLessonOverview) : null,
    packages,
    payments,
    paymentSettings,
    rules: settingsResult.data ? parseLessonRules(settingsResult.data) : { ...defaultLessonRules, booking_open_at: null },
    settingsLoaded: Boolean(settingsResult.data),
    slots,
    today,
    unread: "count" in unreadResult && typeof unreadResult.count === "number" ? unreadResult.count : 0,
    v2,
  };
}

// ---------- bypass preview (?bypass=member) ----------

export const sampleLessonMember: LessonMember = {
  bureau: "สำนักงานใหญ่",
  club_id: sampleLessonIds.club,
  department: "กองบริการ",
  division: "ฝ่ายบริการ",
  full_name: "สมาชิกทดลอง",
  id: sampleLessonIds.member,
  lesson_announcement_ack_version: 1,
  section: null,
  skill_level: "beginner",
  status: "active",
  work_line: null,
};

/** Realistic data for the bypass preview, built from the shared lesson sample. */
export function sampleMemberLessons(today: string = bangkokDate()): MemberLessonsData {
  const sample = lessonSampleData(today);
  const programById = new Map(sample.programs.map((program) => [program.id, program]));
  const slots = sample.slots
    .filter((slot) => slot.status === "open")
    .map((slot) => {
      const program = slot.program_id ? programById.get(slot.program_id) : undefined;
      return toBrowserSlot({
        ...slot,
        allow_member_reschedule: true,
        lesson_programs: program ? { coach_name: program.coach_name, id: program.id, name: program.name, requires_package: program.requires_package } : null,
        reschedule_cutoff_hours: 12,
        title: slot.title ?? program?.name ?? "รอบเรียน",
      });
    });
  const slotById = new Map(sample.slots.map((slot) => [slot.id, slot]));
  const programName = (programId: string | null | undefined) => (programId ? (programById.get(programId)?.name ?? null) : null);

  const current: MemberBooking[] = sample.myBookings.flatMap((row) => {
    const slot = slotById.get(row.slot_id);
    if (!slot) return [];
    return [
      {
        bookedAt: lessonStartAt(addDays(today, -2), "09:00").toISOString(),
        checkedInAt: null,
        creditHeld: Boolean(row.credit_enrollment_id),
        id: row.booking_id,
        offerExpiresAt: row.offer_expires_at,
        position: row.queue_position,
        rank: waitlistRank(row.status, row.queue_position, row.capacity),
        slot: {
          allowReschedule: true,
          capacity: slot.capacity,
          coach: slot.coach_name ?? null,
          date: slot.lesson_date,
          endTime: slot.end_time,
          id: slot.id,
          program: programName(slot.program_id),
          programId: slot.program_id ?? null,
          rescheduleCutoffHours: 12,
          startTime: slot.start_time,
          status: slot.status,
          title: slot.title ?? "รอบเรียน",
          venue: slot.venue ?? null,
        },
        status: row.status,
      },
    ];
  });

  const past = (id: string, days: number, status: MemberBooking["status"]): MemberBooking => ({
    bookedAt: lessonStartAt(addDays(today, days - 5), "09:00").toISOString(),
    checkedInAt: status === "attended" ? lessonStartAt(addDays(today, days), "16:25").toISOString() : null,
    creditHeld: true,
    id,
    offerExpiresAt: null,
    position: 2,
    rank: null,
    slot: {
      allowReschedule: true,
      capacity: 4,
      coach: "ธนพล ใจดี (โปรต้น)",
      date: addDays(today, days),
      endTime: "17:30:00",
      id: `${id}-slot`,
      program: "กอล์ฟพื้นฐาน",
      programId: sampleLessonIds.programBasic,
      rescheduleCutoffHours: 12,
      startTime: "16:30:00",
      status: status === "closed" ? "cancelled" : "completed",
      title: "กอล์ฟพื้นฐาน",
      venue: "สนามไดร์ฟ กฟภ. · ช่อง 1",
    },
    status,
  });
  const history = [past(sampleIdFor(1003), -5, "no_show"), past(sampleIdFor(1002), -9, "closed"), past(sampleIdFor(1001), -14, "attended")];

  return {
    bookings: sortBookings([...current, ...history]),
    enrollments: sample.enrollments,
    notes: sample.coachNotes.map((note) => ({
      bookingId: note.booking_id,
      coach: "โปรต้น",
      createdAt: note.created_at,
      id: note.id,
      note: note.note,
      skillLevel: note.skill_level,
      videoUrl: note.video_url,
    })),
    // four open bookings allowed in the preview, so the book buttons show next to the three sample bookings
    overview: { ...sample.overview, max_active_bookings: 4 },
    packages: sample.packages.map((item) => ({ ...item, programName: programName(item.program_id) })),
    payments: { [sample.enrollments[2].enrollment_id]: { amount: 1400, id: "sample-payment", status: "pending" } },
    paymentSettings: {
      accountName: "ชมรมกอล์ฟ กฟภ.",
      autoVerify: false,
      bankAccountNo: null,
      bankName: null,
      clubId: sampleLessonIds.club,
      note: null,
      promptPayId: "0812345678",
      slipRetentionDays: 365,
      updatedAt: null,
    },
    rules: { ...sample.rules, max_bookings_per_member: 4, announcement_body: "สวมรองเท้าผ้าใบหรือรองเท้ากอล์ฟ มาก่อนเวลา 10 นาที", announcement_title: "กติกาคลาสเรียน", announcement_version: 1 },
    settingsLoaded: true,
    slots,
    today,
    unread: 2,
    v2: true,
  };
}

/** Same id scheme as lessonSampleData (the coach note points at booking 1001). */
function sampleIdFor(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
