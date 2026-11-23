"use client";

import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { type SlotPreview, generateLessonSlots, previewLessonSlots } from "@/app/admin/lessons/actions";
import {
  OpenNowOption,
  RescheduleFields,
  Required,
  SchemaField,
  TargetFields,
  UnitInput,
  checkboxClass,
  lessonLevelLabels,
} from "@/components/lessons-admin-fields";
import { coachLabel } from "@/lib/lessons/admin";
import { LessonsAdminCoachPicker, LessonsAdminVenuePicker, type PickerCoach, type PickerVenue } from "@/components/lessons-admin-pickers";
import { LessonsTimeRanges } from "@/components/lessons-time-ranges";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, fieldHint, fieldInput, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { formatThaiDate, formatThaiDateShort } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { type BookingPhase, MAX_GENERATED_SLOTS, addDays } from "@/lib/lessons/booking";
import { thaiWeekdaysShort } from "@/lib/lessons/calendar";

export type WizardProgram = {
  coach_name: string | null;
  default_coach_id?: string | null;
  default_venue_id?: string | null;
  id: string;
  level: string;
  name: string;
  requires_package?: boolean;
};

const steps = ["คอร์ส", "ผู้สอน", "สถานที่", "วันและเวลา", "ดูตัวอย่าง", "ยืนยัน"] as const;
/** Monday first, like the calendar. */
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];

type Summary = { label: string; value: string }[];

/**
 * สร้างรอบเรียน step by step (audit p.20): คอร์ส → ผู้สอน → สถานที่ → วันและเวลา → ดูตัวอย่าง → ยืนยัน.
 * One form; each step only hides the others. The preview asks the server which rounds would clash
 * (same course at the same time, the coach or the venue/bay busy) before anything is written.
 */
