/**
 * แต้มสะสม ledger maths. The database stores append-only rows (point_txns); the balance is the
 * sum of `delta`. Every positive row is a "lot" that expires 12 months after it was earned.
 *
 * Spending is first-in-first-out: a negative row (redemption, no-show, deduction) at time t uses
 * the oldest lot that is still open at t. Spending more than is open becomes a debt that the next
 * lots pay off first. When a lot reaches its expiry, whatever is left of it expires — the daily job
 * writes that as an 'expiry' row pointing at the lot (source_type 'point_txn', source_id = lot id),
 * so running the job twice never expires the same lot twice.
 */

export type PointTxn = {
  created_at: string;
  delta: number;
  expires_at: string | null;
  id: string;
  reason: string;
  source_id: string | null;
  source_type: string | null;
};

export type PointLot = {
  amount: number;
  createdAt: string;
  expiresAt: string;
  id: string;
  /** Points still usable (open lots) or left when the lot closed (expired lots). */
  remaining: number;
  /** True once `expiresAt` has passed at the evaluation time. */
  closed: boolean;
  /** An 'expiry' row already exists for this lot. */
  expiryWritten: boolean;
};

export type PointLedger = {
  /** Sum of every row minus the expiries that are due but not written yet. */
  balance: number;
  debt: number;
  /** Expiry rows the daily job should write now. */
  dueExpiries: { amount: number; lotId: string }[];
  lots: PointLot[];
};

export const EXPIRY_SOURCE_TYPE = "point_txn";

function time(value: string) {
  return new Date(value).getTime();
}

export function computePointLedger(txns: PointTxn[], now: Date = new Date()): PointLedger {
  const nowMs = now.getTime();
  const expiryRows = new Map<string, number>();
  for (const txn of txns) {
    if (txn.reason === "expiry" && txn.source_type === EXPIRY_SOURCE_TYPE && txn.source_id) {
      expiryRows.set(txn.source_id, (expiryRows.get(txn.source_id) ?? 0) + Math.abs(txn.delta));
    }
  }

  // Positive rows first on the same instant so a lot earned with a spend in one transaction is usable.
  const ordered = [...txns].sort((a, b) => time(a.created_at) - time(b.created_at) || b.delta - a.delta || a.id.localeCompare(b.id));

  const lots: PointLot[] = [];
  let debt = 0;

  const isOpenAt = (lot: PointLot, at: number) => time(lot.expiresAt) > at;

  for (const txn of ordered) {
    if (txn.reason === "expiry" && txn.source_type === EXPIRY_SOURCE_TYPE) continue;
    const at = time(txn.created_at);
    if (txn.delta > 0) {
      const expiresAt = txn.expires_at ?? new Date(at + 365 * 86_400_000).toISOString();
      let remaining = txn.delta;
      const payoff = Math.min(debt, remaining);
      debt -= payoff;
      remaining -= payoff;
      lots.push({ amount: txn.delta, closed: false, createdAt: txn.created_at, expiresAt, expiryWritten: expiryRows.has(txn.id), id: txn.id, remaining });
      continue;
    }
    let need = -txn.delta;
    for (const lot of lots) {
      if (need === 0) break;
      if (lot.remaining === 0 || !isOpenAt(lot, at)) continue;
      const used = Math.min(lot.remaining, need);
      lot.remaining -= used;
      need -= used;
    }
    debt += need;
  }

  const dueExpiries: PointLedger["dueExpiries"] = [];
  for (const lot of lots) {
    lot.closed = !isOpenAt(lot, nowMs);
    if (lot.closed && !lot.expiryWritten && lot.remaining > 0) {
      dueExpiries.push({ amount: lot.remaining, lotId: lot.id });
    }
  }

  const total = txns.reduce((sum, txn) => sum + txn.delta, 0);
  const pending = dueExpiries.reduce((sum, item) => sum + item.amount, 0);
  return { balance: total - pending, debt, dueExpiries, lots };
}

/** Points that will expire within `days` from `now` unless spent first. */
export function expiringWithin(ledger: PointLedger, now: Date, days: number) {
  const limit = now.getTime() + days * 86_400_000;
  return ledger.lots
    .filter((lot) => !lot.closed && lot.remaining > 0 && time(lot.expiresAt) <= limit)
    .reduce((sum, lot) => sum + lot.remaining, 0);
}

/** Earliest expiry among the open lots that still hold points. */
export function nextExpiry(ledger: PointLedger) {
  const open = ledger.lots.filter((lot) => !lot.closed && lot.remaining > 0).sort((a, b) => time(a.expiresAt) - time(b.expiresAt));
  return open[0] ? { amount: open[0].remaining, expiresAt: open[0].expiresAt } : null;
}
