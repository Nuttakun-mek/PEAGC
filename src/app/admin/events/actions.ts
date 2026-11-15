"use server";

import { eventStatusOptions } from "@/lib/labels";
import { redirectAfterAction as redirect } from "@/lib/navigation";
import { failureStatus, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { anyCorruptedText } from "@/lib/text-integrity";

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

function getStringList(formData: FormData, key: string) {
  return getString(formData, key)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function redirectEvents(status: string, eventId?: string, filter?: string): never {
  const params = new URLSearchParams({ status });

  if (eventId) {
    params.set("event", eventId);
  }
  if (filter) {
    params.set("filter", filter);
  }

  redirect(`/admin/events?${params.toString()}${eventId ? `#event-${eventId}` : ""}`);
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

function normalizeStatus(value: string) {
  return (eventStatusOptions as readonly string[]).includes(value) ? value : "draft";
}

/** `archived_at` is what hides an event from every list; keep it in step with the status. */
function archiveFields(status: string, previousArchivedAt: string | null | undefined) {
  if (status === "archived") {
    return { archived_at: previousArchivedAt ?? new Date().toISOString() };
  }
  return { archived_at: null };
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
    status: normalizeStatus(getString(formData, "status")),
    target_bureaus: getStringList(formData, "targetBureaus"),
    target_departments: getStringList(formData, "targetDepartments"),
    target_divisions: getStringList(formData, "targetDivisions"),
    target_sections: getStringList(formData, "targetSections"),
    target_work_lines: getStringList(formData, "targetWorkLines"),
    tee_off_time: getString(formData, "teeOffTime") || null,
    updated_by: userId,
    venue: getString(formData, "venue") || null,
  };
}

function hasCorruptedEventText(payload: NonNullable<ReturnType<typeof getEventPayload>>) {
  return anyCorruptedText([payload.name, payload.venue, payload.description, payload.includes]);
}

export async function createEvent(formData: FormData) {
  const { clubId, supabase, userId } = await requireEventAdminClub();
  const payload = getEventPayload(formData, clubId, userId);

  if (!payload) {
    redirectEvents("missing-required");
  }
  if (hasCorruptedEventText(payload)) {
    redirectEvents("text-corrupted");
  }

  const { data: event, error } = await supabase
    .from("events")
    .insert({
      ...payload,
      ...archiveFields(payload.status, null),
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !event) {
    logDbError("events.create", error);
    redirectEvents(failureStatus("create-failed", error));
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
  if (hasCorruptedEventText(payload)) {
    redirectEvents("text-corrupted", eventId);
  }

  const { data: before } = await supabase
    .from("events")
    .select("*")
    .eq("club_id", clubId)
    .eq("id", eventId)
    .maybeSingle();

  if (!before) {
    redirectEvents("update-not-found", eventId);
  }

  // Read the row back: an update that matches nothing (or is filtered out by RLS) returns no
  // error, so "saved" used to be reported for changes that never reached the database.
  const { data: saved, error } = await supabase
    .from("events")
    .update({ ...payload, ...archiveFields(payload.status, before.archived_at) })
    .eq("club_id", clubId)
    .eq("id", eventId)
    .select("id, status")
    .maybeSingle();

  if (error) {
    logDbError("events.update", error);
    redirectEvents(failureStatus("update-failed", error), eventId);
  }
  if (!saved || saved.status !== payload.status) {
    console.error("[events.update] row not updated", eventId, saved?.status, payload.status);
    redirectEvents("update-not-saved", eventId);
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

  redirectEvents("updated", eventId, payload.status === "archived" ? "archived" : undefined);
}

/** One-click status change from the event row: close sign-ups, cancel, archive or restore. */
export async function setEventStatus(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const status = getString(formData, "status");

  if (!eventId || !(eventStatusOptions as readonly string[]).includes(status)) {
    redirectEvents("missing-required", eventId || undefined);
  }

  const { clubId, supabase, userId } = await requireEventAdminClub();
  const { data: before } = await supabase
    .from("events")
    .select("id, status, archived_at")
    .eq("club_id", clubId)
    .eq("id", eventId)
    .maybeSingle();

  if (!before) {
    redirectEvents("update-not-found", eventId);
  }

  const { data: saved, error } = await supabase
    .from("events")
    .update({ status, updated_by: userId, ...archiveFields(status, before.archived_at) })
    .eq("club_id", clubId)
    .eq("id", eventId)
    .select("id, status")
    .maybeSingle();

  if (error) {
    logDbError("events.set_status", error);
    redirectEvents(failureStatus("update-failed", error), eventId);
  }
  if (!saved || saved.status !== status) {
    console.error("[events.set_status] row not updated", eventId, saved?.status, status);
    redirectEvents("update-not-saved", eventId);
  }

  await supabase.from("audit_logs").insert({
    action: "event.status_changed",
    actor_user_id: userId,
    after_data: { status },
    before_data: { archived_at: before.archived_at, status: before.status },
    club_id: clubId,
    entity_id: eventId,
    entity_type: "events",
    metadata: { source: "admin.events" },
  });

  if (status === "archived") {
    redirectEvents("event-archived");
  }
  redirectEvents(before.status === "archived" ? "event-restored" : "event-status-changed", eventId);
}
