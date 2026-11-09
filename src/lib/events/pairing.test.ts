import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "../csv";

import {
  addMinutes,
  autoAssignPlayers,
  eventErrorToStatus,
  holdsSeat,
  planPairingGroups,
  restoredStatus,
  summarizeRegistrations,
} from "./pairing";

describe("addMinutes", () => {
  it("adds and wraps", () => {
    expect(addMinutes("07:00", 8)).toBe("07:08");
    expect(addMinutes("06:55:00", 10)).toBe("07:05");
    expect(addMinutes("23:50", 20)).toBe("00:10");
    expect(addMinutes("25:00", 1)).toBeNull();
  });
});

describe("planPairingGroups", () => {
  it("builds tee-time groups from hole 1", () => {
    const result = planPairingGroups({
      firstTeeTime: "07:00",
      groupSize: 4,
      intervalMinutes: 8,
      mode: "tee_times",
      playerCount: 10,
    });
    expect(result).toEqual({
      items: [
        { capacity: 4, group_no: 1, start_hole: 1, tee_time: "07:00" },
        { capacity: 4, group_no: 2, start_hole: 1, tee_time: "07:08" },
        { capacity: 4, group_no: 3, start_hole: 1, tee_time: "07:16" },
      ],
    });
  });

  it("alternates 1/10 on a split tee", () => {
    const result = planPairingGroups({
      firstTeeTime: "07:00",
      groupSize: 4,
      intervalMinutes: 10,
      mode: "tee_times",
      playerCount: 13,
      splitTee: true,
      startingGroupNo: 5,
    });
    expect("items" in result && result.items.map((g) => [g.group_no, g.start_hole, g.tee_time])).toEqual([
      [5, 1, "07:00"],
      [6, 10, "07:00"],
      [7, 1, "07:10"],
      [8, 10, "07:10"],
    ]);
  });

  it("puts shotgun groups on separate holes, doubling past 18", () => {
    const result = planPairingGroups({
      firstTeeTime: "12:00",
      groupSize: 4,
      intervalMinutes: 0,
      mode: "shotgun",
      playerCount: 80,
    });
    expect("items" in result).toBe(true);
    if ("items" in result) {
      expect(result.items).toHaveLength(20);
      expect(new Set(result.items.map((g) => g.tee_time))).toEqual(new Set(["12:00"]));
      expect(result.items[17].start_hole).toBe(18);
      expect(result.items[18].start_hole).toBe(1);
    }
  });

  it("rejects bad input", () => {
    const base = { firstTeeTime: "07:00", groupSize: 4, intervalMinutes: 8, mode: "tee_times" as const, playerCount: 4 };
    expect(planPairingGroups({ ...base, groupSize: 0 })).toEqual({ error: "invalid-group-size" });
    expect(planPairingGroups({ ...base, playerCount: 0 })).toEqual({ error: "no-players" });
    expect(planPairingGroups({ ...base, firstTeeTime: "7am" })).toEqual({ error: "invalid-tee-time" });
    expect(planPairingGroups({ ...base, intervalMinutes: 0 })).toEqual({ error: "invalid-interval" });
    expect(planPairingGroups({ ...base, playerCount: 1000 })).toEqual({ error: "too-many-groups" });
  });
});

const players = [
  { createdAt: "2026-01-01T00:00:05Z", handicap: 20, id: "p20" },
  { createdAt: "2026-01-01T00:00:01Z", handicap: 5, id: "p5" },
  { createdAt: "2026-01-01T00:00:03Z", handicap: null, id: "pnull" },
  { createdAt: "2026-01-01T00:00:02Z", handicap: 12, id: "p12" },
  { createdAt: "2026-01-01T00:00:04Z", handicap: 30, id: "p30" },
  { createdAt: "2026-01-01T00:00:06Z", handicap: 8, id: "p8" },
];

const groups = [
  { capacity: 3, groupNo: 2, id: "g2", occupied: 0 },
  { capacity: 3, groupNo: 1, id: "g1", occupied: 0 },
];

