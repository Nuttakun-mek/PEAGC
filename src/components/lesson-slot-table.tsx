import type { ReactNode } from "react";
import { Hourglass, MapPin, UsersRound } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatThaiDateShort, formatThaiTime } from "@/lib/display";

export type LessonSlotTableItem = {
  action?: ReactNode;
  bookedCount?: number;
  capacity: number;
  date: string;
  endTime: string;
  id: string;
  startTime: string;
  /** Raw lesson_slots.status; picks the badge colour. Without it the badge is neutral. */
  status?: string;
  statusLabel: string;
  subtitle?: string | null;
  title: string;
  venue?: string | null;
  waitlistCapacity?: number;
};

/** "16:30:00", "17:30:00" → "16:30–17:30 น." */
export function formatTimeRange(start: string, end: string) {
  return `${formatThaiTime(start).replace(/ น\.$/, "")}–${formatThaiTime(end)}`;
}

function SlotBadge({ item }: { item: LessonSlotTableItem }) {
  const booked = item.bookedCount ?? 0;
  if (item.status === "open" && booked >= item.capacity) {
    return <StatusBadge kind="lesson" status="full">เต็มแล้ว</StatusBadge>;
  }
  return item.status ? (
    <StatusBadge kind="lesson" status={item.status}>{item.statusLabel}</StatusBadge>
  ) : (
    <StatusBadge tone="neutral">{item.statusLabel}</StatusBadge>
  );
}

function SlotContent({ item }: { item: LessonSlotTableItem }) {
  const booked = item.bookedCount ?? 0;
  const remaining = Math.max(item.capacity - booked, 0);
  const waitlisted = Math.max(booked - item.capacity, 0);

  return (
    <div className="grid h-full content-start gap-2 rounded-lg border border-line bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 font-semibold text-ink">{item.title}</p>
        <SlotBadge item={item} />
      </div>
      <p className="text-sm font-medium tabular-nums text-ink">{formatTimeRange(item.startTime, item.endTime)}</p>
      {item.subtitle ? <p className="text-xs text-ink-subtle">{item.subtitle}</p> : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
        {item.venue ? (
          <span className="flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden="true" />
            {item.venue}
          </span>
        ) : null}
        <span className="flex items-center gap-1 tabular-nums">
          <UsersRound className="size-3.5" aria-hidden="true" />
          {remaining > 0 ? `ว่าง ${remaining}/${item.capacity}` : `เต็ม ${item.capacity}/${item.capacity}`}
        </span>
        {item.waitlistCapacity || waitlisted ? (
          <span className="flex items-center gap-1 tabular-nums">
            <Hourglass className="size-3.5" aria-hidden="true" />
            สำรอง {waitlisted}/{item.waitlistCapacity ?? 0}
          </span>
        ) : null}
      </div>
      {item.action ? <div className="mt-auto pt-1">{item.action}</div> : null}
    </div>
  );
}

/** Lesson rounds by day: stacked per date on phones, a time × date grid on desktop. */
export function LessonSlotTable({ items }: { items: LessonSlotTableItem[] }) {
  const dates = [...new Set(items.map((item) => item.date))].sort();
  const times = [...new Set(items.map((item) => item.startTime))].sort();

  if (!items.length) {
    return <p className="py-6 text-center text-sm text-ink-muted">ยังไม่มีรอบเรียนในช่วงนี้</p>;
  }

  return (
    <>
      <div className="grid gap-4 lg:hidden">
        {dates.map((date) => (
          <section className="rounded-lg bg-canvas p-3" key={date}>
            <h3 className="mb-2 text-sm font-semibold text-ink">{formatThaiDateShort(date)}</h3>
            <div className="grid gap-2">
              {items.filter((item) => item.date === date).map((item) => (
                <SlotContent item={item} key={item.id} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-line lg:block">
        <div
          className="grid min-w-max"
          role="table"
          aria-label="ตารางรอบเรียนตามวันและเวลา"
          style={{ gridTemplateColumns: `96px repeat(${dates.length}, minmax(220px, 1fr))` }}
        >
          <div className="contents" role="row">
            <div className="sticky left-0 border-b border-r border-line bg-canvas p-3 text-xs font-medium text-ink-subtle" role="columnheader">
              เวลาเริ่ม
            </div>
            {dates.map((date) => (
              <div className="border-b border-r border-line bg-canvas p-3 text-center text-sm font-semibold text-ink last:border-r-0" key={date} role="columnheader">
                {formatThaiDateShort(date)}
              </div>
            ))}
          </div>
          {times.map((time) => (
            <div className="contents" key={time} role="row">
              <div className="sticky left-0 border-b border-r border-line bg-white p-3 text-center text-sm font-semibold tabular-nums text-ink" role="rowheader">
                {formatThaiTime(time)}
              </div>
              {dates.map((date) => {
                const item = items.find((candidate) => candidate.date === date && candidate.startTime === time);
                return (
                  <div className="min-h-32 border-b border-r border-line bg-canvas/60 p-2 last:border-r-0" key={`${date}-${time}`} role="cell">
                    {item ? <SlotContent item={item} /> : <span className="sr-only">ไม่มีรอบ</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
