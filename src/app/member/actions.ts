"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function registerForEvent(formData: FormData) {
  const eventId = getString(formData, "eventId");

  if (!eventId) {
    redirect("/member?status=registration-failed");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/member");
  }

  const { data: member } = await supabase
    .from("members")
    .select("id, club_id, status")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!member || member.status !== "active") {
    redirect("/member?status=member-not-approved");
  }

  const { data: event } = await supabase
    .from("events")
    .select("id, club_id, status")
    .eq("id", eventId)
    .eq("club_id", member.club_id)
    .is("archived_at", null)
    .maybeSingle();

  if (!event || event.status !== "open") {
    redirect("/member?status=registration-closed");
  }

  const { data: existing } = await supabase
    .from("event_registrations")
    .select("id")
    .eq("event_id", event.id)
    .eq("member_id", member.id)
    .not("status", "in", "(cancelled,no_show)")
    .maybeSingle();

  if (existing) {
    redirect("/member?status=already-registered");
  }

  const { error } = await supabase.from("event_registrations").insert({
    club_id: member.club_id,
    created_by: user.id,
    event_id: event.id,
    member_id: member.id,
    registration_type: "single",
    status: "pending_payment",
    updated_by: user.id,
  });

  if (error) {
    if (error.code === "23505") {
      redirect("/member?status=already-registered");
    }

    redirect("/member?status=registration-failed");
  }

  redirect("/member?status=registered");
}
