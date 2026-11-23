import "server-only";

import { isUuid, safeLessonsReturnTo, withStatus } from "@/lib/lessons/admin";
import { rpcErrorCode } from "@/lib/lessons/errors";
import { redirectAfterAction as redirect } from "@/lib/navigation";
import { classifyDbError, failureStatus } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

// Shared by the server-action files of /admin/lessons (not itself a "use server" module).

/** Roles that may change lesson data (same as the lesson write policies in the database). */
export const lessonAdminRoles = ["platform_owner", "club_admin", "committee"];

export function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export function getNumberOrNull(formData: FormData, key: string) {
  const value = getString(formData, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

export function getStringList(formData: FormData, key: string) {
  return getString(formData, key)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** A uuid field (select of coaches, venues, courses…) or null. */
export function getId(formData: FormData, key: string) {
  const value = getString(formData, key);
  return isUuid(value) ? value : null;
}

/** The form was rendered against a database with the lessons v2 migration. */
export function isV2Form(formData: FormData) {
  return formData.get("schema") === "v2";
}

export type LessonsClient = Awaited<ReturnType<typeof createClient>>;

/** Signed-in lesson staff and their club, or a redirect (login / member portal). */
export async function requireLessonAdminClub(nextPath = "/admin/lessons") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("club_id, role_key")
    .eq("user_id", user.id)
    .in("role_key", lessonAdminRoles);

  const role = roles?.[0];
  if (error || !role) {
    redirect("/member?status=admin-required");
  }

  const roleKeys = (roles ?? []).filter((item) => item.club_id === role.club_id).map((item) => item.role_key as string);
  return { clubId: role.club_id as string, roleKeys, supabase, userId: user.id };
}

/** Back to the page the form came from (hidden "returnTo"), with a result status. */
export function redirectBack(formData: FormData, status: string, fallback = "/admin/lessons"): never {
  redirect(withStatus(safeLessonsReturnTo(formData.get("returnTo"), fallback), status));
}

/**
 * Status key for a failed lesson RPC: a known `raise exception 'CODE'` becomes "rpc:CODE" (the page
 * shows the Thai text from lib/lessons/errors.ts), schema / permission problems use the shared keys.
 */
export function rpcFailureStatus(error: { code?: string | null; message?: string | null } | null, base: string) {
  if (classifyDbError(error) !== "unknown") return failureStatus(base, error);
  const code = rpcErrorCode(error?.message);
  return code ? `rpc:${code}` : base;
}
