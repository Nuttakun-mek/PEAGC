import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleOff } from "lucide-react";

import { closeLessonDay } from "@/app/admin/lessons/calendar-actions";
import { LessonsAdminDialog } from "@/components/lessons-admin-dialog";
import { Required, lessonSlotStatusLabels } from "@/components/lessons-admin-fields";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, buttonSecondary, fieldInput, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { UNSET, formatThaiDateLong, formatThaiDateShort, orUnset } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import {
  type AdminLessonProgram,
  type AdminLessonSlot,
  type CalendarQuery,
  type CalendarView,
  calendarStep,
  dayCloseSummary,
  lessonsAdminHref,
} from "@/lib/lessons/admin";
import { type CalendarDay, type FillLevel, type SlotFill, buildMonth, buildWeek, slotFill, thaiMonthsShort } from "@/lib/lessons/calendar";
import type { LessonClosure, LessonCoach, LessonVenue } from "@/lib/lessons/types";
import type { StatusTone } from "@/lib/status";

// ปฏิทินรอบเรียน (admin): week (default) / month / list, Bangkok dates, filters by course, coach
// and venue. A round links to ?slot=<id>, which opens the side panel (see lessons-admin-slot-panel).

const levelCard: Record<FillLevel, string> = {
  closed: "border-line bg-neutral-bg",
  empty: "border-line bg-white",
  full: "border-warning/40 bg-warning-bg",
  high: "border-warning/30 bg-warning-bg",
  low: "border-info/20 bg-white",
  medium: "border-info/30 bg-info-bg",
};

const toneBar: Record<StatusTone, string> = {
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-neutral/50",
  success: "bg-success",
  warning: "bg-warning",
};

const toneText: Record<StatusTone, string> = {
  danger: "text-danger",
  info: "text-info",
  neutral: "text-ink-subtle",
  success: "text-success",
  warning: "text-warning",
};

function fillWord(fill: SlotFill) {
  if (fill.level === "closed") return "ปิด";
  if (fill.level === "full") return "เต็ม";
  if (fill.level === "high") return "ใกล้เต็ม";
  return `${fill.percent}%`;
}

function FillBar({ fill }: { fill: SlotFill }) {
  return (
    <span aria-hidden="true" className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line">
      <span className={`block h-full rounded-full ${toneBar[fill.tone]}`} style={{ width: `${fill.level === "closed" ? 100 : Math.max(fill.percent, fill.taken ? 6 : 0)}%` }} />
    </span>
  );
}

export type CalendarProps = {
  /** every round of the range before the course / coach / venue filter (closing a day closes them all) */
  allSlots?: AdminLessonSlot[];
  bypass: boolean;
  closures: LessonClosure[];
  coaches: LessonCoach[];
  programs: AdminLessonProgram[];
  query: CalendarQuery;
  slots: AdminLessonSlot[];
  today: string;
  v2: boolean;
  venues: LessonVenue[];
};

function href(props: Pick<CalendarProps, "bypass" | "query">, patch: Partial<CalendarQuery>) {
  return lessonsAdminHref({ ...props.query, slot: "", ...patch, bypass: props.bypass });
}

function SlotCard({ props, slot }: { props: CalendarProps; slot: AdminLessonSlot & { fill: SlotFill } }) {
  const fill = slot.fill;
  const selected = props.query.slot === slot.id;
  const cancelled = slot.status === "cancelled";
  return (
    <Link
      aria-current={selected ? "true" : undefined}
      aria-label={`${slot.title} ${formatTimeRange(slot.start_time, slot.end_time)} ${fill.label}${cancelled ? " ยกเลิกแล้ว" : ""}`}
      className={`block rounded-lg border px-3 py-2 text-left transition hover:border-brand-600 hover:shadow-card focus-visible:outline-2 focus-visible:outline-brand-600 ${levelCard[fill.level]} ${selected ? "ring-2 ring-brand-600" : ""}`}
      href={href(props, { slot: slot.id })}
      scroll={false}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={`text-sm font-semibold tabular-nums ${cancelled ? "text-ink-subtle line-through" : "text-ink"}`}>{formatTimeRange(slot.start_time, slot.end_time)}</span>
        <span className={`text-xs font-medium tabular-nums ${toneText[fill.tone]}`}>{fillWord(fill)}</span>
      </span>
      <span className={`mt-0.5 block truncate text-sm font-medium ${cancelled ? "text-ink-subtle" : "text-ink"}`}>{slot.title}</span>
      {slot.program_name && slot.program_name !== slot.title ? <span className="block truncate text-xs text-ink-muted">{slot.program_name}</span> : null}
      <span className="block truncate text-xs text-ink-muted">{orUnset(slot.coach_name, "ไม่ระบุผู้สอน")}</span>
      <span className="block truncate text-xs text-ink-muted">{orUnset(slot.venue, "ไม่ระบุสถานที่")}</span>
      <FillBar fill={fill} />
      <span className="mt-1 block text-xs tabular-nums text-ink-muted">{cancelled ? "ยกเลิกแล้ว" : slot.status === "draft" ? "ฉบับร่าง" : fill.label}</span>
    </Link>
  );
}

