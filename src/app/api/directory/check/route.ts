import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Live sign-up check: does this employee code exist in the association member directory
 * and is it still an active membership? Returns only what the applicant needs to confirm
 * they typed the right code (masked name, type, status). Requires a signed-in user.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const code = new URL(request.url).searchParams.get("code")?.trim().replace(/\s+/g, "").toUpperCase() ?? "";
  if (code.length < 3 || code.length > 20) {
    return NextResponse.json({ found: false, reason: "invalid" });
  }

  const admin = createAdminClient();
  const { data: club } = await admin
    .from("clubs")
    .select("id")
    .eq("status", "active")
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!club) {
    return NextResponse.json({ found: false, reason: "no-club" });
  }

  const [{ data: row }, { data: lastImport }] = await Promise.all([
    admin
      .from("employee_directory")
      .select("title_prefix, first_name, last_name, full_name, member_type, membership_status, work_line, bureau")
      .eq("club_id", club.id)
      .eq("employee_code", code)
      .is("archived_at", null)
      .maybeSingle(),
    admin
      .from("directory_imports")
      .select("imported_at")
      .eq("club_id", club.id)
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!row) {
    return NextResponse.json({ found: false, reason: "not-found", updatedAt: lastImport?.imported_at ?? null });
  }

  const firstName = row.first_name ?? row.full_name.split(/\s+/).filter((part: string) => !/^(นาย|นาง|นางสาว|ดร\.?)$/.test(part))[0] ?? "";
  const lastName = row.last_name ?? row.full_name.split(/\s+/).slice(-1)[0] ?? "";
  const maskedLast = lastName ? `${lastName.slice(0, 1)}${"•".repeat(Math.min(Math.max(lastName.length - 1, 2), 6))}` : "";

  return NextResponse.json({
    found: true,
    maskedName: [row.title_prefix, firstName, maskedLast].filter(Boolean).join(" "),
    memberType: row.member_type ?? null,
    membershipStatus: row.membership_status ?? "active",
    unit: row.work_line ?? row.bureau ?? null,
    updatedAt: lastImport?.imported_at ?? null,
  });
}
