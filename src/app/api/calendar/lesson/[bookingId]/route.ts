import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { buildIcs, icsResponse } from "@/lib/ics";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabasePublicConfig } from "@/lib/supabase/env";
import { logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

// "เพิ่มลงปฏิทิน" for one lesson booking. Only the member who owns the booking gets it: RLS lets
// staff and the slot's coach read other people's bookings, so ownership is checked explicitly.

type SlotRow = {
  coach_name: string | null;
  end_time: string;
  lesson_date: string;
  lesson_programs: { name: string | null } | { name: string | null }[] | null;
  start_time: string;
  status: string;
  title: string;
  venue: string | null;
};

type Row = {
  id: string;
  members: { user_id: string | null } | null;
  slot_id: string;
  status: string;
};

const slotColumns = "title, lesson_date, start_time, end_time, venue, coach_name, status, lesson_programs(name)";
/** Statuses worth a calendar entry (seat, waiting for a seat, or already taken place). */
const calendarStatuses = new Set(["booked", "waitlist", "offered", "attended"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  if (!hasSupabasePublicConfig()) return new NextResponse("ยังไม่ได้ตั้งค่าระบบ", { status: 503 });

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/member/lessons")}`, request.nextUrl.origin));
  }
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return new NextResponse("ไม่พบรายการ", { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lesson_bookings")
    .select("id, slot_id, status, members(user_id)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) logDbError("calendar.lesson", error);
  const row = data as unknown as Row | null;
  if (!row || row.members?.user_id !== user.id || !calendarStatuses.has(row.status)) {
    return new NextResponse("ไม่พบรายการ", { status: 404 });
  }

  // The member owns the booking; read the slot with the service role (members cannot always read
  // a slot that is no longer open for booking).
  const { data: slotData, error: slotError } = await createAdminClient()
    .from("lesson_slots")
    .select(slotColumns)
    .eq("id", row.slot_id)
    .maybeSingle();
  if (slotError) logDbError("calendar.lesson slot", slotError);
  const slot = slotData as unknown as SlotRow | null;
  if (!slot || slot.status === "cancelled") return new NextResponse("ไม่พบรายการ", { status: 404 });

  const program = Array.isArray(slot.lesson_programs) ? slot.lesson_programs[0] : slot.lesson_programs;
  const origin = request.nextUrl.origin;
  const details = [
    program?.name && program.name !== slot.title ? `คอร์ส ${program.name}` : null,
    slot.coach_name ? `ผู้สอน ${slot.coach_name}` : null,
    row.status === "waitlist" ? "อยู่ในคิวสำรอง ยังไม่ได้ที่นั่ง" : null,
    row.status === "offered" ? "มีที่ว่างรอยืนยัน กดยืนยันในหน้าเรียนกอล์ฟ" : null,
    `รายละเอียด ${origin}/member/lessons`,
  ].filter(Boolean);

  const body = buildIcs([
    {
      date: slot.lesson_date,
      description: details.join("\n"),
      endTime: slot.end_time,
      location: slot.venue,
      startTime: slot.start_time,
      title: `เรียนกอล์ฟ: ${slot.title}`,
      uid: `lesson-booking-${row.id}`,
      url: `${origin}/member/lessons`,
    },
  ]);
  return icsResponse(body, `lesson-${slot.lesson_date}.ics`);
}
