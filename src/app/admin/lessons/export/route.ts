import { NextResponse } from "next/server";

import { queueStatusLabel } from "@/lib/lessons/booking";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = ["platform_owner", "club_admin", "committee"];

type SlotInfo = {
  capacity: number;
  coach_name: string | null;
  end_time: string;
  lesson_date: string;
  start_time: string;
  title: string;
  venue: string | null;
};

type MemberInfo = {
  email: string | null;
  employee_code: string | null;
  full_name: string;
  line_id: string | null;
  nickname: string | null;
  phone: string | null;
};

type RosterRow = {
  attendance_note: string | null;
  booked_at: string;
  id: string;
  lesson_slots: SlotInfo | SlotInfo[] | null;
  members: MemberInfo | MemberInfo[] | null;
  queue_seq: number | null;
  slot_id: string;
  status: string;
};

function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const statusLabels: Record<string, string> = {
  attended: "เข้าเรียนแล้ว",
  booked: "จองแล้ว",
  cancelled: "ยกเลิก",
  no_show: "ไม่มาเรียน",
};

const header = [
  "วันที่", "เริ่ม", "เลิก", "รอบเรียน", "ผู้สอน", "สถานที่", "ลำดับ", "ที่นั่ง", "สถานะ",
  "ชื่อ-นามสกุล", "ชื่อเล่น", "รหัสพนักงาน", "โทร", "อีเมล", "LINE ID", "เวลาจอง", "หมายเหตุ",
].join(",");

/** CSV roster of every lesson slot, ordered by date, time, then FCFS position. Admin only. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/admin/lessons", request.url));
  }

  const { data: role } = await supabase
    .from("user_roles")
    .select("club_id")
    .eq("user_id", user.id)
    .in("role_key", allowedRoles)
    .limit(1)
    .maybeSingle();

  if (!role) {
    return new NextResponse("ไม่มีสิทธิ์เข้าถึง", { status: 403 });
  }

  const { data, error } = await supabase
    .from("lesson_bookings")
    .select(
      "id, slot_id, status, queue_seq, booked_at, attendance_note, members(full_name, nickname, employee_code, phone, email, line_id), lesson_slots(title, lesson_date, start_time, end_time, capacity, coach_name, venue)",
    )
    .eq("club_id", role.club_id)
    .order("queue_seq", { ascending: true })
    .limit(5000);

  if (error) {
    return new NextResponse("ดึงข้อมูลไม่สำเร็จ", { status: 500 });
  }

  const rows = (data ?? []) as unknown as RosterRow[];
  const positionBySlot = new Map<string, number>();
  const lines: { key: string; line: string }[] = [];

  for (const row of rows) {
    const slot = first(row.lesson_slots);
    const member = first(row.members);
    if (!slot) continue;

    let position: number | "" = "";
    let seat = "";
    if (row.status !== "cancelled") {
      position = (positionBySlot.get(row.slot_id) ?? 0) + 1;
      positionBySlot.set(row.slot_id, position);
      seat = queueStatusLabel(position, slot.capacity);
    }

    lines.push({
      key: `${slot.lesson_date} ${slot.start_time} ${String(position || 9999).padStart(5, "0")}`,
      line: [
        slot.lesson_date,
        slot.start_time.slice(0, 5),
        slot.end_time.slice(0, 5),
        slot.title,
        slot.coach_name ?? "",
        slot.venue ?? "",
        position,
        seat,
        statusLabels[row.status] ?? row.status,
        member?.full_name ?? "",
        member?.nickname ?? "",
        member?.employee_code ?? "",
        member?.phone ?? "",
        member?.email ?? "",
        member?.line_id ?? "",
        new Date(row.booked_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
        row.attendance_note ?? "",
      ]
        .map(csvCell)
        .join(","),
    });
  }

  lines.sort((a, b) => a.key.localeCompare(b.key));
  const stamp = new Date().toISOString().slice(0, 10);
  const body = `﻿${[header, ...lines.map((item) => item.line)].join("\r\n")}`;

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="lesson-roster-${stamp}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
