import Link from "next/link";
import { ChevronRight, Clock3, MapPin, UsersRound } from "lucide-react";

import { CoachHeader } from "@/components/coach-header";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { MemberSection } from "@/components/member-section";
import { StatusBanner } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { formatThaiDateLong, formatThaiDateShort } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { addDays, bangkokDate } from "@/lib/lessons/booking";
import { formatMonthLabel, slotFill } from "@/lib/lessons/calendar";
import { coachSchedule, formatHours, monthlyTeaching, previousMonth } from "@/lib/lessons/coach-view";
import { lessonSampleData } from "@/lib/lessons/sample-data";
import type { LessonSlotRow } from "@/lib/lessons/types";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";

import { coachLabel, coachProblemText, resolveCoachPortal } from "./portal";

type PageProps = {
  searchParams: Promise<{ bypass?: string; coach?: string }>;
};

type CoachSlot = LessonSlotRow & { program_name: string | null };

type Attendance = { attended: number; noShow: number; seats: number };

const CalendarIcon = appIcons.calendar;
const CoachIcon = appIcons.coach;

const slotColumns =
  "id, title, lesson_date, start_time, end_time, capacity, waitlist_capacity, status, booked_count, seats_taken, waitlist_count, venue, bay_label, coach_id, program_id, lesson_programs(name)";

/** One timestamp per request (server component), so every rule on the page uses the same "now". */
function requestTime() {
  return Date.now();
}

