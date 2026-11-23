"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";

import { eventOperationRoles, requireStaffClub } from "@/lib/auth/staff";
import { selectWithOptional } from "@/lib/events/db";
import { type FlightMode, planFlightGroups } from "@/lib/events/flights";
import {
  type AssignStrategy,
  type PairingMode,
  autoAssignPlayers,
  eventErrorToStatus,
  isConfirmed,
  isPairable,
  isValidTime,
  planPairingGroups,
  restoredStatus,
} from "@/lib/events/pairing";
import { computedCategories, isPrizeCategory, suggestPrizes } from "@/lib/events/prizes";
import { loadClubHandicaps } from "@/lib/scoring/club-handicap";
import { loadScoringData, verifiedPlayerInputs } from "@/lib/scoring/data";
import { computeLeaderboard, parseRules } from "@/lib/scoring/engine";
import { chooseHandicap } from "@/lib/scoring/handicap";
import { classifyDbError, failureStatus, logDbError } from "@/lib/supabase/errors";
import { anyCorruptedText } from "@/lib/text-integrity";

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
    .select("id, club_id, name, member_price, status, event_date")
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

// ---------- automatic flights by handicap ----------

/**
 * "จัดกลุ่มอัตโนมัติตามแต้มต่อ": replaces all groups with new ones, flights A/B/C by thirds (or the
 * competition's handicap ranges), groups of N inside each flight, then seats every player.
 */
