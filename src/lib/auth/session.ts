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
