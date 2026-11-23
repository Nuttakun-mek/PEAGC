"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { buttonClass, fieldHint, fieldInputClass } from "@/components/ui/styles";
import { planSlots } from "@/lib/lessons/booking";

type Row = { end: string; id: number; start: string };

type FormSnapshot = { from: string; to: string; weekdays: number[] };

/** "16:30-17:30, 17:30-18:30" → rows. Anything unreadable becomes an empty row to fill in. */
function parseRanges(value: string): Omit<Row, "id">[] {
  const rows = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [start = "", end = ""] = item.split("-").map((part) => part.trim());
      return { end, start };
    });
  return rows.length ? rows : [{ end: "", start: "" }];
}

/** Adds minutes to "HH:MM"; empty when it would pass midnight. */
function addMinutes(time: string, minutes: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return "";
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
  if (total >= 24 * 60) return "";
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function readForm(form: HTMLFormElement): FormSnapshot {
  const value = (name: string) => {
    const field = form.elements.namedItem(name);
    return field instanceof HTMLInputElement ? field.value : "";
  };
  const weekdays = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="weekdays"]'))
    .filter((input) => input.checked)
    .map((input) => Number(input.value));
  return { from: value("dateFrom"), to: value("dateTo"), weekdays };
}

/**
 * Time ranges for the repeating-slot generator as start/end time pickers. Writes the same
 * "16:30-17:30, 17:30-18:30" string the server action already parses into a hidden input, and
 * previews how many rounds the form will create from its date range and weekdays.
 */
