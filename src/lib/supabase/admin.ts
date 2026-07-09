import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig, getSupabaseSecretKey } from "./env";

export function createAdminClient() {
  const { url } = getSupabasePublicConfig();
  const secret = getSupabaseSecretKey();

  return createSupabaseClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
