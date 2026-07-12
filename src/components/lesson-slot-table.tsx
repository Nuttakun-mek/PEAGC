import type { ReactNode } from "react";

export type LessonSlotTableItem = {
  action?: ReactNode;
  bookedCount?: number;
  capacity: number;
  date: string;
  endTime: string;
  id: string;
  startTime: string;
  statusLabel: string;
  subtitle?: string | null;
  title: string;
  venue?: string | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(new Date(`${value}T00:00:00`));
}

function SlotContent({ item }: { item: LessonSlotTableItem }) {
  const remaining = Math.max(item.capacity - (item.bookedCount ?? 0), 0);

  return (
    <div className="grid h-full gap-2 rounded-md border border-[#e6e2ee] bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-[#722257]">{item.title}</p>
        <span className="shrink-0 rounded-md bg-[#f8edf4] px-2 py-1 text-[11px] font-semibold text-[#722257]">
          {item.statusLabel}
        </span>
      </div>
      {item.subtitle ? <p className="text-xs text-[#6b6475]">{item.subtitle}</p> : null}
      <p className="text-xs font-medium text-[#3f3a48]">
        {item.startTime.slice(0, 5)}-{item.endTime.slice(0, 5)}
      </p>
      <div className="flex flex-wrap gap-2 text-[11px] text-[#6b6475]">
        <span>{item.venue || "ยังไม่ระบุสถานที่"}</span>
        <span>ว่าง {remaining}/{item.capacity}</span>
      </div>
      {item.action ? <div className="mt-auto pt-1">{item.action}</div> : null}
    </div>
  );
}

export function LessonSlotTable({ items }: { items: LessonSlotTableItem[] }) {
  const dates = [...new Set(items.map((item) => item.date))].sort();
  const times = [...new Set(items.map((item) => item.startTime))].sort();

  if (!items.length) {
    return (
      <div className="rounded-md border border-dashed border-[#d9d3e6] bg-white/60 px-4 py-8 text-center text-sm text-[#6b6475]">
        ยังไม่มีรอบเรียนในตาราง
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 lg:hidden">
        {dates.map((date) => (
          <section className="rounded-lg border border-[#e6e2ee] bg-[#fbf9fc] p-3" key={date}>
            <h3 className="mb-3 text-sm font-semibold text-[#722257]">{formatDate(date)}</h3>
            <div className="grid gap-3">
              {items.filter((item) => item.date === date).map((item) => (
                <SlotContent item={item} key={item.id} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-[#e6e2ee] bg-[#fbf9fc] lg:block">
        <div
          className="grid min-w-max"
          style={{ gridTemplateColumns: `96px repeat(${dates.length}, minmax(220px, 1fr))` }}
        >
          <div className="border-b border-r border-[#e6e2ee] bg-[#722257] p-3 text-xs font-semibold text-white">เวลา</div>
          {dates.map((date) => (
            <div className="border-b border-r border-[#e6e2ee] bg-[#722257] p-3 text-center text-sm font-semibold text-white last:border-r-0" key={date}>
              {formatDate(date)}
            </div>
          ))}
          {times.map((time) => (
            <div className="contents" key={time}>
              <div className="border-b border-r border-[#e6e2ee] bg-white p-3 text-center text-sm font-semibold text-[#722257]">{time.slice(0, 5)}</div>
              {dates.map((date) => {
                const item = items.find((candidate) => candidate.date === date && candidate.startTime === time);
                return (
                  <div className="min-h-40 border-b border-r border-[#e6e2ee] p-2 last:border-r-0" key={`${date}-${time}`}>
                    {item ? <SlotContent item={item} /> : <div className="flex h-full items-center justify-center text-sm text-[#b2acb8]">-</div>}
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