function membersOf(assignments: { groupId: string; registrationId: string }[], groupId: string) {
  return assignments.filter((a) => a.groupId === groupId).map((a) => a.registrationId);
}

describe("autoAssignPlayers", () => {
  it("groups by registration order", () => {
    const { assignments, overflow } = autoAssignPlayers(players, groups, "registration");
    expect(membersOf(assignments, "g1")).toEqual(["p5", "p12", "pnull"]);
    expect(membersOf(assignments, "g2")).toEqual(["p30", "p20", "p8"]);
    expect(overflow).toEqual([]);
  });

  it("groups similar handicaps, unknown handicap last", () => {
    const { assignments } = autoAssignPlayers(players, groups, "handicap");
    expect(membersOf(assignments, "g1")).toEqual(["p5", "p8", "p12"]);
    expect(membersOf(assignments, "g2")).toEqual(["p20", "p30", "pnull"]);
  });

  it("snake-drafts for balanced groups", () => {
    const { assignments } = autoAssignPlayers(players, groups, "balanced");
    // order 5, 8, 12, 20, 30, null -> fwd g1:5 g2:8, back g2:12 g1:20, fwd g1:30 g2:null
    expect(membersOf(assignments, "g1")).toEqual(["p5", "p20", "p30"]);
    expect(membersOf(assignments, "g2")).toEqual(["p8", "p12", "pnull"]);
  });

  it("respects occupied seats and reports overflow", () => {
    const { assignments, overflow } = autoAssignPlayers(
      players,
      [
        { capacity: 4, groupNo: 1, id: "g1", occupied: 3 },
        { capacity: 2, groupNo: 2, id: "g2", occupied: 0 },
      ],
      "balanced",
    );
    expect(assignments).toHaveLength(3);
    expect(membersOf(assignments, "g1")).toHaveLength(1);
    expect(membersOf(assignments, "g2")).toHaveLength(2);
    expect(overflow).toHaveLength(3);
  });
});

describe("seat accounting", () => {
  it("matches SQL seat statuses", () => {
    expect(["registered", "pending_payment", "payment_review", "paid", "checked_in"].every(holdsSeat)).toBe(true);
    expect(["cancelled", "no_show", "waitlist", "draft"].some(holdsSeat)).toBe(false);
  });

  it("summarizes a field", () => {
    const summary = summarizeRegistrations([
      { checked_in_at: "x", pairing_group_id: "g", status: "paid" },
      { checked_in_at: null, pairing_group_id: null, status: "pending_payment" },
      { checked_in_at: null, pairing_group_id: null, status: "waitlist" },
      { checked_in_at: null, pairing_group_id: null, status: "cancelled" },
      { checked_in_at: null, pairing_group_id: "g", status: "registered" },
    ]);
    expect(summary).toEqual({
      cancelled: 1,
      checkedIn: 1,
      confirmed: 2,
      noShow: 0,
      seats: 3,
      unpaid: 1,
      unpaired: 1,
      waitlist: 1,
    });
  });

  it("restores the right status after an undone no-show", () => {
    expect(restoredStatus({ memberPrice: 1500, paymentApproved: true })).toBe("paid");
    expect(restoredStatus({ memberPrice: 1500, paymentApproved: false })).toBe("pending_payment");
    expect(restoredStatus({ memberPrice: 0, paymentApproved: false })).toBe("registered");
  });
});

describe("eventErrorToStatus", () => {
  it("maps RPC exceptions", () => {
    expect(eventErrorToStatus("ALREADY_REGISTERED", "x")).toBe("already-registered");
    expect(eventErrorToStatus("PAIRING_GROUP_FULL", "x")).toBe("group-full");
    expect(eventErrorToStatus("boom", "fallback")).toBe("fallback");
  });
});

describe("csv", () => {
  it("quotes, guards formulas, keeps phone numbers", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+66 81 234 5678")).toBe("+66 81 234 5678");
    expect(csvCell(-3.5)).toBe("-3.5");
    expect(toCsv(["a"], [[1]])).toBe("﻿a\r\n1");
  });
});
