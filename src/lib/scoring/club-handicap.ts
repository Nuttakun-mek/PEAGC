import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logDbError } from "@/lib/supabase/errors";

import { HOLES, parseRules } from "./engine";
import { type ClubHandicap, type HandicapRound, computeClubHandicap } from "./handicap";

// Loads the verified rounds behind แต้มต่อชมรม and computes it per member. Other tracks can call
// `loadClubHandicaps` (e.g. a member profile or the points page) with any Supabase client whose
// RLS lets it read the club's verified scores (staff client, or the service-role client after an
// app-level check).

// Server and service-role clients have different generic parameters; only these two calls are used.
type Client = Pick<SupabaseClient, "from">;

type Row = {
  competitions: { rules: unknown; events: { event_date: string } | null } | null;
  event_registrations: { member_id: string | null } | null;
  id: string;
  score_entries: { pickups: boolean[] | null; strokes: (number | null)[] } | null;
};

export type MemberHandicapInput = {
  id: string;
  /** members.handicap: the handicap the club entered by hand; used until 3 rated rounds exist. */
  manual: number | null;
};

/**
 * Club handicap per member id. `before` ("2026-11-23") leaves out rounds played on or after that
 * date, so a competition uses the handicap players brought to it. Members without rated rounds get
 * `{ index: null, rounds: 0 }`. Never throws: a failed query is logged and treated as no rounds.
 */
export async function loadClubHandicaps(
  supabase: Client,
  clubId: string,
  members: MemberHandicapInput[],
  options: { before?: string | null } = {},
): Promise<Map<string, ClubHandicap>> {
  const result = new Map<string, ClubHandicap>();
  const ids = [...new Set(members.map((member) => member.id).filter(Boolean))];
  if (!ids.length) return result;

  const rows: Row[] = [];
  // Chunk the member filter to keep URLs short.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from("verified_scores")
      .select("id, score_entries(strokes, pickups), competitions(rules, events(event_date)), event_registrations!inner(member_id)")
      .eq("club_id", clubId)
      .in("event_registrations.member_id", ids.slice(i, i + 150))
      .limit(5000);
    if (error) {
      logDbError("club handicap rounds", error);
      break;
    }
    rows.push(...((data ?? []) as unknown as Row[]));
  }

  const roundsByMember = new Map<string, HandicapRound[]>();
  for (const row of rows) {
    const memberId = row.event_registrations?.member_id;
    const date = row.competitions?.events?.event_date;
    if (!memberId || !date || !row.score_entries || !row.competitions) continue;
    if (options.before && date >= options.before) continue;
    const rules = parseRules(row.competitions.rules);
    roundsByMember.set(memberId, [
      ...(roundsByMember.get(memberId) ?? []),
      {
        courseRating: rules.courseRating,
        date,
        id: row.id,
        pars: rules.pars,
        pickups: Array.from({ length: HOLES }, (_, i) => Boolean(row.score_entries?.pickups?.[i])),
        slopeRating: rules.slopeRating,
        strokeIndex: rules.strokeIndex,
        strokes: Array.from({ length: HOLES }, (_, i) => row.score_entries?.strokes[i] ?? null),
      },
    ]);
  }

  for (const member of members) {
    result.set(member.id, computeClubHandicap(roundsByMember.get(member.id) ?? [], { initialIndex: member.manual }));
  }
  return result;
}
