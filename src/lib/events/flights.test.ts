import { describe, expect, it } from "vitest";

import { chunkGroups, evenSizes, planFlightGroups, splitIntoFlights } from "./flights";

const players = (handicaps: (number | null)[]) => handicaps.map((handicap, i) => ({ handicap, id: `p${i + 1}` }));

describe("flight grouping", () => {
  it("even group sizes, never a lonely single when avoidable", () => {
    expect(evenSizes(9, 3)).toEqual([3, 3, 3]);
    expect(chunkGroups([1, 2, 3, 4, 5, 6, 7, 8, 9], 4).map((g) => g.length)).toEqual([3, 3, 3]);
    expect(chunkGroups([1, 2, 3, 4, 5, 6, 7, 8], 4).map((g) => g.length)).toEqual([4, 4]);
    expect(chunkGroups([1, 2, 3, 4, 5, 6, 7], 4).map((g) => g.length)).toEqual([4, 3]);
    expect(chunkGroups([], 4)).toEqual([]);
  });

  it("thirds: lowest handicaps in A, no handicap last", () => {
    const flights = splitIntoFlights(players([20, 5, null, 12, 30, 8, 15, 25, 1]), { mode: "thirds" });
    expect(flights.map((f) => [f.name, f.players.map((p) => p.handicap)])).toEqual([
      ["A", [1, 5, 8]],
      ["B", [12, 15, 20]],
      ["C", [25, 30, null]],
    ]);
  });

  it("ranges: club-defined handicap ranges", () => {
    const flights = splitIntoFlights(players([3, 14, 25, null, 40]), {
      mode: "ranges",
      ranges: [
        { maxHandicap: 12, minHandicap: 0, name: "A" },
        { maxHandicap: 20, minHandicap: 12.1, name: "B" },
        { maxHandicap: 36, minHandicap: 20.1, name: "C" },
      ],
    });
    expect(flights.map((f) => [f.name, f.players.map((p) => p.id)])).toEqual([
      ["A", ["p1"]],
      ["B", ["p2"]],
      ["C", ["p3"]],
      ["ไม่มีแต้มต่อ", ["p4"]],
      ["นอกไฟลท์", ["p5"]],
    ]);
  });

  it("plans groups of four within each flight in tee order", () => {
    const plan = planFlightGroups(players([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]), {
      groupSize: 4,
      mode: "thirds",
    });
    // 22 players -> flights 8 / 7 / 7 -> groups 4+4, 4+3, 4+3
    expect(plan.map((g) => [g.flight, g.registrationIds.length])).toEqual([
      ["A", 4], ["A", 4], ["B", 4], ["B", 3], ["C", 4], ["C", 3],
    ]);
    expect(plan[0].registrationIds).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("single flight just groups by handicap", () => {
    const plan = planFlightGroups(players([10, 2, 7, 1, 30]), { groupSize: 4, mode: "single" });
    expect(plan.map((g) => g.registrationIds)).toEqual([["p4", "p2", "p3"], ["p1", "p5"]]);
  });
});
