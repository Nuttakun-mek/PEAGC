// Deterministic interpretation of handwritten golf scorecard marks.
//
// The vision model only transcribes what is written in each cell (`raw`) and says how the
// card is written (absolute strokes vs. relative to par). Converting marks to strokes happens
// here, against the course pars, so arithmetic and symbol conventions are testable and never
// left to the model. Anything we cannot read with confidence is flagged for human review.

export type CardNotation = "absolute" | "relative";
export type Confidence = "high" | "medium" | "low";

export type CellReading = {
  /** Shape drawn around the mark, if any (circle = under par, square = over par by convention). */
  enclosure?: "none" | "circle" | "double_circle" | "square" | "double_square" | null;
  /** Model's own confidence in the transcription of `raw`. */
  confidence: Confidence;
  /** Exactly what is written in the cell, e.g. "5", "+1", "E", "/", "DB", "X", "". */
  raw: string;
};

export type InterpretedCell = {
  /** Why this cell needs a human look (empty = trusted). */
  flags: string[];
  /** Picked up / no return. Counts as 0 points in stableford; makes a stroke card incomplete. */
  pickup: boolean;
  raw: string;
  strokes: number | null;
};

const PICKUP = new Set(["x", "nr", "pu", "p/u", "pick", "pickup", "dnf", "—"]);
const PAR_MARKS = new Set(["e", "/", "✓", "✔", "p", "par", "•", "·", "0", "o", "-0", "+0"]);
const NAMED: Record<string, number> = {
  alb: -3,
  albatross: -3,
  b: -1,
  bb: 2, // "bogey bogey" is unusual; treated as double bogey but flagged below
  bird: -1,
  birdie: -1,
  bo: 1,
  bog: 1,
  bogey: 1,
  db: 2,
  dbl: 2,
  double: 2,
  ea: -2,
  eagle: -2,
  tb: 3,
  triple: 3,
};

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/** Normalise Thai digits, unicode minus/plus, whitespace and case. */
export function normalizeMark(raw: string) {
  return raw
    .trim()
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/[−–]/g, "-")
    .replace(/＋/g, "+")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function interpretCell(cell: CellReading, par: number, notation: CardNotation): InterpretedCell {
  const flags: string[] = [];
  const raw = cell.raw ?? "";
  const mark = normalizeMark(raw);
  const result = (strokes: number | null, pickup = false): InterpretedCell => {
    if (cell.confidence !== "high") flags.push(cell.confidence === "low" ? "อ่านไม่ชัด" : "ควรตรวจซ้ำ");
    if (strokes !== null && (strokes < 1 || strokes > 20)) {
      flags.push("ค่าผิดปกติ");
      return { flags, pickup, raw, strokes: null };
    }
    if (strokes !== null && cell.enclosure) {
      // Circles mean under par and squares over par; disagreement suggests a misread digit.
      const diff = strokes - par;
      const circled = cell.enclosure === "circle" || cell.enclosure === "double_circle";
      const squared = cell.enclosure === "square" || cell.enclosure === "double_square";
      if ((circled && diff >= 0) || (squared && diff <= 0)) flags.push("สัญลักษณ์ไม่ตรงกับตัวเลข");
    }
    return { flags, pickup, raw, strokes };
  };

  if (!mark) {
    flags.push("ช่องว่าง");
    return { flags, pickup: false, raw, strokes: null };
  }
  if (PICKUP.has(mark) || (notation === "absolute" && mark === "-")) {
    flags.push("เก็บลูก/ไม่จบหลุม");
    return result(null, true);
  }

  // Pure number: absolute card -> strokes; relative card -> par + n.
  if (/^[+-]?\d{1,2}$/.test(mark)) {
    const value = Number(mark);
    const signed = /^[+-]/.test(mark);
    if (notation === "relative" || signed) {
      if (notation === "absolute" && signed) flags.push("เขียนแบบเทียบพาร์บนการ์ดแบบนับสโตรก");
      return result(par + value);
    }
    return result(value);
  }

  if (PAR_MARKS.has(mark) || (notation === "relative" && mark === "-")) {
    return result(par);
  }

  const named = NAMED[mark];
  if (named !== undefined) {
    if (mark === "bb") flags.push("ตัวย่อไม่ชัดเจน");
    return result(par + named);
  }

  // A digit with stray punctuation ("5.", "(4)") - read the digits but ask a human.
  const digits = mark.match(/\d{1,2}/);
  if (digits) {
    flags.push("มีสัญลักษณ์ปน");
    return result(notation === "relative" ? par + Number(digits[0]) : Number(digits[0]));
  }

  flags.push("อ่านสัญลักษณ์ไม่ได้");
  return { flags, pickup: false, raw, strokes: null };
}

export type OcrPlayerRow = { cells: CellReading[]; name: string; nameConfidence: Confidence };

export function interpretRow(row: OcrPlayerRow, pars: number[], notation: CardNotation) {
  const cells = pars.map((par, index) =>
    interpretCell(row.cells[index] ?? { confidence: "low", raw: "" }, par, notation),
  );
  return {
    cells,
    needsReview: cells.some((cell) => cell.flags.length > 0) || row.nameConfidence !== "high",
  };
}

// ---------- matching card rows to registered players ----------

const TITLES = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss|คุณ|โปร)\s*/i;

export function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(TITLES, "").replace(/[\s.()\-_'"]/g, "");
}

function bigrams(text: string) {
  const grams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const gram = text.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice similarity on character bigrams (works for Thai and Latin script). */
export function nameSimilarity(a: string, b: string) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let overlap = 0;
  for (const [gram, count] of gx) overlap += Math.min(count, gy.get(gram) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

export type RosterEntry = { id: string; names: string[] };

/**
 * Greedy one-to-one matching of card names to roster players by best similarity.
 * Returns roster id (or null when nothing clears `threshold`) for each card row.
 */
export function matchRows(cardNames: string[], roster: RosterEntry[], threshold = 0.5) {
  const pairs: { row: number; id: string; score: number }[] = [];
  cardNames.forEach((name, row) => {
    for (const entry of roster) {
      const score = Math.max(...entry.names.map((candidate) => nameSimilarity(name, candidate)), 0);
      if (score >= threshold) pairs.push({ id: entry.id, row, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const result: { id: string | null; score: number }[] = cardNames.map(() => ({ id: null, score: 0 }));
  const usedIds = new Set<string>();
  for (const pair of pairs) {
    if (result[pair.row].id || usedIds.has(pair.id)) continue;
    result[pair.row] = { id: pair.id, score: pair.score };
    usedIds.add(pair.id);
  }
  return result;
}
