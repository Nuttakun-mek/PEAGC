import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

const adminRoles = [
  "platform_owner",
  "club_admin",
  "committee",
  "finance_officer",
  "tournament_director",
  "scoring_officer",
];

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/auth/complete", requestUrl.origin));
  }

  const [{ data: profile }, { data: member }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, phone")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("members")
      .select("status")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle(),
    supabase.from("user_roles").select("role_key").eq("user_id", user.id),
  ]);
  const hasAdminRole = Boolean(
    roles?.some((item) => adminRoles.includes(item.role_key)),
  );

  if (hasAdminRole && !member) {
    return NextResponse.redirect(new URL("/admin", requestUrl.origin));
  }

  if (!profile?.display_name || !profile?.phone || !member) {
    return NextResponse.redirect(new URL("/profile", requestUrl.origin));
  }

  if (member.status === "pending_verification") {
    return NextResponse.redirect(new URL("/member?status=pending-review", requestUrl.origin));
  }

  if (member.status === "active") {
    return NextResponse.redirect(new URL("/member", requestUrl.origin));
  }

  return NextResponse.redirect(new URL("/member", requestUrl.origin));
}
