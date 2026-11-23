// Fixed-rule checks for a scorecard row after reading (audit step 4): every hole filled with
// 1-15 (or X = picked up), and the 9-hole / 18-hole sums equal the OUT / IN / TOTAL written on the
// card. Cells that fail are shown in the warning (orange) tone for the player to fix.

import { HOLES } from "../scoring/engine";

import { normalizeMark } from "./notation";

export const MAX_HOLE_STROKES = 15;

export type PrintedTotals = { in?: string | null; out?: string | null; total?: string | null };

export type CardCheck = {
  /** One message per hole, null when the hole is fine. */
  cellIssues: (string | null)[];
  ok: boolean;
  /** Sums of what is typed now (null when a hole in that range is empty or picked up). */
  sums: { in: number | null; out: number | null; total: number | null };
  totalIssues: { in: string | null; out: string | null; total: string | null };
};

/** "42" / "๔๒" / " 42 " -> 42; anything else -> null. */
export function parseTotal(value: string | null | undefined) {
  const mark = normalizeMark(value ?? "");
  return /^\d{1,3}$/.test(mark) ? Number(mark) : null;
}

function holeValue(raw: string) {
  const mark = normalizeMark(raw);
  if (!mark) return { kind: "empty" as const };
  if (["x", "nr", "pu", "-"].includes(mark)) return { kind: "pickup" as const };
  if (/^\d{1,2}$/.test(mark)) return { kind: "number" as const, value: Number(mark) };
  return { kind: "invalid" as const };
}

export function checkCard(values: (string | number | null | undefined)[], printed: PrintedTotals = {}): CardCheck {
  const cells = Array.from({ length: HOLES }, (_, i) => holeValue(String(values[i] ?? "")));
  const cellIssues = cells.map((cell) => {
    if (cell.kind === "empty") return "ยังไม่ได้กรอก";
    if (cell.kind === "invalid") return "ต้องเป็นตัวเลขหรือ X";
    if (cell.kind === "number" && (cell.value < 1 || cell.value > MAX_HOLE_STROKES)) return `ต้องอยู่ระหว่าง 1-${MAX_HOLE_STROKES}`;
    return null;
  });

  const sum = (from: number, to: number) => {
    let total = 0;
    for (let i = from; i < to; i += 1) {
      const cell = cells[i];
      if (cell.kind !== "number") return null;
      total += cell.value;
    }
    return total;
  };
  const sums = { in: sum(9, HOLES), out: sum(0, 9), total: sum(0, HOLES) };

  const compare = (label: string, typed: number | null, written: string | null | undefined) => {
    const card = parseTotal(written);
    if (card === null || typed === null) return null;
    return typed === card ? null : `${label} รวมได้ ${typed} แต่การ์ดเขียน ${card}`;
  };
  const totalIssues = {
    in: compare("IN", sums.in, printed.in),
    out: compare("OUT", sums.out, printed.out),
    total: compare("TOTAL", sums.total, printed.total),
  };
  // The card's own arithmetic: OUT + IN should equal TOTAL.
  const writtenOut = parseTotal(printed.out);
  const writtenIn = parseTotal(printed.in);
  const writtenTotal = parseTotal(printed.total);
  if (!totalIssues.total && writtenOut !== null && writtenIn !== null && writtenTotal !== null && writtenOut + writtenIn !== writtenTotal) {
    totalIssues.total = `OUT + IN บนการ์ด (${writtenOut + writtenIn}) ไม่เท่ากับ TOTAL ${writtenTotal}`;
  }

  return {
    cellIssues,
    ok: cellIssues.every((issue) => issue === null) && !totalIssues.out && !totalIssues.in && !totalIssues.total,
    sums,
    totalIssues,
  };
}

/** Short Thai summary for the review banner / score entry note. */
export function describeCheck(check: CardCheck) {
  const problems = [
    ...check.cellIssues.flatMap((issue, i) => (issue ? [`หลุม ${i + 1}: ${issue}`] : [])),
    ...[check.totalIssues.out, check.totalIssues.in, check.totalIssues.total].filter((issue): issue is string => Boolean(issue)),
  ];
  return problems;
}
