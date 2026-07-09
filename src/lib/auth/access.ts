import { redirect } from "next/navigation";

import { isAuthBypassEnabled } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "admin" | "member";

export type AccessContext = {
  clubId: string | null;
  displayName: string;
  email: string | null;
  isBypass: boolean;
  isProfileComplete: boolean;
  role: AppRole;
  userId: string | null;
};

type ResolveAccessOptions = {
  allowBypassRole?: AppRole;
  nextPath: string;
  requiredRole?: AppRole;
  searchParams?: { bypass?: string };
};

function canUseBypass(role: AppRole | undefined, requiredRole: AppRole | undefined) {
  if (!role) {
    return false;
  }

  if (!requiredRole) {
    return true;
  }

  if (requiredRole === "member") {
    return role === "member" || role === "admin";
  }

  return role === "admin";
}

async function getAuthenticatedContext(requiredRole: AppRole | undefined) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, phone, line_id")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("club_id, role_key").eq("user_id", user.id),
  ]);

  const adminRoles = [
    "platform_owner",
    "club_admin",
    "committee",
    "finance_officer",
    "tournament_director",
    "scoring_officer",
  ];
  const hasAdminRole = Boolean(
    roles?.some((item) => adminRoles.includes(item.role_key)),
  );
  const role: AppRole = hasAdminRole ? "admin" : "member";
  const primaryRole =
    roles?.find((item) => adminRoles.includes(item.role_key)) ?? roles?.[0] ?? null;

  if (requiredRole === "admin" && !hasAdminRole) {
    redirect("/member?status=admin-required");
  }

  return {
    clubId: primaryRole?.club_id ?? null,
    displayName:
      profile?.display_name ||
      user.user_metadata?.display_name ||
      user.user_metadata?.full_name ||
      user.email ||
      "สมาชิก",
    email: user.email ?? null,
    isBypass: false,
    isProfileComplete: Boolean(profile?.display_name && profile?.phone),
    role,
    userId: user.id,
  } satisfies AccessContext;
}

export async function resolveAccess({
  allowBypassRole,
  nextPath,
  requiredRole,
  searchParams,
}: ResolveAccessOptions) {
  if (
    isAuthBypassEnabled() &&
    searchParams?.bypass === allowBypassRole &&
    canUseBypass(allowBypassRole, requiredRole)
  ) {
    const bypassRole = allowBypassRole as AppRole;

    return {
      clubId: null,
      displayName: bypassRole === "admin" ? "Admin ทดลอง" : "สมาชิกทดลอง",
      email: null,
      isBypass: true,
      isProfileComplete: true,
      role: bypassRole,
      userId: null,
    } satisfies AccessContext;
  }

  const context = await getAuthenticatedContext(requiredRole);

  if (context) {
    return context;
  }

  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}
