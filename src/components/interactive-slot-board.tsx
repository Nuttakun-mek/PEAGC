"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, MapPin, RefreshCw, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export type InteractiveSlot = {
  bookedCount: number;
  capacity: number;
  date: string;
  endTime: string;
  id: string;
  isCurrent: boolean;
  program: string;
  startTime: string;
  title: string;
  venue: string | null;
};

function formatDay(value: string) {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", weekday: "short" })
    .format(new Date(`${value}T00:00:00`));
}

export function InteractiveSlotBoard({
  bookAction,
  canBook,
  changeAction,
  currentBookingId,
  slots: initialSlots,
}: {
  bookAction: (formData: FormData) => void;
  canBook: boolean;
  changeAction: (formData: FormData) => void;
  currentBookingId?: string;
  slots: InteractiveSlot[];
}) {
  const router = useRouter();
  const [slots, setSlots] = useState(initialSlots);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("member-lesson-slots")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lesson_slots" }, (payload) => {
        const next = payload.new as { id?: string; booked_count?: number };
        if (!next.id) return;
        setSlots((items) => items.map((item) => item.id === next.id
          ? { ...item, bookedCount: next.booked_count ?? item.bookedCount }
          : item));
        setLive(true);
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const dates = useMemo(() => [...new Set(slots.map((slot) => slot.date))].sort(), [slots]);
  const selected = slots.find((slot) => slot.id === selectedId);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-[#667085]">
          <span className={`size-2 rounded-full ${live ? "bg-[#16a36a]" : "bg-[#f0a11a]"}`} />
          {live ? "อัปเดตที่นั่งแบบเรียลไทม์" : "กำลังเชื่อมต่อข้อมูลสด"}
        </div>
        <button className="flex h-9 items-center gap-2 rounded-md border border-[#dce3ea] bg-white px-3 text-xs font-semibold text-[#475467]" onClick={() => router.refresh()} type="button">
          <RefreshCw className="size-3.5" /> รีเฟรช
        </button>
      </div>

      <div className="flex snap-x gap-4 overflow-x-auto pb-3">
        {dates.map((date) => (
          <section className="w-[280px] shrink-0 snap-start sm:w-[320px]" key={date}>
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="font-semibold text-[#344054]">{formatDay(date)}</h3>
              <span className="text-xs text-[#98a2b3]">{slots.filter((slot) => slot.date === date).length} รอบ</span>
            </div>
            <div className="grid gap-2">
              {slots.filter((slot) => slot.date === date).map((slot) => {
                const remaining = Math.max(slot.capacity - slot.bookedCount, 0);
                const full = remaining === 0 && !slot.isCurrent;
                const chosen = selectedId === slot.id;
                return (
                  <button
                    className={`group w-full rounded-lg border p-4 text-left transition-all ${slot.isCurrent
                      ? "border-[#722257] bg-[#f8edf4] shadow-sm"
                      : chosen
                        ? "border-[#168aad] bg-[#effaff] ring-2 ring-[#168aad]/15"
                        : full
                          ? "cursor-not-allowed border-[#eaecf0] bg-[#f7f8fa] opacity-65"
                          : "border-[#e2e8ef] bg-white hover:-translate-y-0.5 hover:border-[#9fc9d6] hover:shadow-md"}`}
                    disabled={!canBook || full || slot.isCurrent}
                    key={slot.id}
                    onClick={() => setSelectedId(slot.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-semibold text-[#243244]">{slot.startTime.slice(0,5)}-{slot.endTime.slice(0,5)}</p><p className="mt-1 text-sm text-[#667085]">{slot.title}</p></div>
                      {slot.isCurrent ? <span className="flex items-center gap-1 rounded-full bg-[#722257] px-2 py-1 text-[11px] font-semibold text-white"><Check className="size-3" /> รอบของคุณ</span> : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#667085]">
                      <span className="flex items-center gap-1"><MapPin className="size-3.5" />{slot.venue ?? "สนามฝึกซ้อม"}</span>
                      <span className="flex items-center gap-1"><UsersRound className="size-3.5" />ว่าง {remaining}/{slot.capacity}</span>
                    </div>
                    <div className="mt-3 flex gap-1" aria-label={`มีผู้จอง ${slot.bookedCount} คน`}>
                      {Array.from({ length: Math.min(slot.capacity, 12) }).map((_, index) => <span className={`h-1.5 flex-1 rounded-full ${index < slot.bookedCount ? "bg-[#722257]" : "bg-[#dfe8ed]"}`} key={index} />)}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {selected ? (
        <div className="sticky bottom-3 z-10 mt-3 flex flex-col gap-3 rounded-lg border border-[#cce2e8] bg-white/95 p-4 shadow-[0_12px_34px_rgba(30,61,76,.16)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold text-[#243244]">ยืนยันรอบ {selected.startTime.slice(0,5)} น.</p><p className="mt-1 text-xs text-[#667085]">{formatDay(selected.date)} · {selected.title}</p></div>
          <div className="flex gap-2">
            <button className="h-10 rounded-md px-4 text-sm font-semibold text-[#667085]" onClick={() => setSelectedId(null)} type="button">ยกเลิก</button>
            <form action={currentBookingId ? changeAction : bookAction}>
              <input name="slotId" type="hidden" value={selected.id} />
              {currentBookingId ? <input name="bookingId" type="hidden" value={currentBookingId} /> : null}
              <button className="flex h-10 items-center gap-2 rounded-md bg-[#168aad] px-4 text-sm font-semibold text-white" type="submit"><Clock3 className="size-4" />{currentBookingId ? "ยืนยันเปลี่ยนเวลา" : "ยืนยันการจอง"}</button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
