"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { RECOVERY_COOKIE, RESET_PASSWORD_PATH, publicOrigin } from "@/lib/auth/recovery";
import { hasSupabasePublicConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/validation";

const MIN_PASSWORD = 8;

/** Sends a reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!email.ok || !email.value) {
    redirect("/forgot-password?status=email-invalid");
  }
  if (!hasSupabasePublicConfig()) {
    redirect("/forgot-password?status=missing-config");
  }

  const headerList = await headers();
  const origin = publicOrigin(headerList.get("x-forwarded-host") ?? headerList.get("host"), headerList.get("x-forwarded-proto"));
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.value, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(RESET_PASSWORD_PATH)}`,
  });

  if (error) {
    console.error("[auth] reset request failed:", error.status, error.code, error.message);
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      redirect("/forgot-password?status=rate-limited");
    }
  }

  redirect("/forgot-password?status=sent");
}

function back(status: string): never {
  redirect(`${RESET_PASSWORD_PATH}?status=${status}`);
}

/**
 * Changes the signed-in user's password. Without a just-verified reset link the current password
 * is checked first; other sessions are signed out afterwards.
 */
export async function changePassword(formData: FormData) {
  const user = await getSessionUser();

  if (!user?.email) {
    redirect(`/login?next=${encodeURIComponent(RESET_PASSWORD_PATH)}`);
  }

  const cookieStore = await cookies();
  const viaResetLink = cookieStore.get(RECOVERY_COOKIE)?.value === user.id;
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < MIN_PASSWORD) back("weak-password");
  if (password !== confirmPassword) back("password-mismatch");

  const supabase = await createClient();

  if (!viaResetLink) {
    if (!currentPassword) back("current-password-required");
    if (currentPassword === password) back("same-password");
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (error) back("current-password-wrong");
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    console.error("[auth] password change failed:", error.status, error.code, error.message);
    if (error.code === "same_password") back("same-password");
    if (error.code === "weak_password") back("weak-password");
    if (error.code === "reauthentication_needed") back("reauth-needed");
    back("password-change-failed");
  }

  cookieStore.delete(RECOVERY_COOKIE);
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError) {
    console.error("[auth] sign out other sessions failed:", signOutError.message);
  }

  back("password-changed");
}
