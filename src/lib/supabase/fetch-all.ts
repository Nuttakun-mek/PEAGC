import type { PostgrestError } from "@supabase/supabase-js";

/**
 * PostgREST caps every response at the project's "Max rows" setting (1,000 on Supabase by
 * default) whatever `.limit()` asks for, so one request can silently drop rows. Reads that must
 * see every row (report totals, CSV exports, rosters) page through with `.range()` instead.
 *
 * Keep `pageSize` at or below the project's Max rows: a short page is taken as the last one.
 */
export const PAGE_SIZE = 1000;

type Page<T> = { data: T[] | null; error: PostgrestError | null };

/**
 * `page(from, to)` must build a fresh query with a stable order (finish with a unique column such
 * as `id`) and return its `.range(from, to)`.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
  { maxRows = 50_000, pageSize = PAGE_SIZE }: { maxRows?: number; pageSize?: number } = {},
): Promise<Page<T>> {
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const from = rows.length;
    const { data, error } = await page(from, Math.min(from + pageSize, maxRows) - 1);
    if (error) return { data: null, error };
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return { data: rows, error: null };
}
