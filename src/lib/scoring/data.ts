import "server-only";

import { selectWithOptional } from "@/lib/events/db";
import { holdsSeat } from "@/lib/events/pairing";
import { loadClubHandicaps } from "@/lib/scoring/club-handicap";
import { type CompetitionRules, type PlayerInput, HOLES, parseRules } from "@/lib/scoring/engine";
import { type HandicapChoice, chooseHandicap } from "@/lib/scoring/handicap";
import { logDbError } from "@/lib/supabase/errors";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export const scoringRoles = ["platform_owner", "club_admin", "committee", "tournament_director", "scoring_officer"];

export type CompetitionRow = {
  event_id: string;
  id: string;
  name: string;
  published_at: string | null;
  published_version: number | null;
  rule_version: number;
  rules: unknown;
  status: string;
};

export type ScoringPlayer = {
  /** แต้มต่อชมรม from rounds before this event (null until 3 rated rounds) and its round count. */
  clubHandicap: number | null;
  clubRounds: number;
  groupNo: number | null;
  groupStartHole: number | null;
  /** members.handicap as entered by the club (fallback for the club handicap). */
  handicap: number | null;
  /** The handicap this competition uses for the player, per rules.handicapSource. */
  handicapUsed: HandicapChoice;
  memberId: string | null;
  memberCode: string | null;
  name: string;
  nickname: string | null;
  officialHandicap: number | null;
  registrationId: string;
};

export type ScoreEntryRow = {
  created_at: string;
  event_registration_id: string;
  id: string;
  note: string | null;
  ocr_job_id: string | null;
  pickups: boolean[];
  source: string;
  strokes: (number | null)[];
};

export type EntryConfirmations = { marker: boolean; player: boolean };

