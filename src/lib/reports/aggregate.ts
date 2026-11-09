// Pure aggregations for the admin reports page (finance, lessons, events). No I/O.

import { holdsSeat } from "../events/pairing";

export type PaymentRow = { amount: number | string; event_id: string | null; event_name: string; status: string };

export type FinanceLine = {
  approved: number;
  approvedCount: number;
  eventId: string;
  eventName: string;
  pending: number;
  pendingCount: number;
  refunded: number;
};

export function financeByEvent(rows: PaymentRow[]) {
  const lines = new Map<string, FinanceLine>();
  for (const row of rows) {
    const key = row.event_id ?? "unknown";
    const line = lines.get(key) ?? {
      approved: 0,
      approvedCount: 0,
      eventId: key,
      eventName: row.event_name,
      pending: 0,
      pendingCount: 0,
      refunded: 0,
    };
    const amount = Number(row.amount) || 0;
    if (row.status === "approved") {
      line.approved += amount;
      line.approvedCount += 1;
    } else if (row.status === "pending" || row.status === "review") {
      line.pending += amount;
      line.pendingCount += 1;
    } else if (row.status === "refunded") {
      line.refunded += amount;
    }
    lines.set(key, line);
  }
  const list = [...lines.values()].sort((a, b) => b.approved - a.approved || a.eventName.localeCompare(b.eventName, "th"));
  const totals = list.reduce(
    (sum, line) => ({
      approved: sum.approved + line.approved,
      net: sum.net + line.approved - line.refunded,
      pending: sum.pending + line.pending,
      refunded: sum.refunded + line.refunded,
    }),
    { approved: 0, net: 0, pending: 0, refunded: 0 },
  );
  return { lines: list, totals };
}

export type LessonSlotRow = {
  capacity: number;
  id: string;
  lesson_date: string;
  program_id: string;
  program_name: string;
  status: string;
};
export type LessonBookingRow = { slot_id: string; status: string };

export type ProgramUsage = {
  attended: number;
  booked: number;
  noShow: number;
  programId: string;
  programName: string;
  seats: number;
  slots: number;
  /** booked seats (capped at capacity per slot) / seats, 0-1 */
  utilization: number;
  waitlisted: number;
};

export function lessonUsageByProgram(slots: LessonSlotRow[], bookings: LessonBookingRow[]) {
  const activeBySlot = new Map<string, LessonBookingRow[]>();
  for (const booking of bookings) {
    if (booking.status === "cancelled") continue;
    activeBySlot.set(booking.slot_id, [...(activeBySlot.get(booking.slot_id) ?? []), booking]);
  }

  const programs = new Map<string, ProgramUsage>();
  for (const slot of slots) {
    if (slot.status === "cancelled" || slot.status === "draft") continue;
    const usage = programs.get(slot.program_id) ?? {
      attended: 0,
      booked: 0,
      noShow: 0,
      programId: slot.program_id,
      programName: slot.program_name,
      seats: 0,
      slots: 0,
      utilization: 0,
      waitlisted: 0,
    };
    const active = activeBySlot.get(slot.id) ?? [];
    usage.slots += 1;
    usage.seats += slot.capacity;
    usage.booked += Math.min(active.length, slot.capacity);
    usage.waitlisted += Math.max(0, active.length - slot.capacity);
    usage.attended += active.filter((b) => b.status === "attended").length;
    usage.noShow += active.filter((b) => b.status === "no_show").length;
    programs.set(slot.program_id, usage);
  }

  return [...programs.values()]
    .map((usage) => ({ ...usage, utilization: usage.seats ? usage.booked / usage.seats : 0 }))
    .sort((a, b) => b.booked - a.booked);
}

export type EventRow = { capacity: number | null; event_date: string; id: string; name: string };
export type RegistrationRow = { checked_in_at: string | null; event_id: string; status: string };

export function eventAttendance(events: EventRow[], registrations: RegistrationRow[]) {
  return events
    .map((event) => {
      const rows = registrations.filter((row) => row.event_id === event.id);
      const seats = rows.filter((row) => holdsSeat(row.status)).length;
      const checkedIn = rows.filter((row) => holdsSeat(row.status) && row.checked_in_at).length;
      const noShow = rows.filter((row) => row.status === "no_show").length;
      const waitlist = rows.filter((row) => row.status === "waitlist").length;
      return {
        capacity: event.capacity,
        checkedIn,
        eventDate: event.event_date,
        eventId: event.id,
        fill: event.capacity ? seats / event.capacity : null,
        name: event.name,
        noShow,
        noShowRate: seats + noShow ? noShow / (seats + noShow) : 0,
        seats,
        waitlist,
      };
    })
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
}

export function percent(value: number | null) {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

export function baht(value: number) {
  return `${value.toLocaleString("th-TH", { maximumFractionDigits: 2, minimumFractionDigits: 0 })} บาท`;
}
