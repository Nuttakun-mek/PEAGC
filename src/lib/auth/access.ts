import { redirect } from "next/navigation";

import { getSessionRoles, getSessionUser } from "@/lib/auth/session";
import { hasSupabasePublicConfig, isAuthBypassEnabled } from "@/lib/supabase/env";
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

function getBypassContext(role: AppRole) {
  return {
    clubId: null,
    displayName: role === "admin" ? "ผู้ดูแลระบบทดลอง" : "สมาชิกทดลอง",
    email: null,
    isBypass: true,
    isProfileComplete: true,
    role,
    userId: null,
  } satisfies AccessContext;
}

async function getAuthenticatedContext(requiredRole: AppRole | undefined) {
  const user = await getSessionUser();

  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const [{ data: profile }, roles] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, phone, line_id")
      .eq("id", user.id)
      .maybeSingle(),
    getSessionRoles(user.id),
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

  const metadataName = [user.metadata.display_name, user.metadata.full_name].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  return {
    clubId: primaryRole?.club_id ?? null,
    displayName: profile?.display_name || metadataName || user.email || "สมาชิก",
    email: user.email,
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
    allowBypassRole &&
    searchParams?.bypass === allowBypassRole &&
    canUseBypass(allowBypassRole, requiredRole)
  ) {
    return getBypassContext(allowBypassRole);
  }

  if (!hasSupabasePublicConfig()) {
    if (allowBypassRole && canUseBypass(allowBypassRole, requiredRole)) {
      return getBypassContext(allowBypassRole);
    }

    redirect(`/login?next=${encodeURIComponent(nextPath)}&error=missing-config`);
  }

  const context = await getAuthenticatedContext(requiredRole);

  if (context) {
    return context;
  }

  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}
