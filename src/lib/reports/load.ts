import "server-only";

import { classifyDbError, collectLoadErrors } from "@/lib/supabase/errors";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { createClient } from "@/lib/supabase/server";

import type { EventRow, LessonBookingRow, LessonSlotRow, PaymentRow, RegistrationRow } from "./aggregate";
import type { CoachSlotRow } from "./lessons";
import type { RevenuePaymentRow } from "./revenue";

type Client = Awaited<ReturnType<typeof createClient>>;

export const reportRoles = ["platform_owner", "club_admin", "committee", "finance_officer", "tournament_director", "auditor"];

/** Roles that may see money (same as the payment_records SELECT policy and the CSV export). */
export const financeRoles = ["platform_owner", "club_admin", "finance_officer", "auditor"];

export { reportPeriod, reportPresets } from "./period";

/** Bangkok calendar day bounds as ISO instants, for timestamptz filters. */
function dayStart(date: string) {
  return new Date(`${date}T00:00:00+07:00`).toISOString();
}
function dayEnd(date: string) {
  return new Date(`${date}T23:59:59.999+07:00`).toISOString();
}

type SlotJoin = {
  capacity: number;
  coach_id?: string | null;
  coach_name: string | null;
  end_time: string | null;
  id: string;
  lesson_date: string;
  lesson_programs: { coach_name: string | null; name: string } | null;
  program_id: string;
  start_time: string | null;
  status: string;
};

const slotColumns = "id, program_id, capacity, status, lesson_date, start_time, end_time, coach_name, lesson_programs(name, coach_name)";

/**
 * Lesson slots of the period. `coach_id` arrives with the lessons v2 migration; until it is
 * applied the query is retried without it and coaches are grouped by the typed coach name.
 */
async function loadSlots(supabase: Client, clubId: string, period: { from: string; to: string }) {
  const query = (columns: string) =>
    fetchAllRows<SlotJoin>((from, to) =>
      supabase
        .from("lesson_slots")
        .select(columns)
        .eq("club_id", clubId)
        .is("archived_at", null)
        .gte("lesson_date", period.from)
        .lte("lesson_date", period.to)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: SlotJoin[] | null; error: null }>,
    );
  const withCoach = await query(`${slotColumns}, coach_id`);
  if (withCoach.error && classifyDbError(withCoach.error) === "schema-outdated") {
    return query(slotColumns);
  }
  return withCoach;
}

type RevenueJoin = { amount: number | string; created_at: string; purpose?: string | null; reviewed_at: string | null; status: string };

/**
 * Approved payments approved inside the period (or created inside it when an old row has no
 * review time). `purpose` arrives with the phase 2 foundation migration; without it every
 * payment is an event payment.
 */
async function loadRevenue(supabase: Client, clubId: string, period: { from: string; to: string }) {
  const start = dayStart(period.from);
  const end = dayEnd(period.to);
  const inPeriod = `and(reviewed_at.gte."${start}",reviewed_at.lte."${end}"),and(reviewed_at.is.null,created_at.gte."${start}",created_at.lte."${end}")`;
  const query = (columns: string) =>
    fetchAllRows<RevenueJoin>((from, to) =>
      supabase
        .from("payment_records")
        .select(columns)
        .eq("club_id", clubId)
        .eq("status", "approved")
        .or(inPeriod)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: RevenueJoin[] | null; error: null }>,
    );
  const withPurpose = await query("amount, status, reviewed_at, created_at, purpose");
  if (withPurpose.error && classifyDbError(withPurpose.error) === "schema-outdated") {
    return query("amount, status, reviewed_at, created_at");
  }
  return withPurpose;
}

/**
 * Names for `lesson_slots.coach_id` when it holds staff user ids (coach role). Uses the
 * platform migration's `club_staff_names`; when that is missing the typed coach name is used.
 */
/** lesson_slots.coach_id → lesson_coaches (track 1, 20261123093000_lessons_v2.sql). */
async function loadCoachNames(supabase: Client, clubId: string, slots: SlotJoin[]): Promise<Record<string, string>> {
  const ids = [...new Set(slots.map((slot) => slot.coach_id).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return {};
  const { data, error } = await supabase.from("lesson_coaches").select("id, full_name, nickname").eq("club_id", clubId).in("id", ids);
  if (error) return {};
  const names: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ full_name: string | null; id: string; nickname: string | null }>) {
    const name = row.full_name?.trim();
    if (name) names[row.id] = row.nickname?.trim() ? `${name} (${row.nickname.trim()})` : name;
  }
  return names;
}

