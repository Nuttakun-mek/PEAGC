import { describe, expect, it } from "vitest";

import {
  type CompetitionRules,
  computeLeaderboard,
  defaultPeoriaHoles,
  defaultRules,
  doublePeoriaHandicap,
  parseRules,
  playingHandicap,
  sanitizeStrokes,
  scorePlayer,
  stablefordPoints,
  strokesReceived,
  system36Points,
  validateRules,
} from "./engine";

const pars = defaultRules.pars; // front 36, back 36
const plus = (offsets: Record<number, number>, base = 0) => pars.map((par, i) => par + base + (offsets[i + 1] ?? 0));
const rules = (overrides: Partial<CompetitionRules> = {}): CompetitionRules => ({ ...defaultRules, ...overrides });

describe("handicap", () => {
  it("rounds the allowance", () => {
    expect(playingHandicap(18.4, 100)).toBe(18);
    expect(playingHandicap(20, 85)).toBe(17);
    expect(playingHandicap(null, 100)).toBe(0);
    expect(playingHandicap(-2.4, 100)).toBe(-2);
  });

  it("allocates strokes by stroke index", () => {
    const received = strokesReceived(20, defaultRules.strokeIndex);
    expect(received.reduce((a, b) => a + b, 0)).toBe(20);
    expect(received[defaultRules.strokeIndex.indexOf(1)]).toBe(2);
    expect(received[defaultRules.strokeIndex.indexOf(2)]).toBe(2);
    expect(received[defaultRules.strokeIndex.indexOf(3)]).toBe(1);

    const plusHcp = strokesReceived(-2, defaultRules.strokeIndex);
    expect(plusHcp.reduce((a, b) => a + b, 0)).toBe(-2);
    expect(plusHcp[defaultRules.strokeIndex.indexOf(18)]).toBe(-1);
    expect(plusHcp[defaultRules.strokeIndex.indexOf(17)]).toBe(-1);
    expect(plusHcp[defaultRules.strokeIndex.indexOf(1)]).toBe(0);
  });
});

describe("hole points", () => {
  it("stableford", () => {
    expect(stablefordPoints(5, 4, 1)).toBe(2);
    expect(stablefordPoints(3, 4, 1)).toBe(4);
    expect(stablefordPoints(8, 4, 0)).toBe(0);
  });

  it("system 36", () => {
    expect(system36Points(3, 4)).toBe(2);
    expect(system36Points(4, 4)).toBe(2);
    expect(system36Points(5, 4)).toBe(1);
    expect(system36Points(6, 4)).toBe(0);
  });

  it("system 36 handicap = 36 - points", () => {
    const result = scorePlayer(rules({ format: "system36" }), { handicapIndex: null, id: "a", name: "A", strokes: plus({}, 1) });
    expect(result.points).toBe(18);
    expect(result.s36Handicap).toBe(18);
    expect(result.gross).toBe(90);
    expect(result.net).toBe(72);
  });
});

describe("leaderboard", () => {
  it("breaks a net tie on back nine with prorated handicap", () => {
    // A: hcp 10, +1 on holes 1-10 -> gross 82, net 72, back9 37 - 5 = 32
    // B: hcp 20, +1 everywhere and +2 more on hole 1 -> gross 92, net 72, back9 45 - 10 = 35
    const board = computeLeaderboard(rules(), [
      { handicapIndex: 20, id: "b", name: "B", strokes: plus({ 1: 2 }, 1) },
      { handicapIndex: 10, id: "a", name: "A", strokes: plus({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 }) },
    ]);
    expect(board.overall.map((p) => [p.id, p.net, p.rank, p.tieBreak])).toEqual([
      ["a", 72, 1, null],
      ["b", 72, 2, "9 หลุมหลัง"],
    ]);
  });

  it("shares rank when countback cannot separate, then skips", () => {
    const card = plus({ 3: 1 });
    const board = computeLeaderboard(rules({ format: "stroke_gross" }), [
      { handicapIndex: 5, id: "c", name: "C", strokes: card },
      { handicapIndex: 5, id: "d", name: "D", strokes: card },
      { handicapIndex: 5, id: "e", name: "E", strokes: plus({ 3: 2 }) },
    ]);
    expect(board.overall.map((p) => p.rank)).toEqual([1, 1, 3]);
  });

  it("puts incomplete cards last and unranked", () => {
    const partial = plus({});
    partial[17] = Number.NaN;
    const board = computeLeaderboard(rules({ format: "stroke_gross" }), [
      { handicapIndex: 0, id: "x", name: "X", strokes: [...pars.slice(0, 17), null] },
      { handicapIndex: 0, id: "y", name: "Y", strokes: plus({}, 2) },
    ]);
    expect(board.overall.map((p) => [p.id, p.rank, p.complete, p.holesPlayed])).toEqual([
      ["y", 1, true, 18],
      ["x", null, false, 17],
    ]);
  });

  it("scores a stableford pickup as 0 points but keeps the card complete", () => {
    const strokes: (number | null)[] = plus({}, 1);
    strokes[0] = null;
    const pickups = strokes.map((value) => value === null);
    const stableford = computeLeaderboard(rules({ format: "stableford" }), [{ handicapIndex: 0, id: "p", name: "P", pickups, strokes }]);
    expect(stableford.overall[0]).toMatchObject({ complete: true, gross: null, points: 17, rank: 1 });
    const stroke = computeLeaderboard(rules({ format: "stroke_net" }), [{ handicapIndex: 0, id: "p", name: "P", pickups, strokes }]);
    expect(stroke.overall[0]).toMatchObject({ complete: false, rank: null });
  });

  it("ranks stableford by most points", () => {
    const board = computeLeaderboard(rules({ format: "stableford" }), [
      { handicapIndex: 0, id: "low", name: "Low", strokes: plus({}, 1) }, // 18 pts
      { handicapIndex: 18, id: "high", name: "High", strokes: plus({}, 1) }, // 36 pts
    ]);
    expect(board.overall.map((p) => [p.id, p.points, p.rank])).toEqual([
      ["high", 36, 1],
      ["low", 18, 2],
    ]);
  });

  it("splits flights and ranks within each", () => {
    const flighted = rules({
      flights: [
        { maxHandicap: 12, minHandicap: 0, name: "A" },
        { maxHandicap: 24, minHandicap: 12.1, name: "B" },
      ],
    });
    const board = computeLeaderboard(flighted, [
      { handicapIndex: 8, id: "a1", name: "A1", strokes: plus({}, 1) }, // net 82
      { handicapIndex: 10, id: "a2", name: "A2", strokes: plus({}, 0) }, // net 62
      { handicapIndex: 20, id: "b1", name: "B1", strokes: plus({}, 1) }, // net 70
      { handicapIndex: 30, id: "out", name: "Out", strokes: plus({}, 1) },
      { handicapIndex: null, id: "none", name: "None", strokes: plus({}, 1) },
    ]);
    expect(board.flights.map((f) => [f.name, f.players.map((p) => [p.id, p.flightRank])])).toEqual([
      ["A", [["a2", 1], ["a1", 2]]],
      ["B", [["b1", 1]]],
      ["ไม่มีแต้มต่อ", [["none", 1]]],
      ["นอกไฟลท์", [["out", 1]]],
    ]);
    expect(board.overall.find((p) => p.id === "b1")?.flight).toBe("B");
  });
});

