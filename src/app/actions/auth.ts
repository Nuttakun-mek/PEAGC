"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function getSafeRedirectPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/profile";
  }

  return value;
}

export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const next = getSafeRedirectPath(formData.get("next"));

  if (!email || !email.includes("@")) {
    redirect(`/login?error=invalid-email&next=${encodeURIComponent(next)}`);
  }

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    redirect(`/login?error=send-failed&next=${encodeURIComponent(next)}`);
  }

  redirect(`/login?sent=1&next=${encodeURIComponent(next)}`);
}

export async function signInWithGoogle(formData: FormData) {
  const next = getSafeRedirectPath(formData.get("next"));
  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
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