function lastDayOfMonth(month: string) {
  const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const next = index === 12 ? `${year + 1}-01-01` : `${year}-${String(index + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

export default async function CoachPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const portal = await resolveCoachPortal(params, "/coach");
  const now = requestTime();
  const today = bangkokDate(now);
  const month = today.slice(0, 7);
  const lastMonth = previousMonth(month);
  const from = `${lastMonth}-01`;
  const to = [addDays(today, 13), lastDayOfMonth(month)].sort().at(-1) as string;

  let slots: CoachSlot[] = [];
  const attendance = new Map<string, Attendance>();
  let loadFailed = false;

  if (portal.coach && portal.isBypass) {
    const sample = lessonSampleData(today);
    const names = new Map(sample.programs.map((program) => [program.id, program.name]));
    slots = sample.slots
      .filter((slot) => slot.coach_id === portal.coach?.id)
      .map((slot) => ({ ...slot, program_name: slot.program_id ? (names.get(slot.program_id) ?? null) : null }));
    const rosterSlot = slots.find((slot) => slot.lesson_date === today && slot.status !== "cancelled");
    if (rosterSlot) attendance.set(rosterSlot.id, { attended: 1, noShow: 0, seats: 4 });
  } else if (portal.coach && portal.supabase) {
    const { data, error } = await portal.supabase
      .from("lesson_slots")
      .select(slotColumns)
      .eq("coach_id", portal.coach.id)
      .is("archived_at", null)
      .gte("lesson_date", from)
      .lte("lesson_date", to)
      .order("lesson_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(500);
    if (error) {
      loadFailed = true;
      if (classifyDbError(error) !== "schema-outdated") logDbError("coach.page slots", error);
    }
    slots = ((data ?? []) as Array<LessonSlotRow & { lesson_programs?: { name: string | null } | { name: string | null }[] | null }>).map(
      ({ lesson_programs, ...slot }) => ({
        ...slot,
        program_name: (Array.isArray(lesson_programs) ? lesson_programs[0]?.name : lesson_programs?.name) ?? null,
      }),
    );

    const scheduleIds = slots.filter((slot) => slot.lesson_date >= today && slot.lesson_date <= addDays(today, 6)).map((slot) => slot.id);
    if (scheduleIds.length) {
      const { data: bookings, error: bookingsError } = await portal.supabase
        .from("lesson_bookings")
        .select("slot_id, status")
        .in("slot_id", scheduleIds)
        .in("status", ["booked", "offered", "attended", "no_show"]);
      if (bookingsError) logDbError("coach.page bookings", bookingsError);
      for (const row of (bookings ?? []) as Array<{ slot_id: string; status: string }>) {
        const entry = attendance.get(row.slot_id) ?? { attended: 0, noShow: 0, seats: 0 };
        entry.seats += 1;
        if (row.status === "attended") entry.attended += 1;
        if (row.status === "no_show") entry.noShow += 1;
        attendance.set(row.slot_id, entry);
      }
    }
  }

  const schedule = coachSchedule(slots, today, 7);
  const coachId = portal.coach?.id ?? "";
  const thisMonth = monthlyTeaching(slots, coachId, month, now);
  const previous = monthlyTeaching(slots, coachId, lastMonth, now);
  const viewingOther = portal.isStaff && portal.coach && params.coach === portal.coach.id;
  const coachQuery = viewingOther ? `?coach=${portal.coach?.id}` : portal.isBypass ? "?bypass=admin" : "";

  const slotLink = (slot: CoachSlot) => {
    const fill = slotFill(slot);
    const marks = attendance.get(slot.id);
    const cancelled = slot.status === "cancelled";
    return (
      <li key={slot.id}>
        <Link
          className={`flex items-center gap-3 rounded-xl border p-4 transition ${cancelled ? "border-line bg-canvas" : "border-line bg-white hover:border-brand-600/50 hover:shadow-card"}`}
          href={`/coach/slots/${slot.id}${coachQuery}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-h3 font-semibold tabular-nums text-ink">{formatTimeRange(slot.start_time, slot.end_time)}</p>
            <p className="text-base text-ink">{slot.title}</p>
            {slot.program_name && slot.program_name !== slot.title ? <p className="text-sm text-ink-muted">{slot.program_name}</p> : null}
            <div className="mt-1.5 grid gap-1 text-sm text-ink-muted">
              <p className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                {slot.venue || "รอแจ้งสนาม"}
              </p>
              <p className="flex items-start gap-1.5 tabular-nums">
                <UsersRound className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                ผู้เรียน {fill.label}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {cancelled ? (
              <StatusBadge kind="lesson" status="cancelled">
                ยกเลิกรอบ
              </StatusBadge>
            ) : marks && marks.seats ? (
              <StatusBadge tone={marks.attended + marks.noShow >= marks.seats ? "success" : "neutral"}>
                เช็กชื่อ {marks.attended + marks.noShow}/{marks.seats}
              </StatusBadge>
            ) : null}
            <ChevronRight className="size-5 text-ink-subtle" aria-hidden="true" />
          </div>
        </Link>
      </li>
    );
  };

  return (
    <main className="min-h-screen bg-canvas px-4 pb-10 pt-5 text-ink sm:px-6">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <CoachHeader hasMemberRow={portal.hasMemberRow} isBypass={portal.isBypass} isStaff={portal.isStaff} name={portal.displayName} />
        <span className="sr-only" id="coach-content" tabIndex={-1} />
        <PageHeader
          description={portal.coach ? (viewingOther ? `ผู้สอน ${coachLabel(portal.coach)}` : formatThaiDateLong(today)) : undefined}
          title={viewingOther ? "ตารางสอน" : "ตารางสอนของฉัน"}
        />
        {portal.isBypass ? <StatusBanner tone="warning">โหมดทดลอง ข้อมูลในหน้านี้เป็นตัวอย่าง</StatusBanner> : null}

        {portal.isStaff && portal.coaches.length ? (
          <form className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-end" method="get">
            <div className="min-w-0 flex-1">
              <label className={fieldLabel} htmlFor="coach-picker">
                ดูตารางของผู้สอน
              </label>
              <select className={fieldInputClass("lg")} defaultValue={portal.coach?.id ?? ""} id="coach-picker" name="coach">
                <option disabled value="">
                  เลือกผู้สอน
                </option>
                {portal.coaches.map((coach) => (
                  <option key={coach.id} value={coach.id}>
                    {coachLabel(coach)}
                    {coach.status !== "active" ? " (พักการสอน)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <button className={buttonClass("secondary", "lg")} type="submit">
              ดูตาราง
            </button>
          </form>
        ) : null}

        {portal.problem === "pick-coach" && !portal.coaches.length ? (
          <StatusBanner title="ยังไม่มีรายชื่อผู้สอน" tone="info">
            เพิ่มผู้สอนและผูกบัญชีผู้สอนได้ที่หน้าคลาสเรียนของผู้ดูแล
          </StatusBanner>
        ) : portal.problem ? (
          <StatusBanner title={coachProblemText[portal.problem].title} tone={portal.problem === "schema-outdated" ? "error" : "info"}>
            {coachProblemText[portal.problem].body}
          </StatusBanner>
        ) : null}
        {loadFailed ? <StatusBanner tone="error">โหลดตารางสอนไม่สำเร็จ ลองโหลดหน้าใหม่</StatusBanner> : null}

        {portal.coach ? (
          <>
            <MemberSection description={formatThaiDateShort(today)} icon={Clock3} id="today" title="วันนี้">
              {schedule.today.length ? (
                <ul className="grid gap-3">{schedule.today.map(slotLink)}</ul>
              ) : (
                <p className="text-base text-ink-muted">วันนี้ไม่มีรอบสอน</p>
              )}
            </MemberSection>

            <MemberSection description="6 วันถัดไป" icon={CalendarIcon} id="week" title="สัปดาห์นี้">
              {schedule.later.length ? (
                <div className="grid gap-5">
                  {schedule.later.map((day) => (
                    <section aria-label={formatThaiDateLong(day.date)} key={day.date}>
                      <h3 className="mb-2 text-base font-semibold text-ink">{formatThaiDateLong(day.date)}</h3>
                      <ul className="grid gap-3">{day.slots.map(slotLink)}</ul>
                    </section>
                  ))}
                </div>
              ) : (
                <p className="text-base text-ink-muted">ยังไม่มีรอบสอนใน 6 วันถัดไป</p>
              )}
            </MemberSection>

            <MemberSection icon={CoachIcon} id="hours" title="ชั่วโมงสอน">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-canvas p-4">
                  <dt className="text-sm font-medium text-ink-muted">{formatMonthLabel(month)}</dt>
                  <dd className="text-kpi font-semibold tabular-nums text-ink">
                    {formatHours(thisMonth.hours)}
                    <span className="ml-1 text-base font-medium text-ink-muted">ชม.</span>
                  </dd>
                  <dd className="text-sm text-ink-muted">
                    {thisMonth.rounds} รอบ · สอนแล้ว {thisMonth.taught} รอบ ({formatHours(thisMonth.taughtHours)} ชม.) · ยังไม่ถึง {thisMonth.planned} รอบ
                  </dd>
                </div>
                <div className="rounded-lg bg-canvas p-4">
                  <dt className="text-sm font-medium text-ink-muted">{formatMonthLabel(lastMonth)}</dt>
                  <dd className="text-kpi font-semibold tabular-nums text-ink">
                    {formatHours(previous.hours)}
                    <span className="ml-1 text-base font-medium text-ink-muted">ชม.</span>
                  </dd>
                  <dd className="text-sm text-ink-muted">{previous.rounds} รอบ</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-ink-subtle">นับเฉพาะรอบที่ไม่ถูกยกเลิก</p>
            </MemberSection>
          </>
        ) : null}
      </div>
    </main>
  );
}
