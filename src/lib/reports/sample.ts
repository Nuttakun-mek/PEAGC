// Sample report data for the bypass preview (`?bypass=admin`), so the page and its chart can be
// checked without a database. Deterministic: the same period always gives the same numbers.

import type { EventRow, LessonBookingRow, LessonSlotRow, PaymentRow, RegistrationRow } from "./aggregate";
import type { CoachSlotRow } from "./lessons";
import { type RevenuePaymentRow, monthsInPeriod } from "./revenue";

const programs = [
  { coach: "โค้ชเอก", id: "sample-program-1", name: "พื้นฐานวงสวิง" },
  { coach: "โค้ชบี", id: "sample-program-2", name: "ชิพและพัตต์" },
  { coach: "", id: "sample-program-3", name: "ออกรอบจริงกับโค้ช" },
];

const eventNames = ["ออกรอบประจำเดือน", "แข่งขันชิงถ้วยประธาน", "กอล์ฟการกุศล"];

export function sampleReportData(period: { from: string; to: string }, today: string) {
  // Up to 12 months ending at the current month (or the period end if that is earlier).
  const lastMonth = (period.to < today ? period.to : today).slice(0, 7);
  const months = monthsInPeriod(period.from, period.to).filter((month) => month <= lastMonth).slice(-12);

  const revenue: RevenuePaymentRow[] = [];
  const payments: PaymentRow[] = [];
  const slots: LessonSlotRow[] = [];
  const coachSlots: CoachSlotRow[] = [];
  const bookings: LessonBookingRow[] = [];
  const events: EventRow[] = [];
  const registrations: RegistrationRow[] = [];

  months.forEach((month, index) => {
    const reviewed = (day: number) => `${month}-${String(day).padStart(2, "0")}T10:00:00+07:00`;
    const eventPlayers = 12 + ((index * 5) % 9);
    for (let player = 0; player < eventPlayers; player += 1) {
      revenue.push({ amount: 1500, created_at: reviewed(10), purpose: "event", reviewed_at: reviewed(12), status: "approved" });
    }
    const packages = 2 + ((index * 3) % 5);
    for (let item = 0; item < packages; item += 1) {
      revenue.push({ amount: 3500, created_at: reviewed(3), purpose: "lesson_package", reviewed_at: reviewed(4), status: "approved" });
    }
    if (month.endsWith("-01") || month.endsWith("-10")) {
      for (let item = 0; item < 18; item += 1) {
        revenue.push({ amount: 500, created_at: reviewed(2), purpose: "membership_fee", reviewed_at: reviewed(5), status: "approved" });
      }
    }
    // A refunded and a rejected slip never count as revenue.
    revenue.push({ amount: 1500, created_at: reviewed(11), purpose: "event", reviewed_at: reviewed(13), status: "refunded" });

    const eventId = `sample-event-${index}`;
    const eventDate = `${month}-20`;
    if (eventDate >= period.from && eventDate <= period.to) {
      const name = `${eventNames[index % eventNames.length]} ${index + 1}`;
      events.push({ capacity: 24, event_date: eventDate, id: eventId, name });
      for (let player = 0; player < eventPlayers; player += 1) {
        registrations.push({ checked_in_at: player % 7 === 6 ? null : `${eventDate}T06:30:00+07:00`, event_id: eventId, status: "paid" });
        payments.push({ amount: 1500, event_id: eventId, event_name: name, has_slip: true, status: "approved" });
      }
      registrations.push({ checked_in_at: null, event_id: eventId, status: "no_show" });
      registrations.push({ checked_in_at: null, event_id: eventId, status: "waitlist" });
      payments.push({ amount: 1500, event_id: eventId, event_name: name, has_slip: true, status: index % 2 ? "review" : "refunded" });
    }

    programs.forEach((program, programIndex) => {
      [6, 13, 27].forEach((day, dayIndex) => {
        const date = `${month}-${String(day).padStart(2, "0")}`;
        if (date < period.from || date > period.to) return;
        const id = `sample-slot-${index}-${programIndex}-${dayIndex}`;
        const capacity = 6;
        slots.push({ capacity, id, lesson_date: date, program_id: program.id, program_name: program.name, status: date <= today ? "completed" : "open" });
        coachSlots.push({
          coach_name: program.coach || null,
          end_time: programIndex === 2 ? "12:00:00" : "10:30:00",
          lesson_date: date,
          start_time: "09:00:00",
          status: date <= today ? "completed" : "open",
        });
        const booked = 3 + ((index + programIndex + dayIndex) % 4);
        for (let seat = 0; seat < booked; seat += 1) {
          const status = date > today ? "booked" : seat === 0 && (index + dayIndex) % 3 === 0 ? "no_show" : "attended";
          bookings.push({ slot_id: id, status });
        }
      });
    });
  });

  return {
    bookings,
    coachNames: {} as Record<string, string>,
    coachSlots,
    events,
    loadError: null as { labels: string[]; outdated: boolean } | null,
    members: { active: 186, new: 14, pending: 3 },
    paymentAccess: true,
    payments,
    registrations,
    revenue,
    slots,
  };
}
