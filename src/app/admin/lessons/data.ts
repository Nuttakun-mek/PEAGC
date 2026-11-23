import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { type AdminLessonProgram, type AdminLessonSlot } from "@/lib/lessons/admin";
import { addDays, bangkokDate, queueStatus } from "@/lib/lessons/booking";
import { isInactiveStatus } from "@/lib/lessons/labels";
import { type LessonRules, lessonRuleColumns, parseLessonRules } from "@/lib/lessons/rules";
import type {
  LessonBookingStatus,
  LessonClosure,
  LessonCoach,
  LessonEnrollmentBalance,
  LessonPackage,
  LessonRosterRow,
  LessonVenue,
} from "@/lib/lessons/types";
import { classifyDbError } from "@/lib/supabase/errors";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { createClient } from "@/lib/supabase/server";

// Queries of /admin/lessons. Every v2 query has a v1 fallback: the UAT database runs without the
// lessons v2 migration at first, and the old features (courses, rounds, attendance, booking
// window) must keep working there. `outdated` tells the page to show the "ฐานข้อมูลยังไม่ได้อัปเดต" banner.

type Client = Awaited<ReturnType<typeof createClient>>;
type Result<T> = { data: T | null; error: PostgrestError | null };
export type LoadIssue = { error: PostgrestError | null; label: string };

async function tryV2<T>(v2: () => PromiseLike<Result<T>>, v1: () => PromiseLike<Result<T>>) {
  const first = await v2();
  if (first.error && classifyDbError(first.error) === "schema-outdated") {
    const second = await v1();
    return { data: second.data, error: second.error, outdated: true };
  }
  return { data: first.data, error: first.error, outdated: false };
}

const PROGRAM_V1 = "id, name, coach_name, level, price, description, status";
const PROGRAM_V2 = `${PROGRAM_V1}, requires_package, default_coach_id, default_venue_id`;
const SLOT_V1 =
  "id, program_id, title, coach_name, venue, lesson_date, start_time, end_time, capacity, waitlist_capacity, booked_count, status, note, allow_member_reschedule, reschedule_cutoff_hours, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections, lesson_programs(name)";
const SLOT_V2 = `${SLOT_V1}, coach_id, venue_id, bay_label, closure_id, seats_taken, waitlist_count`;
const SETTINGS_V1 =
  "booking_open_at, booking_close_at, max_bookings_per_member, cancel_cutoff_hours, announcement_title, announcement_body, announcement_version";

type RawSlot = Omit<AdminLessonSlot, "program_name"> & { lesson_programs?: { name: string } | { name: string }[] | null };

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export function toAdminSlot(row: RawSlot): AdminLessonSlot {
  const { lesson_programs: program, ...rest } = row;
  return { ...rest, program_name: first(program)?.name ?? null };
}

export type LessonsBase = {
  coaches: LessonCoach[];
  issues: LoadIssue[];
  programs: AdminLessonProgram[];
  rules: LessonRules;
  /** lessons v2 migration applied */
  v2: boolean;
  venues: LessonVenue[];
};

/** Courses, coaches, venues and rules: every tab needs some of them. */
export async function loadLessonsBase(supabase: Client, clubId: string): Promise<LessonsBase> {
  const [programs, settings, coaches, venues] = await Promise.all([
    tryV2<AdminLessonProgram[]>(
      () => supabase.from("lesson_programs").select(PROGRAM_V2).eq("club_id", clubId).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
      () => supabase.from("lesson_programs").select(PROGRAM_V1).eq("club_id", clubId).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
    ),
    tryV2<Record<string, unknown> | null>(
      () => supabase.from("lesson_booking_settings").select(lessonRuleColumns).eq("club_id", clubId).maybeSingle(),
      () => supabase.from("lesson_booking_settings").select(SETTINGS_V1).eq("club_id", clubId).maybeSingle(),
    ),
    supabase.from("lesson_coaches").select("id, club_id, full_name, nickname, phone, user_id, member_id, bio, status, archived_at").eq("club_id", clubId).is("archived_at", null).order("full_name"),
    supabase.from("lesson_venues").select("id, club_id, name, address, bay_count, capacity_per_bay, note, status, archived_at").eq("club_id", clubId).is("archived_at", null).order("name"),
  ]);

  const coachesOutdated = Boolean(coaches.error && classifyDbError(coaches.error) === "schema-outdated");
  const venuesOutdated = Boolean(venues.error && classifyDbError(venues.error) === "schema-outdated");
  const v2 = !programs.outdated && !settings.outdated && !coachesOutdated && !venuesOutdated;

  return {
    coaches: (coaches.data ?? []) as LessonCoach[],
    issues: [
      { error: programs.error, label: "คอร์สเรียน" },
      { error: settings.error, label: "กติกาการจอง" },
      { error: coachesOutdated ? null : coaches.error, label: "ผู้สอน" },
      { error: venuesOutdated ? null : venues.error, label: "สถานที่" },
    ],
    programs: ((programs.data ?? []) as AdminLessonProgram[]).map((program) => ({ ...program, price: Number(program.price ?? 0) })),
    rules: parseLessonRules(settings.data as Partial<Record<keyof LessonRules, unknown>> | null),
    v2,
    venues: ((venues.data ?? []) as LessonVenue[]),
  };
}