export function LessonsAdminWizard({
  booking,
  bypass,
  coaches,
  cutoffHours,
  disabled,
  programs,
  today,
  v2,
  venues,
}: {
  booking: { openAt: string | null; phase: BookingPhase };
  bypass: boolean;
  coaches: PickerCoach[];
  cutoffHours: number;
  /** bypass preview: everything works except the final save */
  disabled: boolean;
  programs: WizardProgram[];
  today: string;
  v2: boolean;
  venues: PickerVenue[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const [step, setStep] = useState(0);
  const [programId, setProgramId] = useState(programs.length === 1 ? programs[0].id : "");
  const [title, setTitle] = useState(programs.length === 1 ? programs[0].name : "");
  const [titleTouched, setTitleTouched] = useState(false);
  const [capacity, setCapacity] = useState(8);
  const [preview, setPreview] = useState<SlotPreview | null>(null);
  const [summary, setSummary] = useState<Summary>([]);
  const [showAll, setShowAll] = useState(false);
  const [pending, startTransition] = useTransition();
  const program = programs.find((item) => item.id === programId) ?? null;
  const SaveIcon = appIcons.add;

  const pickProgram = (id: string) => {
    setProgramId(id);
    const next = programs.find((item) => item.id === id);
    if (next && !titleTouched) setTitle(next.name);
    const venue = venues.find((item) => item.id === next?.default_venue_id);
    if (venue) setCapacity(venue.bay_count * venue.capacity_per_bay);
  };

  /** Browser validation of the current step's fields; shows the first problem. */
  const stepValid = (index: number) => {
    const section = sectionRefs.current[index];
    if (!section) return true;
    const fields = Array.from(section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea"));
    const invalid = fields.find((field) => !field.disabled && !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return false;
    }
    if (index === 3) {
      const weekdays = section.querySelectorAll<HTMLInputElement>('input[name="weekdays"]:checked');
      if (!weekdays.length) {
        section.querySelector<HTMLInputElement>('input[name="weekdays"]')?.focus();
        setPreview({ error: "เลือกวันในสัปดาห์อย่างน้อย 1 วัน", ok: false });
        return false;
      }
    }
    return true;
  };

  const readSummary = (form: HTMLFormElement): Summary => {
    const data = new FormData(form);
    const coach = coaches.find((item) => item.id === data.get("coachId"));
    const venue = venues.find((item) => item.id === data.get("venueId"));
    const bay = String(data.get("bayLabel") ?? "");
    const days = data.getAll("weekdays").map(Number);
    return [
      { label: "คอร์ส", value: program?.name ?? "" },
      { label: "ชื่อรอบเรียน", value: String(data.get("title") ?? "") },
      { label: "ผู้สอน", value: coach ? coachLabel(coach) : String(data.get("coachName") ?? "") || "ไม่ระบุ" },
      { label: "สถานที่", value: venue ? `${venue.name}${bay ? ` ช่อง ${bay}` : ""}` : String(data.get("venue") ?? "") || "ไม่ระบุ" },
      { label: "ช่วงวันที่", value: `${formatThaiDate(String(data.get("dateFrom")))} – ${formatThaiDate(String(data.get("dateTo")))}` },
      { label: "วันที่มีเรียน", value: weekdayOrder.filter((day) => days.includes(day)).map((day) => thaiWeekdaysShort[day]).join(" ") },
      { label: "ช่วงเวลา", value: String(data.get("timeRanges") ?? "").replace(/-/g, "–") },
      { label: "ที่นั่งต่อรอบ", value: `${data.get("capacity")} คน · คิวสำรอง ${data.get("waitlistCapacity") || 0} คน` },
    ];
  };

  const goTo = (target: number) => {
    if (target > step) {
      for (let index = step; index < Math.min(target, 4); index += 1) {
        if (!stepValid(index)) {
          setStep(index);
          return;
        }
      }
    }
    setStep(target);
    if (target === 4 && formRef.current) {
      const form = formRef.current;
      setShowAll(false);
      setPreview(null);
      startTransition(async () => {
        try {
          setPreview(await previewLessonSlots(new FormData(form)));
        } catch {
          setPreview({ error: "ดูตัวอย่างไม่สำเร็จ ลองอีกครั้ง", ok: false });
        }
      });
    }
    if (target === 5 && formRef.current) {
      setSummary(readSummary(formRef.current));
    }
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toCreate = preview?.ok ? preview.counts.create : 0;
  const shownItems = preview?.ok ? (showAll ? preview.items : preview.items.slice(0, 60)) : [];

  return (
    <form action={generateLessonSlots} className="@container scroll-mt-24" ref={formRef}>
      <SchemaField v2={v2} />
      {bypass ? <input name="bypass" type="hidden" value="admin" /> : null}

      <ol className="flex flex-wrap gap-x-1 gap-y-2 border-b border-line pb-4" aria-label="ขั้นตอนสร้างรอบเรียน">
        {steps.map((label, index) => {
          const state = index === step ? "current" : index < step ? "done" : "todo";
          return (
            <li key={label}>
              <button
                aria-current={state === "current" ? "step" : undefined}
                className={`flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition ${
                  state === "current" ? "bg-brand-600 text-white" : state === "done" ? "bg-brand-50 text-brand-600 hover:bg-brand-50/70" : "text-ink-subtle"
                }`}
                disabled={state === "todo"}
                onClick={() => goTo(index)}
                type="button"
              >
                <span className={`flex size-5 items-center justify-center rounded-full text-xs tabular-nums ${state === "current" ? "bg-white/20" : "bg-white ring-1 ring-line"}`}>{index + 1}</span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      {/* 1. course */}
      <section className="mt-5 grid gap-4" hidden={step !== 0} ref={(node) => { sectionRefs.current[0] = node; }}>
        <fieldset className="min-w-0">
          <legend className={fieldLabel}>คอร์ส<Required /></legend>
          <div className="mt-1.5 grid gap-2 @xl:grid-cols-2">
            {programs.map((item) => (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-white px-4 py-3 transition has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
                key={item.id}
              >
                <input checked={programId === item.id} className={`${checkboxClass} mt-1`} name="programId" onChange={() => pickProgram(item.id)} required type="radio" value={item.id} />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{item.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                    {lessonLevelLabels[item.level] ?? item.level}
                    {item.coach_name ? ` · ${item.coach_name}` : ""}
                    {item.requires_package ? <StatusBadge tone="info">ใช้เครดิต</StatusBadge> : null}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className={fieldLabel}>ชื่อรอบเรียน<Required /></span>
          <input
            className={fieldInput}
            name="title"
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleTouched(true);
            }}
            placeholder="เช่น คลาสผู้เริ่มต้น รอบเย็น"
            required
            value={title}
          />
          <span className={fieldHint}>สมาชิกเห็นชื่อนี้ในตารางเรียน</span>
        </label>
      </section>

      {/* 2. coach */}
      <section className="mt-5 grid gap-4" hidden={step !== 1} ref={(node) => { sectionRefs.current[1] = node; }}>
        {v2 ? (
          <LessonsAdminCoachPicker coaches={coaches} defaultCoachId={program?.default_coach_id} defaultCoachName={program?.default_coach_id ? "" : program?.coach_name} key={`coach-${programId}`} />
        ) : (
          <label className="block">
            <span className={fieldLabel}>ผู้สอน</span>
            <input className={fieldInput} defaultValue={program?.coach_name ?? ""} key={`coach-${programId}`} name="coachName" />
          </label>
        )}
        <p className="text-sm text-ink-muted">รอบที่เวลาชนกับรอบอื่นของผู้สอนคนเดียวกันจะถูกข้าม (เห็นในขั้นดูตัวอย่าง)</p>
      </section>

      {/* 3. venue + seats */}
      <section className="mt-5 grid gap-4" hidden={step !== 2} ref={(node) => { sectionRefs.current[2] = node; }}>
        {v2 ? (
          <LessonsAdminVenuePicker
            capacity={capacity}
            defaultVenueId={program?.default_venue_id}
            key={`venue-${programId}`}
            onChange={(value) => {
              if (value.venueId) setCapacity(value.suggested);
            }}
            venues={venues}
          />
        ) : (
          <label className="block">
            <span className={fieldLabel}>สถานที่</span>
            <input className={fieldInput} name="venue" placeholder="เช่น สนามไดร์ฟ ช่อง 1-8" />
          </label>
        )}
        <div className="grid gap-4 @md:grid-cols-2">
          <label className="block">
            <span className={fieldLabel}>ที่นั่งต่อรอบ<Required /></span>
            <span className="mt-1.5 flex items-center gap-2">
              <input
                className={`${fieldInputClass("md", { margin: false })} min-w-0 tabular-nums`}
                inputMode="numeric"
                min={1}
                name="capacity"
                onChange={(event) => setCapacity(Number(event.target.value) || 0)}
                required
                type="number"
                value={capacity || ""}
              />
              <span className="shrink-0 text-sm text-ink-muted">คน</span>
            </span>
          </label>
          <UnitInput defaultValue={3} label="คิวสำรองต่อรอบ" name="waitlistCapacity" unit="คน" />
        </div>
      </section>

      {/* 4. dates and times */}
      <section className="mt-5 grid gap-4" hidden={step !== 3} ref={(node) => { sectionRefs.current[3] = node; }}>
        <div className="grid gap-4 @md:grid-cols-2">
          <label className="block">
            <span className={fieldLabel}>ตั้งแต่วันที่<Required /></span>
            <input className={fieldInput} defaultValue={today} min={addDays(today, -30)} name="dateFrom" required type="date" />
          </label>
          <label className="block">
            <span className={fieldLabel}>ถึงวันที่<Required /></span>
            <input className={fieldInput} defaultValue={addDays(today, 27)} name="dateTo" required type="date" />
          </label>
        </div>
        <fieldset className="min-w-0">
          <legend className={fieldLabel}>วันที่มีเรียน<Required /></legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {weekdayOrder.map((day) => (
              <label
                className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-sm font-medium text-ink has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-600"
                key={day}
              >
                <input className={checkboxClass} defaultChecked={day >= 1 && day <= 5} name="weekdays" type="checkbox" value={day} />
                {thaiWeekdaysShort[day]}
              </label>
            ))}
          </div>
        </fieldset>
        <LessonsTimeRanges />
        <label className="block @md:max-w-xs">
          <span className={fieldLabel}>สถานะรอบ</span>
          <select className={fieldInput} defaultValue="open" name="status">
            <option value="open">เปิดจอง</option>
            <option value="draft">ฉบับร่าง (สมาชิกยังไม่เห็น)</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>หมายเหตุ</span>
          <input className={fieldInput} name="note" />
        </label>
        <TargetFields />
        <RescheduleFields cutoffHours={cutoffHours} />
        {preview && !preview.ok && step === 3 ? <p className="text-sm font-medium text-danger" role="alert">{preview.error}</p> : null}
      </section>

      {/* 5. preview */}
      <section className="mt-5" hidden={step !== 4} ref={(node) => { sectionRefs.current[4] = node; }}>
        {pending || !preview ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            กำลังตรวจรอบที่ชนกัน…
          </p>
        ) : preview.ok ? (
          <div className="grid gap-3">
            <p className="text-h3 font-semibold text-ink" role="status">{preview.summary}</p>
            {preview.capacityWarning ? <p className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-medium text-warning">ที่นั่งเกินสถานที่: {preview.capacityWarning}</p> : null}
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {shownItems.map((item) => (
                <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm ${item.skip ? "bg-canvas" : ""}`} key={`${item.date}-${item.start}`}>
                  <span className={`w-36 shrink-0 font-medium ${item.skip ? "text-ink-subtle line-through" : "text-ink"}`}>{formatThaiDateShort(item.date)}</span>
                  <span className={`w-28 shrink-0 tabular-nums ${item.skip ? "text-ink-subtle line-through" : "text-ink"}`}>{item.start}–{item.end} น.</span>
                  {item.skip ? (
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      {item.conflicts.map((conflict, index) => (
                        <span className="flex items-center gap-1.5 text-ink-muted" key={index}>
                          <StatusBadge tone="warning">{conflict.label}</StatusBadge>
                          {conflict.title ? <span className="truncate">{conflict.title}{conflict.time ? ` ${conflict.time} น.` : ""}</span> : null}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <StatusBadge tone="success">สร้าง</StatusBadge>
                  )}
                </li>
              ))}
            </ul>
            {preview.items.length > shownItems.length ? (
              <button className={`${buttonClass("ghost", "sm")} w-fit`} onClick={() => setShowAll(true)} type="button">
                แสดงทั้งหมด {preview.items.length} รอบ
              </button>
            ) : null}
          </div>
        ) : (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm font-medium text-danger" role="alert">{preview.error}</p>
        )}
      </section>

      {/* 6. confirm */}
      <section className="mt-5 grid gap-4" hidden={step !== 5} ref={(node) => { sectionRefs.current[5] = node; }}>
        <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-line bg-white p-4 text-sm @md:grid-cols-[auto_minmax(0,1fr)]">
          {summary.map((row) => (
            <div className="contents" key={row.label}>
              <dt className="font-medium text-ink-subtle">{row.label}</dt>
              <dd className="text-ink">{row.value || "ยังไม่ระบุ"}</dd>
            </div>
          ))}
        </dl>
        {preview?.ok ? <p className="font-semibold text-ink">{preview.summary}</p> : null}
        <OpenNowOption disabled={disabled} openAt={booking.openAt} phase={booking.phase} />
        {disabled ? <p className="text-sm text-warning">โหมดทดลอง: ดูตัวอย่างได้ แต่บันทึกจริงไม่ได้</p> : null}
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <button className={buttonClass("secondary")} disabled={step === 0} onClick={() => goTo(step - 1)} type="button">
          <ArrowLeft className="size-4" aria-hidden="true" />
          ย้อนกลับ
        </button>
        {step < 5 ? (
          <button
            className={buttonClass("primary")}
            disabled={step === 4 && (pending || !preview?.ok || !toCreate)}
            onClick={() => goTo(step + 1)}
            type="button"
          >
            {step === 3 ? "ดูตัวอย่าง" : "ถัดไป"}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        ) : (
          <button className={buttonClass("primary")} disabled={disabled || !toCreate} type="submit">
            <SaveIcon className="size-4" aria-hidden="true" />
            สร้าง {toCreate} รอบ
          </button>
        )}
      </div>
      <p className={fieldHint}>สร้างได้ครั้งละไม่เกิน {MAX_GENERATED_SLOTS} รอบ รอบที่ชนกับรอบเดิมจะไม่ถูกสร้าง</p>
    </form>
  );
}
