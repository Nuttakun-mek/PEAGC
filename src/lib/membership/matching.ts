/**
 * Sign-up check against the association member directory (ฐานสมาชิกสมาคม).
 *
 * Auto-approve needs both: the employee code is an ACTIVE directory row, and the name matches.
 * Anything else stays "รอตรวจ" with a reason the admin queue shows in Thai.
 */

export const matchReasons = ["not_found", "name_mismatch", "left_directory", "inactive_in_directory", "external"] as const;

export type MatchReason = (typeof matchReasons)[number];

export const matchReasonLabels: Record<MatchReason, string> = {
  external: "บุคคลภายนอก (มีสมาชิกรับรอง)",
  inactive_in_directory: "พ้นสภาพในฐานสมาคม",
  left_directory: "หายจากฐานสมาคม",
  name_mismatch: "ชื่อไม่ตรงกับฐานสมาคม",
  not_found: "ไม่พบรหัสในฐานสมาคม",
};

export type DirectoryRow = {
  affiliation?: string | null;
  archived_at?: string | null;
  email?: string | null;
  employment_status?: string | null;
  first_name?: string | null;
  full_name: string;
  id: string;
  last_name?: string | null;
  membership_status?: string | null;
  title_prefix?: string | null;
};

export type DirectoryMatch = {
  /** True only when the club may activate the member without an admin. */
  canAutoApprove: boolean;
  checks: Record<string, boolean>;
  directoryId: string | null;
  reason: MatchReason | null;
  /** members.employee_match_status */
  status: "matched" | "mismatch" | "not_found";
};

// Longest first so "นางสาว" is not read as "นาง" + "สาว…".
const TITLES = [
  "ว่าที่ร้อยตรีหญิง",
  "ว่าที่ร้อยตรี",
  "ว่าที่ร.ต.หญิง",
  "ว่าที่ร.ต.",
  "นางสาว",
  "น.ส.",
  "นาย",
  "นาง",
  "ดร.",
  "ดร",
  "mrs.",
  "mrs",
  "miss",
  "mr.",
  "mr",
  "ms.",
  "ms",
  "dr.",
];

/**
 * Comparable form of a person's name: no title, no dots, no spaces, Thai "ํ + า" written as "ำ",
 * no zero-width characters, lower case. "นาย สมชาย  ใจดี" and "สมชาย ใจดี" compare equal.
 */
export function normalizePersonName(value: string | null | undefined) {
  let text = (value ?? "")
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/ํา/g, "ำ")
    .trim()
    .toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const title of TITLES) {
      if (text.startsWith(title)) {
        text = text.slice(title.length).trim();
        changed = true;
        break;
      }
    }
  }
  return text.replace(/[.\s]/g, "");
}

export function namesMatch(directory: DirectoryRow, fullName: string) {
  const typed = normalizePersonName(fullName);
  if (!typed) return false;
  const candidates = [directory.full_name, [directory.first_name, directory.last_name].filter(Boolean).join(" ")];
  return candidates.some((candidate) => normalizePersonName(candidate) === typed && typed.length > 0);
}

export function matchDirectory({
  directory,
  email,
  fullName,
}: {
  directory: DirectoryRow | null | undefined;
  email?: string | null;
  fullName: string;
}): DirectoryMatch {
  if (!directory) {
    return { canAutoApprove: false, checks: {}, directoryId: null, reason: "not_found", status: "not_found" };
  }

  const archived = Boolean(directory.archived_at);
  const membership = directory.membership_status ?? "active";
  const employment = directory.employment_status ?? "active";
  const checks = {
    activeEmployee: employment === "active",
    activeMembership: !archived && membership === "active",
    // Shown to the admin only: many members sign in with Google or a personal address.
    email: !directory.email || !email || directory.email.trim().toLowerCase() === email.trim().toLowerCase(),
    fullName: namesMatch(directory, fullName),
  };

  let reason: MatchReason | null = null;
  if (archived || membership === "inactive") reason = "left_directory";
  else if (membership !== "active" || employment !== "active") reason = "inactive_in_directory";
  else if (!checks.fullName) reason = "name_mismatch";

  return {
    canAutoApprove: reason === null,
    checks,
    directoryId: directory.id,
    reason,
    status: reason === null ? "matched" : "mismatch",
  };
}

/** Reason stored in members.employee_match_detail (older rows used "employee_code_not_found"). */
export function matchReasonOf(detail: { reason?: unknown } | null | undefined): MatchReason | null {
  const reason = typeof detail?.reason === "string" ? detail.reason : null;
  if (!reason) return null;
  if (reason === "employee_code_not_found") return "not_found";
  return (matchReasons as readonly string[]).includes(reason) ? (reason as MatchReason) : null;
}