function CloseDayButton({ day, props, returnTo }: { day: CalendarDay<AdminLessonSlot>; props: CalendarProps; returnTo: string }) {
  const daySlots = (props.allSlots ?? props.slots).filter((slot) => slot.lesson_date === day.date);
  const summary = dayCloseSummary(daySlots);
  const CloseIcon = CircleOff;
  return (
    <LessonsAdminDialog
      title={`งดเรียน ${formatThaiDateLong(day.date)}`}
      trigger={
        <>
          <CloseIcon className="size-3.5" aria-hidden="true" />
          งดเรียนทั้งวัน
        </>
      }
      triggerClassName="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-danger transition hover:bg-danger-bg"
      triggerLabel={`งดเรียนทั้งวัน ${formatThaiDateShort(day.date)}`}
    >
      <form action={closeLessonDay} className="grid gap-4">
        <input name="date" type="hidden" value={day.date} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <p className="text-ink-muted">
          วันนั้นมี <span className="font-semibold tabular-nums text-ink">{summary.slots}</span> รอบ ผู้จองและคิวสำรอง{" "}
          <span className="font-semibold tabular-nums text-ink">{summary.people}</span> คน ทุกรอบจะถูกยกเลิก คืนเครดิต และแจ้งเตือนผู้จองทุกคนในแอป
        </p>
        {props.venues.length ? (
          <label className="block">
            <span className={fieldLabel}>งดเรียนที่</span>
            <select className={fieldInput} defaultValue="" name="venueId">
              <option value="">ทุกสถานที่ (ทั้งชมรม)</option>
              {props.venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  เฉพาะ {venue.name} ({dayCloseSummary(daySlots, venue.id).slots} รอบ)
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className={fieldLabel}>เหตุผล<Required /></span>
          <textarea className={fieldTextarea} name="reason" placeholder="เช่น ฝนตกหนัก สนามปิด" required rows={2} />
          <span className="mt-1 block text-xs text-ink-subtle">สมาชิกเห็นข้อความนี้ในการแจ้งเตือน</span>
        </label>
        {props.bypass ? <p className="text-sm text-warning">โหมดทดลอง: บันทึกจริงไม่ได้</p> : null}
        <button className={buttonClass("danger")} disabled={props.bypass} type="submit">
          <CloseIcon className="size-4" aria-hidden="true" />
          ยืนยันงดเรียน
        </button>
      </form>
    </LessonsAdminDialog>
  );
}

function WeekView({ props, returnTo }: { props: CalendarProps; returnTo: string }) {
  const week = buildWeek(props.slots, props.query.date, { today: props.today });
  const closuresByDate = new Map<string, LessonClosure[]>();
  props.closures.forEach((closure) => closuresByDate.set(closure.closure_date, [...(closuresByDate.get(closure.closure_date) ?? []), closure]));
  const venueName = (id: string | null) => props.venues.find((venue) => venue.id === id)?.name;

  return (
    <div className="grid gap-3 lg:grid-cols-7 lg:gap-2">
      {week.days.map((day) => {
        const closures = closuresByDate.get(day.date) ?? [];
        const canClose = props.v2 && !day.isPast && dayCloseSummary((props.allSlots ?? props.slots).filter((slot) => slot.lesson_date === day.date)).slots > 0;
        return (
          <section
            aria-label={formatThaiDateLong(day.date)}
            className={`min-w-0 rounded-xl border bg-white p-2 shadow-card ${day.isToday ? "border-brand-600" : "border-line"} ${day.isPast ? "lg:bg-canvas" : ""}`}
            key={day.date}
          >
            <header className="flex items-center justify-between gap-2 px-1 pb-2 lg:flex-col lg:items-start lg:gap-0.5">
              <h3 className={`text-sm font-semibold ${day.isToday ? "text-brand-600" : "text-ink"}`}>
                {day.weekdayLabel} {day.dayOfMonth} {thaiMonthsShort[Number(day.date.slice(5, 7)) - 1]}
                {day.isToday ? <span className="ml-1 text-xs font-medium">(วันนี้)</span> : null}
              </h3>
              <span className="text-xs tabular-nums text-ink-subtle">{day.summary.slots ? `${day.summary.slots} รอบ · ${day.summary.taken}/${day.summary.capacity} ที่` : "ไม่มีรอบ"}</span>
            </header>
            {closures.map((closure) => (
              <p className="mb-2 rounded-md bg-neutral-bg px-2 py-1.5 text-xs text-ink-muted" key={closure.id}>
                <span className="font-semibold text-ink">งดเรียน{closure.venue_id ? ` ${venueName(closure.venue_id) ?? ""}` : ""}</span> · {closure.reason}
              </p>
            ))}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {day.slots.map((slot) => (
                <SlotCard key={slot.id} props={props} slot={slot} />
              ))}
            </div>
            {canClose ? (
              <div className="mt-2 border-t border-line pt-1">
                <CloseDayButton day={day} props={props} returnTo={returnTo} />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function MonthView({ props }: { props: CalendarProps }) {
  const month = buildMonth(props.slots, props.query.date, { today: props.today });
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[44rem] grid-cols-7 gap-1.5">
        {month.weekdayLabels.map((label) => (
          <p className="px-2 pb-1 text-xs font-medium text-ink-subtle" key={label}>{label}</p>
        ))}
        {month.weeks.flat().map((day) => {
          const extra = day.slots.length - 3;
          return (
            <div
              className={`min-h-28 min-w-0 rounded-lg border p-1.5 ${day.inMonth ? "bg-white" : "bg-canvas text-ink-subtle"} ${day.isToday ? "border-brand-600" : "border-line"}`}
              key={day.date}
            >
              <div className="flex items-center justify-between gap-1 px-0.5">
                <Link
                  aria-label={`ดูสัปดาห์ของ ${formatThaiDateLong(day.date)}`}
                  className={`text-sm font-semibold tabular-nums hover:underline ${day.isToday ? "text-brand-600" : day.inMonth ? "text-ink" : "text-ink-subtle"}`}
                  href={href(props, { date: day.date, view: "week" })}
                >
                  {day.dayOfMonth}
                </Link>
                {day.summary.slots ? (
                  <span className={`text-xs font-medium tabular-nums ${toneText[day.summary.tone]}`}>{day.summary.taken}/{day.summary.capacity}</span>
                ) : null}
              </div>
              <ul className="mt-1 grid gap-1">
                {day.slots.slice(0, 3).map((slot) => (
                  <li key={slot.id}>
                    <Link
                      className={`flex items-center gap-1.5 truncate rounded px-1 py-0.5 text-xs transition hover:bg-brand-50 ${slot.status === "cancelled" ? "text-ink-subtle line-through" : "text-ink"}`}
                      href={href(props, { slot: slot.id })}
                      scroll={false}
                      title={`${slot.title} ${slot.fill.label}`}
                    >
                      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${toneBar[slot.fill.tone]}`} />
                      <span className="tabular-nums">{slot.start_time.slice(0, 5)}</span>
                      <span className="truncate">{slot.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {extra > 0 ? (
                <Link className="mt-0.5 block px-1 text-xs font-medium text-brand-600 hover:underline" href={href(props, { date: day.date, view: "week" })}>
                  อีก {extra} รอบ
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const viewLabels: Record<CalendarView, string> = { list: "รายการ", month: "เดือน", week: "สัปดาห์" };

/** Toolbar + week / month grid. The list view is LessonsAdminSlotList. */
export function LessonsAdminCalendar(props: CalendarProps & { returnTo: string }) {
  const { query } = props;
  const grid = query.view === "month" ? buildMonth(props.slots, query.date, { today: props.today }) : buildWeek(props.slots, query.date, { today: props.today });
  const { label, summary } = grid;
  const filtered = Boolean(query.course || query.coach || query.venue);
  const ChevronPrev = ChevronLeft;

  return (
    <div className="grid gap-4">
      <CalendarToolbar props={props} />
      {query.view !== "list" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link aria-label={query.view === "month" ? "เดือนก่อน" : "สัปดาห์ก่อน"} className={buttonClass("secondary", "sm")} href={href(props, { date: calendarStep(query.view, query.date, -1) })}>
            <ChevronPrev className="size-4" aria-hidden="true" />
          </Link>
          <Link aria-label={query.view === "month" ? "เดือนถัดไป" : "สัปดาห์ถัดไป"} className={buttonClass("secondary", "sm")} href={href(props, { date: calendarStep(query.view, query.date, 1) })}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <Link className={buttonClass("ghost", "sm")} href={href(props, { date: props.today })}>
            วันนี้
          </Link>
          <h2 className="ml-1 text-h3 font-semibold text-ink">{label}</h2>
          {filtered ? <StatusBadge tone="info">กรองอยู่</StatusBadge> : null}
          <p className="w-full text-sm tabular-nums text-ink-muted sm:ml-auto sm:w-auto">
            {summary.slots ? `${summary.slots} รอบ · จองแล้ว ${summary.taken}/${summary.capacity} ที่${summary.waitlist ? ` · คิวสำรอง ${summary.waitlist} คน` : ""}` : "ยังไม่มีรอบเรียนในช่วงนี้"}
          </p>
        </div>
      ) : null}
      {query.view === "month" ? <MonthView props={props} /> : query.view === "week" ? <WeekView props={props} returnTo={props.returnTo} /> : null}
      {query.view !== "list" ? <FillLegend /> : null}
    </div>
  );
}

function FillLegend() {
  const items: Array<{ label: string; tone: StatusTone }> = [
    { label: "ยังมีที่ว่าง", tone: "info" },
    { label: "ใกล้เต็ม / เต็ม (80% ขึ้นไป)", tone: "warning" },
    { label: "ยกเลิก / ฉบับร่าง", tone: "neutral" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="ความหมายของสี">
      {items.map((item) => (
        <li className="flex items-center gap-1.5" key={item.label}>
          <span aria-hidden="true" className={`size-2.5 rounded-full ${toneBar[item.tone]}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function CalendarToolbar({ props }: { props: CalendarProps }) {
  const { query } = props;
  const SearchIcon = appIcons.search;
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <nav aria-label="มุมมองปฏิทิน" className="flex w-fit rounded-lg border border-line bg-white p-1">
        {(["week", "month", "list"] as const).map((view) => (
          <Link
            aria-current={query.view === view ? "page" : undefined}
            className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold transition ${query.view === view ? "bg-brand-600 text-white" : "text-ink-muted hover:text-brand-600"}`}
            href={href(props, { view })}
            key={view}
          >
            {viewLabels[view]}
          </Link>
        ))}
      </nav>
      <form action="/admin/lessons" className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end" method="get">
        {query.view !== "week" ? <input name="view" type="hidden" value={query.view} /> : null}
        <input name="date" type="hidden" value={query.date} />
        {props.bypass ? <input name="bypass" type="hidden" value="admin" /> : null}
        <label className="block min-w-0">
          <span className={fieldLabel}>คอร์ส</span>
          <select className={fieldInput} defaultValue={query.course} name="course">
            <option value="">ทุกคอร์ส</option>
            {props.programs.map((program) => (
              <option key={program.id} value={program.id}>{program.name}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className={fieldLabel}>ผู้สอน</span>
          <select className={fieldInput} defaultValue={query.coach} disabled={!props.coaches.length} name="coach">
            <option value="">ทุกคน</option>
            {props.coaches.map((coach) => (
              <option key={coach.id} value={coach.id}>{coach.nickname ? `${coach.full_name} (${coach.nickname})` : coach.full_name}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className={fieldLabel}>สถานที่</span>
          <select className={fieldInput} defaultValue={query.venue} disabled={!props.venues.length} name="venue">
            <option value="">ทุกที่</option>
            {props.venues.map((venue) => (
              <option key={venue.id} value={venue.id}>{venue.name}</option>
            ))}
          </select>
        </label>
        <button className={`${buttonSecondary} w-full sm:w-auto`} type="submit">
          <SearchIcon className="size-4" aria-hidden="true" />
          แสดง
        </button>
      </form>
    </div>
  );
}

/** รายการ: every round from 30 days back (same window as the CSV), each row opens the panel. */
export function LessonsAdminSlotList({ from, limit, props }: { from: string; limit: number; props: CalendarProps }) {
  const DownloadIcon = appIcons.download;
  const dates = [...new Set(props.slots.map((slot) => slot.lesson_date))].sort();
  return (
    <section className="rounded-xl border border-line bg-white shadow-card">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-h3 font-semibold text-ink">รอบเรียน {props.slots.length} รอบ</h2>
          <p className="mt-1 text-sm text-ink-muted">
            ตั้งแต่ {formatThaiDateShort(from)}
            {props.slots.length >= limit ? ` · แสดง ${limit} รอบแรก` : ""} · รอบที่เก่ากว่านี้ดูได้ในรายงานและไฟล์ CSV
          </p>
        </div>
        {!props.bypass ? (
          <a className={`${buttonSecondary} w-fit shrink-0`} href="/admin/lessons/export">
            <DownloadIcon className="size-4" aria-hidden="true" />
            ดาวน์โหลดรายชื่อ (CSV)
          </a>
        ) : null}
      </div>
      {props.slots.length ? (
        <>
          <div className="hidden grid-cols-[minmax(0,1.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_6rem] gap-4 border-b border-line bg-canvas px-5 py-2 text-xs font-medium text-ink-subtle lg:grid" aria-hidden="true">
            <span>รอบเรียน</span>
            <span>เวลา</span>
            <span>ที่นั่ง</span>
            <span />
          </div>
          {dates.map((date) => (
            <div key={date}>
              <h3 className="border-b border-line bg-canvas px-5 py-2 text-sm font-semibold text-ink">{formatThaiDateShort(date)}</h3>
              <ul className="divide-y divide-line border-b border-line">
                {props.slots.filter((slot) => slot.lesson_date === date).map((slot) => {
                  const fill = slotFill(slot);
                  const full = slot.status === "open" && fill.level === "full";
                  return (
                    <li className="grid gap-2 px-5 py-3 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_6rem] lg:items-center lg:gap-4" key={slot.id}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-ink">{slot.title}</p>
                          <StatusBadge kind="lesson" status={full ? "full" : slot.status}>{full ? "เต็มแล้ว" : (lessonSlotStatusLabels[slot.status] ?? slot.status)}</StatusBadge>
                        </div>
                        <p className="mt-0.5 text-sm text-ink-muted">
                          {orUnset(slot.program_name)} · {orUnset(slot.coach_name, "ไม่ระบุผู้สอน")} · {orUnset(slot.venue, "ไม่ระบุสถานที่")}
                        </p>
                      </div>
                      <p className="text-sm tabular-nums text-ink">
                        <span className="text-ink-subtle lg:hidden">เวลา </span>
                        {formatTimeRange(slot.start_time, slot.end_time)}
                      </p>
                      <div className="text-sm tabular-nums text-ink">
                        <span className="text-ink-subtle lg:hidden">ที่นั่ง </span>
                        {fill.label}
                        <FillBar fill={fill} />
                      </div>
                      <Link className={`${buttonClass("secondary", "sm")} w-fit`} href={href(props, { slot: slot.id })} scroll={false}>
                        รายชื่อ
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">ยังไม่มีรอบเรียนตั้งแต่ {formatThaiDateShort(from)}</p>
      )}
    </section>
  );
}

/** Closures in the shown range, under the calendar. */
export function LessonsAdminClosureList({ closures, venues }: { closures: LessonClosure[]; venues: LessonVenue[] }) {
  if (!closures.length) return null;
  return (
    <section className="rounded-xl border border-line bg-white shadow-card">
      <h2 className="border-b border-line px-5 py-3 text-h3 font-semibold text-ink">วันงดเรียนในช่วงนี้</h2>
      <ul className="divide-y divide-line">
        {closures.map((closure) => (
          <li className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4" key={closure.id}>
            <span className="font-semibold text-ink">{formatThaiDateShort(closure.closure_date)}</span>
            <span className="text-ink-muted">
              {closure.venue_id ? `${venues.find((venue) => venue.id === closure.venue_id)?.name ?? UNSET} · ` : "ทั้งชมรม · "}
              {closure.reason}
            </span>
            <span className="text-xs tabular-nums text-ink-subtle">
              ยกเลิก {closure.slots_cancelled} รอบ · คืนเครดิต {closure.credits_refunded} ครั้ง · แจ้ง {closure.members_notified} คน
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
