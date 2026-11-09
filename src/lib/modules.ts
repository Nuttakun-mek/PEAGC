// Member-facing modules an admin can open or close per club. Core features (member
// accounts, association directory, profile) are always on and are not listed here.
// Launch defaults must match SQL `club_module_enabled` (lessons on, the rest off).

export const moduleKeys = ["lessons", "events", "scores", "news"] as const;
export type ModuleKey = (typeof moduleKeys)[number];
export type ModuleState = Record<ModuleKey, boolean>;

export type ModuleInfo = {
  adminPaths: string[];
  defaultEnabled: boolean;
  description: string;
  key: ModuleKey;
  label: string;
};

export const moduleCatalog: ModuleInfo[] = [
  {
    adminPaths: ["/admin/lessons"],
    defaultEnabled: true,
    description: "สมาชิกเลือกคอร์ส จองรอบเรียน เข้าคิวสำรอง ย้ายรอบ และยกเลิกการจอง",
    key: "lessons",
    label: "คอร์สเรียนและจองเรียน",
  },
  {
    adminPaths: ["/admin/events", "/admin/payments"],
    defaultEnabled: false,
    description: "สมาชิกสมัครกิจกรรม/ออกรอบ แนบหลักฐานการชำระเงิน ดูก๊วนและเวลาออกตัว",
    key: "events",
    label: "กิจกรรมและการชำระเงิน",
  },
  {
    adminPaths: ["/admin/content"],
    defaultEnabled: false,
    description: "สมาชิกดูประวัติคะแนน สกอร์รายหลุม และรางวัลที่ได้รับ",
    key: "scores",
    label: "คะแนนและรางวัล",
  },
  {
    adminPaths: ["/admin/content"],
    defaultEnabled: false,
    description: "ข่าวและประกาศของชมรมบนหน้าสมาชิก",
    key: "news",
    label: "ข่าวประชาสัมพันธ์",
  },
];

export function isModuleKey(value: string): value is ModuleKey {
  return (moduleKeys as readonly string[]).includes(value);
}

export const defaultModuleState: ModuleState = Object.fromEntries(
  moduleCatalog.map((item) => [item.key, item.defaultEnabled]),
) as ModuleState;

/** Merge stored rows over the launch defaults; unknown keys are ignored. */
export function resolveModules(rows: { enabled: boolean; module_key: string }[] | null | undefined): ModuleState {
  const state = { ...defaultModuleState };
  for (const row of rows ?? []) {
    if (isModuleKey(row.module_key)) state[row.module_key] = row.enabled;
  }
  return state;
}

/** Module whose admin page lives at `path`, for nav badges. A page shared by several
 *  modules is reported closed only when all of them are closed. */
export function modulesForPath(path: string) {
  return moduleCatalog.filter((item) => item.adminPaths.includes(path)).map((item) => item.key);
}
