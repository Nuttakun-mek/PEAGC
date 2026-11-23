import { type AdminArea, type AdminRoleKey, adminAreas, areaHome, canAccessArea, hasAdminRole, rolesForArea } from "./auth/roles";
import type { AppIconName } from "@/lib/icons";

/** Counts shown next to menu items, loaded once in the admin layout. */
export type NavBadgeKey = "pendingMembers" | "pendingSlips";

export type NavItem = {
  /**
   * Admin area that decides which roles see the item (src/lib/auth/roles.ts) and which area the
   * page guards with requireAdminArea. Derived from `href` when omitted.
   */
  area?: AdminArea;
  badge?: NavBadgeKey;
  href: string;
  icon: AppIconName;
  label: string;
  /** Shorter label for the phone tab bar. */
  short?: string;
};

export type NavGroup = { items: NavItem[]; label: string };

/**
 * Admin menu, grouped by the job instead of by database table, with daily work first. The
 * sidebar, the phone drawer and the phone tab bar all read this list.
 */
export const adminNav: NavGroup[] = [
  {
    label: "งานวันนี้",
    items: [
      { area: "dashboard", href: "/admin", icon: "dashboard", label: "ภาพรวมวันนี้", short: "วันนี้" },
      { area: "payments", badge: "pendingSlips", href: "/admin/payments", icon: "payments", label: "ตรวจสลิป", short: "สลิป" },
    ],
  },
  {
    label: "สมาชิก",
    items: [
      { area: "members", badge: "pendingMembers", href: "/admin/members", icon: "members", label: "รายชื่อสมาชิก", short: "สมาชิก" },
      { area: "directory", href: "/admin/employees", icon: "directory", label: "ฐานสมาชิกสมาคม", short: "ฐานสมาคม" },
      { area: "points", href: "/admin/points", icon: "points", label: "แต้มสะสม" },
    ],
  },
  {
    label: "เรียนและกิจกรรม",
    items: [
      { area: "lessons", href: "/admin/lessons", icon: "lessons", label: "ตารางเรียน", short: "เรียน" },
      // The coach portal (outside /admin) as staff see it: pick a coach, roster, check-in.
      { area: "lessons", href: "/coach", icon: "coach", label: "ตารางสอนผู้สอน" },
      { area: "events", href: "/admin/events", icon: "events", label: "กิจกรรมออกรอบ", short: "กิจกรรม" },
    ],
  },
  {
    label: "สื่อสาร",
    items: [{ area: "content", href: "/admin/content", icon: "news", label: "ข่าวและรางวัล" }],
  },
  {
    label: "รายงานและตั้งค่า",
    items: [
      { area: "reports", href: "/admin/reports", icon: "reports", label: "รายงาน" },
      { area: "audit", href: "/admin/audit", icon: "audit", label: "บันทึกการแก้ไข", short: "บันทึก" },
      { area: "settings", href: "/admin/settings", icon: "settings", label: "เปิด/ปิดโมดูล" },
    ],
  },
];

export const adminNavItems: NavItem[] = adminNav.flatMap((group) => group.items);

/** Phone tab bar: the jobs done at the course (today, slips, members) plus the full menu. */
export const adminTabBar: NavItem[] = [
  { area: "dashboard", href: "/admin", icon: "dashboard", label: "วันนี้" },
  { area: "payments", badge: "pendingSlips", href: "/admin/payments", icon: "payments", label: "สลิป" },
  { area: "members", badge: "pendingMembers", href: "/admin/members", icon: "members", label: "สมาชิก" },
];

export function isNavActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Area of a menu item: its own `area`, else the area whose landing page is the longest prefix of `href`. */
export function navItemArea(item: Pick<NavItem, "area" | "href">): AdminArea | null {
  if (item.area) return item.area;
  const path = item.href.split(/[?#]/)[0];
  const match = adminAreas
    .filter((area) => isNavActive(path, areaHome[area]))
    .sort((a, b) => areaHome[b].length - areaHome[a].length)[0];
  return match ?? null;
}

/** Role keys that may see a menu item. Items outside every area are for club managers and committee. */
export function navItemRoles(item: Pick<NavItem, "area" | "href">): AdminRoleKey[] {
  const area = navItemArea(item);
  return area ? rolesForArea(area) : ["platform_owner", "club_admin", "committee"];
}

function canSee(item: NavItem, roleKeys: readonly string[]) {
  const area = navItemArea(item);
  return area ? canAccessArea(roleKeys, area) : navItemRoles(item).some((role) => roleKeys.includes(role));
}

/**
 * Menu for a set of role keys. `null` (no signed-in staff, e.g. the bypass preview) keeps the
 * full menu; empty groups are dropped.
 */
export function filterNavForRoles(nav: NavGroup[], roleKeys: readonly string[] | null): NavGroup[] {
  if (roleKeys === null || !hasAdminRole(roleKeys)) return nav;
  return nav
    .map((group) => ({ ...group, items: group.items.filter((item) => canSee(item, roleKeys)) }))
    .filter((group) => group.items.length > 0);
}

/**
 * Phone tab bar for a set of role keys: the daily jobs the person may open, topped up with their
 * other menu items (short labels) so every role gets three shortcuts where it has them.
 */
export function tabBarForRoles(roleKeys: readonly string[] | null, nav: NavGroup[] = adminNav, size = 3): NavItem[] {
  const allowed = filterNavForRoles(nav, roleKeys).flatMap((group) => group.items);
  const allowedHrefs = new Set(allowed.map((item) => item.href));
  const tabs = adminTabBar.filter((item) => allowedHrefs.has(item.href));
  for (const item of allowed) {
    if (tabs.length >= size) break;
    if (tabs.some((tab) => tab.href === item.href)) continue;
    tabs.push({ ...item, label: item.short ?? item.label });
  }
  return tabs.slice(0, size);
}
