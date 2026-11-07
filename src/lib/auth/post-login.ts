import type { SupabaseClient } from "@supabase/supabase-js";

const adminRoles = [
  "platform_owner",
  "club_admin",
  "committee",
  "finance_officer",
  "tournament_director",
  "scoring_officer",
];

/**
 * Decide where a freshly signed-in user should land.
 * Shared by the password sign-in action and the /auth/complete route so the
 * action can redirect in a single hop (a redirect chain through a route handler
 * loses the cookies set by the action).
 */
export async function resolvePostLoginPath(
  supabase: SupabaseClient,
  userId: string,
) {
  const [{ data: profile }, { data: member }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, phone")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("members")
      .select("status")
      .eq("user_id", userId)
      .is("archived_at", null)
      .maybeSingle(),
    supabase.from("user_roles").select("role_key").eq("user_id", userId),
  ]);

  const hasAdminRole = Boolean(
    roles?.some((item) => adminRoles.includes(item.role_key)),
  );

  if (hasAdminRole) {
    return "/admin";
  }

  if (!profile?.display_name || !profile?.phone || !member) {
    return "/profile";
  }

  if (member.status === "pending_verification") {
    return "/member?status=pending-review";
  }

  return "/member";
}
