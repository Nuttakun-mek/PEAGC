import { ChevronDown } from "lucide-react";

import { LessonsAdminCoachPicker, LessonsAdminVenuePicker, type PickerCoach, type PickerVenue } from "@/components/lessons-admin-pickers";
import { buttonPrimary, fieldHint, fieldInput, fieldInputClass, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { createLessonProgram, createLessonSlot } from "@/app/admin/lessons/actions";
import type { AdminLessonProgram, AdminLessonSlot } from "@/lib/lessons/admin";
import { type BookingPhase, type LessonBookingSettings, formatBangkokDateTime } from "@/lib/lessons/booking";
import { appIcons } from "@/lib/icons";
import type { StatusTone } from "@/lib/status";

// Form pieces shared by the admin lessons tabs (server components; the pickers are client).

export const checkboxClass = "size-4 shrink-0 accent-brand-600";
export const sectionTitle = "text-h3 font-semibold text-ink";
/** Flat card without padding, for cards with their own header row. */
export const cardFlat = "rounded-xl border border-line bg-white shadow-card";

export function Required() {
  return <span aria-hidden="true"> *</span>;
}

/** Hidden marker: the form was rendered against the lessons v2 schema (actions write v2 columns). */
export function SchemaField({ v2 }: { v2: boolean }) {
  return v2 ? <input name="schema" type="hidden" value="v2" /> : null;
}

/** Number field with its unit after the box ("บาท", "รอบ", "ชั่วโมง"). */
export function UnitInput({
  defaultValue,
  disabled,
  hint,
  label,
  max,
  min = "0",
  name,
  placeholder,
  required,
  step,
  unit,
}: {
  defaultValue?: number;
  disabled?: boolean;
  hint?: string;
  label: React.ReactNode;
  max?: string;
  min?: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  step?: string;
  unit: string;
}) {
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <span className="mt-1.5 flex items-center gap-2">
        <input
          className={`${fieldInputClass("md", { margin: false })} min-w-0 tabular-nums`}
          defaultValue={defaultValue}
          disabled={disabled}
          inputMode={step ? "decimal" : "numeric"}
          max={max}
          min={min}
          name={name}
          placeholder={placeholder}
          required={required}
          step={step}
          type="number"
        />
        {unit ? <span className="shrink-0 text-sm text-ink-muted">{unit}</span> : null}
      </span>
      {hint ? <span className={fieldHint}>{hint}</span> : null}
    </label>
  );
}

const targetFields = [
  { key: "targetWorkLines", label: "สายงาน", slotKey: "target_work_lines" },
  { key: "targetBureaus", label: "สำนัก", slotKey: "target_bureaus" },
  { key: "targetDivisions", label: "ฝ่าย", slotKey: "target_divisions" },
  { key: "targetDepartments", label: "กอง", slotKey: "target_departments" },
  { key: "targetSections", label: "แผนก", slotKey: "target_sections" },
] as const;

