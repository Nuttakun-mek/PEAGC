import { type NextRequest, NextResponse } from "next/server";

import { getSessionRoles, getSessionUser } from "@/lib/auth/session";
import { allowedAreas, isAdminRole } from "@/lib/auth/roles";
import { formatThaiDateShort } from "@/lib/display";
import type { SearchGroup, SearchHit, SearchResponse } from "@/lib/palette";
import { eventStatusLabels, labelFor, memberStatusLabels } from "@/lib/labels";
import { normalizeQuery, phoneDigits, rankByFields, rankMembers, sanitizeForFilter } from "@/lib/search/rank";
import { isAuthBypassEnabled } from "@/lib/supabase/env";
import { logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin search for the command palette (Ctrl+K): members, events and lesson courses, at most 8
 * each, only in the groups the caller's roles may open. Staff only; RLS still applies.
 */

const LIMIT = 8;
const FETCH = 40;


type MemberRow = {
  employee_code: string | null;
  full_name: string;
  id: string;
  member_code: string | null;
  nickname: string | null;
  phone: string | null;
  status: string | null;
};
type EventRow = { event_date: string; id: string; name: string; status: string; venue: string | null };
type CourseRow = { coach_name: string | null; id: string; name: string; status: string };

const sampleMembers: MemberRow[] = [
  { employee_code: "497901", full_name: "สมชาย ใจดี", id: "sample-member-1", member_code: "PEAGC-0012", nickname: "ชาย", phone: "0891000004", status: "active" },
  { employee_code: "500120", full_name: "สุดา รักกอล์ฟ", id: "sample-member-2", member_code: "PEAGC-0013", nickname: "ดา", phone: "0812223333", status: "pending_verification" },
  { employee_code: null, full_name: "วิชัย ชายทอง", id: "sample-member-3", member_code: "PEAGC-0020", nickname: "ชัย", phone: "0899990000", status: "active" },
];
const sampleEvents: EventRow[] = [
  { event_date: "2026-12-20", id: "sample-event-1", name: "ออกรอบประจำเดือนธันวาคม", status: "open", venue: "สนามกอล์ฟธนาธร" },
  { event_date: "2027-01-17", id: "sample-event-2", name: "แข่งขันการกุศลปีใหม่", status: "draft", venue: "สนามกอล์ฟปัญญา" },
];
const sampleCourses: CourseRow[] = [
  { coach_name: "โปรเอก", id: "sample-course-1", name: "คอร์สพื้นฐานวงสวิง", status: "active" },
  { coach_name: "โปรนก", id: "sample-course-2", name: "คอร์สลูกสั้นและพัตต์", status: "active" },
];

function memberHit(row: MemberRow): SearchHit {
  const detail = [
    row.member_code ? `เลขสมาชิก ${row.member_code}` : null,
    row.employee_code ? `รหัสพนักงาน ${row.employee_code}` : null,
    row.nickname ? `ชื่อเล่น ${row.nickname}` : null,
    row.status && row.status !== "active" ? labelFor(memberStatusLabels, row.status) : null,
  ].filter(Boolean);
  return { detail: detail.join(" · ") || undefined, href: `/admin/members/${row.id}`, id: row.id, label: row.full_name };
}

function eventHit(row: EventRow): SearchHit {
  return {
    detail: [formatThaiDateShort(row.event_date), labelFor(eventStatusLabels, row.status), row.venue].filter(Boolean).join(" · "),
    href: `/admin/events/${row.id}`,
    id: row.id,
    label: row.name,
  };
}

function courseHit(row: CourseRow): SearchHit {
  return {
    detail: row.coach_name ? `ผู้สอน ${row.coach_name}` : undefined,
    href: `/admin/lessons?tab=courses#program-${row.id}`,
    id: row.id,
    label: row.name,
  };
}

function rankAll(query: string, scopes: { courses: boolean; events: boolean; members: boolean }, data: { courses: CourseRow[]; events: EventRow[]; members: MemberRow[] }) {
  const groups: SearchGroup[] = [];
  if (scopes.members) {
    groups.push({ items: rankMembers(data.members, query, LIMIT).map(memberHit), key: "members", label: "สมาชิก" });
  }
  if (scopes.events) {
    const events = rankByFields(data.events, query, [(row) => row.name, (row) => row.venue], LIMIT, (row) => row.name);
    groups.push({ items: events.map(eventHit), key: "events", label: "กิจกรรม" });
  }
  if (scopes.courses) {
    const courses = rankByFields(data.courses, query, [(row) => row.name, (row) => row.coach_name], LIMIT, (row) => row.name);
    groups.push({ items: courses.map(courseHit), key: "courses", label: "คอร์สเรียน" });
  }
  return groups.filter((group) => group.items.length > 0);
}

function json(body: SearchResponse | { error: string }, status = 200) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" }, status });
}

