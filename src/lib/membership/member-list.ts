import { toCsv } from "../csv";
import { type MemberLifecycle, deriveLifecycle, memberLifecycleLabels, memberLifecycles } from "./lifecycle";
import { type MatchReason, matchReasonLabels, matchReasonOf, matchReasons } from "./matching";

/** Admin member list: filters, sort and paging from the URL (also used by the CSV export). */

export const MEMBERS_PAGE_SIZE = 50;

export const memberSortOptions = ["newest", "name", "code", "joined", "status"] as const;
export type MemberSort = (typeof memberSortOptions)[number];

export const memberSortLabels: Record<MemberSort, string> = {
  code: "เลขสมาชิก",
  joined: "วันที่สมัคร",
  name: "ชื่อ ก–ฮ",
  newest: "สมัครล่าสุด",
  status: "สถานะ",
};

export type MemberListFilters = {
  lifecycle: MemberLifecycle | "all";
  page: number;
  q: string;
  reason: MatchReason | "all";
  sort: MemberSort;
  type: string;
};

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string) {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Older links used `filter=pending_verification` (stored status); map them onto the lifecycle filter. */
const legacyFilter: Record<string, MemberLifecycle> = { pending_verification: "pending" };

export function parseMemberListParams(params: Params): MemberListFilters {
  // Older links put the filter in `status` (which also carries save results such as "updated").
  const rawLifecycle = one(params, "filter") || one(params, "lifecycle") || one(params, "status");
  const mapped = legacyFilter[rawLifecycle] ?? rawLifecycle;
  const lifecycle = (memberLifecycles as readonly string[]).includes(mapped) ? (mapped as MemberLifecycle) : "all";
  const rawReason = one(params, "reason");
  const reason = (matchReasons as readonly string[]).includes(rawReason) ? (rawReason as MatchReason) : "all";
  const rawSort = one(params, "sort");
  const sort = (memberSortOptions as readonly string[]).includes(rawSort) ? (rawSort as MemberSort) : "newest";
  const page = Math.min(Math.max(Number.parseInt(one(params, "page") || "1", 10) || 1, 1), 10_000);
  return {
    lifecycle,
    page,
    q: one(params, "q").slice(0, 80),
    reason,
    sort,
    type: one(params, "type") || "all",
  };
}

/** Query string for the list with some filters changed (page resets unless given). */
export function memberListHref(filters: MemberListFilters, change: Partial<MemberListFilters> = {}, extra: Record<string, string> = {}) {
  const next = { ...filters, page: 1, ...change };
  const search = new URLSearchParams();
  if (next.q) search.set("q", next.q);
  if (next.lifecycle !== "all") search.set("filter", next.lifecycle);
  if (next.reason !== "all") search.set("reason", next.reason);
  if (next.type !== "all") search.set("type", next.type);
  if (next.sort !== "newest") search.set("sort", next.sort);
  if (next.page > 1) search.set("page", String(next.page));
  for (const [key, value] of Object.entries(extra)) search.set(key, value);
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * Search text safe inside a PostgREST `or=(…)` filter: drops the characters that would break the
 * filter syntax (commas, parentheses, quotes, wildcards, backslashes).
 */
export function sanitizeMemberSearch(q: string) {
  return q.replace(/[,()*%"'\\:]/g, " ").replace(/\s+/g, " ").trim();
}

/** PostgREST `or` expression for the search box (name, codes, unit, contact). */
export function memberSearchExpression(q: string) {
  const text = sanitizeMemberSearch(q);
  if (!text) return null;
  const like = `*${text}*`;
  const columns = ["full_name", "nickname", "member_code", "employee_code", "department", "affiliation", "organization", "email", "line_id"];
  const parts = columns.map((column) => `${column}.ilike.${like}`);
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 3) parts.push(`phone.ilike.*${digits}*`);
  return parts.join(",");
}

export type MemberCsvRow = {
  affiliation: string | null;
  archived_at?: string | null;
  department: string | null;
  email: string | null;
  employee_code: string | null;
  employee_match_detail?: { reason?: unknown } | null;
  employee_match_status?: string | null;
  full_name: string;
  joined_at: string | null;
  line_id: string | null;
  member_code: string | null;
  member_types?: { name: string } | null;
  membership_expires_at?: string | null;
  nickname: string | null;
  organization: string | null;
  phone: string | null;
  sponsor?: { full_name: string; member_code: string | null } | null;
  status: string;
};

/** Excel-friendly CSV (UTF-8 BOM) of the filtered list. Dates stay ISO for spreadsheets. */
export function membersCsv(rows: MemberCsvRow[], { noticeDays, today }: { noticeDays: number; today: string }) {
  const header = [
    "เลขสมาชิก",
    "ชื่อ-นามสกุล",
    "ชื่อเล่น",
    "รหัสพนักงาน",
    "สถานะ",
    "ผลเทียบฐานสมาคม",
    "ประเภทสมาชิก",
    "หน่วยงาน",
    "สังกัด",
    "หน่วยงาน/บริษัท",
    "เบอร์โทร",
    "อีเมล",
    "ไอดีไลน์",
    "สมาชิกรับรอง",
    "วันที่สมัคร",
    "ใช้ได้ถึง",
  ];
  const body = rows.map((row) => {
    const lifecycle = deriveLifecycle(row, today, noticeDays);
    const reason = matchReasonOf(row.employee_match_detail);
    const match = row.employee_match_status === "matched" ? "ตรงกับฐานสมาคม" : reason ? matchReasonLabels[reason] : "";
    return [
      row.member_code,
      row.full_name,
      row.nickname,
      row.employee_code,
      memberLifecycleLabels[lifecycle],
      match,
      row.member_types?.name ?? "",
      row.department,
      row.affiliation,
      row.organization,
      row.phone,
      row.email,
      row.line_id,
      row.sponsor ? [row.sponsor.member_code, row.sponsor.full_name].filter(Boolean).join(" ") : "",
      row.joined_at,
      row.membership_expires_at,
    ];
  });
  return toCsv(header, body);
}