export async function autoFlightPairings(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const staff = await requireEventStaff(eventId);
  const mode: PairingMode = getString(formData, "mode") === "shotgun" ? "shotgun" : "tee_times";
  const rawFlightMode = getString(formData, "flightMode");
  const flightMode: FlightMode = rawFlightMode === "ranges" || rawFlightMode === "single" ? rawFlightMode : "thirds";
  const groupSize = Math.min(8, Math.max(1, getInt(formData, "groupSize", 4)));
  const confirmedOnly = getString(formData, "confirmedOnly") === "on";

  // The flight column comes with the courses/handicap migration: check before deleting anything.
  const probe = await staff.supabase.from("event_pairing_groups").select("id, flight").eq("event_id", eventId).limit(1);
  if (probe.error) {
    logDbError("event_pairing.auto_flight probe", probe.error);
    back(eventId, classifyDbError(probe.error) === "schema-outdated" ? "db-outdated" : "groups-failed", "pairing");
  }

  const [{ data: competition }, registrationResult] = await Promise.all([
    staff.supabase.from("competitions").select("rules").eq("event_id", eventId).maybeSingle(),
    selectWithOptional<unknown[]>(
      (columns) => staff.supabase.from("event_registrations").select(columns).eq("event_id", eventId),
      "id, status, created_at, member_id, members(handicap, official_handicap_index)",
      "id, status, created_at, member_id, members(handicap)",
      "event_pairing.auto_flight registrations",
    ),
  ]);
  const rules = parseRules(competition?.rules ?? null);
  if (flightMode === "ranges" && !rules.flights.length) back(eventId, "no-flight-ranges", "pairing");

  type Row = {
    created_at: string;
    id: string;
    member_id: string | null;
    members: { handicap: number | null; official_handicap_index?: number | null } | null;
    status: string;
  };
  const rows = ((registrationResult.data ?? []) as unknown as Row[])
    .filter((row) => isPairable(row.status))
    .filter((row) => !confirmedOnly || isConfirmed(row.status));
  if (!rows.length) back(eventId, "no-players", "pairing");

  const handicaps = await loadClubHandicaps(
    staff.supabase,
    staff.clubId,
    rows.flatMap((row) => (row.member_id ? [{ id: row.member_id, manual: row.members?.handicap ?? null }] : [])),
    { before: staff.event.event_date },
  );
  const players = rows.map((row) => ({
    createdAt: row.created_at,
    handicap: chooseHandicap(rules.handicapSource === "official" ? "official" : "club", {
      club: row.member_id ? (handicaps.get(row.member_id)?.index ?? null) : null,
      manual: row.members?.handicap ?? null,
      official: row.members?.official_handicap_index ?? null,
    }).value,
    id: row.id,
  }));

  const plan = planFlightGroups(players, { groupSize, mode: flightMode, ranges: rules.flights });
  const times = planPairingGroups({
    firstTeeTime: getString(formData, "firstTeeTime"),
    groupSize,
    intervalMinutes: getInt(formData, "intervalMinutes", 8),
    mode,
    playerCount: plan.length * groupSize,
    splitTee: getString(formData, "splitTee") === "on",
    startingGroupNo: 1,
  });
  if ("error" in times) back(eventId, times.error, "pairing");

  // FK is ON DELETE SET NULL: everyone becomes unassigned, then is seated again below.
  const { error: deleteError } = await staff.supabase.from("event_pairing_groups").delete().eq("event_id", eventId);
  if (deleteError) back(eventId, "groups-failed", "pairing");

  const { data: created, error: insertError } = await staff.supabase
    .from("event_pairing_groups")
    .insert(
      plan.map((group, index) => ({
        capacity: Math.max(groupSize, group.registrationIds.length),
        club_id: staff.clubId,
        created_by: staff.userId,
        event_id: eventId,
        flight: group.flight || null,
        group_no: times.items[index].group_no,
        start_hole: times.items[index].start_hole,
        tee_time: times.items[index].tee_time,
        updated_by: staff.userId,
      })),
    )
    .select("id, group_no");
  if (insertError || !created) {
    logDbError("event_pairing.auto_flight insert", insertError);
    back(eventId, failureStatus("groups-failed", insertError), "pairing");
  }

  const groupIdByNo = new Map(created.map((group) => [group.group_no, group.id]));
  let failed = 0;
  for (const [index, group] of plan.entries()) {
    const groupId = groupIdByNo.get(times.items[index].group_no);
    if (!groupId) continue;
    const { error } = await staff.supabase
      .from("event_registrations")
      .update({ pairing_group_id: groupId, updated_by: staff.userId })
      .eq("event_id", eventId)
      .in("id", group.registrationIds);
    if (error) failed += group.registrationIds.length;
  }

  await audit(staff, "event_pairing.auto_flighted", "events", eventId, {
    after: { failed, flight_mode: flightMode, groups: plan.length, group_size: groupSize, players: players.length },
  });
  back(eventId, failed ? "players-assigned-partial" : "flights-generated", "pairing");
}

// ---------- prizes ----------

const prizeErrorStatus = (error: { code?: string | null; message?: string | null } | null) => {
  if (!error) return "prize-failed";
  if ((error.message ?? "").includes("PRIZE_WINNER_MISMATCH")) return "prize-winner-mismatch";
  if (classifyDbError(error) === "duplicate") return "prize-duplicate";
  return failureStatus("prize-failed", error);
};

export async function savePrize(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const staff = await requireEventStaff(eventId);
  const category = getString(formData, "category");
  if (!isPrizeCategory(category)) back(eventId, "prize-invalid", "prizes");
  const registrationId = getString(formData, "registrationId") || null;
  const guestName = getString(formData, "guestName") || null;
  if (!registrationId && !guestName) back(eventId, "prize-no-winner", "prizes");
  const flight = getString(formData, "flight") || null;
  if (category === "flight_winner" && !flight) back(eventId, "prize-no-flight", "prizes");
  const label = getString(formData, "label") || null;
  const note = getString(formData, "note") || null;
  if (anyCorruptedText([guestName, label, note, flight])) back(eventId, "text-corrupted", "prizes");

  const payload = {
    category,
    club_id: staff.clubId,
    created_by: staff.userId,
    event_id: eventId,
    event_registration_id: registrationId,
    flight: category === "flight_winner" ? flight : null,
    guest_name: registrationId ? null : guestName,
    label,
    note,
    rank: Math.min(20, Math.max(1, getInt(formData, "rank", 1))),
    source: "manual",
    updated_by: staff.userId,
  };
  const { data, error } = await staff.supabase.from("event_prizes").insert(payload).select("id").single();
  if (error || !data) {
    logDbError("event_prizes.insert", error);
    back(eventId, prizeErrorStatus(error), "prizes");
  }
  await audit(staff, "event_prize.created", "event_prizes", data.id, { after: payload });
  back(eventId, "prize-saved", "prizes");
}

