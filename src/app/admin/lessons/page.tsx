import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  Download,
  ListOrdered,
  Megaphone,
  Plus,
  Trash2,
} from "lucide-react";

import {
  createLessonProgram,
  createLessonSlot,
  archiveLessonSlot,
  generateLessonSlots,
  removeLessonBooking,
  saveLessonBookingSettings,
  updateLessonAttendance,
  updateLessonProgram,
  updateLessonSlot,
} from "@/app/admin/lessons/actions";
import {
  type LessonBookingSettings,
  defaultLessonBookingSettings,
  formatBangkokDateTime,
  getBookingPhase,
  queueStatus,
  queueStatusLabel,
  seatSummary,
  toBangkokInputValue,
} from "@/lib/lessons/booking";
import { LessonSlotTable } from "@/components/lesson-slot-table";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type AdminLessonsPageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

type ProgramRow = {
  coach_name: string | null;
  description: string | null;
  id: string;
  level: string;
  name: string;
  price: number;
  status: string;
};

type SlotRow = {
  allow_member_reschedule?: boolean;
  booked_count?: number;
  capacity: number;
  coach_name: string | null;
  id: string;
  lesson_date: string;
  lesson_programs: { name: string } | { name: string }[] | null;
  note?: string | null;
  program_id: string;
  start_time: string;
  end_time: string;
  status: string;
  target_bureaus?: string[] | null;
  target_departments?: string[] | null;
  target_divisions?: string[] | null;
  target_sections?: string[] | null;
  target_work_lines?: string[] | null;
  reschedule_cutoff_hours?: number;
  title: string;
  venue: string | null;
  waitlist_capacity?: number;
};

type BookingMember = {
  email?: string | null;
  employee_code: string | null;
  full_name: string;
  line_id?: string | null;
  nickname: string | null;
  phone?: string | null;
};

type BookingRow = {
  attendance_note: string | null;
  booked_at?: string;
  checked_in_at: string | null;
  id: string;
  queue_seq?: number | null;
  slot_id: string;
  lesson_slots: {
    lesson_date: string;
    start_time: string;
    title: string;
  } | {
    lesson_date: string;
    start_time: string;
    title: string;
  }[] | null;
  members: BookingMember | BookingMember[] | null;
  status: string;
};

const samplePrograms: ProgramRow[] = [
  {
    coach_name: "ผู้ฝึกสอน กฟภ.",
    description: "พื้นฐานวงสวิงและ short game",
    id: "sample-program-1",
    level: "beginner",
    name: "พื้นฐานกอล์ฟ",
    price: 1200,
    status: "active",
  },
];

const sampleSlots: SlotRow[] = [
  {
    capacity: 6,
    coach_name: "ผู้ฝึกสอน กฟภ.",
    end_time: "18:30",
    id: "sample-slot-1",
    lesson_date: "2026-08-20",
    lesson_programs: { name: "พื้นฐานกอล์ฟ" },
    note: null,
    program_id: "sample-program-1",
    start_time: "17:00",
    status: "open",
    title: "ฝึกวงสวิงรอบเย็น",
    venue: "สนามฝึกซ้อม เอ",
  },
];

const sampleBookings: BookingRow[] = [
  {
    attendance_note: null,
    checked_in_at: null,
    id: "sample-booking-1",
    slot_id: "sample-slot-1",
    lesson_slots: {
      lesson_date: "2026-08-20",
      start_time: "17:00",
      title: "Swing Clinic รอบเย็น",
    },
    members: {
      employee_code: "PEA001",
      full_name: "สมาชิกทดลอง",
      nickname: "Demo",
    },
    status: "booked",
  },
];

