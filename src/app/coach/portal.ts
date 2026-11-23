import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { resolveAccess } from "@/lib/auth/access";
import { canAccessArea, hasAdminRole } from "@/lib/auth/roles";
import { getSessionIdentity, getSessionRoles } from "@/lib/auth/session";
import { lessonSampleData } from "@/lib/lessons/sample-data";
import type { LessonCoach } from "@/lib/lessons/types";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

// Who may open /coach and whose teaching schedule they see:
//   * a coach (role 'coach' + lesson_coaches.user_id) sees only their own rounds;
//   * lesson staff (platform_owner / club_admin / committee) may open it too and pick any coach;
//   * everyone else is sent back to their own home page.
// `?bypass=admin` (AUTH_BYPASS_ENABLED=true) renders the sample coach with sample data.

export const coachColumns = "id, club_id, full_name, nickname, phone, user_id, member_id, bio, status, archived_at";

export type CoachPortalProblem = "schema-outdated" | "not-linked" | "inactive" | "pick-coach";

export type CoachPortal = {
  clubId: string | null;
  /** the coach whose schedule is shown */
  coach: LessonCoach | null;
  /** staff only: every coach of the club, for the picker */
  coaches: LessonCoach[];
  displayName: string;
  /** the signed-in person also has a member record (link back to /member) */
  hasMemberRow: boolean;
  isBypass: boolean;
  /** lesson staff: may mark attendance any time and view every coach */
  isStaff: boolean;
  problem: CoachPortalProblem | null;
  supabase: SupabaseClient | null;
};

export function coachLabel(coach: Pick<LessonCoach, "full_name" | "nickname">) {
  return coach.nickname ? `${coach.full_name} (${coach.nickname})` : coach.full_name;
}

export async function resolveCoachPortal(params: { bypass?: string; coach?: string }, nextPath: string): Promise<CoachPortal> {
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath, searchParams: params });

  if (access.isBypass || !access.userId) {
    const sample = lessonSampleData();
    const coach = sample.coaches.find((item) => item.user_id) ?? sample.coaches[0];
    return {
      clubId: coach.club_id,
      coach,
      coaches: [],
      displayName: coachLabel(coach),
      hasMemberRow: false,
      isBypass: true,
      isStaff: false,
      problem: null,
      supabase: null,
    };
  }

  const [roles, identity] = await Promise.all([getSessionRoles(access.userId), getSessionIdentity(access.userId)]);
  const hasMemberRow = Boolean(identity.memberName);
  const roleKeys = roles.map((role) => role.role_key);
  const isCoach = roleKeys.includes("coach");
  const isStaff = canAccessArea(roleKeys, "lessons");
  if (!isCoach && !isStaff) {
    redirect(hasAdminRole(roleKeys) ? "/admin" : "/member");
  }

  const supabase = await createClient();
  const own = await supabase.from("lesson_coaches").select(coachColumns).eq("user_id", access.userId).is("archived_at", null).limit(1).maybeSingle();
  if (own.error) {
    const outdated = classifyDbError(own.error) === "schema-outdated";
    if (!outdated) logDbError("coach.portal own coach", own.error);
    return {
      clubId: null,
      coach: null,
      coaches: [],
      displayName: access.displayName,
      hasMemberRow,
      isBypass: false,
      isStaff,
      problem: outdated ? "schema-outdated" : "not-linked",
      supabase,
    };
  }

  const ownCoach = (own.data ?? null) as LessonCoach | null;
  const staffClub = roles.find((role) => canAccessArea([role.role_key], "lessons"))?.club_id ?? null;
  const clubId = ownCoach?.club_id ?? staffClub ?? roles.find((role) => role.role_key === "coach")?.club_id ?? null;

  let coaches: LessonCoach[] = [];
  if (isStaff && clubId) {
    const { data, error } = await supabase
      .from("lesson_coaches")
      .select(coachColumns)
      .eq("club_id", clubId)
      .is("archived_at", null)
      .order("full_name", { ascending: true });
    if (error) logDbError("coach.portal coaches", error);
    coaches = (data ?? []) as LessonCoach[];
  }

  const picked = isStaff && params.coach ? (coaches.find((item) => item.id === params.coach) ?? null) : null;
  const coach = picked ?? (ownCoach && (ownCoach.status === "active" || isStaff) ? ownCoach : null);
  const problem: CoachPortalProblem | null = coach
    ? null
    : ownCoach && ownCoach.status !== "active"
      ? "inactive"
      : isStaff
        ? "pick-coach"
        : "not-linked";

  return {
    clubId,
    coach,
    coaches,
    displayName: ownCoach ? coachLabel(ownCoach) : access.displayName,
    hasMemberRow,
    isBypass: false,
    isStaff,
    problem,
    supabase,
  };
}

/** Thai text for a portal that cannot show a schedule. */
export const coachProblemText: Record<CoachPortalProblem, { body: string; title: string }> = {
  inactive: { body: "ติดต่อผู้ดูแลชมรมถ้าจะกลับมาสอน", title: "บัญชีผู้สอนนี้พักการสอนอยู่" },
  "not-linked": { body: "บัญชีนี้ยังไม่ได้ผูกกับรายชื่อผู้สอน ติดต่อผู้ดูแลชมรมให้ผูกบัญชีในหน้าคลาสเรียน", title: "ยังไม่พบตารางสอนของคุณ" },
  "pick-coach": { body: "เลือกผู้สอนเพื่อดูตารางสอนและรายชื่อผู้เรียน", title: "เลือกผู้สอน" },
  "schema-outdated": { body: "ฐานข้อมูลยังไม่ได้อัปเดตให้ตรงกับระบบ (migration ค้างอยู่) กรุณาแจ้งผู้ดูแลระบบ", title: "ยังเปิดตารางสอนไม่ได้" },
};
