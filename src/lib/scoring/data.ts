import "server-only";

import { holdsSeat } from "@/lib/events/pairing";
import { type CompetitionRules, type PlayerInput, HOLES, parseRules } from "@/lib/scoring/engine";
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
  groupNo: number | null;
  handicap: number | null;
  memberId: string | null;
  memberCode: string | null;
  name: string;
  nickname: string | null;
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

export async function loadScoringData(supabase: Client, clubId: string, eventId: string) {
  const [{ data: event }, { data: competition }, { data: registrations }] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, event_date, venue, status")
      .eq("club_id", clubId)
      .eq("id", eventId)
      .maybeSingle(),
    supabase
      .from("competitions")
      .select("id, event_id, name, rules, rule_version, status, published_version, published_at")
      .eq("club_id", clubId)
      .eq("event_id", eventId)
      .maybeSingle(),
    supabase
      .from("event_registrations")
      .select("id, status, member_id, guest_name, members(full_name, nickname, member_code, handicap), event_pairing_groups(group_no)")
      .eq("club_id", clubId)
      .eq("event_id", eventId)
      .order("created_at")
      .limit(1000),
  ]);

  type RegRow = {
    event_pairing_groups: { group_no: number } | null;
    guest_name: string | null;
    id: string;
    member_id: string | null;
    members: { full_name: string; handicap: number | null; member_code: string | null; nickname: string | null } | null;
    status: string;
  };

  const players: ScoringPlayer[] = ((registrations ?? []) as unknown as RegRow[])
    .filter((row) => holdsSeat(row.status))
    .map((row) => ({
      groupNo: row.event_pairing_groups?.group_no ?? null,
      handicap: row.members?.handicap ?? null,
      memberCode: row.members?.member_code ?? null,
      memberId: row.member_id,
      name: row.members?.full_name ?? row.guest_name ?? "ผู้เล่น",
      nickname: row.members?.nickname ?? null,
      registrationId: row.id,
    }))
    .sort((a, b) => (a.groupNo ?? 999) - (b.groupNo ?? 999) || a.name.localeCompare(b.name, "th"));

  let entries: ScoreEntryRow[] = [];
  let verified = new Map<string, string>();

  if (competition) {
    const [{ data: entryData }, { data: verifiedData }] = await Promise.all([
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
    ]);
    entries = (entryData ?? []) as ScoreEntryRow[];
    verified = new Map((verifiedData ?? []).map((row) => [row.event_registration_id, row.score_entry_id]));
  }

  const latestEntry = new Map<string, ScoreEntryRow>();
  const entryById = new Map<string, ScoreEntryRow>();
  for (const entry of entries) {
    entryById.set(entry.id, entry);
    if (!latestEntry.has(entry.event_registration_id)) latestEntry.set(entry.event_registration_id, entry);
  }

  const rules: CompetitionRules | null = competition ? parseRules(competition.rules) : null;

  return {
    competition: competition as CompetitionRow | null,
    entryById,
    entryCount: (registrationId: string) => entries.filter((e) => e.event_registration_id === registrationId).length,
    event,
    latestEntry,
    players,
    rules,
    verified,
  };
}

/** Engine input built from verified cards only - unverified entries never reach a leaderboard. */
export function verifiedPlayerInputs(data: Awaited<ReturnType<typeof loadScoringData>>): PlayerInput[] {
  return data.players.flatMap((player) => {
    const entryId = data.verified.get(player.registrationId);
    const entry = entryId ? data.entryById.get(entryId) : undefined;
    if (!entry) return [];
    return [{
      handicapIndex: player.handicap,
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
