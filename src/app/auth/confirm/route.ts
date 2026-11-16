import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { RECOVERY_COOKIE, RECOVERY_COOKIE_MAX_AGE, RESET_PASSWORD_PATH } from "@/lib/auth/recovery";
import { createClient } from "@/lib/supabase/server";

function getSafeNext(url: URL) {
  const next = url.searchParams.get("next") ?? "/";

  if (!next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }

  return next;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const next = getSafeNext(requestUrl);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const code = requestUrl.searchParams.get("code");
  const isPasswordReset = type === "recovery" || next === RESET_PASSWORD_PATH;
  const supabase = await createClient();
  let userId: string | null = null;

  if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (!error) {
      userId = data.user?.id ?? null;
    }
  }

  if (!userId && code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      userId = data.user?.id ?? null;
    }
  }

  if (!userId) {
    return NextResponse.redirect(
      new URL(isPasswordReset ? "/login?error=reset-link-invalid" : "/login?error=confirm-failed", requestUrl.origin),
    );
  }

  if (isPasswordReset) {
    // A verified reset link lets the next screen set a new password without the old one.
    (await cookies()).set(RECOVERY_COOKIE, userId, {
      httpOnly: true,
      maxAge: RECOVERY_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: requestUrl.protocol === "https:",
    });
    return NextResponse.redirect(new URL(RESET_PASSWORD_PATH, requestUrl.origin));
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
