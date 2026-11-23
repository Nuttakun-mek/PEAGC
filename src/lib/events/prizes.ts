// Prize categories and the winners suggested from a leaderboard. Pure; the admin section on the
// event page saves them to event_prizes (which mirrors member winners into member_awards).

import type { CompetitionRules, Leaderboard, PlayerResult } from "../scoring/engine";
import { usesDoublePeoria, usesSystem36 } from "../scoring/engine";

export const prizeCategories = [
  "best_gross",
  "best_net",
  "best_stableford",
  "flight_winner",
  "longest_drive",
  "nearest_pin",
  "special",
] as const;

export type PrizeCategory = (typeof prizeCategories)[number];

export const prizeCategoryLabels: Record<PrizeCategory, string> = {
  best_gross: "สกอร์รวมดีที่สุด (Best Gross)",
  best_net: "สกอร์สุทธิดีที่สุด (Best Net)",
  best_stableford: "สเตเบิลฟอร์ดสูงสุด",
  flight_winner: "ชนะเลิศไฟลท์",
  longest_drive: "ไดรฟ์ไกลที่สุด (Longest Drive)",
  nearest_pin: "ใกล้ธงที่สุด (Nearest to Pin)",
  special: "รางวัลพิเศษ",
};

/** Categories filled from the leaderboard; the others are typed in by staff. */
export const computedCategories: PrizeCategory[] = ["best_gross", "best_net", "best_stableford", "flight_winner"];

export function isPrizeCategory(value: unknown): value is PrizeCategory {
  return typeof value === "string" && (prizeCategories as readonly string[]).includes(value);
}

/** Same wording as SQL `_event_prize_title` (the member's award title). */
export function prizeTitle(prize: { category: string; flight?: string | null; label?: string | null; rank: number }) {
  const label = prize.label?.trim() ?? "";
  let title: string;
  switch (prize.category) {
    case "flight_winner":
      title = prize.rank === 1 ? `ชนะเลิศไฟลท์ ${prize.flight ?? ""}` : `ไฟลท์ ${prize.flight ?? ""}`;
      break;
    case "special":
      title = label || prizeCategoryLabels.special;
      break;
    default:
      title = isPrizeCategory(prize.category) ? prizeCategoryLabels[prize.category] : prize.category;
  }
  if ((prize.category === "longest_drive" || prize.category === "nearest_pin") && label) title += ` ${label}`;
  if (prize.rank > 1) title += ` อันดับ ${prize.rank}`;
  return title.trim();
}

export type PrizeSuggestion = {
  category: PrizeCategory;
  flight: string | null;
  name: string;
  rank: number;
  registrationId: string;
  /** Score that won it (gross, net or points) for display. */
  value: number | null;
};

/** Which "best" category the format awards besides best gross. */
export function mainCategory(rules: CompetitionRules): PrizeCategory | null {
  if (rules.format === "stableford") return "best_stableford";
  if (rules.format === "stroke_net" || usesSystem36(rules) || usesDoublePeoria(rules)) return "best_net";
  return null;
}

function grossCountback(player: PlayerResult) {
  // back 9, last 6, last 3, last hole - lower is better
  const sum = (from: number) => player.strokes.slice(from).reduce<number>((total, value) => total + (value ?? 0), 0);
  return [player.gross ?? Number.POSITIVE_INFINITY, sum(9), sum(12), sum(15), sum(17)];
}

function compareTuples(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Winners from a leaderboard, in award order: best gross, then the format's main prize (net or
 * stableford, ranked by the engine incl. countback), then each flight. With `oneWinPerPlayer`
 * a player takes only the first prize they qualify for (common club rule).
 */
export function suggestPrizes(
  board: Leaderboard,
  rules: CompetitionRules,
  options: { oneWinPerPlayer?: boolean; topN?: number } = {},
): PrizeSuggestion[] {
  const topN = Math.max(1, Math.min(10, Math.trunc(options.topN ?? 1)));
  const oneWin = options.oneWinPerPlayer ?? true;
  const taken = new Set<string>();
  const suggestions: PrizeSuggestion[] = [];

  const award = (category: PrizeCategory, ordered: PlayerResult[], value: (player: PlayerResult) => number | null, flight: string | null = null) => {
    let rank = 0;
    for (const player of ordered) {
      if (rank >= topN) break;
      if (oneWin && taken.has(player.id)) continue;
      rank += 1;
      taken.add(player.id);
      suggestions.push({ category, flight, name: player.name, rank, registrationId: player.id, value: value(player) });
    }
  };

  const complete = board.overall.filter((player) => player.complete && player.gross !== null);
  award(
    "best_gross",
    [...complete].sort((a, b) => compareTuples(grossCountback(a), grossCountback(b)) || a.name.localeCompare(b.name, "th")),
    (player) => player.gross,
  );

  const main = mainCategory(rules);
  if (main) {
    award(
      main,
      board.overall.filter((player) => player.rank !== null).sort((a, b) => a.rank! - b.rank!),
      (player) => (main === "best_stableford" ? player.points : player.net),
    );
  }

  for (const flight of board.flights) {
    award(
      "flight_winner",
      flight.players.filter((player) => player.flightRank !== null).sort((a, b) => a.flightRank! - b.flightRank!),
      (player) => (rules.format === "stableford" ? player.points : rules.format === "stroke_gross" ? player.gross : player.net),
      flight.name,
    );
  }

  return suggestions;
}
