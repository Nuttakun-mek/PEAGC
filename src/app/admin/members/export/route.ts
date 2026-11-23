import type { PostgrestError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { applyMemberListFilters, memberListColumns, membersQuery } from "@/app/admin/members/member-query";
import { csvResponseInit } from "@/lib/csv";
import { bangkokToday } from "@/lib/membership/lifecycle";
import { type MemberCsvRow, membersCsv, parseMemberListParams } from "@/lib/membership/member-list";
import { loadMembershipSettings } from "@/lib/membership/settings";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = ["platform_owner", "club_admin", "committee"];

type Raw = Omit<MemberCsvRow, "member_types" | "sponsor"> & {
  member_types: { name: string } | { name: string }[] | null;
  sponsor?: { full_name: string; member_code: string | null } | { full_name: string; member_code: string | null }[] | null;
};

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** CSV of the member list with the same filters as the page (UTF-8 BOM for Excel). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: role } = await supabase
    .from("user_roles")
    .select("club_id")
    .eq("user_id", user.id)
    .in("role_key", allowedRoles)
    .limit(1)
    .maybeSingle();
  if (!role) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clubId = role.club_id as string;

  const url = new URL(request.url);
  const filters = parseMemberListParams(Object.fromEntries(url.searchParams.entries()));
  const today = bangkokToday();
  const { settings } = await loadMembershipSettings(supabase, clubId);

  const run = (legacy: boolean) =>
    fetchAllRows<Raw>((from, to) =>
      applyMemberListFilters(membersQuery(supabase, clubId, legacy ? memberListColumns.legacy : memberListColumns.current), filters, {
        legacy,
        noticeDays: settings.renewalNoticeDays,
        today,
      }).range(from, to) as PromiseLike<{ data: Raw[] | null; error: PostgrestError | null }>,
    );

  let result = await run(false);
  if (result.error && classifyDbError(result.error) === "schema-outdated") {
    result = await run(true);
  }
  if (result.error) {
    logDbError("admin.members export", result.error);
    return NextResponse.json({ error: "load-failed" }, { status: 500 });
  }

  const rows: MemberCsvRow[] = (result.data ?? []).map((row) => ({
    ...row,
    member_types: first(row.member_types),
    sponsor: first(row.sponsor),
  }));
  const csv = membersCsv(rows, { noticeDays: settings.renewalNoticeDays, today });
  return new NextResponse(csv, csvResponseInit(`members-${today}.csv`));
}
