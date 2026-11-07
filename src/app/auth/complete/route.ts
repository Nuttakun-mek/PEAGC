import { NextResponse, type NextRequest } from "next/server";

import { resolvePostLoginPath } from "@/lib/auth/post-login";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/auth/complete", requestUrl.origin));
  }

  const path = await resolvePostLoginPath(supabase, user.id);

  return NextResponse.redirect(new URL(path, requestUrl.origin));
}
