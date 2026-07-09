"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function getNumberOrNull(formData: FormData, key: string) {
  const value = getString(formData, key);

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export async function savePersonalProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  const displayName = getString(formData, "displayName");
  const fullName = getString(formData, "fullName");
  const nickname = getString(formData, "nickname");
  const phone = getString(formData, "phone");
  const lineId = getString(formData, "lineId");
  const organization = getString(formData, "organization");
  const handicap = getNumberOrNull(formData, "handicap");
  const skillLevel = getString(formData, "skillLevel");

  if (!displayName || !fullName || !phone) {
    redirect("/profile?status=missing-required");
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    display_name: displayName,
    id: user.id,
    line_id: lineId || null,
    phone,
    updated_at: new Date().toISOString(),
  });

  if (profileError) {
    redirect("/profile?status=profile-failed");
  }

  const { data: club, error: clubError } = await supabase
    .from("clubs")
    .select("id")
    .eq("status", "active")
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (clubError || !club) {
    redirect("/profile?status=no-club");
  }

  const { error: memberError } = await supabase.from("members").upsert(
    {
      club_id: club.id,
      email: user.email,
      full_name: fullName,
      handicap,
      line_id: lineId || null,
      nickname: nickname || null,
      organization: organization || null,
      phone,
      skill_level: skillLevel || null,
      status: "active",
      updated_by: user.id,
      user_id: user.id,
    },
    { onConflict: "club_id,user_id" },
  );

  if (memberError) {
    redirect("/profile?status=member-failed");
  }

  redirect("/member?status=profile-saved");
}
