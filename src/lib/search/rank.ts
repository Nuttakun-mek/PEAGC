// Admin search (command palette): query cleaning and result ranking. Pure, no I/O.

/** Trimmed, whitespace-collapsed, lower-case query. */
export function normalizeQuery(value: string | null | undefined) {
  return (value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Text safe inside a PostgREST `or=(…ilike.*q*…)` filter: drops the characters that would end
 * or reshape the filter (comma, parentheses, quotes, backslash, wildcards) and caps the length.
 */
export function sanitizeForFilter(value: string) {
  return normalizeQuery(value)
    .replace(/[,()"'\\%*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** Digits of a phone-like query ("089-100-0004" → "0891000004"); empty when under 3 digits. */
export function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 3 ? digits : "";
}

export type MemberSearchRow = {
  employee_code?: string | null;
  full_name: string;
  id: string;
  member_code?: string | null;
  nickname?: string | null;
  phone?: string | null;
  status?: string | null;
};

function lower(value: string | null | undefined) {
  return (value ?? "").normalize("NFC").toLowerCase().trim();
}

/** Score for one text field: exact 100, prefix 70, word prefix 55, contains 35, else 0. */
export function textScore(field: string | null | undefined, query: string) {
  const text = lower(field);
  if (!text || !query) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 70;
  if (text.split(/[\s\-/.]+/).some((word) => word.startsWith(query))) return 55;
  if (text.includes(query)) return 35;
  return 0;
}

/**
 * Relevance of a member for the query. Codes and phone numbers are identifiers, so an exact code
 * beats a name that merely contains the text; names beat nicknames at the same match level.
 */
export function memberScore(row: MemberSearchRow, rawQuery: string) {
  const query = normalizeQuery(rawQuery);
  if (!query) return 0;
  const compactQuery = query.replace(/\s+/g, "");
  const codeScore = Math.max(
    textScore(row.member_code?.replace(/\s+/g, ""), compactQuery),
    textScore(row.employee_code?.replace(/\s+/g, ""), compactQuery),
  );
  const digits = phoneDigits(query);
  const phone = (row.phone ?? "").replace(/\D/g, "");
  const phoneScore = digits && phone ? (phone === digits ? 98 : phone.startsWith(digits) ? 65 : phone.includes(digits) ? 30 : 0) : 0;
  const nameScore = textScore(row.full_name, query);
  const nickScore = textScore(row.nickname, query) * 0.9;
  const best = Math.max(codeScore ? codeScore + 5 : 0, phoneScore, nameScore, nickScore);
  // Archived/inactive people sink below active ones with the same match.
  const statusPenalty = row.status === "archived" ? 20 : row.status === "inactive" ? 5 : 0;
  return best ? best - statusPenalty : 0;
}

/** Members matching the query, best first, at most `limit`. Ties: Thai alphabetical by name. */
export function rankMembers<T extends MemberSearchRow>(rows: T[], query: string, limit = 8): T[] {
  return rows
    .map((row) => ({ row, score: memberScore(row, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.full_name.localeCompare(b.row.full_name, "th"))
    .slice(0, limit)
    .map((item) => item.row);
}

/** Generic ranking by named text fields (first field weighs most), e.g. events by name/venue. */
export function rankByFields<T>(rows: T[], query: string, fields: Array<(row: T) => string | null | undefined>, limit = 8, label: (row: T) => string = (row) => String(fields[0](row) ?? "")): T[] {
  const q = normalizeQuery(query);
  if (!q) return rows.slice(0, limit);
  return rows
    .map((row) => ({
      row,
      score: Math.max(...fields.map((field, index) => textScore(field(row), q) * (index === 0 ? 1 : 0.8))),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || label(a.row).localeCompare(label(b.row), "th"))
    .slice(0, limit)
    .map((item) => item.row);
}

export type PageSearchItem = { group?: string; href: string; keywords?: string; label: string };

/** Menu pages and quick actions matching the query (label first, then keywords). */
export function matchPages<T extends PageSearchItem>(items: T[], query: string, limit = 8): T[] {
  return rankByFields(items, query, [(item) => item.label, (item) => item.keywords ?? null, (item) => item.group ?? null], limit);
}