export function LessonsTimeRanges({
  defaultValue = "16:30-17:30, 17:30-18:30",
  disabled,
  name = "timeRanges",
}: {
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => parseRanges(defaultValue).map((row, id) => ({ ...row, id })));
  const [snapshot, setSnapshot] = useState<FormSnapshot | null>(null);
  const nextId = useRef(rows.length);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Follow the date range and weekday boxes of the surrounding form for the preview line.
  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return;
    const read = () => setSnapshot(readForm(form));
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, []);

  // Block submit on an end time before its start, or a start time used twice.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const seen = new Set<string>();
    rows.forEach((row) => {
      const start = list.querySelector<HTMLInputElement>(`input[data-start="${row.id}"]`);
      const end = list.querySelector<HTMLInputElement>(`input[data-end="${row.id}"]`);
      start?.setCustomValidity(row.start && seen.has(row.start) ? "เวลาเริ่มซ้ำกับช่วงอื่น" : "");
      end?.setCustomValidity(row.start && row.end && row.end <= row.start ? "เวลาเลิกต้องหลังเวลาเริ่ม" : "");
      if (row.start) seen.add(row.start);
    });
  }, [rows]);

  const complete = rows.filter((row) => row.start && row.end);
  const serialized = complete.map((row) => `${row.start}-${row.end}`).join(", ");
  const valid = complete.filter((row) => row.end > row.start);
  const uniqueStarts = new Set(valid.map((row) => row.start)).size === valid.length;

  let preview: { text: string; warn: boolean };
  if (!valid.length) {
    preview = { text: "ใส่เวลาเริ่มและเวลาเลิกอย่างน้อย 1 ช่วง", warn: true };
  } else if (!uniqueStarts) {
    preview = { text: "มีช่วงเวลาที่เริ่มเวลาเดียวกัน ลบช่วงที่ซ้ำออกก่อน", warn: true };
  } else if (!snapshot?.from || !snapshot.to) {
    preview = { text: `${valid.length} ช่วงเวลาต่อวัน · เลือกวันที่เพื่อดูจำนวนรอบ`, warn: false };
  } else {
    const plan = planSlots({
      from: snapshot.from,
      times: valid.map((row) => ({ end_time: row.end, start_time: row.start })),
      to: snapshot.to,
      weekdays: snapshot.weekdays,
    });
    preview = "error" in plan
      ? { text: plan.error, warn: true }
      : {
          text: `จะสร้าง ${plan.items.length} รอบ (${plan.items.length / valid.length} วัน × ${valid.length} ช่วงเวลา) รอบที่มีอยู่แล้วจะข้ามไป`,
          warn: false,
        };
  }

  const update = (id: number, field: "start" | "end", value: string) =>
    setRows((items) => items.map((row) => (row.id === id ? { ...row, [field]: value } : row)));

  const addRow = () =>
    setRows((items) => {
      const last = items[items.length - 1];
      const start = last?.end ?? "";
      const step = last?.start && last.end ? Math.max(15, minutesBetween(last.start, last.end)) : 60;
      return [...items, { end: start ? addMinutes(start, step) : "", id: nextId.current++, start }];
    });

  const removeRow = (id: number) => setRows((items) => (items.length > 1 ? items.filter((row) => row.id !== id) : items));

  return (
    <fieldset className="min-w-0">
      <legend className="block text-sm font-medium text-ink-muted">
        ช่วงเวลาเรียนในแต่ละวัน<span aria-hidden="true"> *</span>
      </legend>
      <input name={name} ref={hiddenRef} type="hidden" value={serialized} />
      <div aria-hidden="true" className="mt-1.5 grid grid-cols-[minmax(0,1fr)_0.75rem_minmax(0,1fr)_2.75rem] gap-2 text-xs font-medium text-ink-subtle">
        <span>เวลาเริ่ม</span>
        <span />
        <span>เวลาเลิก</span>
        <span />
      </div>
      <ul className="mt-1 grid gap-2" ref={listRef}>
        {rows.map((row, index) => {
          const backwards = Boolean(row.start && row.end && row.end <= row.start);
          return (
            <li key={row.id}>
              <div className="grid grid-cols-[minmax(0,1fr)_0.75rem_minmax(0,1fr)_2.75rem] items-center gap-2">
                <input
                  aria-label={`ช่วงที่ ${index + 1} เวลาเริ่ม`}
                  className={fieldInputClass("md", { margin: false })}
                  data-start={row.id}
                  disabled={disabled}
                  onChange={(event) => update(row.id, "start", event.target.value)}
                  required
                  step={900}
                  type="time"
                  value={row.start}
                />
                <span aria-hidden="true" className="text-center text-ink-subtle">–</span>
                <input
                  aria-describedby={backwards ? `time-range-error-${row.id}` : undefined}
                  aria-invalid={backwards || undefined}
                  aria-label={`ช่วงที่ ${index + 1} เวลาเลิก`}
                  className={fieldInputClass("md", { margin: false })}
                  data-end={row.id}
                  disabled={disabled}
                  onChange={(event) => update(row.id, "end", event.target.value)}
                  required
                  step={900}
                  type="time"
                  value={row.end}
                />
                <button
                  aria-label={`ลบช่วงที่ ${index + 1}`}
                  className="flex size-11 items-center justify-center rounded-lg border border-line bg-white text-ink-subtle transition hover:border-danger/30 hover:bg-danger-bg hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={disabled || rows.length === 1}
                  onClick={() => removeRow(row.id)}
                  type="button"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              {backwards ? (
                <p className="mt-1 text-xs text-danger" id={`time-range-error-${row.id}`}>
                  เวลาเลิกต้องหลังเวลาเริ่ม
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button className={`${buttonClass("secondary", "sm")} mt-2`} disabled={disabled} onClick={addRow} type="button">
        <Plus className="size-4" aria-hidden="true" />
        เพิ่มช่วงเวลา
      </button>
      <p aria-live="polite" className={`mt-2 text-sm font-medium ${preview.warn ? "text-warning" : "text-ink"}`}>
        {preview.text}
      </p>
      <span className={fieldHint}>เลือกเวลาทีละ 15 นาที</span>
    </fieldset>
  );
}

function minutesBetween(start: string, end: string) {
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };
  return toMinutes(end) - toMinutes(start);
}
