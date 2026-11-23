import { describe, expect, it } from "vitest";

import { defaultRules } from "./engine";
import {
  type HandicapRound,
  adjustedGrossScore,
  chooseHandicap,
  computeClubHandicap,
  differentialsToUse,
  formatHandicap,
  holeCaps,
  indexFromDifferentials,
  roundTenth,
  scoreDifferential,
} from "./handicap";

const pars = defaultRules.pars; // par 72
const si = defaultRules.strokeIndex;
const card = (over: number) => pars.map((par) => par + over);

function round(id: string, date: string, strokes: (number | null)[], extra: Partial<HandicapRound> = {}): HandicapRound {
  return { courseRating: 72, date, id, pars, slopeRating: 113, strokeIndex: si, strokes, ...extra };
}

describe("score differential", () => {
  it("is 113 / slope x (adjusted gross - course rating), one decimal", () => {
    expect(scoreDifferential(90, 72, 113)).toBe(18);
    expect(scoreDifferential(85, 71.2, 125)).toBe(12.5); // 0.904 x 13.8 = 12.475
    expect(scoreDifferential(70, 71.5, 130)).toBe(-1.3); // 0.869 x -1.5 = -1.304
  });

  it("rounds half away from zero and never returns -0", () => {
    expect(roundTenth(12.45)).toBe(12.5);
    expect(roundTenth(-0.04)).toBe(0);
    expect(Object.is(roundTenth(-0.04), -0)).toBe(false);
  });
});

describe("net double bogey", () => {
  it("caps at par + 5 without a handicap", () => {
    expect(holeCaps([4, 3, 5], [1, 2, 3], null)).toEqual([9, 8, 10]);
  });

  it("caps at par + 2 + strokes received", () => {
    const caps = holeCaps(pars, si, 20);
    // SI 1 and 2 get 2 strokes, the rest 1
    expect(caps[si.indexOf(1)]).toBe(pars[si.indexOf(1)] + 4);
    expect(caps[si.indexOf(3)]).toBe(pars[si.indexOf(3)] + 3);
  });

  it("adjusts a blow-up hole and counts pickups as the cap", () => {
    const strokes = card(1);
    strokes[0] = 12; // par 4, SI 7, course handicap 18 -> cap 4 + 2 + 1 = 7
    expect(adjustedGrossScore({ courseHcp: 18, pars, strokeIndex: si, strokes })).toBe(90 - 5 + 7);

    const picked: (number | null)[] = card(1);
    picked[0] = null;
    const pickups = pars.map((_, i) => i === 0);
    expect(adjustedGrossScore({ courseHcp: 18, pars, pickups, strokeIndex: si, strokes: picked })).toBe(90 - 5 + 7);
  });

  it("fills up to 4 unplayed holes with net par and refuses fewer than 14 holes", () => {
    const strokes: (number | null)[] = card(1);
    strokes[16] = null;
    strokes[17] = null;
    // course handicap 0: unplayed holes count as par
    expect(adjustedGrossScore({ courseHcp: 0, pars, strokeIndex: si, strokes })).toBe(88);
    const short = card(1).map((value, i) => (i < 13 ? value : null));
    expect(adjustedGrossScore({ courseHcp: 0, pars, strokeIndex: si, strokes: short })).toBeNull();
  });
});

describe("WHS small-sample table", () => {
  it.each([
    [2, null],
    [3, { adjustment: -2, use: 1 }],
    [4, { adjustment: -1, use: 1 }],
    [5, { adjustment: 0, use: 1 }],
    [6, { adjustment: -1, use: 2 }],
    [8, { adjustment: 0, use: 2 }],
    [9, { adjustment: 0, use: 3 }],
    [12, { adjustment: 0, use: 4 }],
    [15, { adjustment: 0, use: 5 }],
    [17, { adjustment: 0, use: 6 }],
    [19, { adjustment: 0, use: 7 }],
    [20, { adjustment: 0, use: 8 }],
    [35, { adjustment: 0, use: 8 }],
  ])("%i rounds", (count, expected) => {
    expect(differentialsToUse(count)).toEqual(expected);
  });

  it("3 rounds: lowest minus 2", () => {
    expect(indexFromDifferentials([20, 15.4, 18])).toBe(13.4);
  });

  it("6 rounds: average of lowest 2 minus 1", () => {
    expect(indexFromDifferentials([20, 10, 12, 30, 25, 22])).toBe(10);
  });
});

