import type { SupabaseClient } from "@supabase/supabase-js";

import { staffHomeFor } from "@/lib/auth/roles";

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

  // Admin roles land on the first admin page they may open (auditor → reports); a coach without
  // an admin role goes to the coach portal.
  const staffHome = staffHomeFor((roles ?? []).map((item) => item.role_key as string));
  if (staffHome) {
    return staffHome;
  }

  if (!profile?.display_name || !profile?.phone || !member) {
    return "/profile";
  }

  if (member.status === "pending_verification") {
    return "/member?status=pending-review";
  }

  return "/member";
}
