"use server";

import { redirect } from "next/navigation";

import { eventOperationRoles, requireStaffClub } from "@/lib/auth/staff";
import {
  type AssignStrategy,
  type PairingMode,
  autoAssignPlayers,
  eventErrorToStatus,
  isPairable,
  isValidTime,
  planPairingGroups,
  restoredStatus,
} from "@/lib/events/pairing";

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function getInt(formData: FormData, key: string, fallback: number) {
  const parsed = Number.parseInt(getString(formData, key), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function back(eventId: string, status: string, anchor = ""): never {
  redirect(`/admin/events/${eventId}?status=${status}${anchor ? `#${anchor}` : ""}`);
}

async function requireEventStaff(eventId: string) {
  if (!eventId) {
    redirect("/admin/events?status=missing-required");
  }

  const staff = await requireStaffClub(eventOperationRoles, `/admin/events/${eventId}`);
  const { data: event } = await staff.supabase
    .from("events")
    .select("id, club_id, name, member_price, status")
    .eq("club_id", staff.clubId)
    .eq("id", eventId)
    .maybeSingle();

  if (!event) {
    redirect("/admin/events?status=missing-event");
  }

  return { ...staff, event };
}

type Staff = Awaited<ReturnType<typeof requireEventStaff>>;

async function audit(
  staff: Staff,
  action: string,
  entityType: string,
  entityId: string | null,
  data: { after?: unknown; before?: unknown; metadata?: Record<string, unknown> },
) {
  await staff.supabase.from("audit_logs").insert({
    action,
    actor_user_id: staff.userId,
    after_data: data.after ?? null,
    before_data: data.before ?? null,
    club_id: staff.clubId,
    entity_id: entityId,
    entity_type: entityType,
    metadata: { event_id: staff.event.id, source: "admin.event_ops", ...data.metadata },
  });
}

// ---------- pairing groups ----------

export async function generatePairingGroups(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const staff = await requireEventStaff(eventId);
  const mode: PairingMode = getString(formData, "mode") === "shotgun" ? "shotgun" : "tee_times";
  const replace = getString(formData, "replace") === "on";

  const [{ data: existing }, { data: registrations }] = await Promise.all([
    staff.supabase.from("event_pairing_groups").select("id, group_no").eq("event_id", eventId),
    staff.supabase.from("event_registrations").select("status").eq("event_id", eventId),
  ]);

  const seatCount = (registrations ?? []).filter((row) => isPairable(row.status)).length;
  const playerCount = getInt(formData, "playerCount", 0) || seatCount;
  const plan = planPairingGroups({
    firstTeeTime: getString(formData, "firstTeeTime"),
    groupSize: getInt(formData, "groupSize", 4),
    intervalMinutes: getInt(formData, "intervalMinutes", 8),
    mode,
    playerCount,
    splitTee: getString(formData, "splitTee") === "on",
    startingGroupNo: replace
      ? 1
      : Math.max(0, ...(existing ?? []).map((group) => group.group_no)) + 1,
  });

  if ("error" in plan) {
    back(eventId, plan.error, "pairing");
  }

  if (replace && existing?.length) {
    // FK is ON DELETE SET NULL, so players simply become unassigned.
    const { error } = await staff.supabase.from("event_pairing_groups").delete().eq("event_id", eventId);
    if (error) back(eventId, "groups-failed", "pairing");
  }

  const { error } = await staff.supabase.from("event_pairing_groups").insert(
    plan.items.map((item) => ({
      ...item,
      club_id: staff.clubId,
      created_by: staff.userId,
      event_id: eventId,
      updated_by: staff.userId,
    })),
  );

  if (error) {
    back(eventId, "groups-failed", "pairing");
  }

  await audit(staff, "event_pairing.groups_generated", "events", eventId, {
    after: { count: plan.items.length, mode, replace },
  });
  back(eventId, "groups-generated", "pairing");
}

export async function updatePairingGroup(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const groupId = getString(formData, "groupId");
  const staff = await requireEventStaff(eventId);
  const teeTime = getString(formData, "teeTime");

  if (teeTime && !isValidTime(teeTime)) {
    back(eventId, "invalid-tee-time", "pairing");
  }

  const payload = {
    capacity: Math.min(8, Math.max(1, getInt(formData, "capacity", 4))),
    note: getString(formData, "note") || null,
    start_hole: Math.min(18, Math.max(1, getInt(formData, "startHole", 1))),
    tee_time: teeTime || null,
    updated_by: staff.userId,
  };

  const { data, error } = await staff.supabase
    .from("event_pairing_groups")
    .update(payload)
    .eq("event_id", eventId)
    .eq("id", groupId)
    .select("id");

  if (error || !data?.length) {
    back(eventId, "group-update-failed", "pairing");
  }

  await audit(staff, "event_pairing.group_updated", "event_pairing_groups", groupId, { after: payload });
  back(eventId, "group-updated", `group-${groupId}`);
}

export async function deletePairingGroup(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const groupId = getString(formData, "groupId");
  const staff = await requireEventStaff(eventId);

  const { data, error } = await staff.supabase
    .from("event_pairing_groups")
    .delete()
    .eq("event_id", eventId)
    .eq("id", groupId)
    .select("id, group_no");

  if (error || !data?.length) {
    back(eventId, "group-update-failed", "pairing");
  }

  await audit(staff, "event_pairing.group_deleted", "event_pairing_groups", groupId, { before: data[0] });
  back(eventId, "group-deleted", "pairing");
}

export async function clearPairings(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const staff = await requireEventStaff(eventId);

  const { error } = await staff.supabase
    .from("event_registrations")
    .update({ pairing_group_id: null, updated_by: staff.userId })
    .eq("event_id", eventId)
    .not("pairing_group_id", "is", null);

  if (error) {
    back(eventId, "assign-failed", "pairing");
  }

  await audit(staff, "event_pairing.cleared", "events", eventId, {});
  back(eventId, "pairings-cleared", "pairing");
}

export async function autoAssignPairings(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const staff = await requireEventStaff(eventId);
  const rawStrategy = getString(formData, "strategy");
  const strategy: AssignStrategy =
    rawStrategy === "handicap" || rawStrategy === "balanced" ? rawStrategy : "registration";
  const confirmedOnly = getString(formData, "confirmedOnly") === "on";

  const [{ data: groups }, { data: registrations }] = await Promise.all([
    staff.supabase.from("event_pairing_groups").select("id, group_no, capacity").eq("event_id", eventId),
    staff.supabase
      .from("event_registrations")
      .select("id, status, created_at, pairing_group_id, members(handicap)")
      .eq("event_id", eventId),
  ]);

  if (!groups?.length) {
    back(eventId, "no-groups", "pairing");
  }

  const rows = (registrations ?? []) as unknown as {
    created_at: string;
    id: string;
    members: { handicap: number | null } | { handicap: number | null }[] | null;
    pairing_group_id: string | null;
    status: string;
  }[];
  const occupied = new Map<string, number>();
  for (const row of rows) {
    if (row.pairing_group_id && isPairable(row.status)) {
      occupied.set(row.pairing_group_id, (occupied.get(row.pairing_group_id) ?? 0) + 1);
    }
  }

  const candidates = rows
    .filter((row) => !row.pairing_group_id && isPairable(row.status))
    .filter((row) => !confirmedOnly || ["paid", "registered", "checked_in"].includes(row.status))
    .map((row) => {
      const member = Array.isArray(row.members) ? row.members[0] : row.members;
      return { createdAt: row.created_at, handicap: member?.handicap ?? null, id: row.id };
    });

  const { assignments, overflow } = autoAssignPlayers(
    candidates,
    groups.map((group) => ({
      capacity: group.capacity,
      groupNo: group.group_no,
      id: group.id,
      occupied: occupied.get(group.id) ?? 0,
    })),
    strategy,
  );

  let failed = 0;
  for (const assignment of assignments) {
    const { error } = await staff.supabase
      .from("event_registrations")
      .update({ pairing_group_id: assignment.groupId, updated_by: staff.userId })
      .eq("event_id", eventId)
      .eq("id", assignment.registrationId)
      .is("pairing_group_id", null);
    if (error) failed += 1;
  }

  await audit(staff, "event_pairing.auto_assigned", "events", eventId, {
    after: { assigned: assignments.length - failed, failed, overflow: overflow.length, strategy },
  });

  back(eventId, overflow.length || failed ? "players-assigned-partial" : "players-assigned", "pairing");
}

export async function assignPlayerToGroup(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const registrationId = getString(formData, "registrationId");
  const groupId = getString(formData, "groupId") || null;
  const staff = await requireEventStaff(eventId);

  const { data: before } = await staff.supabase
    .from("event_registrations")
    .select("id, pairing_group_id, status")
    .eq("event_id", eventId)
    .eq("id", registrationId)
    .maybeSingle();

  if (!before) {
    back(eventId, "missing-registration", "pairing");
  }
  if (groupId && !isPairable(before.status)) {
    back(eventId, "not-pairable", "pairing");
  }

  const { error } = await staff.supabase
    .from("event_registrations")
    .update({ pairing_group_id: groupId, updated_by: staff.userId })
    .eq("event_id", eventId)
    .eq("id", registrationId);

  if (error) {
    back(eventId, eventErrorToStatus(error.message, "assign-failed"), "pairing");
  }

  await audit(staff, "event_pairing.player_moved", "event_registrations", registrationId, {
    after: { pairing_group_id: groupId },
    before: { pairing_group_id: before.pairing_group_id },
  });
  back(eventId, "player-moved", groupId ? `group-${groupId}` : "pairing");
}

// ---------- check-in / attendance ----------

export async function updateAttendance(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const registrationId = getString(formData, "registrationId");
  const action = getString(formData, "attendance");
  const staff = await requireEventStaff(eventId);

  const { data: registration } = await staff.supabase
    .from("event_registrations")
    .select("id, status, checked_in_at, payment_records(status)")
    .eq("event_id", eventId)
    .eq("id", registrationId)
    .maybeSingle();

  if (!registration) {
    back(eventId, "missing-registration", "participants");
  }

  const paymentApproved = (registration.payment_records ?? []).some(
    (payment: { status: string }) => payment.status === "approved",
  );
  let payload: Record<string, unknown>;
  let status: string;

  switch (action) {
    case "check_in":
      if (!isPairable(registration.status)) back(eventId, "not-pairable", "participants");
      payload = { checked_in_at: new Date().toISOString(), checked_in_by: staff.userId };
      status = "checked-in";
      break;
    case "undo_check_in":
      payload = { checked_in_at: null, checked_in_by: null };
      status = "check-in-undone";
      break;
    case "no_show":
      if (!isPairable(registration.status)) back(eventId, "not-pairable", "participants");
      payload = { checked_in_at: null, checked_in_by: null, pairing_group_id: null, status: "no_show" };
      status = "no-show-marked";
      break;
    case "undo_no_show":
      if (registration.status !== "no_show") back(eventId, "not-pairable", "participants");
      payload = {
        status: restoredStatus({ memberPrice: Number(staff.event.member_price ?? 0), paymentApproved }),
      };
      status = "no-show-undone";
      break;
    case "cancel":
      if (["cancelled", "checked_in"].includes(registration.status)) back(eventId, "not-pairable", "participants");
      // The DB trigger promotes the next waitlisted member into the freed seat.
      payload = { checked_in_at: null, pairing_group_id: null, status: "cancelled" };
      status = "registration-cancelled";
      break;
    default:
      back(eventId, "invalid-status", "participants");
  }

  const { data, error } = await staff.supabase
    .from("event_registrations")
    .update({ ...payload, updated_by: staff.userId })
    .eq("event_id", eventId)
    .eq("id", registrationId)
    .select("id");

  if (error || !data?.length) {
    back(eventId, eventErrorToStatus(error?.message, "attendance-failed"), "participants");
  }

  await audit(staff, `event_registration.${action}`, "event_registrations", registrationId, {
    after: payload,
    before: { checked_in_at: registration.checked_in_at, status: registration.status },
  });
  back(eventId, status, `reg-${registrationId}`);
}
