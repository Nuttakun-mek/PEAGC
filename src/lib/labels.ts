import { UNSET } from "@/lib/display";

/** Thai display labels for stored enum values. Keep every admin screen on these maps. */

export const eventStatusLabels: Record<string, string> = {
  archived: "เก็บถาวร",
  cancelled: "ยกเลิก",
  closed: "ปิดรับสมัคร",
  completed: "เสร็จสิ้น",
  draft: "ฉบับร่าง",
  open: "เปิดรับสมัคร",
};

export const eventStatusOptions = ["draft", "open", "closed", "completed", "cancelled", "archived"] as const;

export const eventTypeLabels: Record<string, string> = {
  charity: "การกุศล",
  golf_round: "ออกรอบ",
  tournament: "แข่งขัน",
  training: "ฝึกอบรมกอล์ฟ",
};

export const announcementStatusLabels: Record<string, string> = {
  archived: "เก็บแล้ว",
  draft: "ฉบับร่าง",
  published: "เผยแพร่แล้ว",
};

/** Keys of members.employee_match_detail.checks. */
export const employeeMatchCheckLabels: Record<string, string> = {
  activeEmployee: "สถานะพนักงาน",
  activeMembership: "สถานะสมาชิกสมาคม",
  affiliation: "สังกัด",
  department: "หน่วยงาน",
  email: "อีเมล",
  fullName: "ชื่อ-นามสกุล",
};

/** Values of members.employee_match_detail.reason. */
export const employeeMatchReasonLabels: Record<string, string> = {
  employee_code_not_found: "ไม่พบรหัสพนักงานในฐานสมาชิกสมาคม",
  left_directory: "ไม่อยู่ในฐานสมาชิกสมาคมเดือนล่าสุด",
};

export function labelFor(map: Record<string, string>, value: string | null | undefined, fallback = UNSET) {
  if (!value) return fallback;
  return map[value] ?? value;
}

export const roleLabels: Record<string, string> = {
  auditor: "ผู้ตรวจสอบ",
  club_admin: "ผู้ดูแลชมรม",
  committee: "กรรมการ",
  finance_officer: "เจ้าหน้าที่การเงิน",
  member: "สมาชิก",
  platform_owner: "เจ้าของระบบ",
  scoring_officer: "เจ้าหน้าที่บันทึกคะแนน",
  tournament_director: "ผู้อำนวยการแข่งขัน",
};
