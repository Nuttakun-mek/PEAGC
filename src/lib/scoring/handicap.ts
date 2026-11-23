// แต้มต่อชมรม (club handicap), computed the WHS way from the club's own verified rounds.
//
// The club is not an authorised association, so this is NOT a "Handicap Index" (WHS Rule 1); it
// is called แต้มต่อชมรม everywhere. A member's official index lives in
// members.official_handicap_index ("Handicap Index ทางการ") and is never overwritten by this.
//
//   score differential = 113 / slope x (adjusted gross - course rating)        (one decimal)
//   adjusted gross     = each hole capped at net double bogey (par + 2 + strokes received);
//                        without an index yet, par + 5. Picked-up holes count as the cap.
//                        14-17 holes played: unplayed holes count as net par.
//   index              = average of the lowest differentials of the latest 20, using the WHS
//                        table below for fewer than 20 rounds (3 rounds minimum), one decimal,
//                        at most 54.0
// Only rounds whose competition has a course rating and slope count. Not modelled: playing
// conditions calculation, soft/hard caps and exceptional score reduction.
//
// Pure functions only; loading rounds from the database is in ./club-handicap.ts.

import { HOLES, courseHandicap, strokesReceived } from "./engine";

export const MAX_CLUB_HANDICAP = 54;
export const MIN_ROUNDS_FOR_INDEX = 3;
export const ROUNDS_WINDOW = 20;

/** WHS table: rounds available -> how many lowest differentials count, and the adjustment. */
export function differentialsToUse(count: number): { adjustment: number; use: number } | null {
  if (count < 3) return null;
  if (count === 3) return { adjustment: -2, use: 1 };
  if (count === 4) return { adjustment: -1, use: 1 };
  if (count === 5) return { adjustment: 0, use: 1 };
  if (count === 6) return { adjustment: -1, use: 2 };
  if (count <= 8) return { adjustment: 0, use: 2 };
  if (count <= 11) return { adjustment: 0, use: 3 };
  if (count <= 14) return { adjustment: 0, use: 4 };
  if (count <= 16) return { adjustment: 0, use: 5 };
  if (count <= 18) return { adjustment: 0, use: 6 };
  if (count === 19) return { adjustment: 0, use: 7 };
  return { adjustment: 0, use: 8 };
}

/** Round half away from zero to one decimal, never returning -0. */
export function roundTenth(value: number) {
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * 10 + 1e-9)) / 10;
  return rounded === 0 ? 0 : rounded;
}

export function scoreDifferential(adjustedGross: number, courseRating: number, slopeRating: number) {
  return roundTenth((113 / slopeRating) * (adjustedGross - courseRating));
}

/**
 * Highest score counted per hole: net double bogey (par + 2 + strokes received for the course
 * handicap) or par + 5 while the player has no handicap yet.
 */
export function holeCaps(pars: number[], strokeIndex: number[], courseHcp: number | null) {
  if (courseHcp === null) return pars.map((par) => par + 5);
  const received = strokesReceived(courseHcp, strokeIndex);
  return pars.map((par, i) => par + 2 + received[i]);
}

/**
 * Adjusted gross score for handicap purposes, or null when fewer than 14 holes were played.
 * `pickups[i]` = hole started but not holed out (counts as the cap).
 */
export function adjustedGrossScore(input: {
  courseHcp: number | null;
  pars: number[];
  pickups?: boolean[];
  strokeIndex: number[];
  strokes: (number | null)[];
}) {
  const caps = holeCaps(input.pars, input.strokeIndex, input.courseHcp);
  const received = input.courseHcp === null ? input.pars.map(() => 0) : strokesReceived(input.courseHcp, input.strokeIndex);
  let played = 0;
  let total = 0;
  for (let i = 0; i < HOLES; i += 1) {
    const value = input.strokes[i];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      played += 1;
      total += Math.min(value, caps[i]);
    } else if (input.pickups?.[i]) {
      played += 1;
      total += caps[i];
    } else {
      total += input.pars[i] + received[i]; // net par for an unplayed hole
    }
  }
  return played >= 14 ? total : null;
}

export type HandicapRound = {
  courseRating: number | null;
  /** "2026-11-20"; rounds are ordered by date, then id. */
  date: string;
  id: string;
  pars: number[];
  pickups?: boolean[];
  slopeRating: number | null;
  strokeIndex: number[];
  strokes: (number | null)[];
};

