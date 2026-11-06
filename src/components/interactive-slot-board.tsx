"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Check, Clock3, MapPin, RefreshCw, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LessonBookingCountdown } from "@/components/lesson-booking-countdown";
import {
  type BookingPhase,
  cancelDeadline,
  formatBangkokDateTime,
  queueStatus,
  queueStatusLabel,
  seatSummary,
  slotOffer,
} from "@/lib/lessons/booking";
import { createClient } from "@/lib/supabase/client";

export type InteractiveSlot = {
  bookedCount: number;
  capacity: number;
  coach: string | null;
  date: string;
  endTime: string;
  id: string;
  /** Booking id when the member holds this slot. */
  myBookingId: string | null;
  /** FCFS position (1-based) when the member holds this slot. */
  myPosition: number | null;
  program: string;
  startTime: string;
  status: string;
  title: string;
  venue: string | null;
  waitlistCapacity: number;
};

function formatDay(value: string) {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok", weekday: "short" })
    .format(new Date(`${value}T12:00:00+07:00`));
}

const offerLabel: Record<ReturnType<typeof slotOffer>, string> = {
  book: "จองที่นั่ง",
  closed: "ปิดรับรอบนี้",
  full: "เต็มแล้ว",
  "not-open": "ยังไม่เปิด",
  waitlist: "เข้าคิวสำรอง",
  "window-closed": "ปิดลงทะเบียน",
};

