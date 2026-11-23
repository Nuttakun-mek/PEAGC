// Command palette entries (pure): menu pages and quick actions, filtered by role.

import { type AdminArea, canAccessArea } from "./auth/roles";
import type { AppIconName } from "./icons";
import type { NavGroup } from "./nav";

export type PaletteEntry = {
  group: string;
  href: string;
  icon: AppIconName;
  keywords?: string;
  kind: "action" | "page";
  label: string;
};

/** One result of /api/admin/search. */
export type SearchHit = { detail?: string; href: string; id: string; label: string };
export type SearchGroup = { items: SearchHit[]; key: "courses" | "events" | "members"; label: string };
export type SearchResponse = { groups: SearchGroup[]; query: string };

/** Search scopes of /api/admin/search the person may use. */
export type PaletteScopes = { courses: boolean; events: boolean; members: boolean };

/** Extra words people type for a page ("สลิป" finds ตรวจสลิป, "ประวัติ" finds บันทึกการแก้ไข). */
const pageKeywords: Record<string, string> = {
  "/admin": "หน้าแรก งานวันนี้ dashboard",
  "/admin/audit": "ประวัติ ใครแก้ log ย้อนหลัง",
  "/admin/content": "ข่าว ประกาศ รางวัล",
  "/admin/employees": "ฐานพนักงาน นำเข้า excel csv สมาคม",
  "/admin/events": "ออกรอบ แข่งขัน ก๊วน สกอร์ ทัวร์นาเมนต์",
  "/admin/lessons": "คอร์ส รอบเรียน จองเรียน ผู้สอน โค้ช",
  "/admin/members": "สมาชิก อนุมัติ รายชื่อ",
  "/admin/payments": "สลิป โอนเงิน ชำระเงิน อนุมัติ",
  "/admin/points": "แต้มสะสม คะแนนสะสม",
  "/admin/reports": "รายได้ การเงิน สถิติ csv",
  "/admin/settings": "โมดูล เปิด ปิด ตั้งค่า",
};

type QuickAction = { area: AdminArea; href: string; icon: AppIconName; keywords: string; label: string };

/** Common jobs one Enter away. `#create` opens the page's "+ เพิ่ม…" panel. */
export const quickActions: QuickAction[] = [
  { area: "payments", href: "/admin/payments?stage=awaiting_review", icon: "payments", keywords: "สลิป อนุมัติ โอนเงิน", label: "ตรวจสลิปที่รออยู่" },
  { area: "members", href: "/admin/members?filter=pending_verification", icon: "members", keywords: "อนุมัติ สมัครใหม่ ตรวจสอบ", label: "สมาชิกรออนุมัติ" },
  { area: "events", href: "/admin/events#create", icon: "add", keywords: "สร้าง ออกรอบ แข่งขัน", label: "เพิ่มกิจกรรม" },
  { area: "members", href: "/admin/members#create", icon: "add", keywords: "สร้าง สมัคร", label: "เพิ่มสมาชิก" },
  { area: "lessons", href: "/admin/lessons?tab=create", icon: "add", keywords: "สร้าง คอร์ส ตารางเรียน", label: "สร้างรอบเรียน" },
  { area: "directory", href: "/admin/employees#import", icon: "upload", keywords: "นำเข้า excel csv รายเดือน", label: "อัปโหลดฐานสมาชิกสมาคม" },
  { area: "content", href: "/admin/content#create", icon: "news", keywords: "ประกาศ", label: "เพิ่มข่าว" },
];

export const QUICK_ACTION_GROUP = "ทำต่อ";

/**
 * Pages come from the (already role-filtered) menu; quick actions are filtered by role here.
 * `roleKeys = null` (bypass preview) keeps every action.
 */
export function paletteEntriesFor(nav: NavGroup[], roleKeys: readonly string[] | null): PaletteEntry[] {
  const pages = nav.flatMap((group) =>
    group.items.map<PaletteEntry>((item) => ({
      group: group.label,
      href: item.href,
      icon: item.icon,
      keywords: pageKeywords[item.href],
      kind: "page",
      label: item.label,
    })),
  );
  const actions = quickActions
    .filter((action) => roleKeys === null || canAccessArea(roleKeys, action.area))
    .map<PaletteEntry>((action) => ({
      group: QUICK_ACTION_GROUP,
      href: action.href,
      icon: action.icon,
      keywords: action.keywords,
      kind: "action",
      label: action.label,
    }));
  return [...actions, ...pages];
}

export function paletteScopesFor(roleKeys: readonly string[] | null): PaletteScopes {
  if (roleKeys === null) return { courses: true, events: true, members: true };
  return {
    courses: canAccessArea(roleKeys, "lessons"),
    events: canAccessArea(roleKeys, "events"),
    members: canAccessArea(roleKeys, "members"),
  };
}

/** Adds `bypass=admin` to an admin href (before any #hash) while previewing in bypass mode. */
export function withBypass(href: string, bypass: boolean) {
  if (!bypass) return href;
  const [path, hash = ""] = href.split("#");
  const joined = `${path}${path.includes("?") ? "&" : "?"}bypass=admin`;
  return hash ? `${joined}#${hash}` : joined;
}