describe("rules", () => {
  it("validates", () => {
    expect(validateRules(defaultRules)).toEqual([]);
    const bad = validateRules({
      ...defaultRules,
      flights: [
        { maxHandicap: 15, minHandicap: 0, name: "A" },
        { maxHandicap: 30, minHandicap: 10, name: "B" },
      ],
      handicapAllowance: 120,
      pars: [...defaultRules.pars.slice(0, 17), 7],
      strokeIndex: [...defaultRules.strokeIndex.slice(0, 17), 1],
    });
    expect(bad).toHaveLength(4);
  });

  it("parses stored JSON defensively", () => {
    expect(parseRules(null)).toEqual(defaultRules);
    expect(parseRules({ format: "stableford", handicapAllowance: "85" }).handicapAllowance).toBe(85);
  });

  it("sanitizes typed strokes", () => {
    const result = sanitizeStrokes(["4", "", null, "0", "21", 5]);
    expect(result.slice(0, 6)).toEqual([4, null, null, Number.NaN, Number.NaN, 5]);
    expect(result).toHaveLength(18);
  });
});

describe("handicap sources", () => {
  it("old rules default to the club handicap; a system36 format means the System 36 method", () => {
    expect(parseRules({ format: "stroke_net" }).handicapSource).toBe("club");
    expect(parseRules({ format: "system36" }).handicapSource).toBe("system36");
    expect(parseRules({ format: "stroke_net", handicapSource: "system36" }).format).toBe("system36");
  });

  it("turns an index into a course handicap when the tee is rated", () => {
    const rated = rules({ courseRating: 70.1, slopeRating: 130 });
    // 18.0 x 130 / 113 + (70.1 - 72) = 18.81 -> 19
    expect(scorePlayer(rated, { handicapIndex: 18, id: "a", name: "A", strokes: plus({}, 1) }).playingHandicap).toBe(19);
    expect(scorePlayer(rules(), { handicapIndex: 18, id: "a", name: "A", strokes: plus({}, 1) }).playingHandicap).toBe(18);
  });

  it("none: net equals gross", () => {
    const result = scorePlayer(rules({ handicapSource: "none" }), { handicapIndex: 18, id: "a", name: "A", strokes: plus({}, 1) });
    expect(result.playingHandicap).toBe(0);
    expect(result.net).toBe(90);
  });

  it("double peoria: (hidden x 1.5 - par) x 0.8, capped per hole at double par and overall at the max", () => {
    const hidden = defaultPeoriaHoles(defaultRules.pars);
    expect(hidden).toHaveLength(12);
    // bogey on every hole: hidden 12 holes = par 48 + 12 = 60 -> (90 - 72) x 0.8 = 14.4
    expect(doublePeoriaHandicap(plus({}, 1), [], defaultRules.pars, hidden)).toBe(14.4);
    // a 12 on a hidden par 4 counts as 8
    const blowUp = plus({}, 1);
    blowUp[hidden[0] - 1] = 12;
    const capped = defaultRules.pars[hidden[0] - 1] * 2;
    expect(doublePeoriaHandicap(blowUp, [], defaultRules.pars, hidden)).toBe(Math.round(((60 - (defaultRules.pars[hidden[0] - 1] + 1) + capped) * 1.5 - 72) * 0.8 * 10) / 10);
    expect(doublePeoriaHandicap(plus({}, 4), [], defaultRules.pars, hidden, 36)).toBe(36);
    expect(doublePeoriaHandicap(plus({}, -1), [], defaultRules.pars, hidden)).toBe(0);

    const result = scorePlayer(rules({ handicapSource: "double_peoria", peoriaHoles: hidden }), { handicapIndex: 30, id: "a", name: "A", strokes: plus({}, 1) });
    expect(result.cardHandicap).toBe(14.4);
    expect(result.net).toBe(75.6);
    expect(result.playingHandicap).toBe(0);
  });

  it("validates hidden holes", () => {
    expect(validateRules(rules({ handicapSource: "double_peoria", peoriaHoles: [1, 2, 3] }))).toContain("Double Peoria ต้องเลือกหลุมซ่อน 12 หลุม ไม่ซ้ำกัน");
  });
});
