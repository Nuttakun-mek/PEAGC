import { redirect } from "next/navigation";

import { getSessionIdentity, getSessionRoles, getSessionUser, resolveDisplayName } from "@/lib/auth/session";
import { hasSupabasePublicConfig, isAuthBypassEnabled } from "@/lib/supabase/env";

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

  const [identity, roles] = await Promise.all([getSessionIdentity(user.id), getSessionRoles(user.id)]);
  const profile = identity.profile;

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
    displayName: resolveDisplayName(identity, user),
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