export async function deletePrize(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const prizeId = getString(formData, "prizeId");
  const staff = await requireEventStaff(eventId);
  const { data, error } = await staff.supabase
    .from("event_prizes")
    .delete()
    .eq("event_id", eventId)
    .eq("id", prizeId)
    .select("id, category, rank, member_id, guest_name, label, flight");
  if (error || !data?.length) {
    logDbError("event_prizes.delete", error);
    back(eventId, failureStatus("prize-failed", error), "prizes");
  }
  await audit(staff, "event_prize.deleted", "event_prizes", prizeId, { before: data[0] });
  back(eventId, "prize-deleted", "prizes");
}

/** Fill best gross / net / stableford / flight winners from the verified leaderboard. */
export async function applySuggestedPrizes(formData: FormData) {
  const eventId = getString(formData, "eventId");
  const staff = await requireEventStaff(eventId);
  const topN = Math.min(10, Math.max(1, getInt(formData, "topN", 1)));
  const oneWin = getString(formData, "oneWin") === "on";

  const data = await loadScoringData(staff.supabase, staff.clubId, eventId);
  if (!data.competition || !data.rules) back(eventId, "prize-no-competition", "prizes");
  const board = computeLeaderboard(data.rules, verifiedPlayerInputs(data));
  const suggestions = suggestPrizes(board, data.rules, { oneWinPerPlayer: oneWin, topN });
  if (!suggestions.length) back(eventId, "prize-nothing-verified", "prizes");

  const { data: existing, error: loadError } = await staff.supabase
    .from("event_prizes")
    .select("id, category, rank, flight, label, source")
    .eq("event_id", eventId);
  if (loadError) {
    logDbError("event_prizes.load", loadError);
    back(eventId, failureStatus("prize-failed", loadError), "prizes");
  }
  // Replace earlier suggestions; never touch prizes typed in by staff.
  const { error: clearError } = await staff.supabase
    .from("event_prizes")
    .delete()
    .eq("event_id", eventId)
    .eq("source", "leaderboard")
    .in("category", computedCategories);
  if (clearError) back(eventId, failureStatus("prize-failed", clearError), "prizes");

  const manualKeys = new Set(
    (existing ?? [])
      .filter((row) => row.source === "manual")
      .map((row) => `${row.category}|${row.flight ?? ""}|${row.label ?? ""}|${row.rank}`),
  );
  const rows = suggestions
    .filter((item) => !manualKeys.has(`${item.category}|${item.flight ?? ""}||${item.rank}`))
    .map((item) => ({
      category: item.category,
      club_id: staff.clubId,
      created_by: staff.userId,
      event_id: eventId,
      event_registration_id: item.registrationId,
      flight: item.flight,
      note: item.value === null ? null : `สกอร์ ${item.value}`,
      rank: item.rank,
      source: "leaderboard",
      updated_by: staff.userId,
    }));
  if (rows.length) {
    const { error } = await staff.supabase.from("event_prizes").insert(rows);
    if (error) {
      logDbError("event_prizes.suggest", error);
      back(eventId, prizeErrorStatus(error), "prizes");
    }
  }
  await audit(staff, "event_prize.suggested", "events", eventId, { after: { count: rows.length, one_win: oneWin, top_n: topN } });
  back(eventId, "prizes-suggested", "prizes");
}
