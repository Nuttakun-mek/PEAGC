import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { addMinutes } from "@/lib/events/pairing";
import { buildIcs, icsResponse } from "@/lib/ics";
import { hasSupabasePublicConfig } from "@/lib/supabase/env";
import { logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

// "เพิ่มลงปฏิทิน" for one event registration. Only the member who owns the registration gets it
// (RLS lets staff read every registration, so ownership is checked explicitly).

type Row = {
  event_pairing_groups: { group_no: number; start_hole: number | null; tee_time: string | null } | null;
  events: { event_date: string; id: string; name: string; tee_off_time: string | null; venue: string | null } | null;
  id: string;
  members: { user_id: string | null } | null;
  status: string;
};

/** A round plus lunch takes about five hours. */
const ROUND_MINUTES = 5 * 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ registrationId: string }> }) {
  const { registrationId } = await params;
  if (!hasSupabasePublicConfig()) return new NextResponse("ยังไม่ได้ตั้งค่าระบบ", { status: 503 });

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/member#events")}`, request.nextUrl.origin));
  }
  if (!/^[0-9a-f-]{36}$/i.test(registrationId)) return new NextResponse("ไม่พบรายการ", { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_registrations")
    .select("id, status, members(user_id), events(id, name, event_date, tee_off_time, venue), event_pairing_groups(group_no, tee_time, start_hole)")
    .eq("id", registrationId)
    .maybeSingle();
  if (error) logDbError("calendar.event", error);
  const row = data as unknown as Row | null;
  if (!row || !row.events || row.members?.user_id !== user.id || ["cancelled", "no_show"].includes(row.status)) {
    return new NextResponse("ไม่พบรายการ", { status: 404 });
  }

  const event = row.events;
  const group = row.event_pairing_groups;
  const start = (group?.tee_time ?? event.tee_off_time)?.slice(0, 5) ?? null;
  const end = start ? addMinutes(start, ROUND_MINUTES) : null;
  const origin = request.nextUrl.origin;
  const details = [
    group ? `ก๊วน ${group.group_no}${group.start_hole ? ` เริ่มหลุม ${group.start_hole}` : ""}` : null,
    row.status === "waitlist" ? "อยู่ในคิวสำรอง" : null,
    `รายละเอียด ${origin}/events/${event.id}`,
  ].filter(Boolean);

  const body = buildIcs([
    {
      date: event.event_date,
      description: details.join("\n"),
      // Same calendar day: a late start ends at midnight instead of wrapping to the morning.
      endTime: start && end && end > start ? end : start ? "23:59" : null,
      location: event.venue,
      startTime: start,
      title: `ออกรอบ: ${event.name}`,
      uid: `event-registration-${row.id}`,
      url: `${origin}/events/${event.id}`,
    },
  ]);
  return icsResponse(body, `event-${event.event_date}.ics`);
}