export async function GET(request: NextRequest) {
  const rawQuery = request.nextUrl.searchParams.get("q") ?? "";
  const query = normalizeQuery(rawQuery).slice(0, 60);

  if (isAuthBypassEnabled() && request.nextUrl.searchParams.get("bypass") === "admin") {
    if (query.length < 2) return json({ groups: [], query });
    const scopes = { courses: true, events: true, members: true };
    return json({ groups: rankAll(query, scopes, { courses: sampleCourses, events: sampleEvents, members: sampleMembers }), query });
  }

  const user = await getSessionUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  const roles = await getSessionRoles(user.id);
  const club = roles.find((role) => isAdminRole(role.role_key));
  if (!club) return json({ error: "forbidden" }, 403);
  const areas = allowedAreas(roles.filter((role) => role.club_id === club.club_id).map((role) => role.role_key));
  const scopes = { courses: areas.includes("lessons"), events: areas.includes("events"), members: areas.includes("members") };

  const term = sanitizeForFilter(rawQuery);
  if (term.length < 2) return json({ groups: [], query });
  // `term` has no , ( ) " * % : left (sanitizeForFilter), so it is safe unquoted in or=(…).
  const like = (column: string, value: string) => `${column}.ilike.*${value}*`;
  const digits = phoneDigits(rawQuery);
  const supabase = await createClient();

  const [members, events, courses] = await Promise.all([
    scopes.members
      ? supabase
          .from("members")
          .select("id, full_name, nickname, member_code, employee_code, phone, status")
          .eq("club_id", club.club_id)
          .is("archived_at", null)
          .or(
            [
              like("full_name", term),
              like("nickname", term),
              like("member_code", term.replace(/\s+/g, "")),
              like("employee_code", term.replace(/\s+/g, "")),
              ...(digits ? [like("phone", digits)] : []),
            ].join(","),
          )
          .limit(FETCH)
      : null,
    scopes.events
      ? supabase
          .from("events")
          .select("id, name, event_date, status, venue")
          .eq("club_id", club.club_id)
          .is("archived_at", null)
          .or([like("name", term), like("venue", term)].join(","))
          .order("event_date", { ascending: false })
          .limit(FETCH)
      : null,
    scopes.courses
      ? supabase
          .from("lesson_programs")
          .select("id, name, coach_name, status")
          .eq("club_id", club.club_id)
          .is("archived_at", null)
          .or([like("name", term), like("coach_name", term)].join(","))
          .limit(FETCH)
      : null,
  ]);

  if (members?.error) logDbError("api.admin.search members", members.error);
  if (events?.error) logDbError("api.admin.search events", events.error);
  if (courses?.error) logDbError("api.admin.search courses", courses.error);

  return json({
    groups: rankAll(query, scopes, {
      courses: (courses?.data ?? []) as CourseRow[],
      events: (events?.data ?? []) as EventRow[],
      members: (members?.data ?? []) as MemberRow[],
    }),
    query,
  });
}
