import "server-only";

import { classifyDbError, logDbError } from "@/lib/supabase/errors";

type DbError = { code?: string | null; message?: string | null } | null;
type DbResult<T> = { data: T | null; error: DbError };

/**
 * Select with columns added by a newer migration (`columns`), falling back to the old column list
 * (`fallbackColumns`) when the database is behind: the UAT database gets the migration after the
 * code. `outdated` tells the page to show the "ฐานข้อมูลยังไม่ได้อัปเดต" banner.
 */
export async function selectWithOptional<T>(
  // Builders typed from a dynamic column string carry no row type; the caller names it with T.
  run: (columns: string) => PromiseLike<{ data: unknown; error: DbError }>,
  columns: string,
  fallbackColumns: string,
  context: string,
): Promise<DbResult<T> & { outdated: boolean }> {
  const first = await run(columns);
  if (first.error && classifyDbError(first.error) === "schema-outdated") {
    logDbError(`${context} (retry without new columns)`, first.error);
    const second = await run(fallbackColumns);
    if (second.error) logDbError(context, second.error);
    return { data: (second.data ?? null) as T | null, error: second.error, outdated: true };
  }
  if (first.error) logDbError(context, first.error);
  return { data: (first.data ?? null) as T | null, error: first.error, outdated: false };
}
