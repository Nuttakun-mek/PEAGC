import "server-only";

import { redirect } from "next/navigation";

import { type ModuleKey, type ModuleState, defaultModuleState, resolveModules } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Module switches for a club. Falls back to launch defaults if the table is unreadable. */
export async function getClubModules(supabase: Client, clubId: string | null | undefined): Promise<ModuleState> {
  if (!clubId) return { ...defaultModuleState };
  const { data, error } = await supabase.from("club_modules").select("module_key, enabled").eq("club_id", clubId);
  if (error) return { ...defaultModuleState };
  return resolveModules(data);
}

/** Server-action guard for member actions: bounce back when the module is closed. */
export async function requireModuleOpen(supabase: Client, clubId: string, key: ModuleKey) {
  const modules = await getClubModules(supabase, clubId);
  if (!modules[key]) {
    redirect("/member?status=module-disabled");
  }
}
