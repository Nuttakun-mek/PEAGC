import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  CalendarClock,
  CircleUserRound,
  ClipboardCheck,
  Plus,
} from "lucide-react";

import {
  createLessonProgram,
  createLessonSlot,
  archiveLessonSlot,
  updateLessonAttendance,
  updateLessonProgram,
  updateLessonSlot,
} from "@/app/admin/lessons/actions";
import { LessonSlotTable } from "@/components/lesson-slot-table";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
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
};

type BookingRow = {
  attendance_note: string | null;
  checked_in_at: string | null;
  id: string;
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
  members: {
    employee_code: string | null;
    full_name: string;
    nickname: string | null;
  } | {
    employee_code: string | null;
    full_name: string;
    nickname: string | null;
  }[] | null;
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
  "slot-capacity-too-low": "จำนวนรับต้องไม่น้อยกว่าจำนวนสมาชิกที่จองรอบนี้อยู่",
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
      <div className="grid gap-4 md:grid-cols-5">
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

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const [programResult, slotResult, bookingResult] = await Promise.all([
      supabase
        .from("lesson_programs")
        .select("id, name, coach_name, level, price, description, status")
        .eq("club_id", access.clubId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("lesson_slots")
        .select("id, program_id, title, coach_name, venue, lesson_date, start_time, end_time, capacity, status, note, allow_member_reschedule, reschedule_cutoff_hours, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections, lesson_programs(name)")
        .eq("club_id", access.clubId)
        .is("archived_at", null)
        .order("lesson_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(80),
      supabase
        .from("lesson_bookings")
        .select("id, slot_id, status, checked_in_at, attendance_note, members(full_name, nickname, employee_code), lesson_slots(title, lesson_date, start_time)")
        .eq("club_id", access.clubId)
        .order("created_at", { ascending: false })
        .limit(80),
    ]);

    programs = (programResult.data ?? []) as ProgramRow[];
    slots = (slotResult.data ?? []) as unknown as SlotRow[];
    bookings = (bookingResult.data ?? []) as unknown as BookingRow[];
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
  const statusMessage = params.status ? statusMessages[params.status] : null;
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
          <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">
            {statusMessage}
          </div>
        ) : null}

        {access.isBypass ? (
          <div className="mt-5 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
            โหมดผู้ดูแลทดลอง: แสดงข้อมูลตัวอย่างและปิดการบันทึกจริง ต้องปิดก่อนเปิดใช้งาน
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { icon: BookOpenCheck, label: "คอร์สที่ใช้งาน", value: activePrograms.length },
            { icon: CalendarClock, label: "รอบเปิดจอง", value: openSlots.length },
            { icon: ClipboardCheck, label: "รอลงเวลา", value: bookedCount },
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
          <div className="border-b border-[#e6e2ee] p-5">
            <h2 className="text-xl font-semibold text-[#722257]">ตารางรอบเรียนแบบ Slot</h2>
            <p className="mt-1 text-sm text-[#6b6475]">มองรอบเรียนตามวันและเวลา กดแก้ไขเพื่อจัดการรายละเอียดแต่ละช่อง</p>
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
                  bookedCount: bookedCountBySlot.get(slot.id) ?? 0,
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
                      <p className="text-sm text-[#3f3a48]">รับ {slot.capacity} คน</p>
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
                    </div>
                  </details>
                );
              })
            ) : (
              <div className="px-5 py-10 text-center text-sm text-[#6b6475]">ยังไม่มีรอบเรียน</div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="border-b border-[#e6e2ee] p-5">
            <h2 className="text-xl font-semibold text-[#722257]">ลงเวลาเรียน</h2>
          </div>
          <div className="divide-y divide-[#e6e2ee]">
            {bookings.length ? (
              bookings.map((booking) => {
                const member = firstRelated(booking.members);
                const slot = firstRelated(booking.lesson_slots);

                return (
                  <div className="grid gap-4 px-5 py-4 xl:grid-cols-[44px_1fr_1fr] xl:items-start" key={booking.id}>
                    <div className="flex size-11 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                      <CircleUserRound className="size-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#722257]">
                          {member?.full_name ?? "-"}
                        </p>
                        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(booking.status)}`}>
                          {lessonStatusLabels[booking.status] ?? booking.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[#6b6475]">
                        {member?.employee_code ?? "-"} · {slot?.title ?? "-"}
                      </p>
                      <p className="mt-1 text-sm text-[#6b6475]">
                        {slot?.lesson_date ?? "-"} · {slot?.start_time?.slice(0, 5) ?? "-"}
                      </p>
                    </div>
                    <form action={updateLessonAttendance} className="grid gap-3 md:grid-cols-[160px_1fr_120px]">
                      <input name="bookingId" type="hidden" value={booking.id} />
                      <select className="h-11 rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={booking.status} disabled={access.isBypass} name="attendanceStatus">
                        <option value="booked">จองแล้ว</option>
                        <option value="attended">เข้าเรียนแล้ว</option>
                        <option value="no_show">ไม่มาเรียน</option>
                        <option value="cancelled">ยกเลิก</option>
                      </select>
                      <input className="h-11 rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" defaultValue={booking.attendance_note ?? ""} disabled={access.isBypass} name="attendanceNote" placeholder="หมายเหตุ" />
                      <button className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white disabled:bg-[#9a94a6]" disabled={access.isBypass} type="submit">
                        <ClipboardCheck className="size-4" aria-hidden="true" />
                        บันทึก
                      </button>
                    </form>
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-10 text-center text-sm text-[#6b6475]">ยังไม่มีรายการจองเรียน</div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