const statusMessages: Record<string, string> = {
  "attendance-missing": "กรุณาเลือกสถานะเข้าเรียน",
  "attendance-updated": "ลงเวลาเรียนเรียบร้อยแล้ว",
  "attendance-update-failed": "ลงเวลาเรียนไม่สำเร็จ",
  "program-created": "สร้างคอร์สเรียนเรียบร้อยแล้ว",
  "program-create-failed": "สร้างคอร์สเรียนไม่สำเร็จ",
  "program-missing": "กรุณากรอกชื่อคอร์สเรียน",
  "program-not-found": "ไม่พบคอร์สเรียน",
  "program-updated": "บันทึกการแก้ไขคอร์สเรียนเรียบร้อยแล้ว",
  "program-update-failed": "บันทึกการแก้ไขคอร์สเรียนไม่สำเร็จ",
  "slot-created": "สร้างรอบเรียนเรียบร้อยแล้ว",
  "slot-create-failed": "สร้างรอบเรียนไม่สำเร็จ",
  "slot-capacity-too-low": "ที่นั่งรวมคิวสำรองต้องไม่น้อยกว่าจำนวนสมาชิกที่จองรอบนี้อยู่",
  "booking-removed": "นำผู้เรียนออกจากรอบแล้ว คิวถัดไปขยับขึ้นอัตโนมัติ",
  "generate-nothing-new": "ทุกรอบที่เลือกมีอยู่ในตารางแล้ว ไม่มีรอบใหม่ให้สร้าง",
  "generate-times-invalid": "ช่วงเวลาต้องเป็นรูปแบบ HH:MM-HH:MM คั่นด้วยจุลภาค และเวลาเลิกต้องหลังเวลาเริ่ม",
  "settings-save-failed": "บันทึกการตั้งค่ารอบลงทะเบียนไม่สำเร็จ",
  "settings-saved": "บันทึกรอบลงทะเบียนและประกาศแล้ว",
  "settings-window-invalid": "เวลาปิดลงทะเบียนต้องหลังเวลาเปิด",
  "slot-archive-failed": "ลบรอบเรียนไม่สำเร็จ",
  "slot-archive-has-bookings": "ไม่สามารถลบรอบที่ยังมีสมาชิกจองอยู่ กรุณาย้ายหรือยกเลิกการจองก่อน",
  "slot-archived": "ลบรอบเรียนออกจากตารางแล้ว",
  "slot-missing": "กรุณากรอกข้อมูลรอบเรียนให้ครบ",
  "slot-not-found": "ไม่พบรอบเรียนที่ต้องการแก้ไข",
  "slot-updated": "บันทึกการแก้ไขรอบเรียนเรียบร้อยแล้ว",
  "slot-update-failed": "บันทึกการแก้ไขรอบเรียนไม่สำเร็จ",
};

const lessonStatusLabels: Record<string, string> = {
  active: "ใช้งาน",
  archived: "เก็บถาวร",
  attended: "เข้าเรียนแล้ว",
  booked: "จองแล้ว",
  cancelled: "ยกเลิก",
  closed: "ปิดรับ",
  completed: "จบแล้ว",
  draft: "ฉบับร่าง",
  inactive: "ปิดใช้งาน",
  no_show: "ไม่มาเรียน",
  open: "เปิดจอง",
};

const lessonLevelLabels: Record<string, string> = {
  advanced: "ชำนาญ",
  all: "ทุกระดับ",
  beginner: "เริ่มต้น",
  intermediate: "ปานกลาง",
};

function statusClass(status: string) {
  if (["active", "attended", "open"].includes(status)) {
    return "bg-[#f8edf4] text-[#722257]";
  }

  if (["booked", "draft"].includes(status)) {
    return "bg-[#fff5d8] text-[#805300]";
  }

  if (["cancelled", "no_show"].includes(status)) {
    return "bg-[#fdecec] text-[#991b1b]";
  }

  return "bg-[#f1f3ef] text-[#6b6475]";
}