/** Rounds between two dates (inclusive), every course, not archived. */
export async function loadSlotsBetween(supabase: Client, clubId: string, from: string, to: string, v2: boolean) {
  const query = (columns: string) =>
    fetchAllRows<RawSlot>((start, end) =>
      supabase
        .from("lesson_slots")
        .select(columns)
        .eq("club_id", clubId)
        .is("archived_at", null)
        .gte("lesson_date", from)
        .lte("lesson_date", to)
        .order("lesson_date", { ascending: true })
        .order("start_time", { ascending: true })
        .order("id")
        .range(start, end) as unknown as PromiseLike<Result<RawSlot[]>>,
    );
  const result = v2 ? await tryV2(() => query(SLOT_V2), () => query(SLOT_V1)) : { ...(await query(SLOT_V1)), outdated: false };
  return { error: result.error, outdated: result.outdated, slots: (result.data ?? []).map(toAdminSlot) };
}

/** The list view: from 30 days back, at most `limit` rounds (same window as before the calendar). */
export async function loadSlotList(supabase: Client, clubId: string, v2: boolean, pastDays: number, limit: number) {
  const from = addDays(bangkokDate(), -pastDays);
  const query = (columns: string) =>
    supabase
      .from("lesson_slots")
      .select(columns)
      .eq("club_id", clubId)
      .is("archived_at", null)
      .gte("lesson_date", from)
      .order("lesson_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(limit) as unknown as PromiseLike<Result<RawSlot[]>>;
  const result = v2 ? await tryV2(() => query(SLOT_V2), () => query(SLOT_V1)) : { ...(await query(SLOT_V1)), outdated: false };
  return { error: result.error, from, slots: (result.data ?? []).map(toAdminSlot) };
}

export async function loadClosures(supabase: Client, clubId: string, from: string, to: string) {
  const { data, error } = await supabase
    .from("lesson_closures")
    .select("id, club_id, closure_date, venue_id, reason, slots_cancelled, bookings_closed, members_notified, credits_refunded, created_at, created_by")
    .eq("club_id", clubId)
    .gte("closure_date", from)
    .lte("closure_date", to)
    .order("closure_date", { ascending: true });
  return { closures: (data ?? []) as LessonClosure[], error };
}

export async function loadSlot(supabase: Client, clubId: string, slotId: string, v2: boolean) {
  const query = (columns: string) =>
    supabase.from("lesson_slots").select(columns).eq("club_id", clubId).eq("id", slotId).is("archived_at", null).maybeSingle() as unknown as PromiseLike<Result<RawSlot>>;
  const result = v2 ? await tryV2(() => query(SLOT_V2), () => query(SLOT_V1)) : { ...(await query(SLOT_V1)), outdated: false };
  return { error: result.error, slot: result.data ? toAdminSlot(result.data) : null };
}

type V1Booking = {
  attendance_note: string | null;
  booked_at: string | null;
  checked_in_at: string | null;
  id: string;
  member_id: string;
  members: { avatar_url?: string | null; employee_code: string | null; full_name: string; member_code?: string | null; nickname: string | null; phone: string | null; skill_level?: string | null } | null;
  queue_seq: number | null;
  status: string;
};

/**
 * Roster of one round: rpc("lesson_slot_roster") on v2 (credits, last coach note); on the old
 * schema the bookings are read directly and the FCFS position decides seat vs คิวสำรอง.
 */
export async function loadRoster(supabase: Client, clubId: string, slot: AdminLessonSlot, v2: boolean): Promise<{ error: PostgrestError | null; roster: LessonRosterRow[] }> {
  if (v2) {
    const { data, error } = await supabase.rpc("lesson_slot_roster", { p_slot_id: slot.id });
    if (!error || classifyDbError(error) !== "schema-outdated") {
      return { error, roster: (data ?? []) as LessonRosterRow[] };
    }
  }
  const { data, error } = await supabase
    .from("lesson_bookings")
    .select("id, member_id, status, queue_seq, booked_at, checked_in_at, attendance_note, members(full_name, nickname, phone, employee_code, member_code, avatar_url, skill_level)")
    .eq("club_id", clubId)
    .eq("slot_id", slot.id)
    .order("queue_seq", { ascending: true })
    .order("id");
  const rows = (data ?? []) as unknown as V1Booking[];
  let position = 0;
  const roster = rows.map((row): LessonRosterRow => {
    const member = first(row.members);
    const active = !isInactiveStatus(row.status);
    if (active) position += 1;
    const waitlisted = active && queueStatus(position, slot.capacity).kind === "waitlisted";
    const status = (waitlisted && row.status === "booked" ? "waitlist" : row.status) as LessonBookingStatus;
    return {
      attendance_note: row.attendance_note,
      avatar_url: member?.avatar_url ?? null,
      booked_at: row.booked_at ?? "",
      booking_id: row.id,
      booking_status: status,
      checked_in_at: row.checked_in_at,
      credit_used: false,
      employee_code: member?.employee_code ?? null,
      full_name: member?.full_name ?? "",
      last_note: null,
      last_note_at: null,
      member_code: member?.member_code ?? null,
      member_id: row.member_id,
      nickname: member?.nickname ?? null,
      offer_expires_at: null,
      phone: member?.phone ?? null,
      queue_position: active ? position : null,
      skill_level: member?.skill_level ?? null,
    };
  });
  // Same order as the RPC: seats, then the waitlist, then cancelled.
  const rank = (row: LessonRosterRow) => (isInactiveStatus(row.booking_status) ? 2 : row.booking_status === "waitlist" ? 1 : 0);
  roster.sort((a, b) => rank(a) - rank(b));
  return { error, roster };
}

export type PackageStats = { active: number; pending: number };

export type CourseExtras = {
  activeEnrollments: number;
  archivedPackages: LessonPackage[];
  archivedPrograms: Array<{ archived_at: string | null; id: string; name: string }>;
  issues: LoadIssue[];
  memberResults: MemberCredit[];
  packageStats: Map<string, PackageStats>;
  packages: LessonPackage[];
  pendingEnrollments: Array<LessonEnrollmentBalance & { member_name: string | null }>;
};

export type MemberCredit = {
  employee_code: string | null;
  enrollments: LessonEnrollmentBalance[];
  full_name: string;
  id: string;
  member_code: string | null;
  nickname: string | null;
  phone: string | null;
};

/** Escapes PostgREST `or()` / `ilike` special characters in a search term. */
function searchTerm(value: string) {
  return value.replace(/[%_,()\\*]/g, " ").trim().slice(0, 60);
}

/** Packages, enrollment counts, archived courses and the credit-adjustment member search. */
export async function loadCourseExtras(supabase: Client, clubId: string, v2: boolean, memberQuery: string): Promise<CourseExtras> {
  const archivedPrograms = await supabase
    .from("lesson_programs")
    .select("id, name, archived_at")
    .eq("club_id", clubId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(30);

  const empty: CourseExtras = {
    activeEnrollments: 0,
    archivedPackages: [],
    archivedPrograms: archivedPrograms.data ?? [],
    issues: [{ error: archivedPrograms.error, label: "คอร์สที่เก็บถาวร" }],
    memberResults: [],
    packageStats: new Map(),
    packages: [],
    pendingEnrollments: [],
  };
  if (!v2) return empty;

  const nowIso = new Date().toISOString();
  const term = searchTerm(memberQuery);
  const [packages, archivedPackages, enrollmentRows, activeCount, pending, members] = await Promise.all([
    supabase.from("lesson_packages").select("*").eq("club_id", clubId).is("archived_at", null).order("sort_order").order("created_at"),
    supabase.from("lesson_packages").select("*").eq("club_id", clubId).not("archived_at", "is", null).order("archived_at", { ascending: false }).limit(20),
    fetchAllRows<{ id: string; package_id: string | null; status: string }>((from, to) =>
      supabase.from("lesson_enrollments").select("id, package_id, status").eq("club_id", clubId).in("status", ["active", "pending_payment"]).order("id").range(from, to),
    ),
    supabase.from("lesson_enrollments").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("status", "active").gt("expires_at", nowIso),
    supabase.from("lesson_enrollment_balances").select("*").eq("club_id", clubId).eq("status", "pending_payment").order("created_at", { ascending: false }).limit(20),
    term
      ? supabase
          .from("members")
          .select("id, full_name, nickname, member_code, employee_code, phone")
          .eq("club_id", clubId)
          .is("archived_at", null)
          .or(`full_name.ilike.*${term}*,nickname.ilike.*${term}*,member_code.ilike.*${term}*,employee_code.ilike.*${term}*,phone.ilike.*${term}*`)
          .order("full_name")
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const stats = new Map<string, PackageStats>();
  for (const row of enrollmentRows.data ?? []) {
    if (!row.package_id) continue;
    const entry = stats.get(row.package_id) ?? { active: 0, pending: 0 };
    if (row.status === "active") entry.active += 1;
    else entry.pending += 1;
    stats.set(row.package_id, entry);
  }

  const pendingRows = (pending.data ?? []) as LessonEnrollmentBalance[];
  const memberRows = (members.data ?? []) as Array<Omit<MemberCredit, "enrollments">>;
  const [names, balances] = await Promise.all([
    pendingRows.length
      ? supabase.from("members").select("id, full_name, nickname").in("id", pendingRows.map((row) => row.member_id))
      : Promise.resolve({ data: [], error: null }),
    memberRows.length
      ? supabase.from("lesson_enrollment_balances").select("*").in("member_id", memberRows.map((row) => row.id)).order("expires_at", { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const nameById = new Map(((names.data ?? []) as Array<{ full_name: string; id: string; nickname: string | null }>).map((row) => [row.id, row.nickname ? `${row.full_name} (${row.nickname})` : row.full_name]));
  const balanceRows = (balances.data ?? []) as LessonEnrollmentBalance[];

  return {
    activeEnrollments: activeCount.count ?? 0,
    archivedPackages: (archivedPackages.data ?? []) as LessonPackage[],
    archivedPrograms: archivedPrograms.data ?? [],
    issues: [
      ...empty.issues,
      { error: packages.error, label: "แพ็กเกจ" },
      { error: enrollmentRows.error ?? activeCount.error ?? pending.error, label: "การซื้อแพ็กเกจ" },
      { error: members.error ?? balances.error, label: "ค้นหาสมาชิก" },
    ],
    memberResults: memberRows.map((member) => ({ ...member, enrollments: balanceRows.filter((row) => row.member_id === member.id) })),
    packageStats: stats,
    packages: ((packages.data ?? []) as LessonPackage[]).map((pkg) => ({ ...pkg, price: Number(pkg.price ?? 0) })),
    pendingEnrollments: pendingRows.map((row) => ({ ...row, member_name: nameById.get(row.member_id) ?? null })),
  };
}

export type StaffName = { display_name: string | null; role_keys: string[]; user_id: string };

/** Linked coach logins: names and whether the `coach` role is still there. */
export async function loadStaffNames(supabase: Client, clubId: string) {
  const { data, error } = await supabase.rpc("club_staff_names", { p_club_id: clubId });
  return { error, names: new Map(((data ?? []) as StaffName[]).map((row) => [row.user_id, row])) };
}

/** Members who acknowledged the current announcement version. */
export async function countAnnouncementAcks(supabase: Client, clubId: string, version: number) {
  if (version <= 0) return { count: 0, error: null };
  const { count, error } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("club_id", clubId)
    .is("archived_at", null)
    .gte("lesson_announcement_ack_version", version);
  return { count: count ?? 0, error };
}