describe("best 8 of the latest 20", () => {
  it("ignores rounds older than the latest 20", () => {
    // newest first: 20 rounds at 20.0, then 5 very good old rounds
    const differentials = [...Array(20).fill(20), 1, 1, 1, 1, 1];
    expect(indexFromDifferentials(differentials)).toBe(20);
  });

  it("averages the 8 lowest of 20", () => {
    const differentials = [10, 11, 12, 13, 14, 15, 16, 17, ...Array(12).fill(30)];
    expect(indexFromDifferentials(differentials)).toBe(13.5);
  });

  it("caps at 54", () => {
    expect(indexFromDifferentials([80, 90, 85])).toBe(54);
  });
});

describe("computeClubHandicap", () => {
  it("needs 3 rated rounds; unrated rounds do not count", () => {
    const rounds = [
      round("a", "2026-01-01", card(1)),
      round("b", "2026-02-01", card(1)),
      round("c", "2026-03-01", card(1), { courseRating: null }),
    ];
    const result = computeClubHandicap(rounds);
    expect(result.index).toBeNull();
    expect(result.rounds).toBe(2);
  });

  it("computes from differentials and marks the ones used", () => {
    const rounds = [
      round("a", "2026-01-01", card(1)), // 90 -> 18.0
      round("b", "2026-02-01", card(0.5).map((v, i) => (i % 2 ? Math.ceil(v) : Math.floor(v)))), // 81 -> 9.0
      round("c", "2026-03-01", card(1).map((v, i) => (i < 6 ? v - 1 : v))), // 84 -> 12.0
    ];
    const result = computeClubHandicap(rounds);
    expect(result.rounds).toBe(3);
    expect(result.differentials.map((row) => row.id)).toEqual(["c", "b", "a"]);
    expect(result.index).toBe(7); // lowest 9.0 - 2.0
    expect(result.differentials.filter((row) => row.used).map((row) => row.id)).toEqual(["b"]);
  });

  it("uses the handicap held at the time for net double bogey", () => {
    const blowUp = card(1);
    blowUp[0] = 15; // par 4 SI 7
    // no initial index: cap par + 5 = 9 -> 90 - 5 + 9 = 94
    expect(computeClubHandicap([round("x", "2026-01-01", blowUp)]).differentials[0].adjustedGross).toBe(94);
    // initial index 0 at slope 113 / CR 72 -> course handicap 0 -> cap par + 2 = 6 -> 91
    expect(computeClubHandicap([round("x", "2026-01-01", blowUp)], { initialIndex: 0 }).differentials[0].adjustedGross).toBe(91);
  });

  it("slope changes the differential", () => {
    const result = computeClubHandicap([
      round("a", "2026-01-01", card(1), { courseRating: 70, slopeRating: 130 }),
      round("b", "2026-01-02", card(1), { courseRating: 70, slopeRating: 130 }),
      round("c", "2026-01-03", card(1), { courseRating: 70, slopeRating: 130 }),
    ]);
    // 113/130 x (90 - 70) = 17.4 -> lowest 17.4 - 2 = 15.4 (later rounds capped with that index, still 90)
    expect(result.differentials[0].differential).toBe(17.4);
    expect(result.index).toBe(15.4);
  });
});

describe("chooseHandicap", () => {
  it("club falls back to the club's manual handicap, official stands alone", () => {
    expect(chooseHandicap("club", { club: 12.3, manual: 18, official: 10 })).toEqual({ basis: "club", value: 12.3 });
    expect(chooseHandicap("club", { club: null, manual: 18, official: 10 })).toEqual({ basis: "club_initial", value: 18 });
    expect(chooseHandicap("official", { club: 12.3, manual: 18, official: null })).toEqual({ basis: "none", value: null });
    expect(chooseHandicap("official", { club: 12.3, manual: 18, official: 9.9 })).toEqual({ basis: "official", value: 9.9 });
    expect(chooseHandicap("none", { club: 12.3, manual: 18, official: 9.9 }).value).toBeNull();
    expect(chooseHandicap("system36", { club: null, manual: 18, official: 9.9 }).value).toBe(18);
  });

  it("formats plus handicaps", () => {
    expect(formatHandicap(-1.5)).toBe("+1.5");
    expect(formatHandicap(12)).toBe("12.0");
    expect(formatHandicap(null)).toBe("ยังไม่มี");
  });
});
