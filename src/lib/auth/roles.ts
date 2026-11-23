// Staff roles and which admin areas each may open (pure, shared by the menu, the pages and tests).
//
// The admin menu (src/lib/nav.ts) shows only the areas a person's roles allow, and every admin
// page calls `requireAdminArea(area, access)` (src/lib/auth/admin-area.ts) so a typed URL is
// refused the same way. RLS stays the real guard for data; this keeps each role's screen to the
// work it does (audit, Nov 2026: เหรัญญิก เห็นแค่สลิปกับรายงาน, ทีมงานกิจกรรมเห็นแค่กิจกรรม).

/** Roles that may open /admin at all. `coach` and `member` are not admin roles (coaches use /coach). */
export const adminRoleKeys = [
  "platform_owner",
  "club_admin",
  "committee",
  "finance_officer",
  "tournament_director",
  "scoring_officer",
  "auditor",
] as const;

export type AdminRoleKey = (typeof adminRoleKeys)[number];

export const adminAreas = [
  "dashboard",
  "payments",
  "members",
  "directory",
  "points",
  "lessons",
  "events",
  "content",
  "reports",
  "audit",
  "settings",
] as const;

export type AdminArea = (typeof adminAreas)[number];

const managers: readonly AdminRoleKey[] = ["platform_owner", "club_admin"];
const allAreas: readonly AdminArea[] = adminAreas;

/** Areas per role. A person with several roles sees the union. */
export const roleAreas: Record<AdminRoleKey, readonly AdminArea[]> = {
  auditor: ["reports", "audit"],
  club_admin: allAreas,
  committee: adminAreas.filter((area) => area !== "settings"),
  finance_officer: ["dashboard", "payments", "reports"],
  platform_owner: allAreas,
  scoring_officer: ["dashboard", "events"],
  tournament_director: ["dashboard", "events"],
};

/** Landing page of each area (used for "go to the first page you may open"). */
export const areaHome: Record<AdminArea, string> = {
  audit: "/admin/audit",
  content: "/admin/content",
  dashboard: "/admin",
  directory: "/admin/employees",
  events: "/admin/events",
  lessons: "/admin/lessons",
  members: "/admin/members",
  payments: "/admin/payments",
  points: "/admin/points",
  reports: "/admin/reports",
  settings: "/admin/settings",
};

export function isAdminRole(roleKey: string): roleKey is AdminRoleKey {
  return (adminRoleKeys as readonly string[]).includes(roleKey);
}

export function hasAdminRole(roleKeys: readonly string[]) {
  return roleKeys.some(isAdminRole);
}

/** Roles that may open `area`, e.g. for a nav item's `roles`. */
export function rolesForArea(area: AdminArea): AdminRoleKey[] {
  return adminRoleKeys.filter((role) => roleAreas[role].includes(area));
}

export function allowedAreas(roleKeys: readonly string[]): AdminArea[] {
  const set = new Set<AdminArea>();
  for (const role of roleKeys) {
    if (isAdminRole(role)) roleAreas[role].forEach((area) => set.add(area));
  }
  return adminAreas.filter((area) => set.has(area));
}

export function canAccessArea(roleKeys: readonly string[], area: AdminArea) {
  return roleKeys.some((role) => isAdminRole(role) && roleAreas[role].includes(area));
}

/** The first admin page these roles may open (dashboard first), or null when none. */
export function firstAllowedHref(roleKeys: readonly string[]) {
  const [first] = allowedAreas(roleKeys);
  return first ? areaHome[first] : null;
}

/** Full-access roles (settings, staff management). */
export function isManager(roleKeys: readonly string[]) {
  return roleKeys.some((role) => (managers as readonly string[]).includes(role));
}

/**
 * Where a signed-in person lands after login: admin roles → their first admin page, a coach
 * without admin roles → /coach, everyone else → the member flow (null).
 */
export function staffHomeFor(roleKeys: readonly string[]) {
  if (hasAdminRole(roleKeys)) return firstAllowedHref(roleKeys) ?? "/admin";
  if (roleKeys.includes("coach")) return "/coach";
  return null;
}
