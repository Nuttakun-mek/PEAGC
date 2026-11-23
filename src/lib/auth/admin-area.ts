import "server-only";

import { redirect } from "next/navigation";

import { getSessionRoles, getSessionUser } from "@/lib/auth/session";
import { type AdminArea, canAccessArea, firstAllowedHref } from "@/lib/auth/roles";

/** Role keys of the signed-in user, limited to one club when given. Shared within a request. */
export async function getSessionRoleKeys(clubId?: string | null) {
  const user = await getSessionUser();
  if (!user) return [];
  const roles = await getSessionRoles(user.id);
  return roles.filter((role) => !clubId || role.club_id === clubId).map((role) => role.role_key);
}

/**
 * Page guard for one admin area. Call it right after `resolveAccess(...)` at the top of an admin
 * page: `await requireAdminArea("payments", access);`. Bypass previews pass. Staff whose roles do
 * not include the area land on /admin/no-access, which links to the pages they may open (or, for
 * the overview, on their first page).
 */
export async function requireAdminArea(area: AdminArea, access?: { clubId?: string | null; isBypass?: boolean } | null) {
  if (access?.isBypass) return;
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?next=/admin");
  }
  const roleKeys = await getSessionRoleKeys(access?.clubId);
  if (canAccessArea(roleKeys, area)) return;
  // /admin is everyone's "home" link: send roles without the overview (auditor) to their first page.
  const home = area === "dashboard" ? firstAllowedHref(roleKeys) : null;
  redirect(home ?? `/admin/no-access?area=${area}`);
}
