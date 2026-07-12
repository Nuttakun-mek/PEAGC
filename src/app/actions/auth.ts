"use server";

import { redirect } from "next/navigation";

import { hasSupabasePublicConfig, isGoogleAuthEnabled } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

function getSafeRedirectPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/auth/complete";
  }

  return value;
}

function getAppOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3555").replace(/\/$/, "");
}

export async function signUpWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!email.includes("@")) {
    redirect("/login?mode=signup&error=invalid-email");
  }

  if (password.length < 8) {
    redirect("/login?mode=signup&error=weak-password");
  }

  if (password !== confirmPassword) {
    redirect("/login?mode=signup&error=password-mismatch");
  }

  if (!hasSupabasePublicConfig()) {
    redirect("/login?mode=signup&error=missing-config");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getAppOrigin()}/auth/confirm?next=/profile`,
    },
  });

  if (error || !data.user) {
    const reason = error?.message.toLowerCase().includes("already")
      ? "email-in-use"
      : "signup-failed";
    redirect(`/login?mode=signup&error=${reason}`);
  }

  if (!data.session) {
    redirect("/login?mode=signin&registered=1");
  }

  redirect("/profile?status=account-created");
}

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = getSafeRedirectPath(formData.get("next"));

  if (!email.includes("@") || password.length < 8) {
    redirect(`/login?error=invalid-credentials&next=${encodeURIComponent(next)}`);
  }

  if (!hasSupabasePublicConfig()) {
    redirect(`/login?error=missing-config&next=${encodeURIComponent(next)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=invalid-credentials&next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}

export async function signInWithGoogle(formData: FormData) {
  const next = getSafeRedirectPath(formData.get("next"));

  if (!hasSupabasePublicConfig() || !isGoogleAuthEnabled()) {
    redirect(`/login?error=missing-config&next=${encodeURIComponent(next)}`);
  }

  const origin = getAppOrigin();
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
      redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=google-failed&next=${encodeURIComponent(next)}`);
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();

  await supabase.auth.signOut();
  redirect("/login?signedOut=1");
}
