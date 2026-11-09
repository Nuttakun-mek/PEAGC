import "server-only";

import { bangkokDate } from "@/lib/lessons/booking";
import type { createClient } from "@/lib/supabase/server";

import type { EventRow, LessonBookingRow, LessonSlotRow, PaymentRow, RegistrationRow } from "./aggregate";

type Client = Awaited<ReturnType<typeof createClient>>;

export const reportRoles = ["platform_owner", "club_admin", "committee", "finance_officer", "tournament_director", "auditor"];

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** Report period from query params; defaults to 1 Jan of the current (Bangkok) year .. today. */
export function reportPeriod(from?: string, to?: string) {
  const today = bangkokDate();
  const start = from && datePattern.test(from) ? from : `${today.slice(0, 4)}-01-01`;
  const end = to && datePattern.test(to) ? to : today;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/** Bangkok calendar day bounds as ISO instants, for timestamptz filters. */
function dayStart(date: string) {
  return new Date(`${date}T00:00:00+07:00`).toISOString();
}
function dayEnd(date: string) {
  return new Date(`${date}T23:59:59.999+07:00`).toISOString();
}

export async function loadReportData(supabase: Client, clubId: string, period: { from: string; to: string }) {
  const [payments, slots, bookings, events, registrations, activeMembers, pendingMembers, newMembers] = await Promise.all([
    supabase
      .from("payment_records")
      .select("amount, status, event_registrations(event_id, events(name))")
      .eq("club_id", clubId)
      .gte("created_at", dayStart(period.from))
      .lte("created_at", dayEnd(period.to))
      .limit(10000),
    supabase
      .from("lesson_slots")
      .select("id, program_id, capacity, status, lesson_date, lesson_programs(name)")
      .eq("club_id", clubId)
      .is("archived_at", null)
      .gte("lesson_date", period.from)
      .lte("lesson_date", period.to)
      .limit(5000),
    supabase
      .from("lesson_bookings")
      .select("slot_id, status, lesson_slots!inner(lesson_date)")
      .eq("club_id", clubId)
      .gte("lesson_slots.lesson_date", period.from)
      .lte("lesson_slots.lesson_date", period.to)
      .limit(20000),
    supabase
      .from("events")
      .select("id, name, event_date, capacity")
      .eq("club_id", clubId)
      .is("archived_at", null)
      .gte("event_date", period.from)
      .lte("event_date", period.to)
      .limit(500),
    supabase
      .from("event_registrations")
      .select("event_id, status, checked_in_at, events!inner(event_date)")
      .eq("club_id", clubId)
      .gte("events.event_date", period.from)
      .lte("events.event_date", period.to)
      .limit(20000),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("status", "active").is("archived_at", null),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("status", "pending_verification").is("archived_at", null),
    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("club_id", clubId)
      .gte("created_at", dayStart(period.from))
      .lte("created_at", dayEnd(period.to)),
  ]);

  type PaymentJoin = { amount: number; event_registrations: { event_id: string; events: { name: string } | null } | null; status: string };
  type SlotJoin = { capacity: number; id: string; lesson_date: string; lesson_programs: { name: string } | null; program_id: string; status: string };

  return {
    bookings: (bookings.data ?? []) as LessonBookingRow[],
    events: (events.data ?? []) as EventRow[],
    members: { active: activeMembers.count ?? 0, new: newMembers.count ?? 0, pending: pendingMembers.count ?? 0 },
    paymentAccess: !payments.error,
    payments: ((payments.data ?? []) as unknown as PaymentJoin[]).map<PaymentRow>((row) => ({
      amount: row.amount,
      event_id: row.event_registrations?.event_id ?? null,
      event_name: row.event_registrations?.events?.name ?? "ไม่ระบุกิจกรรม",
      status: row.status,
    })),
    registrations: (registrations.data ?? []) as RegistrationRow[],
    slots: ((slots.data ?? []) as unknown as SlotJoin[]).map<LessonSlotRow>((row) => ({
      capacity: row.capacity,
      id: row.id,
      lesson_date: row.lesson_date,
      program_id: row.program_id,
      program_name: row.lesson_programs?.name ?? "คอร์ส",
      status: row.status,
    })),
  };
}
