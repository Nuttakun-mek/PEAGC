/**
 * Classifies Supabase/PostgREST errors so actions can tell the admin *why* a save failed
 * instead of a generic "failed", and so pages can say a load failed instead of showing an
 * empty list. A schema that is behind the code (migration not applied) used to look exactly
 * like "no data".
 */

type DbError = { code?: string | null; details?: string | null; hint?: string | null; message?: string | null } | null | undefined;

export type DbErrorKind = "schema-outdated" | "duplicate" | "permission" | "constraint" | "unknown";

const SCHEMA_CODES = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "42883", // undefined_function
  "PGRST202", // function not found in schema cache
  "PGRST204", // column not found in schema cache
  "PGRST205", // table not found in schema cache
]);

export function classifyDbError(error: DbError): DbErrorKind {
  const code = error?.code ?? "";
  if (SCHEMA_CODES.has(code)) return "schema-outdated";
  if (code === "23505") return "duplicate";
  if (code === "42501" || /row-level security/i.test(error?.message ?? "")) return "permission";
  if (code === "23514" || code === "23502" || code === "23503") return "constraint";
  return "unknown";
}

/**
 * Banner key for a failed write: a shared key when the cause is known (every page maps those
 * through `dbFailureMessages`), otherwise the page's own `base` key.
 */
export function failureStatus(base: string, error: DbError) {
  switch (classifyDbError(error)) {
    case "schema-outdated":
      return "db-outdated";
    case "permission":
      return "permission-denied";
    case "duplicate":
      return "duplicate";
    default:
      return base;
  }
}

/** Server log line that Vercel keeps; never includes row data. */
export function logDbError(context: string, error: DbError) {
  if (!error) return;
  console.error(`[db] ${context}:`, error.code ?? "-", error.message ?? "", error.details ?? "", error.hint ?? "");
}

/** Shared banner text for the statuses produced by `failureStatus`. */
export const dbFailureMessages: Record<string, string> = {
  "db-outdated": "ฐานข้อมูลยังไม่ได้อัปเดตให้ตรงกับระบบ (migration ค้างอยู่) กรุณาแจ้งผู้ดูแลระบบ ข้อมูลยังไม่ถูกบันทึก",
  duplicate: "บันทึกไม่สำเร็จ เพราะข้อมูลซ้ำกับรายการที่มีอยู่แล้ว (เช่น รหัสหรือเลขที่ซ้ำ)",
  "permission-denied": "บัญชีนี้ไม่มีสิทธิ์บันทึกข้อมูลนี้",
};

/** Collects load errors from a set of query results for a page-level warning banner. */
export function collectLoadErrors(context: string, results: Array<{ error: DbError; label: string }>) {
  const failed = results.filter((result) => result.error);
  failed.forEach((result) => logDbError(`${context} load ${result.label}`, result.error));
  if (!failed.length) return null;
  const outdated = failed.some((result) => classifyDbError(result.error) === "schema-outdated");
  return {
    labels: failed.map((result) => result.label),
    outdated,
  };
}