export async function loadReportData(
  supabase: Client,
  clubId: string,
  period: { from: string; to: string },
  { paymentAccess = true }: { paymentAccess?: boolean } = {},
) {
  // Row lists page through fetchAllRows: one request returns at most 1,000 rows (Supabase's
  // default Max rows), and a year of bookings or payments can pass that and skew the totals.
  const noRows = { data: [], error: null };
  const [payments, revenue, slots, bookings, events, registrations, activeMembers, pendingMembers, newMembers] = await Promise.all([
    paymentAccess
      ? fetchAllRows((from, to) =>
          supabase
            .from("payment_records")
            .select("amount, status, slip_file_id, event_registrations(event_id, events(name))")
            .eq("club_id", clubId)
            .gte("created_at", dayStart(period.from))
            .lte("created_at", dayEnd(period.to))
            .order("id")
            .range(from, to),
        )
      : Promise.resolve(noRows),
    paymentAccess ? loadRevenue(supabase, clubId, period) : Promise.resolve(noRows),
    loadSlots(supabase, clubId, period),
    fetchAllRows((from, to) =>
      supabase
        .from("lesson_bookings")
        .select("slot_id, status, lesson_slots!inner(lesson_date)")
        .eq("club_id", clubId)
        .gte("lesson_slots.lesson_date", period.from)
        .lte("lesson_slots.lesson_date", period.to)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("events")
        .select("id, name, event_date, capacity")
        .eq("club_id", clubId)
        .is("archived_at", null)
        .gte("event_date", period.from)
        .lte("event_date", period.to)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("event_registrations")
        .select("event_id, status, checked_in_at, events!inner(event_date)")
        .eq("club_id", clubId)
        .gte("events.event_date", period.from)
        .lte("events.event_date", period.to)
        .order("id")
        .range(from, to),
    ),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("status", "active").is("archived_at", null),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("status", "pending_verification").is("archived_at", null),
    // New members exclude archived (deleted) rows, the same scope as the member list.
    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("club_id", clubId)
      .is("archived_at", null)
      .gte("created_at", dayStart(period.from))
      .lte("created_at", dayEnd(period.to)),
  ]);

  const loadError = collectLoadErrors("admin.reports", [
    { error: payments.error, label: "การเงินรายกิจกรรม" },
    { error: revenue.error, label: "รายรับรายเดือน" },
    { error: slots.error, label: "รอบเรียน" },
    { error: bookings.error, label: "การจองเรียน" },
    { error: events.error, label: "กิจกรรม" },
    { error: registrations.error, label: "ผู้สมัครกิจกรรม" },
    { error: activeMembers.error ?? pendingMembers.error ?? newMembers.error, label: "จำนวนสมาชิก" },
  ]);

  type PaymentJoin = { amount: number; event_registrations: { event_id: string; events: { name: string } | null } | null; slip_file_id: string | null; status: string };
  const slotRows = (slots.data ?? []) as SlotJoin[];
  const coachNames = await loadCoachNames(supabase, clubId, slotRows);

  return {
    bookings: (bookings.data ?? []) as LessonBookingRow[],
    coachNames,
    coachSlots: slotRows.map<CoachSlotRow>((row) => ({
      coach_id: row.coach_id ?? null,
      coach_name: row.coach_name,
      end_time: row.end_time,
      lesson_date: row.lesson_date,
      program_coach_name: row.lesson_programs?.coach_name ?? null,
      start_time: row.start_time,
      status: row.status,
    })),
    events: (events.data ?? []) as EventRow[],
    loadError,
    members: { active: activeMembers.count ?? 0, new: newMembers.count ?? 0, pending: pendingMembers.count ?? 0 },
    paymentAccess: paymentAccess && !payments.error,
    payments: ((payments.data ?? []) as unknown as PaymentJoin[]).map<PaymentRow>((row) => ({
      amount: row.amount,
      event_id: row.event_registrations?.event_id ?? null,
      event_name: row.event_registrations?.events?.name ?? "ไม่ระบุกิจกรรม",
      has_slip: Boolean(row.slip_file_id),
      status: row.status,
    })),
    registrations: (registrations.data ?? []) as RegistrationRow[],
    revenue: (revenue.data ?? []) as RevenuePaymentRow[],
    slots: slotRows.map<LessonSlotRow>((row) => ({
      capacity: row.capacity,
      id: row.id,
      lesson_date: row.lesson_date,
      program_id: row.program_id,
      program_name: row.lesson_programs?.name ?? "คอร์ส",
      status: row.status,
    })),
  };
}

export type ReportData = Awaited<ReturnType<typeof loadReportData>>;
