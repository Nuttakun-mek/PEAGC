"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const eventAdminRoles = ["platform_owner", "club_admin", "committee"];

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

function redirectEvents(status: string, eventId?: string): never {
  const params = new URLSearchParams({ status });

  if (eventId) {
    params.set("event", eventId);
  }

  redirect(`/admin/events?${params.toString()}`);
}

async function requireEventAdminClub() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/events");
  }

  const { data: role, error } = await supabase
    .from("user_roles")
    .select("club_id, role_key")
    .eq("user_id", user.id)
    .in("role_key", eventAdminRoles)
    .limit(1)
    .maybeSingle();

  if (error || !role) {
    redirect("/member?status=admin-required");
  }

  return { clubId: role.club_id as string, supabase, userId: user.id };
}

function getEventPayload(formData: FormData, clubId: string, userId: string) {
  const name = getString(formData, "name");
  const eventDate = getString(formData, "eventDate");

  if (!name || !eventDate) {
    return null;
  }

  return {
    capacity: getNumberOrNull(formData, "capacity"),
    club_id: clubId,
    description: getString(formData, "description") || null,
    event_date: eventDate,
    event_type: getString(formData, "eventType") || "golf_round",
    guest_price: getNumberOrNull(formData, "guestPrice") ?? 0,
    includes: getString(formData, "includes") || null,
    member_price: getNumberOrNull(formData, "memberPrice") ?? 0,
    name,
    owner_user_id: userId,
    status: getString(formData, "status") || "draft",
    tee_off_time: getString(formData, "teeOffTime") || null,
    updated_by: userId,
    venue: getString(formData, "venue") || null,
  };
}

export async function createEvent(formData: FormData) {
  const { clubId, supabase, userId } = await requireEventAdminClub();
  const payload = getEventPayload(formData, clubId, userId);

  if (!payload) {
    redirectEvents("missing-required");
  }

  const { data: event, error } = await supabase
    .from("events")
    .insert({
      ...payload,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !event) {
    redirectEvents("create-failed");
  }

  await supabase.from("audit_logs").insert({
    action: "event.created",
    actor_user_id: userId,
    after_data: payload,
    club_id: clubId,
    entity_id: event.id,
    entity_type: "events",
    metadata: { source: "admin.events" },
  });

  redirectEvents("created", event.id);
}

export async function updateEvent(formData: FormData) {
  const eventId = getString(formData, "eventId");

  if (!eventId) {
    redirectEvents("missing-required");
  }

  const { clubId, supabase, userId } = await requireEventAdminClub();
  const payload = getEventPayload(formData, clubId, userId);

  if (!payload) {
    redirectEvents("missing-required", eventId);
  }

  const { data: before } = await supabase
    .from("events")
    .select("*")
    .eq("club_id", clubId)
    .eq("id", eventId)
    .maybeSingle();
  const { error } = await supabase
    .from("events")
    .update(payload)
    .eq("club_id", clubId)
    .eq("id", eventId);

  if (error) {
    redirectEvents("update-failed", eventId);
  }

  await supabase.from("audit_logs").insert({
    action: "event.updated",
    actor_user_id: userId,
    after_data: payload,
    before_data: before,
    club_id: clubId,
    entity_id: eventId,
    entity_type: "events",
    metadata: { source: "admin.events" },
  });

  redirectEvents("updated", eventId);
}
