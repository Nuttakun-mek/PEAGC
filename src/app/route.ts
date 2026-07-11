import { NextResponse, type NextRequest } from "next/server";

import { hasSupabasePublicConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;

  if (!hasSupabasePublicConfig()) {
    return NextResponse.redirect(new URL("/login?error=missing-config", origin));
  }

  const hasAuthCookie = request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("auth-token"));

  if (!hasAuthCookie) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return NextResponse.redirect(
    new URL(user ? "/auth/complete" : "/login", origin),
  );
}
