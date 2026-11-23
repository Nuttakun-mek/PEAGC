import { describe, expect, it } from "vitest";

import { type CompetitionRules, computeLeaderboard, defaultRules } from "../scoring/engine";

import { prizeTitle, suggestPrizes } from "./prizes";

const pars = defaultRules.pars;
const card = (over: number) => pars.map((par) => par + over);
const rules = (overrides: Partial<CompetitionRules> = {}): CompetitionRules => ({ ...defaultRules, ...overrides });

describe("prize titles", () => {
  it("match the SQL mirror wording", () => {
    expect(prizeTitle({ category: "best_gross", rank: 1 })).toBe("สกอร์รวมดีที่สุด (Best Gross)");
    expect(prizeTitle({ category: "best_net", rank: 2 })).toBe("สกอร์สุทธิดีที่สุด (Best Net) อันดับ 2");
    expect(prizeTitle({ category: "flight_winner", flight: "A", rank: 1 })).toBe("ชนะเลิศไฟลท์ A");
    expect(prizeTitle({ category: "nearest_pin", label: "หลุม 7", rank: 1 })).toBe("ใกล้ธงที่สุด (Nearest to Pin) หลุม 7");
    expect(prizeTitle({ category: "special", label: "Hole in one", rank: 1 })).toBe("Hole in one");
  });
});

describe("suggestPrizes", () => {
  const players = [
    { handicapIndex: 2, id: "low", name: "Low", strokes: card(0) }, // gross 72, net 70
    { handicapIndex: 20, id: "mid", name: "Mid", strokes: card(1) }, // gross 90, net 70 (countback)
    { handicapIndex: 30, id: "high", name: "High", strokes: card(1.5).map(Math.round) },
  ];

  it("best gross first, then best net without repeating a winner", () => {
    const r = rules();
    const board = computeLeaderboard(r, players);
    const suggestions = suggestPrizes(board, r);
    expect(suggestions.map((s) => [s.category, s.rank, s.registrationId])).toEqual([
      ["best_gross", 1, "low"],
      ["best_net", 1, board.overall.find((p) => p.id !== "low" && p.rank !== null)!.id],
    ]);
  });

  it("allows the same player twice when the club allows it", () => {
    const r = rules();
    const board = computeLeaderboard(r, players);
    const suggestions = suggestPrizes(board, r, { oneWinPerPlayer: false, topN: 2 });
    expect(suggestions.filter((s) => s.category === "best_gross").map((s) => s.registrationId)).toEqual(["low", "mid"]);
    expect(suggestions.filter((s) => s.category === "best_net")).toHaveLength(2);
  });

  it("stableford and flight winners", () => {
    const r = rules({
      flights: [
        { maxHandicap: 10, minHandicap: 0, name: "A" },
        { maxHandicap: 36, minHandicap: 10.1, name: "B" },
      ],
      format: "stableford",
    });
    const board = computeLeaderboard(r, players);
    const suggestions = suggestPrizes(board, r, { oneWinPerPlayer: true });
    expect(suggestions.map((s) => s.category)).toEqual(["best_gross", "best_stableford", "flight_winner"]);
    expect(suggestions.find((s) => s.category === "flight_winner")?.flight).toBe("B");
  });

  it("gross-only competitions have no net prize", () => {
    const r = rules({ format: "stroke_gross" });
    expect(suggestPrizes(computeLeaderboard(r, players), r).map((s) => s.category)).toEqual(["best_gross"]);
  });
});