/** Limit a round to some departments; collapsed because most rounds are open to everyone. */
export function TargetFields({ disabled, slot }: { disabled?: boolean; slot?: Partial<AdminLessonSlot> }) {
  const hasTargets = targetFields.some((field) => (slot?.[field.slotKey]?.length ?? 0) > 0);
  return (
    <details className="group/targets rounded-lg border border-line" open={hasTargets}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink">
        <span>
          จำกัดผู้จองเฉพาะหน่วยงาน
          <span className="ml-1 font-normal text-ink-subtle">(ไม่บังคับ)</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-subtle transition group-open/targets:rotate-180" aria-hidden="true" />
      </summary>
      <div className="@container border-t border-line p-4">
        <p className="text-sm text-ink-muted">เว้นว่างทั้งหมด = สมาชิกทุกคนจองได้ ใส่หลายหน่วยงานคั่นด้วยจุลภาค ( , )</p>
        <div className="mt-3 grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
          {targetFields.map((field) => (
            <label className="block" key={field.key}>
              <span className={fieldLabel}>{field.label}</span>
              <input className={fieldInput} defaultValue={slot?.[field.slotKey]?.join(", ") ?? ""} disabled={disabled} name={field.key} />
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

export function RescheduleFields({ cutoffHours = 12, disabled, slot }: { cutoffHours?: number; disabled?: boolean; slot?: Partial<AdminLessonSlot> }) {
  return (
    <div className="grid items-end gap-4 @xl:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-ink">
        <input className={checkboxClass} defaultChecked={slot?.allow_member_reschedule ?? true} disabled={disabled} name="allowMemberReschedule" type="checkbox" />
        ให้สมาชิกเปลี่ยนรอบเองได้
      </label>
      <UnitInput
        defaultValue={slot?.reschedule_cutoff_hours ?? cutoffHours}
        disabled={disabled}
        label="เปลี่ยนรอบเองได้ถึงก่อนเริ่มเรียน"
        name="rescheduleCutoffHours"
        unit="ชั่วโมง"
      />
    </div>
  );
}

/** Member booking window in one badge + one line, shared by the calendar and the rules tab. */
export const phaseInfo: Record<BookingPhase, { label: string; tone: StatusTone }> = {
  after: { label: "ปิดจองแล้ว", tone: "neutral" },
  before: { label: "ยังไม่ถึงเวลาเปิดจอง", tone: "warning" },
  open: { label: "เปิดจองอยู่", tone: "info" },
  unset: { label: "ยังไม่เปิดจอง", tone: "warning" },
};

export function phaseDetail(phase: BookingPhase, settings: Pick<LessonBookingSettings, "booking_close_at" | "booking_open_at">) {
  switch (phase) {
    case "open":
      return settings.booking_close_at ? `สมาชิกจองได้ถึง ${formatBangkokDateTime(settings.booking_close_at)}` : "สมาชิกจองได้ ไม่มีกำหนดปิด";
    case "before":
      return `สมาชิกจองได้ตั้งแต่ ${formatBangkokDateTime(settings.booking_open_at)}`;
    case "after":
      return `ปิดไปเมื่อ ${formatBangkokDateTime(settings.booking_close_at)} สมาชิกจองไม่ได้`;
    default:
      return "ยังไม่ได้ตั้งเวลาเปิดจอง สมาชิกเห็นทุกรอบเป็น \"ยังไม่เปิด\"";
  }
}

/** On create forms: open member booking together with the new rounds (checked unless a future opening is scheduled). */
export function OpenNowOption({ disabled, openAt, phase }: { disabled?: boolean; openAt: string | null; phase: BookingPhase }) {
  if (phase === "open") {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-info-bg px-3 py-2.5 text-sm text-info">
        <span className="size-2 shrink-0 rounded-full bg-info" aria-hidden="true" />
        เปิดจองอยู่ สมาชิกจองรอบใหม่ได้ทันทีหลังบันทึก
      </p>
    );
  }
  const scheduled = phase === "before";
  return (
    <label className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning-bg px-3 py-3 text-sm text-ink">
      <input className={`${checkboxClass} mt-1`} defaultChecked={!scheduled} disabled={disabled} name="openBookingNow" type="checkbox" />
      <span>
        <span className="font-semibold">เปิดให้สมาชิกจองทันทีหลังบันทึก</span>
        <span className="mt-0.5 block text-xs text-warning">
          {scheduled
            ? `ตอนนี้ตั้งเวลาเปิดจองไว้ ${formatBangkokDateTime(openAt)} ถ้าติ๊กจะเปิดจองทันทีแทน`
            : phase === "after"
              ? "ช่วงจองปิดไปแล้ว ถ้าไม่ติ๊ก สมาชิกจะเห็นรอบนี้แต่จองไม่ได้"
              : "ยังไม่ได้ตั้งช่วงเปิดจอง ถ้าไม่ติ๊ก สมาชิกจะเห็นรอบนี้เป็น \"ยังไม่เปิด\""}
        </span>
      </span>
    </label>
  );
}

export const lessonLevelLabels: Record<string, string> = {
  advanced: "ชำนาญ",
  all: "ทุกระดับ",
  beginner: "เริ่มต้น",
  intermediate: "ปานกลาง",
};

export const lessonSlotStatusLabels: Record<string, string> = {
  active: "ใช้งาน",
  archived: "เก็บถาวร",
  cancelled: "ยกเลิก",
  closed: "ปิดรับ",
  completed: "จบแล้ว",
  draft: "ฉบับร่าง",
  inactive: "ปิดใช้งาน",
  open: "เปิดจอง",
};

export function ProgramForm({
  action = createLessonProgram,
  coaches,
  disabled,
  program,
  v2,
  venues,
}: {
  action?: (formData: FormData) => Promise<void>;
  coaches: PickerCoach[];
  disabled?: boolean;
  program?: AdminLessonProgram;
  v2: boolean;
  venues: PickerVenue[];
}) {
  const SaveIcon = appIcons.save;
  return (
    <form action={action} className="@container grid gap-4">
      <SchemaField v2={v2} />
      {program ? <input name="programId" type="hidden" value={program.id} /> : null}
      <div className="grid gap-4 @xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="block">
          <span className={fieldLabel}>ชื่อคอร์ส<Required /></span>
          <input className={fieldInput} defaultValue={program?.name ?? ""} disabled={disabled} name="name" placeholder="เช่น พื้นฐานกอล์ฟ" required />
        </label>
        <label className="block">
          <span className={fieldLabel}>ระดับ</span>
          <select className={fieldInput} defaultValue={program?.level ?? "all"} disabled={disabled} name="level">
            {Object.entries(lessonLevelLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>สถานะ</span>
          <select className={fieldInput} defaultValue={program?.status ?? "active"} disabled={disabled} name="status">
            <option value="active">ใช้งาน</option>
            <option value="inactive">ปิดใช้งาน</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 @md:grid-cols-2">
        {v2 ? (
          <>
            <LessonsAdminCoachPicker
              coaches={coaches}
              currentLabel={program?.coach_name}
              defaultCoachId={program?.default_coach_id}
              defaultCoachName={program?.default_coach_id ? "" : program?.coach_name}
              disabled={disabled}
              idName="defaultCoachId"
              label="ผู้สอนประจำคอร์ส"
            />
            <LessonsAdminVenuePicker
              allowText={false}
              defaultVenueId={program?.default_venue_id}
              disabled={disabled}
              idName="defaultVenueId"
              label="สถานที่ประจำคอร์ส"
              showBay={false}
              venues={venues}
            />
          </>
        ) : (
          <label className="block">
            <span className={fieldLabel}>ผู้สอน</span>
            <input className={fieldInput} defaultValue={program?.coach_name ?? ""} disabled={disabled} name="coachName" />
          </label>
        )}
      </div>
      <div className="grid gap-4 @md:grid-cols-2">
        <UnitInput
          defaultValue={program && program.price > 0 ? program.price : undefined}
          disabled={disabled}
          hint={v2 ? "ราคาที่แสดงในหน้าคอร์ส ถ้าขายเป็นแพ็กเกจ ตั้งราคาที่แพ็กเกจ" : undefined}
          label="ราคา"
          name="price"
          placeholder="0 = ฟรี"
          step="0.01"
          unit="บาท"
        />
        {v2 ? (
          <label className="flex min-h-11 items-start gap-3 self-start rounded-lg border border-line px-3 py-3 text-sm font-medium text-ink @md:mt-7">
            <input className={`${checkboxClass} mt-1`} defaultChecked={program?.requires_package ?? false} disabled={disabled} name="requiresPackage" type="checkbox" />
            <span>
              ต้องใช้แพ็กเกจ/เครดิต
              <span className="block text-xs font-normal text-ink-subtle">จองแต่ละรอบตัดเครดิต 1 ครั้ง สมาชิกต้องซื้อแพ็กเกจก่อนจอง</span>
            </span>
          </label>
        ) : null}
      </div>
      <label className="block">
        <span className={fieldLabel}>รายละเอียด</span>
        <textarea className={fieldTextarea} defaultValue={program?.description ?? ""} disabled={disabled} name="description" placeholder="เรียนอะไร เหมาะกับใคร ต้องเตรียมอะไรมา" rows={3} />
      </label>
      <button className={`${buttonPrimary} w-full @md:w-fit`} disabled={disabled} type="submit">
        <SaveIcon className="size-4" aria-hidden="true" />
        {program ? "บันทึกการแก้ไข" : "บันทึกคอร์ส"}
      </button>
    </form>
  );
}

/** One round: create (special / make-up round) or edit from the calendar panel. */
export function SlotForm({
  action = createLessonSlot,
  booking,
  coaches,
  cutoffHours,
  disabled,
  programs,
  returnTo,
  slot,
  v2,
  venues,
}: {
  action?: (formData: FormData) => Promise<void>;
  /** Create form only: current member booking window, to offer opening it with the new round. */
  booking?: { openAt: string | null; phase: BookingPhase };
  coaches: PickerCoach[];
  cutoffHours?: number;
  disabled?: boolean;
  programs: AdminLessonProgram[];
  returnTo?: string;
  slot?: AdminLessonSlot;
  v2: boolean;
  venues: PickerVenue[];
}) {
  const SaveIcon = appIcons.save;
  const seatsTaken = slot?.seats_taken ?? null;
  return (
    <form action={action} className="@container grid gap-4">
      <SchemaField v2={v2} />
      {slot ? <input name="slotId" type="hidden" value={slot.id} /> : null}
      {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
      <div className="grid gap-4 @xl:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>คอร์ส<Required /></span>
          <select className={fieldInput} defaultValue={slot?.program_id} disabled={disabled || !programs.length} name="programId" required>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>ชื่อรอบเรียน<Required /></span>
          <input className={fieldInput} defaultValue={slot?.title ?? ""} disabled={disabled} name="title" placeholder="เช่น คลาสผู้เริ่มต้น รอบเย็น" required />
        </label>
      </div>
      <div className="grid gap-4 @md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="block">
          <span className={fieldLabel}>วันที่<Required /></span>
          <input className={fieldInput} defaultValue={slot?.lesson_date ?? ""} disabled={disabled} name="lessonDate" required type="date" />
        </label>
        <label className="block">
          <span className={fieldLabel}>เวลาเริ่ม<Required /></span>
          <input className={fieldInput} defaultValue={slot?.start_time?.slice(0, 5) ?? ""} disabled={disabled} name="startTime" required step={900} type="time" />
        </label>
        <label className="block">
          <span className={fieldLabel}>เวลาเลิก<Required /></span>
          <input className={fieldInput} defaultValue={slot?.end_time?.slice(0, 5) ?? ""} disabled={disabled} name="endTime" required step={900} type="time" />
        </label>
      </div>
      <div className="grid gap-4 @md:grid-cols-3">
        <UnitInput
          defaultValue={slot?.capacity ?? 8}
          disabled={disabled}
          hint={slot ? (seatsTaken !== null ? `ได้ที่นั่งแล้ว ${seatsTaken} คน ลดต่ำกว่านี้ไม่ได้ · เพิ่มที่นั่งแล้วคนในคิวสำรองได้รับแจ้ง` : "เพิ่มที่นั่งแล้ว คนในคิวสำรองได้รับแจ้ง") : undefined}
          label={<>ที่นั่ง<Required /></>}
          min={String(Math.max(1, seatsTaken ?? 1))}
          name="capacity"
          required
          unit="คน"
        />
        <UnitInput
          defaultValue={slot?.waitlist_capacity ?? 0}
          disabled={disabled}
          hint={slot?.waitlist_count ? `อยู่ในคิวสำรอง ${slot.waitlist_count} คน` : undefined}
          label="คิวสำรอง"
          min={String(slot?.waitlist_count ?? 0)}
          name="waitlistCapacity"
          unit="คน"
        />
        <label className="block">
          <span className={fieldLabel}>สถานะ</span>
          <select className={fieldInput} defaultValue={slot?.status ?? "open"} disabled={disabled} name="status">
            <option value="open">เปิดจอง</option>
            <option value="draft">ฉบับร่าง</option>
            <option value="closed">ปิดรับ</option>
            <option value="completed">จบแล้ว</option>
            {slot ? <option value="cancelled">ยกเลิกรอบนี้</option> : null}
          </select>
          {slot ? <span className={fieldHint}>ยกเลิกรอบ = ยกเลิกการจองทั้งหมด คืนเครดิต และแจ้งผู้จอง</span> : null}
        </label>
      </div>
      {v2 ? (
        <div className="grid gap-4 @xl:grid-cols-2">
          <LessonsAdminCoachPicker
            coaches={coaches}
            currentLabel={slot?.coach_name}
            defaultCoachId={slot?.coach_id}
            defaultCoachName={slot?.coach_id ? "" : slot?.coach_name}
            disabled={disabled}
          />
          <LessonsAdminVenuePicker
            capacity={slot?.capacity}
            currentLabel={slot?.venue}
            defaultBay={slot?.bay_label}
            defaultVenueId={slot?.venue_id}
            defaultVenueText={slot?.venue_id ? "" : slot?.venue}
            disabled={disabled}
            venues={venues}
          />
        </div>
      ) : (
        <div className="grid gap-4 @xl:grid-cols-2">
          <label className="block">
            <span className={fieldLabel}>ผู้สอน</span>
            <input className={fieldInput} defaultValue={slot?.coach_name ?? ""} disabled={disabled} name="coachName" />
          </label>
          <label className="block">
            <span className={fieldLabel}>สถานที่</span>
            <input className={fieldInput} defaultValue={slot?.venue ?? ""} disabled={disabled} name="venue" placeholder="เช่น สนามไดร์ฟ ช่อง 1-8" />
          </label>
        </div>
      )}
      <label className="block">
        <span className={fieldLabel}>หมายเหตุ</span>
        <input className={fieldInput} defaultValue={slot?.note ?? ""} disabled={disabled} name="note" />
      </label>
      <TargetFields disabled={disabled} slot={slot} />
      <RescheduleFields cutoffHours={cutoffHours} disabled={disabled} slot={slot} />
      {!slot && booking ? <OpenNowOption disabled={disabled} openAt={booking.openAt} phase={booking.phase} /> : null}
      <button className={`${buttonPrimary} w-full @md:w-fit`} disabled={disabled || !programs.length} type="submit">
        <SaveIcon className="size-4" aria-hidden="true" />
        {slot ? "บันทึกการแก้ไข" : "บันทึกรอบเรียน"}
      </button>
    </form>
  );
}