export type DifferentialRow = {
  adjustedGross: number;
  date: string;
  differential: number;
  id: string;
  /** Among the lowest differentials that make up the current value. */
  used: boolean;
};

export type ClubHandicap = {
  /** null until 3 rated rounds exist. */
  index: number | null;
  /** Latest rated rounds considered (at most 20), newest first. */
  differentials: DifferentialRow[];
  /** Rated rounds counted in total (all time). */
  rounds: number;
};

/** Index from differentials ordered newest first (only the latest 20 are looked at). */
export function indexFromDifferentials(differentials: number[]) {
  const recent = differentials.slice(0, ROUNDS_WINDOW);
  const table = differentialsToUse(recent.length);
  if (!table) return null;
  const lowest = [...recent].sort((a, b) => a - b).slice(0, table.use);
  const average = lowest.reduce((sum, value) => sum + value, 0) / lowest.length;
  return Math.min(MAX_CLUB_HANDICAP, roundTenth(average + table.adjustment));
}

function isRated(round: HandicapRound) {
  return (
    typeof round.courseRating === "number" &&
    Number.isFinite(round.courseRating) &&
    typeof round.slopeRating === "number" &&
    Number.isFinite(round.slopeRating) &&
    round.slopeRating > 0 &&
    round.pars.length === HOLES &&
    round.strokeIndex.length === HOLES
  );
}

/**
 * Club handicap after the given rounds. Rounds are replayed oldest first so each round's net
 * double bogey cap uses the handicap the player had when it was played (`initialIndex`, e.g. the
 * handicap the club set by hand, until three rated rounds exist).
 */
export function computeClubHandicap(rounds: HandicapRound[], options: { initialIndex?: number | null } = {}): ClubHandicap {
  const ordered = rounds
    .filter(isRated)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const history: { adjustedGross: number; date: string; differential: number; id: string }[] = [];
  let current: number | null = null;

  for (const round of ordered) {
    const indexAtTime = current ?? options.initialIndex ?? null;
    const par = round.pars.reduce((sum, value) => sum + value, 0);
    const courseHcp = indexAtTime === null ? null : courseHandicap(indexAtTime, round.slopeRating!, round.courseRating!, par);
    const adjustedGross = adjustedGrossScore({ courseHcp, pars: round.pars, pickups: round.pickups, strokeIndex: round.strokeIndex, strokes: round.strokes });
    if (adjustedGross === null) continue;
    history.unshift({ adjustedGross, date: round.date, differential: scoreDifferential(adjustedGross, round.courseRating!, round.slopeRating!), id: round.id });
    current = indexFromDifferentials(history.map((row) => row.differential));
  }

  const window = history.slice(0, ROUNDS_WINDOW);
  const table = differentialsToUse(window.length);
  const usedIds = new Set(
    table
      ? [...window].sort((a, b) => a.differential - b.differential || b.date.localeCompare(a.date)).slice(0, table.use).map((row) => row.id)
      : [],
  );

  return {
    differentials: window.map((row) => ({ ...row, used: usedIds.has(row.id) })),
    index: current,
    rounds: history.length,
  };
}

export type HandicapChoice = {
  /** Value to use, or null when the player has none for this method. */
  value: number | null;
  /** Where it came from, for the small grey text next to it. */
  basis: "club" | "club_initial" | "official" | "none";
};

/**
 * The handicap a player brings to a competition. Club handicap falls back to the handicap the club
 * entered by hand (members.handicap) until three rated rounds exist.
 */
export function chooseHandicap(
  source: "club" | "official" | "system36" | "double_peoria" | "none",
  values: { club: number | null; manual: number | null; official: number | null },
): HandicapChoice {
  if (source === "none") return { basis: "none", value: null };
  if (source === "official") {
    return values.official === null ? { basis: "none", value: null } : { basis: "official", value: values.official };
  }
  if (values.club !== null) return { basis: "club", value: values.club };
  if (values.manual !== null) return { basis: "club_initial", value: values.manual };
  return { basis: "none", value: null };
}

/** "14.2" / "+1.5" (plus handicap) / fallback. */
export function formatHandicap(value: number | null | undefined, fallback = "ยังไม่มี") {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  if (value < 0) return `+${Math.abs(value).toFixed(1)}`;
  return value.toFixed(1);
}