export function InteractiveSlotBoard({
  bookAction,
  canBook,
  cancelAction,
  cancelCutoffHours,
  changeAction,
  currentBookingId,
  openAt,
  phase,
  slots: initialSlots,
}: {
  bookAction: (formData: FormData) => void;
  canBook: boolean;
  cancelAction: (formData: FormData) => void;
  cancelCutoffHours: number;
  changeAction: (formData: FormData) => void;
  /** The member's booking that can be moved to another slot (first active one). */
  currentBookingId?: string;
  openAt: string | null;
  phase: BookingPhase;
  slots: InteractiveSlot[];
}) {
  const router = useRouter();
  const [slots, setSlots] = useState(initialSlots);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("member-lesson-slots")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lesson_slots" }, (payload) => {
        const next = payload.new as { booked_count?: number; capacity?: number; id?: string; status?: string; waitlist_capacity?: number };
        if (!next.id) return;
        setSlots((items) => items.map((item) => item.id === next.id
          ? {
              ...item,
              bookedCount: next.booked_count ?? item.bookedCount,
              capacity: next.capacity ?? item.capacity,
              status: next.status ?? item.status,
              waitlistCapacity: next.waitlist_capacity ?? item.waitlistCapacity,
            }
          : item));
        setLive(true);
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  const dates = useMemo(() => [...new Set(slots.map((slot) => slot.date))].sort(), [slots]);
  const selected = slots.find((slot) => slot.id === selectedId);
  const selectedOffer = selected ? slotOffer({ ...selected, phase, slotStatus: selected.status }) : null;
  const currentSlot = currentBookingId ? slots.find((slot) => slot.myBookingId === currentBookingId) : undefined;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-[#667085]">
          <span className={`size-2 rounded-full ${live ? "bg-[#16a36a]" : "bg-[#f0a11a]"}`} />
          {live ? "อัปเดตที่นั่งอัตโนมัติ" : "กำลังเชื่อมต่อ"}
        </div>
        <button className="flex h-9 items-center gap-2 rounded-md border border-[#dce3ea] bg-white px-3 text-xs font-semibold text-[#475467]" onClick={() => router.refresh()} type="button">
          <RefreshCw className="size-3.5" /> รีเฟรช
        </button>
      </div>

      {phase === "before" && openAt ? (
        <div className="mb-4 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
          เปิดจอง {formatBangkokDateTime(openAt)} · อีก <LessonBookingCountdown openAt={openAt} />
        </div>
      ) : null}
      {phase === "after" ? (
        <div className="mb-4 rounded-md bg-[#f4f6fa] px-4 py-3 text-sm text-[#6b6475]">ปิดลงทะเบียนแล้ว</div>
      ) : null}
      {phase === "unset" ? (
        <div className="mb-4 rounded-md bg-[#f4f6fa] px-4 py-3 text-sm text-[#6b6475]">ยังไม่กำหนดรอบลงทะเบียน</div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-4 text-xs text-[#667085]">
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-full bg-[#722257]" /> มีผู้จอง</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-full bg-[#c69214]" /> ที่นั่งของคุณ</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-full border border-[#cfd8e3] bg-white" /> ว่าง</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-full bg-[#f0a11a]" /> คิวสำรอง</span>
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
                const seats = seatSummary(slot.bookedCount, slot.capacity, slot.waitlistCapacity);
                const offer = slotOffer({ ...slot, phase, slotStatus: slot.status });
                const mine = slot.myBookingId !== null && slot.myPosition !== null;
                const myStatus = mine ? queueStatus(slot.myPosition!, slot.capacity) : null;
                const deadline = cancelDeadline(slot.date, slot.startTime, cancelCutoffHours);
                const cancelLocked = myStatus?.kind === "confirmed" && now > deadline.getTime();
                const selectable = canBook && !mine && (offer === "book" || offer === "waitlist");
                const chosen = selectedId === slot.id;
                const dotCount = Math.min(slot.capacity, 12);

                return (
                  <div
                    className={`rounded-lg border p-4 transition-all ${mine
                      ? "border-[#c69214] bg-[linear-gradient(90deg,#fff5d8,white_70%)] shadow-sm"
                      : chosen
                        ? "border-[#168aad] bg-[#effaff] ring-2 ring-[#168aad]/15"
                        : selectable
                          ? "border-[#e2e8ef] bg-white hover:border-[#9fc9d6] hover:shadow-md"
                          : "border-[#eaecf0] bg-[#f7f8fa]"}`}
                    key={slot.id}
                  >
                    <button
                      className={`w-full text-left ${selectable ? "cursor-pointer" : "cursor-default"}`}
                      disabled={!selectable}
                      onClick={() => setSelectedId(slot.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[#243244]">{slot.startTime.slice(0, 5)}-{slot.endTime.slice(0, 5)}</p>
                          <p className="mt-1 text-sm text-[#667085]">{slot.title}{slot.coach ? ` · โปร${slot.coach}` : ""}</p>
                        </div>
                        {mine ? (
                          <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${myStatus?.kind === "confirmed" ? "bg-[#722257] text-white" : "bg-[#fff5d8] text-[#805300]"}`}>
                            <Check className="size-3" /> {queueStatusLabel(slot.myPosition!, slot.capacity)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#667085]">
                        <span className="flex items-center gap-1"><MapPin className="size-3.5" />{slot.venue ?? "สนามฝึกซ้อม"}</span>
                        <span className="flex items-center gap-1 tabular-nums">
                          <UsersRound className="size-3.5" />
                          {seats.free > 0 ? `ว่าง ${seats.free}/${slot.capacity}` : `เต็ม ${slot.capacity}/${slot.capacity}`}
                          {slot.waitlistCapacity || seats.waitlisted ? ` · สำรอง ${seats.waitlisted}/${slot.waitlistCapacity}` : ""}
                        </span>
                      </div>
                      <div className="mt-3 flex gap-1" aria-label={`มีผู้จอง ${slot.bookedCount} คน`}>
                        {Array.from({ length: dotCount }).map((_, index) => {
                          const isMine = mine && myStatus?.kind === "confirmed" && index === Math.min(slot.myPosition! - 1, dotCount - 1);
                          return <span className={`h-1.5 flex-1 rounded-full ${isMine ? "bg-[#c69214]" : index < seats.confirmed ? "bg-[#722257]" : "bg-[#dfe8ed]"}`} key={index} />;
                        })}
                        {slot.waitlistCapacity > 0 ? Array.from({ length: Math.min(slot.waitlistCapacity, 6) }).map((_, index) => (
                          <span className={`h-1.5 w-2 rounded-full ${index < seats.waitlisted ? "bg-[#f0a11a]" : "bg-[#f3e6c9]"}`} key={`w${index}`} />
                        )) : null}
                      </div>
                    </button>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      {mine ? (
                        cancelLocked ? (
                          <span className="text-xs text-[#98a2b3]">เลยกำหนดยกเลิกแล้ว</span>
                        ) : (
                          <form action={cancelAction}>
                            <input name="bookingId" type="hidden" value={slot.myBookingId!} />
                            <ConfirmSubmitButton className="h-8 rounded-md border border-[#efcbd0] bg-white px-3 text-xs font-semibold text-[#a33a46]" message="ยกเลิกการจองรอบนี้?">
                              ยกเลิกการจอง
                            </ConfirmSubmitButton>
                          </form>
                        )
                      ) : (
                        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${offer === "book" ? "bg-[#f8edf4] text-[#722257]" : offer === "waitlist" ? "bg-[#fff5d8] text-[#805300]" : "bg-[#f1f3ef] text-[#6b6475]"}`}>
                          {offerLabel[offer]}
                        </span>
                      )}
                      {mine && myStatus?.kind === "confirmed" && !cancelLocked ? (
                        <span className="text-[11px] text-[#98a2b3]">ยกเลิกได้ถึง {formatBangkokDateTime(deadline.toISOString())}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {selected && selectedOffer ? (
        <div className="sticky bottom-3 z-10 mt-3 flex flex-col gap-3 rounded-lg border border-[#cce2e8] bg-white/95 p-4 shadow-[0_12px_34px_rgba(30,61,76,.16)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#243244]">
              {selectedOffer === "waitlist" ? "เข้าคิวสำรองรอบ" : "จองรอบ"} {selected.startTime.slice(0, 5)} น.
            </p>
            <p className="mt-1 text-xs text-[#667085]">{formatDay(selected.date)} · {selected.title}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="h-10 rounded-md px-4 text-sm font-semibold text-[#667085]" onClick={() => setSelectedId(null)} type="button">ปิด</button>
            {currentBookingId && currentSlot ? (
              <form action={changeAction}>
                <input name="slotId" type="hidden" value={selected.id} />
                <input name="bookingId" type="hidden" value={currentBookingId} />
                <button className="flex h-10 items-center gap-2 rounded-md border border-[#168aad] bg-white px-4 text-sm font-semibold text-[#168aad]" type="submit">
                  <ArrowLeftRight className="size-4" />ย้ายจากรอบ {formatDay(currentSlot.date)} {currentSlot.startTime.slice(0, 5)}
                </button>
              </form>
            ) : null}
            <form action={bookAction}>
              <input name="slotId" type="hidden" value={selected.id} />
              <button className={`flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold text-white ${selectedOffer === "waitlist" ? "bg-[#b17b0a]" : "bg-[#168aad]"}`} type="submit">
                <Clock3 className="size-4" />{selectedOffer === "waitlist" ? "เข้าคิวสำรอง" : "ยืนยันการจอง"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
