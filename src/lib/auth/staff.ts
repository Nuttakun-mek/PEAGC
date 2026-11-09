import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/** Roles allowed to run event day operations: participants, pairing, check-in. */
export const eventOperationRoles = ["platform_owner", "club_admin", "committee", "tournament_director"];

/** Look up the caller's club for any of `roles`. Returns null when not signed in or not staff. */
export async function getStaffClub(roles: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "anonymous" as const, supabase };
  }

  const { data: role } = await supabase
    .from("user_roles")
    .select("club_id")
    .eq("user_id", user.id)
    .in("role_key", roles)
    .limit(1)
    .maybeSingle();

  if (!role) {
    return { status: "forbidden" as const, supabase };
  }

  return { clubId: role.club_id as string, status: "ok" as const, supabase, userId: user.id };
}

/** Server-action guard: redirects to login / member portal when the caller lacks a role. */
export async function requireStaffClub(roles: string[], nextPath: string) {
  const result = await getStaffClub(roles);

  if (result.status === "anonymous") {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (result.status === "forbidden") {
    redirect("/member?status=admin-required");
  }

  return result;
}