function firstRelated<T>(value: T | T[] | null) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function ProgramForm({
  action = createLessonProgram,
  disabled,
  program,
  title = "สร้างคอร์สเรียน",
}: {
  action?: (formData: FormData) => Promise<void>;
  disabled?: boolean;
  program?: ProgramRow;
  title?: string;
}) {
  return (
    <form action={action} className="grid gap-4">
      {program ? <input name="programId" type="hidden" value={program.id} /> : null}
      <div className="flex items-center gap-2">
        <Plus className="size-4 text-[#722257]" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-[#722257]">{title}</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_180px_180px]">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ชื่อคอร์ส</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={program?.name ?? ""} disabled={disabled} name="name" required />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ระดับ</span>
          <select className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={program?.level ?? "all"} disabled={disabled} name="level">
            <option value="all">ทุกระดับ</option>
            <option value="beginner">เริ่มต้น</option>
            <option value="intermediate">ปานกลาง</option>
            <option value="advanced">ชำนาญ</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สถานะ</span>
          <select className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={program?.status ?? "active"} disabled={disabled} name="status">
            <option value="active">ใช้งาน</option>
            <option value="inactive">ปิดใช้งาน</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_160px]">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ผู้สอน</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={program?.coach_name ?? ""} disabled={disabled} name="coachName" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ราคา</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={program?.price ?? 0} disabled={disabled} min="0" name="price" step="0.01" type="number" />
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-semibold text-[#3f3a48]">รายละเอียด</span>
        <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={program?.description ?? ""} disabled={disabled} name="description" />
      </label>
      <button className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white disabled:bg-[#9a94a6] md:w-fit" disabled={disabled} type="submit">
        <BadgeCheck className="size-4" aria-hidden="true" />
        {program ? "บันทึกการแก้ไข" : "บันทึกคอร์ส"}
      </button>
    </form>
  );
}

function SlotForm({
  action = createLessonSlot,
  disabled,
  programs,
  slot,
  title = "สร้างรอบเรียน",
}: {
  action?: (formData: FormData) => Promise<void>;
  disabled?: boolean;
  programs: ProgramRow[];
  slot?: SlotRow;
  title?: string;
}) {
  return (
    <form action={action} className="grid gap-4">
      {slot ? <input name="slotId" type="hidden" value={slot.id} /> : null}
      <div className="flex items-center gap-2">
        <CalendarClock className="size-4 text-[#722257]" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-[#722257]">{title}</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_140px]">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">คอร์ส</span>
          <select className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.program_id} disabled={disabled || !programs.length} name="programId" required>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ชื่อรอบเรียน</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.title ?? ""} disabled={disabled} name="title" required />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สถานะ</span>
          <select className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.status ?? "open"} disabled={disabled} name="status">
            <option value="open">เปิดจอง</option>
            <option value="draft">ฉบับร่าง</option>
            <option value="closed">ปิดรับ</option>
            <option value="completed">เสร็จสิ้น</option>
            <option value="cancelled">ยกเลิกรอบ</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">วันที่</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.lesson_date ?? ""} disabled={disabled} name="lessonDate" required type="date" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">เริ่ม</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.start_time?.slice(0, 5) ?? ""} disabled={disabled} name="startTime" required type="time" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">เลิก</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.end_time?.slice(0, 5) ?? ""} disabled={disabled} name="endTime" required type="time" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">จำนวนรับ</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.capacity ?? 1} disabled={disabled} min="1" name="capacity" type="number" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">คิวสำรอง</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.waitlist_capacity ?? 0} disabled={disabled} min="0" name="waitlistCapacity" type="number" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ผู้สอน</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.coach_name ?? ""} disabled={disabled} name="coachName" />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สถานที่</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.venue ?? ""} disabled={disabled} name="venue" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">หมายเหตุ</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.note ?? ""} disabled={disabled} name="note" />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        {[
          { key: "targetWorkLines", label: "สายงาน", value: slot?.target_work_lines },
          { key: "targetBureaus", label: "สำนัก", value: slot?.target_bureaus },
          { key: "targetDivisions", label: "ฝ่าย", value: slot?.target_divisions },
          { key: "targetDepartments", label: "กอง", value: slot?.target_departments },
          { key: "targetSections", label: "แผนก", value: slot?.target_sections },
        ].map((target) => (
          <label className="block" key={target.key}>
            <span className="text-sm font-semibold text-[#3f3a48]">{target.label}</span>
            <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={target.value?.join(", ") ?? ""} disabled={disabled} name={target.key} placeholder="เว้นว่าง = ทุกคน" />
          </label>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_180px]">
        <label className="flex items-center gap-3 rounded-md border border-[#e6e2ee] bg-white/70 px-3 py-3 text-sm font-semibold text-[#3f3a48]">
          <input defaultChecked={slot?.allow_member_reschedule ?? true} disabled={disabled} name="allowMemberReschedule" type="checkbox" />
          อนุญาตให้สมาชิกเปลี่ยนเวลาเรียนเอง
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ปิดรับเปลี่ยนก่อนเริ่มเรียน (ชั่วโมง)</span>
          <input className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={slot?.reschedule_cutoff_hours ?? 12} disabled={disabled} min="0" name="rescheduleCutoffHours" type="number" />
        </label>
      </div>
      <button className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white disabled:bg-[#9a94a6] md:w-fit" disabled={disabled || !programs.length} type="submit">
        <BadgeCheck className="size-4" aria-hidden="true" />
        {slot ? "บันทึกการแก้ไข" : "บันทึกรอบเรียน"}
      </button>
    </form>
  );
}

const inputClass = "mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10";
const weekdayLabels = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function BookingSettingsForm({ disabled, settings }: { disabled?: boolean; settings: LessonBookingSettings }) {
  const phase = getBookingPhase(settings);
  const phaseLabel = { after: "ปิดลงทะเบียนแล้ว", before: "รอเปิดลงทะเบียน", open: "เปิดลงทะเบียนอยู่", unset: "ยังไม่กำหนดรอบ" }[phase];
  return (
    <form action={saveLessonBookingSettings} className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Megaphone className="size-4 text-[#722257]" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-[#722257]">รอบลงทะเบียนและประกาศ</h2>
        </div>
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${phase === "open" ? "bg-[#edf9f3] text-[#16794b]" : "bg-[#f1f3ef] text-[#6b6475]"}`}>{phaseLabel}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">เปิดลงทะเบียน (เวลาไทย)</span>
          <input className={inputClass} defaultValue={toBangkokInputValue(settings.booking_open_at)} disabled={disabled} name="bookingOpenAt" type="datetime-local" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ปิดลงทะเบียน (เว้นว่าง = ไม่ปิด)</span>
          <input className={inputClass} defaultValue={toBangkokInputValue(settings.booking_close_at)} disabled={disabled} name="bookingCloseAt" type="datetime-local" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">จองได้สูงสุดต่อคน (0 = ไม่จำกัด)</span>
          <input className={inputClass} defaultValue={settings.max_bookings_per_member} disabled={disabled} min="0" name="maxBookingsPerMember" type="number" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ยกเลิกได้ก่อนเรียน (ชั่วโมง)</span>
          <input className={inputClass} defaultValue={settings.cancel_cutoff_hours} disabled={disabled} min="0" name="cancelCutoffHours" type="number" />
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-semibold text-[#3f3a48]">หัวข้อประกาศ</span>
        <input className={inputClass} defaultValue={settings.announcement_title} disabled={disabled} name="announcementTitle" placeholder="เช่น เงื่อนไขการเข้าเรียนรอบ ธ.ค. 2569" />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-[#3f3a48]">เนื้อหาประกาศ</span>
        <span className="block text-xs text-[#6b6475]">สมาชิกต้องอ่านและกดรับทราบก่อนเลือกเวลาเรียน</span>
        <textarea className={`${inputClass} min-h-36 py-3 leading-7`} defaultValue={settings.announcement_body} disabled={disabled} name="announcementBody" placeholder="กติกา การแต่งกาย อุปกรณ์ จุดนัดพบ การมาสาย การงดสิทธิ์" />
      </label>
      <label className="flex items-center gap-3 rounded-md border border-[#e6e2ee] bg-white/70 px-3 py-3 text-sm font-semibold text-[#3f3a48]">
        <input defaultChecked={settings.announcement_version === 0} disabled={disabled} name="announcementNewVersion" type="checkbox" />
        นับเป็นประกาศฉบับใหม่ สมาชิกทุกคนต้องกดรับทราบอีกครั้ง
        {settings.announcement_version ? <span className="text-xs font-normal text-[#6b6475]">(ฉบับปัจจุบัน {settings.announcement_version})</span> : null}
      </label>
      <button className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white disabled:bg-[#9a94a6] md:w-fit" disabled={disabled} type="submit">
        <BadgeCheck className="size-4" aria-hidden="true" />
        บันทึกการตั้งค่า
      </button>
    </form>
  );
}

function SlotGeneratorForm({ disabled, programs }: { disabled?: boolean; programs: ProgramRow[] }) {
  return (
    <form action={generateLessonSlots} className="grid gap-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-4 text-[#722257]" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-[#722257]">สร้างหลายรอบเรียนพร้อมกัน</h2>
      </div>
      <p className="text-sm text-[#6b6475]">เลือกช่วงวันที่ วันในสัปดาห์ และใส่ได้หลายช่วงเวลา ระบบสร้างทุกคู่วัน-เวลาให้ และข้ามรอบที่มีอยู่แล้ว (สูงสุด 300 รอบต่อครั้ง)</p>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">คอร์ส</span>
          <select className={inputClass} disabled={disabled || !programs.length} name="programId" required>
            {programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ชื่อรอบเรียน</span>
          <input className={inputClass} disabled={disabled} name="title" placeholder="เช่น คลาสผู้เริ่มต้น รอบเย็น" required />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ตั้งแต่วันที่</span>
          <input className={inputClass} disabled={disabled} name="dateFrom" required type="date" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ถึงวันที่</span>
          <input className={inputClass} disabled={disabled} name="dateTo" required type="date" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ช่วงเวลา (คั่นด้วยจุลภาค)</span>
          <input className={inputClass} defaultValue="16:30-17:30, 17:30-18:30" disabled={disabled} name="timeRanges" required />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {weekdayLabels.map((label, index) => (
          <label className="flex items-center gap-2 rounded-full border border-[#d9d3e6] px-3 py-1.5 text-sm" key={label}>
            <input defaultChecked disabled={disabled} name="weekdays" type="checkbox" value={index} /> {label}
          </label>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ที่นั่งต่อรอบ</span>
          <input className={inputClass} defaultValue={8} disabled={disabled} min="1" name="capacity" type="number" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">คิวสำรอง</span>
          <input className={inputClass} defaultValue={3} disabled={disabled} min="0" name="waitlistCapacity" type="number" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ผู้สอน</span>
          <input className={inputClass} disabled={disabled} name="coachName" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สถานที่</span>
          <input className={inputClass} disabled={disabled} name="venue" placeholder="เช่น สนามไดร์ฟ ช่อง 1-8" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">หมายเหตุ</span>
          <input className={inputClass} disabled={disabled} name="note" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สถานะ</span>
          <select className={inputClass} defaultValue="open" disabled={disabled} name="status">
            <option value="open">เปิดจอง</option>
            <option value="draft">ฉบับร่าง</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        {[
          { key: "targetWorkLines", label: "สายงาน" },
          { key: "targetBureaus", label: "สำนัก" },
          { key: "targetDivisions", label: "ฝ่าย" },
          { key: "targetDepartments", label: "กอง" },
          { key: "targetSections", label: "แผนก" },
        ].map((target) => (
          <label className="block" key={target.key}>
            <span className="text-sm font-semibold text-[#3f3a48]">{target.label}</span>
            <input className={inputClass} disabled={disabled} name={target.key} placeholder="คั่นด้วยจุลภาค" />
          </label>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_180px]">
        <label className="flex items-center gap-3 rounded-md border border-[#e6e2ee] bg-white/70 px-3 py-3 text-sm font-semibold text-[#3f3a48]">
          <input defaultChecked disabled={disabled} name="allowMemberReschedule" type="checkbox" />
          อนุญาตให้สมาชิกเปลี่ยนเวลาเรียนเอง
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ปิดรับเปลี่ยนก่อนเริ่มเรียน (ชั่วโมง)</span>
          <input className={inputClass} defaultValue={12} disabled={disabled} min="0" name="rescheduleCutoffHours" type="number" />
        </label>
      </div>
      <button className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white disabled:bg-[#9a94a6] md:w-fit" disabled={disabled || !programs.length} type="submit">
        <Plus className="size-4" aria-hidden="true" />
        สร้างรอบเรียนตามแผน
      </button>
    </form>
  );
}

function SlotRoster({ bookings, disabled, slot }: { bookings: BookingRow[]; disabled?: boolean; slot: SlotRow }) {
  const ordered = bookings
    .filter((booking) => booking.slot_id === slot.id)
    .sort((a, b) => (a.queue_seq ?? 0) - (b.queue_seq ?? 0));
  const active = ordered.filter((booking) => booking.status !== "cancelled");
  const cancelled = ordered.filter((booking) => booking.status === "cancelled");

  if (!ordered.length) {
    return <p className="mt-4 border-t border-[#e6e2ee] pt-4 text-sm text-[#6b6475]">ยังไม่มีผู้จองรอบนี้</p>;
  }

  return (
    <div className="mt-4 border-t border-[#e6e2ee] pt-4">
      <div className="flex items-center gap-2">
        <ListOrdered className="size-4 text-[#722257]" aria-hidden="true" />
        <h4 className="font-semibold text-[#722257]">รายชื่อตามลำดับการจอง ({active.length}/{slot.capacity + (slot.waitlist_capacity ?? 0)})</h4>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="text-left text-xs text-[#6b6475]">
              <th className="px-2 py-2">ลำดับ</th><th className="px-2 py-2">ที่นั่ง</th><th className="px-2 py-2">ชื่อ-นามสกุล</th><th className="px-2 py-2">รหัส</th><th className="px-2 py-2">ติดต่อ</th><th className="px-2 py-2">เวลาจอง</th><th className="px-2 py-2">ลงเวลาเรียน</th><th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ece8f1]">
            {[...active, ...cancelled].map((booking, index) => {
              const member = firstRelated(booking.members);
              const position = index < active.length ? index + 1 : null;
              const seat = position ? queueStatus(position, slot.capacity) : null;
              return (
                <tr className={booking.status === "cancelled" ? "text-[#9a94a6]" : ""} key={booking.id}>
                  <td className="px-2 py-2 tabular-nums">{position ?? "-"}</td>
                  <td className="px-2 py-2">
                    {seat ? (
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${seat.kind === "confirmed" ? "bg-[#f8edf4] text-[#722257]" : "bg-[#fff5d8] text-[#805300]"}`}>{queueStatusLabel(position!, slot.capacity)}</span>
                    ) : (
                      <span className="rounded-md bg-[#f1f3ef] px-2 py-1 text-xs font-semibold">ยกเลิก</span>
                    )}
                  </td>
                  <td className="px-2 py-2 font-semibold text-[#3f3a48]">{member?.full_name ?? "-"}{member?.nickname ? <span className="font-normal text-[#6b6475]"> ({member.nickname})</span> : null}</td>
                  <td className="px-2 py-2 tabular-nums">{member?.employee_code ?? "-"}</td>
                  <td className="px-2 py-2 text-xs text-[#6b6475]">{[member?.phone, member?.email, member?.line_id ? `LINE ${member.line_id}` : null].filter(Boolean).join(" · ") || "-"}</td>
                  <td className="px-2 py-2 text-xs tabular-nums">{formatBangkokDateTime(booking.booked_at)}</td>
                  <td className="px-2 py-2">
                    {booking.status === "cancelled" ? (
                      <span className="text-xs">{booking.attendance_note ?? ""}</span>
                    ) : (
                      <form action={updateLessonAttendance} className="flex flex-wrap items-center gap-2">
                        <input name="bookingId" type="hidden" value={booking.id} />
                        <select className="h-9 rounded-md border border-[#d9d3e6] bg-white px-2 text-xs outline-none focus:border-[#722257]" defaultValue={booking.status} disabled={disabled} name="attendanceStatus">
                          <option value="booked">จองแล้ว</option>
                          <option value="attended">เข้าเรียนแล้ว</option>
                          <option value="no_show">ไม่มาเรียน</option>
                        </select>
                        <input className="h-9 w-32 rounded-md border border-[#d9d3e6] px-2 text-xs outline-none focus:border-[#722257]" defaultValue={booking.attendance_note ?? ""} disabled={disabled} name="attendanceNote" placeholder="หมายเหตุ" />
                        <button className="flex h-9 items-center gap-1 rounded-md bg-[#722257] px-3 text-xs font-semibold text-white disabled:bg-[#9a94a6]" disabled={disabled} type="submit">
                          <ClipboardCheck className="size-3.5" aria-hidden="true" /> บันทึก
                        </button>
                      </form>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {booking.status !== "cancelled" && !disabled ? (
                      <form action={removeLessonBooking}>
                        <input name="bookingId" type="hidden" value={booking.id} />
                        <ConfirmSubmitButton className="flex h-9 items-center gap-1 rounded-md border border-[#efcbd0] bg-white px-2 text-xs font-semibold text-[#a33a46]" message={`นำ ${member?.full_name ?? "ผู้เรียน"} ออกจากรอบนี้? คิวถัดไปจะขยับขึ้นอัตโนมัติ`}>
                          <Trash2 className="size-3.5" aria-hidden="true" /> นำออก
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function AdminLessonsPage({ searchParams }: AdminLessonsPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/lessons",
    requiredRole: "admin",
    searchParams: params,
  });
  let programs = samplePrograms;
  let slots = sampleSlots;
  let bookings = sampleBookings;
  let lessonSettings: LessonBookingSettings = { ...defaultLessonBookingSettings };

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const [programResult, slotResult, bookingResult, settingsResult] = await Promise.all([
      supabase
        .from("lesson_programs")
        .select("id, name, coach_name, level, price, description, status")
        .eq("club_id", access.clubId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("lesson_slots")
        .select("id, program_id, title, coach_name, venue, lesson_date, start_time, end_time, capacity, waitlist_capacity, booked_count, status, note, allow_member_reschedule, reschedule_cutoff_hours, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections, lesson_programs(name)")
        .eq("club_id", access.clubId)
        .is("archived_at", null)
        .order("lesson_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(300),
      supabase
        .from("lesson_bookings")
        .select("id, slot_id, status, queue_seq, booked_at, checked_in_at, attendance_note, members(full_name, nickname, employee_code, phone, email, line_id), lesson_slots(title, lesson_date, start_time)")
        .eq("club_id", access.clubId)
        .order("queue_seq", { ascending: true })
        .limit(2000),
      supabase
        .from("lesson_booking_settings")
        .select("booking_open_at, booking_close_at, max_bookings_per_member, cancel_cutoff_hours, announcement_title, announcement_body, announcement_version")
        .eq("club_id", access.clubId)
        .maybeSingle(),
    ]);

    programs = (programResult.data ?? []) as ProgramRow[];
    slots = (slotResult.data ?? []) as unknown as SlotRow[];
    bookings = (bookingResult.data ?? []) as unknown as BookingRow[];
    if (settingsResult.data) {
      lessonSettings = { ...defaultLessonBookingSettings, ...settingsResult.data };
    }
  }

  const activePrograms = programs.filter((program) => program.status === "active");
  const openSlots = slots.filter((slot) => slot.status === "open");
  const bookedCount = bookings.filter((booking) => booking.status === "booked").length;
  const bookedCountBySlot = new Map<string, number>();
  bookings
    .filter((booking) => !["cancelled"].includes(booking.status))
    .forEach((booking) => {
      bookedCountBySlot.set(
        booking.slot_id,
        (bookedCountBySlot.get(booking.slot_id) ?? 0) + 1,
      );
    });
  let waitlistedCount = 0;
  let confirmedCount = 0;
  let seatTotal = 0;
  slots.forEach((slot) => {
    const seats = seatSummary(bookedCountBySlot.get(slot.id) ?? 0, slot.capacity, slot.waitlist_capacity ?? 0);
    waitlistedCount += seats.waitlisted;
    confirmedCount += seats.confirmed;
    seatTotal += slot.capacity;
  });
  const statusMessage = params.status
    ? statusMessages[params.status]
      ?? (params.status.startsWith("generated:")
        ? (() => {
            const [, created, skipped] = params.status.split(":");
            return `สร้าง ${created} รอบเรียนแล้ว${Number(skipped) ? ` (ข้าม ${skipped} รอบที่มีอยู่แล้ว)` : ""}`;
          })()
        : params.status.startsWith("generate-invalid:")
          ? params.status.slice("generate-invalid:".length)
          : null)
    : null;
  const bypassQuery = access.isBypass ? "?bypass=admin" : "";

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">ระบบผู้ดูแล</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#722257]">
              จัดการตารางเรียนกอล์ฟ
            </h1>
            <p className="mt-2 text-sm text-[#6b6475]">
              จัดคอร์สเรียน เปิดรอบจอง และลงเวลาเข้าเรียนของสมาชิก
            </p>
          </div>
          <Link className="flex h-11 w-fit items-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#722257]" href={`/admin${bypassQuery}`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับหน้าผู้ดูแล
          </Link>
        </div>

        {statusMessage ? (
          <StatusBanner className="mt-5" tone={toneForStatus(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        {access.isBypass ? (
          <div className="mt-5 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
            โหมดผู้ดูแลทดลอง: แสดงข้อมูลตัวอย่างและปิดการบันทึกจริง ต้องปิดก่อนเปิดใช้งาน
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {[
            { icon: BookOpenCheck, label: "คอร์สที่ใช้งาน", value: String(activePrograms.length) },
            { icon: CalendarClock, label: "รอบเปิดจอง", value: String(openSlots.length) },
            { icon: ListOrdered, label: "ที่นั่งถูกจอง", value: `${confirmedCount}/${seatTotal}` },
            { icon: Megaphone, label: "คิวสำรอง", value: String(waitlistedCount) },
            { icon: ClipboardCheck, label: "รอลงเวลา", value: String(bookedCount) },
          ].map((item) => (
            <article className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]" key={item.label}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#6b6475]">{item.label}</p>
                  <p className="mt-2 text-3xl font-semibold text-[#722257]">{item.value}</p>
                </div>
                <div className="flex size-11 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                  <item.icon className="size-5" aria-hidden="true" />
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <BookingSettingsForm disabled={access.isBypass} settings={lessonSettings} />
          </section>
          <section className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <SlotGeneratorForm disabled={access.isBypass} programs={activePrograms} />
          </section>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <ProgramForm disabled={access.isBypass} />
          </section>
          <section className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
            <SlotForm disabled={access.isBypass} programs={activePrograms} />
          </section>
        </div>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="border-b border-[#e6e2ee] p-5">
            <h2 className="text-xl font-semibold text-[#722257]">คอร์สเรียนทั้งหมด</h2>
          </div>
          <div className="divide-y divide-[#e6e2ee]">
            {programs.length ? (
              programs.map((program) => (
                <details className="group px-5 py-4" key={program.id}>
                  <summary className="grid cursor-pointer list-none gap-4 md:grid-cols-[44px_1fr_0.5fr_0.5fr_92px] md:items-center">
                    <div className="flex size-11 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                      <BookOpenCheck className="size-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#722257]">{program.name}</p>
                        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(program.status)}`}>
                          {lessonStatusLabels[program.status] ?? program.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[#6b6475]">
                        {program.coach_name ?? "ยังไม่ระบุผู้สอน"}
                      </p>
                    </div>
                    <p className="text-sm text-[#3f3a48]">
                      {lessonLevelLabels[program.level] ?? program.level}
                    </p>
                    <p className="text-sm font-semibold text-[#722257]">
                      {program.price.toLocaleString()} บาท
                    </p>
                    <span className="w-fit rounded-md border border-[#d9d3e6] px-3 py-2 text-sm font-semibold text-[#722257] group-open:bg-[#f8edf4]">
                      แก้ไข
                    </span>
                  </summary>
                  <div className="mt-5 rounded-lg border border-[#e6e2ee] bg-[#fbf9fc] p-4">
                    <ProgramForm
                      action={updateLessonProgram}
                      disabled={access.isBypass}
                      program={program}
                      title={`แก้ไข ${program.name}`}
                    />
                  </div>
                </details>
              ))
            ) : (
              <div className="px-5 py-10 text-center text-sm text-[#6b6475]">
                ยังไม่มีคอร์สเรียน
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e6e2ee] p-5">
            <div>
              <h2 className="text-xl font-semibold text-[#722257]">ตารางรอบเรียนแบบ Slot</h2>
              <p className="mt-1 text-sm text-[#6b6475]">มองรอบเรียนตามวันและเวลา กดแก้ไขเพื่อจัดการรายละเอียดและดูรายชื่อตามลำดับคิว</p>
            </div>
            {!access.isBypass ? (
              <a className="flex h-10 items-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#722257]" href="/admin/lessons/export">
                <Download className="size-4" aria-hidden="true" />
                ดาวน์โหลดรายชื่อ CSV
              </a>
            ) : null}
          </div>
          <div className="p-5">
            <LessonSlotTable
              items={slots.map((slot) => {
                const program = firstRelated(slot.lesson_programs);

                return {
                  action: (
                    <a className="flex h-9 items-center justify-center rounded-md border border-[#722257] bg-white px-3 text-xs font-semibold text-[#722257]" href={`#slot-${slot.id}`}>
                      แก้ไขรอบ
                    </a>
                  ),
                  bookedCount: bookedCountBySlot.get(slot.id) ?? slot.booked_count ?? 0,
                  capacity: slot.capacity,
                  date: slot.lesson_date,
                  endTime: slot.end_time,
                  id: slot.id,
                  startTime: slot.start_time,
                  statusLabel: lessonStatusLabels[slot.status] ?? slot.status,
                  subtitle: `${program?.name ?? "-"} · ${slot.coach_name ?? "ยังไม่ระบุผู้สอน"}`,
                  title: slot.title,
                  venue: slot.venue,
                };
              })}
            />
          </div>
          <div className="border-y border-[#e6e2ee] px-5 py-4">
            <h3 className="font-semibold text-[#722257]">รายละเอียดและแก้ไขรอบเรียน</h3>
          </div>
          <div className="divide-y divide-[#e6e2ee]">
            {slots.length ? (
              slots.map((slot) => {
                const program = firstRelated(slot.lesson_programs);

                return (
                  <details className="group scroll-mt-4 px-5 py-4" id={`slot-${slot.id}`} key={slot.id}>
                    <summary className="grid cursor-pointer list-none gap-4 lg:grid-cols-[44px_1fr_0.7fr_0.55fr_92px] lg:items-center">
                      <div className="flex size-11 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                        <CalendarClock className="size-5" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[#722257]">{slot.title}</p>
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(slot.status)}`}>
                            {lessonStatusLabels[slot.status] ?? slot.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[#6b6475]">
                          {program?.name ?? "-"} · {slot.venue ?? "ยังไม่ระบุสถานที่"}
                        </p>
                      </div>
                      <p className="text-sm text-[#3f3a48]">
                        {slot.lesson_date} · {slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}
                      </p>
                      <p className="text-sm text-[#3f3a48]">
                        จอง {Math.min(bookedCountBySlot.get(slot.id) ?? 0, slot.capacity)}/{slot.capacity}
                        {slot.waitlist_capacity ? ` · สำรอง ${Math.max(0, (bookedCountBySlot.get(slot.id) ?? 0) - slot.capacity)}/${slot.waitlist_capacity}` : ""}
                      </p>
                      <span className="w-fit rounded-md border border-[#d9d3e6] px-3 py-2 text-sm font-semibold text-[#722257] group-open:bg-[#f8edf4]">
                        แก้ไข
                      </span>
                    </summary>
                    <div className="mt-5 rounded-lg border border-[#e6e2ee] bg-[#fbf9fc] p-4">
                      <SlotForm
                        action={updateLessonSlot}
                        disabled={access.isBypass}
                        programs={programs}
                        slot={slot}
                        title={`แก้ไข ${slot.title}`}
                      />
                      <form action={archiveLessonSlot} className="mt-4 border-t border-[#e6e2ee] pt-4">
                        <input name="slotId" type="hidden" value={slot.id} />
                        <ConfirmSubmitButton className="h-10 rounded-md border border-[#efcbd0] bg-white px-4 text-sm font-semibold text-[#a33a46]" message="ยืนยันลบรอบเรียนนี้ออกจากตาราง">
                          ลบรอบเรียน
                        </ConfirmSubmitButton>
                      </form>
                      <SlotRoster bookings={bookings} disabled={access.isBypass} slot={slot} />
                    </div>
                  </details>
                );
              })
            ) : (
              <div className="px-5 py-10 text-center text-sm text-[#6b6475]">ยังไม่มีรอบเรียน</div>
            )}
          </div>
        </section>

      </section>
    </main>
  );
}
