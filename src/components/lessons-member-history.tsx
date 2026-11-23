import { MessageSquareText, Video } from "lucide-react";

import { formatTimeRange } from "@/components/lesson-slot-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatThaiDateShort } from "@/lib/display";
import { lessonBookingStatusDescriptions, lessonBookingStatusLabel, skillLevelLabels } from "@/lib/lessons/labels";
import { type MemberBooking, type MemberCoachNote, notesByBooking } from "@/lib/lessons/member-view";
import type { SkillLevel } from "@/lib/lessons/types";

function NoteBlock({ note }: { note: MemberCoachNote }) {
  return (
    <div className="mt-2 rounded-lg bg-canvas px-3 py-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink-muted">
        <MessageSquareText className="size-4 text-ink-subtle" aria-hidden="true" />
        โน้ตจาก{note.coach ?? "ผู้สอน"}
        {note.skillLevel ? (
          <span className="rounded-full bg-white px-2 text-xs font-medium text-ink ring-1 ring-inset ring-line">
            ระดับ {skillLevelLabels[note.skillLevel]}
          </span>
        ) : null}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-base text-ink">{note.note}</p>
      {note.videoUrl ? (
        <a
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-base font-semibold text-brand-600 underline underline-offset-4"
          href={note.videoUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Video className="size-4" aria-hidden="true" />
          ดูคลิปวงสวิง
        </a>
      ) : null}
    </div>
  );
}

/** "ประวัติการเรียน": lessons attended or missed, with the coach's notes and level. */
export function LessonsMemberHistory({
  bookings,
  notes,
  skillLevel,
}: {
  /** finished bookings (attended / no_show / late_cancelled / closed, or booked and not marked yet), newest first */
  bookings: MemberBooking[];
  notes: MemberCoachNote[];
  skillLevel: string | null;
}) {
  const byBooking = notesByBooking(notes);
  const bookingIds = new Set(bookings.map((item) => item.id));
  const looseNotes = notes.filter((note) => !note.bookingId || !bookingIds.has(note.bookingId));
  const attended = bookings.filter((item) => item.status === "attended").length;
  const missed = bookings.filter((item) => item.status === "no_show").length;
  const level = skillLevel && skillLevel in skillLevelLabels ? skillLevelLabels[skillLevel as SkillLevel] : null;

  if (!bookings.length && !notes.length) {
    return <p className="text-base text-ink-muted">ยังไม่มีประวัติการเรียน เรียนจบแล้วผู้สอนจะเช็กชื่อและจดโน้ตไว้ที่นี่</p>;
  }

  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-canvas px-3 py-2.5">
          <dt className="text-xs font-medium text-ink-subtle">เข้าเรียน</dt>
          <dd className="text-h2 font-semibold tabular-nums text-ink">{attended}</dd>
        </div>
        <div className="rounded-lg bg-canvas px-3 py-2.5">
          <dt className="text-xs font-medium text-ink-subtle">ขาดเรียน</dt>
          <dd className="text-h2 font-semibold tabular-nums text-ink">{missed}</dd>
        </div>
        <div className="rounded-lg bg-canvas px-3 py-2.5">
          <dt className="text-xs font-medium text-ink-subtle">ระดับฝีมือ</dt>
          <dd className="text-base font-semibold text-ink">{level ?? "ยังไม่ประเมิน"}</dd>
        </div>
      </dl>

      {bookings.length ? (
        <ul className="divide-y divide-line">
          {bookings.map((item) => (
            <li className="py-3 first:pt-0" key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-ink">{item.slot.title}</p>
                  <p className="text-sm tabular-nums text-ink-muted">
                    {formatThaiDateShort(item.slot.date)} · {formatTimeRange(item.slot.startTime, item.slot.endTime)}
                    {item.slot.coach ? ` · ${item.slot.coach}` : ""}
                  </p>
                </div>
                {item.status === "booked" ? (
                  // finished but not marked yet (the coach or the daily job marks it)
                  <StatusBadge tone="neutral">รอเช็กชื่อ</StatusBadge>
                ) : (
                  <StatusBadge kind="booking" status={item.status}>
                    {lessonBookingStatusLabel(item.status)}
                  </StatusBadge>
                )}
              </div>
              {item.status !== "attended" && item.status !== "booked" ? (
                <p className="mt-1 text-sm text-ink-muted">{lessonBookingStatusDescriptions[item.status]}</p>
              ) : null}
              {(byBooking.get(item.id) ?? []).map((note) => (
                <NoteBlock key={note.id} note={note} />
              ))}
            </li>
          ))}
        </ul>
      ) : null}

      {looseNotes.length ? (
        <div>
          <h3 className="text-base font-semibold text-ink">โน้ตอื่นจากผู้สอน</h3>
          {looseNotes.map((note) => (
            <div key={note.id}>
              <p className="mt-3 text-sm text-ink-subtle">{formatThaiDateShort(note.createdAt)}</p>
              <NoteBlock note={note} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
