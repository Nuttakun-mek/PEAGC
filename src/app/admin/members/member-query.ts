import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { addDays } from "@/lib/membership/lifecycle";
import { type MemberListFilters, memberSearchExpression } from "@/lib/membership/member-list";

/** Columns of the admin member list. `legacy` = before the membership_points migration. */
export const memberListColumns = {
  current:
    "id, member_code, avatar_url, employee_code, employee_match_status, employee_match_detail, employee_directory_id, employee_directory(id, archived_at, employment_status, membership_status), department, affiliation, full_name, nickname, phone, line_id, email, organization, handicap, skill_level, status, joined_at, note, member_type_id, member_types(name), archived_at, updated_at, created_at, membership_expires_at, applicant_type, sponsor_member_id, status_reason, sponsor:members!members_sponsor_member_id_fkey(full_name, member_code)",
  legacy:
    "id, member_code, avatar_url, employee_code, employee_match_status, employee_match_detail, employee_directory_id, employee_directory(id, archived_at, employment_status, membership_status), department, affiliation, full_name, nickname, phone, line_id, email, organization, handicap, skill_level, status, joined_at, note, member_type_id, member_types(name), archived_at, updated_at, created_at",
} as const;

/** The PostgREST builder methods the list uses (each returns the same builder). */
type Builder<T> = {
  eq(column: string, value: string): T;
  gte(column: string, value: string): T;
  lte(column: string, value: string): T;
  in(column: string, values: string[]): T;
  is(column: string, value: null): T;
  not(column: string, operator: string, value: null): T;
  or(filters: string): T;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): T;
};

type Result = { count?: number | null; data: unknown[] | null; error: PostgrestError | null };

/** The members query as the list needs it; typed loosely so the select string is not parsed by TS. */
export interface MemberListQuery extends PromiseLike<Result> {
  eq(column: string, value: string): MemberListQuery;
  gte(column: string, value: string): MemberListQuery;
  lte(column: string, value: string): MemberListQuery;
  in(column: string, values: string[]): MemberListQuery;
  is(column: string, value: null): MemberListQuery;
  not(column: string, operator: string, value: null): MemberListQuery;
  or(filters: string): MemberListQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): MemberListQuery;
  range(from: number, to: number): PromiseLike<Result>;
}

export function membersQuery(
  supabase: SupabaseClient,
  clubId: string,
  columns: string,
  options?: { count?: "exact"; head?: boolean },
): MemberListQuery {
  return supabase.from("members").select(columns, options).eq("club_id", clubId) as unknown as MemberListQuery;
}

export type MemberQueryContext = {
  /** Before the migration: lifecycle values that need new columns fall back to the stored status. */
  legacy: boolean;
  noticeDays: number;
  today: string;
};

/** Lifecycle filter as PostgREST conditions (see deriveLifecycle for the same rules in TS). */
export function applyLifecycleFilter<T extends Builder<T>>(query: T, lifecycle: MemberListFilters["lifecycle"], ctx: MemberQueryContext): T {
  if (lifecycle === "archived") return query.not("archived_at", "is", null);
  let q = query.is("archived_at", null);
  const soon = addDays(ctx.today, ctx.noticeDays);
  switch (lifecycle) {
    case "all":
      return q;
    case "pending":
      return q.eq("status", "pending_verification");
    case "active":
      q = q.eq("status", "active");
      return ctx.legacy ? q : q.or(`membership_expires_at.is.null,membership_expires_at.gt.${soon}`);
    case "expiring":
      return ctx.legacy
        ? q.eq("status", "__none__")
        : q.eq("status", "active").gte("membership_expires_at", ctx.today).lte("membership_expires_at", soon);
    case "expired":
      return ctx.legacy ? q.eq("status", "expired") : q.or(`status.eq.expired,and(status.eq.active,membership_expires_at.lt.${ctx.today})`);
    default:
      return q.eq("status", lifecycle);
  }
}

export function applyMemberListFilters<T extends Builder<T>>(query: T, filters: MemberListFilters, ctx: MemberQueryContext): T {
  let q = applyLifecycleFilter(query, filters.lifecycle, ctx);
  if (filters.type !== "all") q = q.eq("member_type_id", filters.type);
  if (filters.reason !== "all") {
    q =
      filters.reason === "not_found"
        ? q.in("employee_match_detail->>reason", ["not_found", "employee_code_not_found"])
        : q.eq("employee_match_detail->>reason", filters.reason);
  }
  const search = memberSearchExpression(filters.q);
  if (search) q = q.or(search);

  switch (filters.sort) {
    case "name":
      q = q.order("full_name", { ascending: true });
      break;
    case "code":
      q = q.order("member_code", { ascending: true, nullsFirst: false });
      break;
    case "joined":
      q = q.order("joined_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
      break;
    case "status":
      q = q.order("status", { ascending: true }).order("full_name", { ascending: true });
      break;
    default:
      q = q.order("created_at", { ascending: false });
  }
  return q.order("id", { ascending: true });
}