export async function loadScoringData(supabase: Client, clubId: string, eventId: string) {
  const [eventResult, { data: competition }, registrationResult] = await Promise.all([
    selectWithOptional<{ course_tee_id?: string | null; event_date: string; id: string; name: string; status: string; venue: string | null }>(
      (columns) => supabase.from("events").select(columns).eq("club_id", clubId).eq("id", eventId).maybeSingle(),
      "id, name, event_date, venue, status, course_tee_id",
      "id, name, event_date, venue, status",
      "scoring.event",
    ),
    supabase
      .from("competitions")
      .select("id, event_id, name, rules, rule_version, status, published_version, published_at")
      .eq("club_id", clubId)
      .eq("event_id", eventId)
      .maybeSingle(),
    selectWithOptional<unknown[]>(
      (columns) =>
        supabase
          .from("event_registrations")
          .select(columns)
          .eq("club_id", clubId)
          .eq("event_id", eventId)
          .order("created_at")
          .limit(1000),
      "id, status, member_id, guest_name, event_pairing_groups(group_no, start_hole), members(full_name, nickname, member_code, handicap, official_handicap_index)",
      "id, status, member_id, guest_name, event_pairing_groups(group_no, start_hole), members(full_name, nickname, member_code, handicap)",
      "scoring.registrations",
    ),
  ]);
  const event = eventResult.data;

  type RegRow = {
    event_pairing_groups: { group_no: number; start_hole: number | null } | null;
    guest_name: string | null;
    id: string;
    member_id: string | null;
    members: {
      full_name: string;
      handicap: number | null;
      member_code: string | null;
      nickname: string | null;
      official_handicap_index?: number | null;
    } | null;
    status: string;
  };

  const rules: CompetitionRules | null = competition ? parseRules(competition.rules) : null;
  const seated = ((registrationResult.data ?? []) as unknown as RegRow[]).filter((row) => holdsSeat(row.status));

  // Club handicap counts only rounds before this event's date.
  const handicaps = await loadClubHandicaps(
    supabase,
    clubId,
    seated.flatMap((row) => (row.member_id ? [{ id: row.member_id, manual: row.members?.handicap ?? null }] : [])),
    { before: event?.event_date ?? null },
  );

  const players: ScoringPlayer[] = seated
    .map((row) => {
      const club = row.member_id ? handicaps.get(row.member_id) : undefined;
      const official = row.members?.official_handicap_index ?? null;
      const manual = row.members?.handicap ?? null;
      return {
        clubHandicap: club?.index ?? null,
        clubRounds: club?.rounds ?? 0,
        groupNo: row.event_pairing_groups?.group_no ?? null,
        groupStartHole: row.event_pairing_groups?.start_hole ?? null,
        handicap: manual,
        handicapUsed: chooseHandicap(rules?.handicapSource ?? "club", { club: club?.index ?? null, manual, official }),
        memberCode: row.members?.member_code ?? null,
        memberId: row.member_id,
        name: row.members?.full_name ?? row.guest_name ?? "ผู้เล่น",
        nickname: row.members?.nickname ?? null,
        officialHandicap: official,
        registrationId: row.id,
      };
    })
    .sort((a, b) => (a.groupNo ?? 999) - (b.groupNo ?? 999) || a.name.localeCompare(b.name, "th"));

  let entries: ScoreEntryRow[] = [];
  let verified = new Map<string, string>();
  const confirmations = new Map<string, EntryConfirmations>();
  let confirmationsAvailable = false;

  if (competition) {
    const [{ data: entryData }, { data: verifiedData }, { data: confirmationData, error: confirmationError }] = await Promise.all([
      supabase
        .from("score_entries")
        .select("id, event_registration_id, source, ocr_job_id, strokes, pickups, note, created_at")
        .eq("competition_id", competition.id)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("verified_scores")
        .select("event_registration_id, score_entry_id")
        .eq("competition_id", competition.id),
      supabase
        .from("score_entry_confirmations")
        .select("score_entry_id, role")
        .eq("competition_id", competition.id)
        .limit(5000),
    ]);
    entries = (entryData ?? []) as ScoreEntryRow[];
    verified = new Map((verifiedData ?? []).map((row) => [row.event_registration_id, row.score_entry_id]));
    if (confirmationError) {
      logDbError("scoring.confirmations", confirmationError);
    } else {
      confirmationsAvailable = true;
      for (const row of (confirmationData ?? []) as { role: string; score_entry_id: string }[]) {
        const current = confirmations.get(row.score_entry_id) ?? { marker: false, player: false };
        if (row.role === "player") current.player = true;
        if (row.role === "marker") current.marker = true;
        confirmations.set(row.score_entry_id, current);
      }
    }
  }

  const latestEntry = new Map<string, ScoreEntryRow>();
  const entryById = new Map<string, ScoreEntryRow>();
  for (const entry of entries) {
    entryById.set(entry.id, entry);
    if (!latestEntry.has(entry.event_registration_id)) latestEntry.set(entry.event_registration_id, entry);
  }

  return {
    competition: competition as CompetitionRow | null,
    confirmations,
    confirmationsAvailable,
    entryById,
    entryCount: (registrationId: string) => entries.filter((e) => e.event_registration_id === registrationId).length,
    event,
    latestEntry,
    players,
    rules,
    /** The database is behind this code (new columns missing): show the outdated banner. */
    schemaOutdated: eventResult.outdated || registrationResult.outdated || (Boolean(competition) && !confirmationsAvailable),
    verified,
  };
}

export type ScoringData = Awaited<ReturnType<typeof loadScoringData>>;

/** Engine input built from verified cards only - unverified entries never reach a leaderboard. */
export function verifiedPlayerInputs(data: ScoringData): PlayerInput[] {
  return data.players.flatMap((player) => {
    const entryId = data.verified.get(player.registrationId);
    const entry = entryId ? data.entryById.get(entryId) : undefined;
    if (!entry) return [];
    return [{
      handicapIndex: player.handicapUsed.value,
      id: player.registrationId,
      name: player.nickname ? `${player.name} (${player.nickname})` : player.name,
      pickups: entry.pickups,
      strokes: Array.from({ length: HOLES }, (_, i) => entry.strokes[i] ?? null),
    }];
  });
}

/** Parse 18 typed cells: number 1-20, "X"/"NR"/"PU" = pickup, blank = not entered. */
export function parseCardInputs(values: string[]) {
  const strokes: (number | null)[] = [];
  const pickups: boolean[] = [];
  let invalid = false;
  for (let i = 0; i < HOLES; i += 1) {
    const raw = (values[i] ?? "").trim().toLowerCase();
    if (!raw) {
      strokes.push(null);
      pickups.push(false);
    } else if (["x", "nr", "pu", "-"].includes(raw)) {
      strokes.push(null);
      pickups.push(true);
    } else {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 20) invalid = true;
      strokes.push(Number.isInteger(value) ? value : null);
      pickups.push(false);
    }
  }
  return { invalid, pickups, strokes };
}
