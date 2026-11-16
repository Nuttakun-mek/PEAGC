import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type SessionUser = {
  email: string | null;
  id: string;
  metadata: Record<string, unknown>;
};

/**
 * The signed-in user for this request, verified from the session JWT.
 *
 * The project signs JWTs with asymmetric (ES256) keys, so `getClaims()` verifies locally
 * against the cached JWKS instead of a round trip to Supabase Auth on every render. `cache`
 * shares the result between the admin layout and the page within one request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    if (error) {
      console.error("[session] getClaims failed:", error.message);
    }
    return null;
  }

  const claims = data.claims;
  return {
    email: typeof claims.email === "string" && claims.email ? claims.email : null,
    id: claims.sub,
    metadata: (claims.user_metadata ?? {}) as Record<string, unknown>,
  };
});

/** All role rows of the signed-in user, shared within one request. */
export const getSessionRoles = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_roles").select("club_id, role_key").eq("user_id", userId);

  if (error) {
    console.error("[session] user_roles failed:", error.code, error.message);
  }

  return (data ?? []) as Array<{ club_id: string; role_key: string }>;
});

/**
 * Profile row and member name of the signed-in user, shared within one request. A person has one
 * name everywhere: the member's full name when there is a member record, otherwise the profile
 * display name (staff accounts without a member record).
 */
export const getSessionIdentity = cache(async (userId: string) => {
  const supabase = await createClient();
  const [profile, member] = await Promise.all([
    supabase.from("profiles").select("display_name, phone, line_id").eq("id", userId).maybeSingle(),
    supabase.from("members").select("full_name").eq("user_id", userId).is("archived_at", null).limit(1).maybeSingle(),
  ]);

  if (profile.error) {
    console.error("[session] profiles failed:", profile.error.code, profile.error.message);
  }
  if (member.error) {
    console.error("[session] members failed:", member.error.code, member.error.message);
  }

  return {
    memberName: (member.data?.full_name as string | undefined)?.trim() || null,
    profile: (profile.data ?? null) as { display_name: string | null; line_id: string | null; phone: string | null } | null,
  };
});

/** The single display name for a signed-in user (see getSessionIdentity). */
export function resolveDisplayName(
  identity: Awaited<ReturnType<typeof getSessionIdentity>>,
  user: SessionUser,
) {
  const metadataName = [user.metadata.display_name, user.metadata.full_name].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return identity.memberName || identity.profile?.display_name?.trim() || metadataName || user.email || "สมาชิก";
}
