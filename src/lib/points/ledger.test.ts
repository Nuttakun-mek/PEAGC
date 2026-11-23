import { describe, expect, it } from "vitest";

import { type PointTxn, computePointLedger, expiringWithin, nextExpiry } from "./ledger";

let seq = 0;
function txn(created: string, delta: number, reason = delta > 0 ? "attend_lesson" : "redemption", extra: Partial<PointTxn> = {}): PointTxn {
  seq += 1;
  const createdAt = new Date(created).toISOString();
  const expires = new Date(created);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return {
    created_at: createdAt,
    delta,
    expires_at: delta > 0 ? expires.toISOString() : null,
    id: extra.id ?? `t${seq}`,
    reason,
    source_id: null,
    source_type: null,
    ...extra,
  };
}

describe("points FIFO ledger", () => {
  it("expires the unused part of the oldest lot first", () => {
    const rows = [txn("2025-01-10", 30, "event_checkin", { id: "a" }), txn("2025-06-01", 10, "attend_lesson", { id: "b" }), txn("2025-07-01", -20)];
    const ledger = computePointLedger(rows, new Date("2026-02-01"));
    // the 20 spent came from lot a (oldest): 10 of a is left and expired on 2026-01-10
    expect(ledger.dueExpiries).toEqual([{ amount: 10, lotId: "a" }]);
    expect(ledger.balance).toBe(10);
  });

  it("does not let an expired lot pay for a later spend", () => {
    const rows = [txn("2025-01-01", 10, "attend_lesson", { id: "a" }), txn("2025-12-01", 10, "attend_lesson", { id: "b" }), txn("2026-02-01", -5)];
    const ledger = computePointLedger(rows, new Date("2026-03-01"));
    expect(ledger.dueExpiries).toEqual([{ amount: 10, lotId: "a" }]);
    expect(ledger.lots.find((lot) => lot.id === "b")?.remaining).toBe(5);
    expect(ledger.balance).toBe(5);
  });

  it("is idempotent once the expiry row is written", () => {
    const rows = [
      txn("2025-01-10", 30, "event_checkin", { id: "a" }),
      txn("2025-07-01", -20),
      txn("2026-01-11", -10, "expiry", { source_id: "a", source_type: "point_txn" }),
    ];
    const ledger = computePointLedger(rows, new Date("2026-02-01"));
    expect(ledger.dueExpiries).toEqual([]);
    expect(ledger.balance).toBe(0);
  });

  it("carries a no-show debt into the next lot, so it never expires twice", () => {
    const rows = [txn("2025-01-01", -10, "no_show"), txn("2025-02-01", 10, "attend_lesson", { id: "a" }), txn("2025-03-01", 30, "event_checkin", { id: "b" })];
    const ledger = computePointLedger(rows, new Date("2026-02-15"));
    expect(ledger.debt).toBe(0);
    expect(ledger.dueExpiries).toEqual([]);
    expect(ledger.balance).toBe(30);
  });

  it("reports points expiring soon and the next expiry", () => {
    const rows = [txn("2025-12-10", 10, "attend_lesson", { id: "a" }), txn("2026-05-01", 30, "event_checkin", { id: "b" })];
    const now = new Date("2026-11-23");
    const ledger = computePointLedger(rows, now);
    expect(expiringWithin(ledger, now, 30)).toBe(10);
    expect(expiringWithin(ledger, now, 10)).toBe(0);
    expect(nextExpiry(ledger)).toEqual({ amount: 10, expiresAt: rows[0].expires_at });
  });

  it("handles an empty ledger", () => {
    const ledger = computePointLedger([], new Date());
    expect(ledger).toEqual({ balance: 0, debt: 0, dueExpiries: [], lots: [] });
    expect(nextExpiry(ledger)).toBeNull();
  });
});
