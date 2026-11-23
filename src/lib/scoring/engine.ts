// Competition scoring engine. Pure functions only: rules arrive as data (versioned in the
// DB as JSON), so new formats/flights/allowances never need branching elsewhere.
//
// Supported formats
//   stroke_gross  lowest gross wins
//   stroke_net    lowest gross - playing handicap
//   stableford    most points, 2 + par + strokes received - strokes (min 0) per hole
//   system36      handicap = 36 - points (par or better 2, bogey 1, worse 0); lowest net wins
// Ties are broken by countback (back 9, back 6, back 3, 18th) when enabled.
//
// Which handicap a competition uses is `handicapSource`:
//   club           แต้มต่อชมรม (computed from verified rounds, see ./handicap.ts)
//   official       Handicap Index ทางการ (members.official_handicap_index)
//   system36       derived from the day's card (format "system36")
//   double_peoria  derived from 12 hidden holes of the day's card: (sum x 1.5 - par) x 0.8
//   none           no handicap (net = gross)
// With a course rating + slope (copied from the tee) an index becomes a course handicap first.

export const HOLES = 18;

export type ScoringFormat = "stroke_gross" | "stroke_net" | "stableford" | "system36";

export const formatLabels: Record<ScoringFormat, string> = {
  stableford: "สเตเบิลฟอร์ด (Stableford)",
  stroke_gross: "สโตรกเพลย์ สกอร์รวม (Gross)",
  stroke_net: "สโตรกเพลย์ สกอร์สุทธิ (Net)",
  system36: "System 36 สกอร์สุทธิ (Net)",
};

/** Formats offered in the rules form; System 36 is picked as a handicap method instead. */
export const selectableFormats: ScoringFormat[] = ["stroke_net", "stroke_gross", "stableford"];

export type HandicapSource = "club" | "official" | "system36" | "double_peoria" | "none";

export const handicapSourceLabels: Record<HandicapSource, string> = {
  club: "แต้มต่อชมรม",
  double_peoria: "Double Peoria (คิดจากสกอร์วันแข่ง)",
  none: "ไม่ใช้แต้มต่อ",
  official: "Handicap Index ทางการ",
  system36: "System 36 (คิดจากสกอร์วันแข่ง)",
};

export const handicapSources = Object.keys(handicapSourceLabels) as HandicapSource[];

export type Flight = { maxHandicap: number; minHandicap: number; name: string };

export type CompetitionRules = {
  countback: boolean;
  /** Course + tee the pars/SI/ratings were copied from (null = typed by hand). */
  courseName: string | null;
  /** WHS course rating of the tee played; with slope it turns an index into a course handicap. */
  courseRating: number | null;
  courseTeeId: string | null;
  flights: Flight[];
  format: ScoringFormat;
  /** Percentage of handicap index used as playing handicap (e.g. 100, 90, 85). */
  handicapAllowance: number;
  handicapSource: HandicapSource;
  pars: number[];
  /** Double Peoria: the 12 hidden holes (1-18) and the handicap cap. */
  peoriaHoles: number[];
  peoriaMaxHandicap: number;
  slopeRating: number | null;
  strokeIndex: number[];
  teeName: string | null;
};

const basePars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

export const defaultRules: CompetitionRules = {
  countback: true,
  courseName: null,
  courseRating: null,
  courseTeeId: null,
  flights: [],
  format: "stroke_net",
  handicapAllowance: 100,
  handicapSource: "club",
  pars: basePars,
  peoriaHoles: defaultPeoriaHoles(basePars),
  peoriaMaxHandicap: 36,
  slopeRating: null,
  strokeIndex: [7, 11, 15, 1, 5, 13, 17, 9, 3, 8, 12, 16, 2, 6, 14, 18, 10, 4],
  teeName: null,
};

/**
 * Default hidden holes for Double Peoria: per nine one par 3, one par 5 and four par 4s (par 24
 * per nine on a par-36 nine), first suitable holes in order. Organisers can change them.
 */
export function defaultPeoriaHoles(pars: number[]) {
  const holes: number[] = [];
  for (const start of [0, 9]) {
    const nine = Array.from({ length: 9 }, (_, i) => start + i);
    const want: Record<number, number> = { 3: 1, 4: 4, 5: 1 };
    const picked: number[] = [];
    for (const index of nine) {
      const par = pars[index];
      if ((want[par] ?? 0) > 0) {
        picked.push(index);
        want[par] -= 1;
      }
    }
    // Unusual layouts: fill up to 6 holes per nine with the remaining holes in order.
    for (const index of nine) {
      if (picked.length >= 6) break;
      if (!picked.includes(index)) picked.push(index);
    }
    holes.push(...picked.slice(0, 6).map((index) => index + 1));
  }
  return holes.sort((a, b) => a - b);
}

/** Card-derived handicap formats ignore the player's index for net (it may still pick a flight). */
export function usesSystem36(rules: Pick<CompetitionRules, "format" | "handicapSource">) {
  return rules.format === "system36" || rules.handicapSource === "system36";
}

export function usesDoublePeoria(rules: Pick<CompetitionRules, "format" | "handicapSource">) {
  return rules.handicapSource === "double_peoria" && !usesSystem36(rules);
}

export function validateRules(rules: CompetitionRules): string[] {
  const errors: string[] = [];
  if (!["stroke_gross", "stroke_net", "stableford", "system36"].includes(rules.format)) {
    errors.push("รูปแบบการแข่งขันไม่ถูกต้อง");
  }
  if (!handicapSources.includes(rules.handicapSource)) {
    errors.push("วิธีคิดแต้มต่อไม่ถูกต้อง");
  }
  if (usesDoublePeoria(rules)) {
    const holes = new Set(rules.peoriaHoles);
    if (rules.peoriaHoles.length !== 12 || holes.size !== 12 || rules.peoriaHoles.some((hole) => !Number.isInteger(hole) || hole < 1 || hole > HOLES)) {
      errors.push("Double Peoria ต้องเลือกหลุมซ่อน 12 หลุม ไม่ซ้ำกัน");
    }
    if (!(rules.peoriaMaxHandicap > 0 && rules.peoriaMaxHandicap <= 54)) errors.push("แต้มต่อสูงสุดต้องอยู่ระหว่าง 1-54");
  }
  if (rules.courseRating !== null && !(rules.courseRating >= 50 && rules.courseRating <= 90)) {
    errors.push("Course rating ต้องอยู่ระหว่าง 50-90");
  }
  if (rules.slopeRating !== null && !(Number.isInteger(rules.slopeRating) && rules.slopeRating >= 55 && rules.slopeRating <= 155)) {
    errors.push("Slope rating ต้องอยู่ระหว่าง 55-155");
  }
  if (rules.pars.length !== HOLES || rules.pars.some((par) => !Number.isInteger(par) || par < 3 || par > 6)) {
    errors.push("พาร์ต้องมี 18 หลุม ค่าละ 3-6");
  }
  const si = [...rules.strokeIndex].sort((a, b) => a - b);
  if (rules.strokeIndex.length !== HOLES || si.some((value, index) => value !== index + 1)) {
    errors.push("ลำดับความยาก (SI) ต้องเป็นเลข 1-18 ไม่ซ้ำกัน");
  }
  if (!(rules.handicapAllowance >= 0 && rules.handicapAllowance <= 100)) {
    errors.push("สัดส่วนแต้มต่อต้องอยู่ระหว่าง 0-100%");
  }
  const flights = [...rules.flights].sort((a, b) => a.minHandicap - b.minHandicap);
  flights.forEach((flight, index) => {
    if (!flight.name.trim()) errors.push("ไฟลท์ต้องมีชื่อ");
    if (flight.maxHandicap < flight.minHandicap) errors.push(`ไฟลท์ ${flight.name}: ช่วงแต้มต่อไม่ถูกต้อง`);
    const next = flights[index + 1];
    if (next && next.minHandicap <= flight.maxHandicap) errors.push(`ไฟลท์ ${flight.name} กับ ${next.name} ช่วงแต้มต่อทับกัน`);
  });
  return errors;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Coerce stored JSON into rules, falling back to defaults field by field. */
export function parseRules(value: unknown): CompetitionRules {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<CompetitionRules>;
  const format = (raw.format as ScoringFormat) ?? defaultRules.format;
  const pars = Array.isArray(raw.pars) && raw.pars.length === HOLES ? raw.pars.map(Number) : [...defaultRules.pars];
  // Older rules have no handicapSource: they used the member's handicap, which is what the club
  // handicap falls back to; a "system36" format always means the System 36 method.
  let handicapSource: HandicapSource = handicapSources.includes(raw.handicapSource as HandicapSource)
    ? (raw.handicapSource as HandicapSource)
    : "club";
  if (format === "system36") handicapSource = "system36";
  return {
    countback: typeof raw.countback === "boolean" ? raw.countback : defaultRules.countback,
    courseName: textOrNull(raw.courseName),
    courseRating: numberOrNull(raw.courseRating),
    courseTeeId: textOrNull(raw.courseTeeId),
    flights: Array.isArray(raw.flights)
      ? raw.flights
          .filter((f): f is Flight => Boolean(f) && typeof f === "object")
          .map((f) => ({ maxHandicap: Number(f.maxHandicap), minHandicap: Number(f.minHandicap), name: String(f.name ?? "") }))
      : [],
    format: handicapSource === "system36" ? "system36" : format,
    handicapAllowance: Number.isFinite(Number(raw.handicapAllowance)) ? Number(raw.handicapAllowance) : 100,
    handicapSource,
    pars,
    peoriaHoles:
      Array.isArray(raw.peoriaHoles) && raw.peoriaHoles.length === 12 ? raw.peoriaHoles.map(Number) : defaultPeoriaHoles(pars),
    peoriaMaxHandicap: numberOrNull(raw.peoriaMaxHandicap) ?? defaultRules.peoriaMaxHandicap,
    slopeRating: numberOrNull(raw.slopeRating),
    strokeIndex:
      Array.isArray(raw.strokeIndex) && raw.strokeIndex.length === HOLES ? raw.strokeIndex.map(Number) : [...defaultRules.strokeIndex],
    teeName: textOrNull(raw.teeName),
  };
}

// ---------- handicap ----------

export function playingHandicap(handicapIndex: number | null | undefined, allowance: number) {
  if (handicapIndex === null || handicapIndex === undefined || !Number.isFinite(handicapIndex)) return 0;
  return Math.round((handicapIndex * allowance) / 100);
}

/** WHS course handicap: index x slope / 113 + (course rating - par), rounded. */
export function courseHandicap(handicapIndex: number, slopeRating: number, courseRating: number, par: number) {
  return Math.round((handicapIndex * slopeRating) / 113 + (courseRating - par));
}

/**
 * Playing handicap for an index under these rules: course handicap first when the competition has
 * a rated tee, then the allowance. Card-derived methods and "none" give 0 here.
 */
export function playingHandicapFor(rules: CompetitionRules, handicapIndex: number | null | undefined) {
  if (rules.handicapSource === "none" || usesSystem36(rules) || usesDoublePeoria(rules)) return 0;
  if (handicapIndex === null || handicapIndex === undefined || !Number.isFinite(handicapIndex)) return 0;
  if (rules.courseRating !== null && rules.slopeRating !== null) {
    const par = rules.pars.reduce((sum, value) => sum + value, 0);
    return Math.round((courseHandicap(handicapIndex, rules.slopeRating, rules.courseRating, par) * rules.handicapAllowance) / 100);
  }
  return playingHandicap(handicapIndex, rules.handicapAllowance);
}

/**
 * Double Peoria handicap from the 12 hidden holes: (strokes x 1.5 - course par) x 0.8, each hidden
 * hole counted at most double par, clamped to 0..max, one decimal. Null until every hidden hole has
 * a score (a pickup counts as double par).
 */
export function doublePeoriaHandicap(
  strokes: (number | null)[],
  pickups: boolean[],
  pars: number[],
  hiddenHoles: number[],
  maxHandicap = 36,
) {
  let sum = 0;
  for (const hole of hiddenHoles) {
    const index = hole - 1;
    const par = pars[index];
    const value = strokes[index];
    if (value === null || value === undefined) {
      if (!pickups[index]) return null;
      sum += par * 2;
    } else {
      sum += Math.min(value, par * 2);
    }
  }
  const coursePar = pars.reduce((total, value) => total + value, 0);
  const raw = (sum * 1.5 - coursePar) * 0.8;
  return Math.round(Math.min(maxHandicap, Math.max(0, raw)) * 10) / 10;
}

/** Strokes received on each hole for a playing handicap (negative = plus handicap gives back). */
export function strokesReceived(playing: number, strokeIndex: number[]) {
  const magnitude = Math.abs(playing);
  const base = Math.floor(magnitude / HOLES);
  const extra = magnitude % HOLES;
  return strokeIndex.map((si) => {
    if (playing >= 0) return base + (si <= extra ? 1 : 0);
    // plus handicaps give strokes back starting from the easiest hole (SI 18)
    const back = base + (si > HOLES - extra ? 1 : 0);
    return back === 0 ? 0 : -back; // avoid -0 leaking into displays/exports
  });
}

export function stablefordPoints(strokes: number, par: number, received: number) {
  return Math.max(0, 2 + par + received - strokes);
}

export function system36Points(strokes: number, par: number) {
  if (strokes <= par) return 2;
  if (strokes === par + 1) return 1;
  return 0;
}

// ---------- results ----------

export type PlayerInput = {
  handicapIndex: number | null;
  id: string;
  name: string;
  /** Hole picked up / no return. Legal in stableford (0 points); makes stroke cards incomplete. */
  pickups?: boolean[];
  strokes: (number | null)[];
};

export type PlayerResult = {
  /** Handicap worked out from the day's card (System 36 / Double Peoria), else null. */
  cardHandicap?: number | null;
  complete: boolean;
  flight: string;
  flightRank: number | null;
  gross: number | null;
  handicapIndex: number | null;
  holePoints: (number | null)[];
  holesPlayed: number;
  id: string;
  name: string;
  /** Net for stroke_net (gross - playing) and system36 (gross - s36 handicap). */
  net: number | null;
  playingHandicap: number;
  points: number | null;
  rank: number | null;
  s36Handicap: number | null;
  strokes: (number | null)[];
  /** Which countback step separated this player from the one above, if any. */
  tieBreak: string | null;
  /** The value ranked on (lower is better for stroke formats, higher for stableford). */
  score: number | null;
};

export function scorePlayer(rules: CompetitionRules, player: PlayerInput): Omit<PlayerResult, "flight" | "flightRank" | "rank" | "tieBreak"> {
  const strokes = Array.from({ length: HOLES }, (_, i) => {
    const value = player.strokes[i];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  });
  const pickups = Array.from({ length: HOLES }, (_, i) => strokes[i] === null && Boolean(player.pickups?.[i]));
  const stablefordLike = rules.format === "stableford";
  const holesPlayed = strokes.filter((value, i) => value !== null || (stablefordLike && pickups[i])).length;
  const complete = holesPlayed === HOLES;
  const allStrokes = strokes.every((value) => value !== null);
  const system36 = usesSystem36(rules);
  const peoria = usesDoublePeoria(rules);
  const playing = playingHandicapFor(rules, player.handicapIndex);
  const received = strokesReceived(playing, rules.strokeIndex);

  const holePoints = strokes.map((value, i) => {
    if (value === null) return pickups[i] && stablefordLike ? 0 : null;
    if (rules.format === "stableford") return stablefordPoints(value, rules.pars[i], received[i]);
    if (system36) return system36Points(value, rules.pars[i]);
    return null;
  });

  const gross = allStrokes ? strokes.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
  const points = rules.format === "stableford" || system36
    ? holePoints.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const s36Handicap = system36 && complete && points !== null ? 36 - points : null;
  const peoriaHandicap = peoria && complete
    ? doublePeoriaHandicap(strokes, pickups, rules.pars, rules.peoriaHoles, rules.peoriaMaxHandicap)
    : null;
  const cardHandicap = system36 ? s36Handicap : peoria ? peoriaHandicap : null;

  let net: number | null = null;
  if (gross !== null && rules.format === "stroke_net" && !peoria) net = gross - playing;
  if (gross !== null && (system36 || peoria) && cardHandicap !== null) net = Math.round((gross - cardHandicap) * 10) / 10;

  let score: number | null = null;
  if (complete) {
    if (rules.format === "stroke_gross") score = gross;
    else if (rules.format === "stableford") score = points;
    else score = net;
  }

  return {
    cardHandicap,
    complete,
    gross,
    handicapIndex: player.handicapIndex,
    holePoints,
    holesPlayed,
    id: player.id,
    name: player.name,
    net,
    playingHandicap: playing,
    points,
    s36Handicap,
    score,
    strokes,
  };
}

const countbackSteps: { from: number; label: string; share: number }[] = [
  { from: 9, label: "9 หลุมหลัง", share: 1 / 2 },
  { from: 12, label: "6 หลุมสุดท้าย", share: 1 / 3 },
  { from: 15, label: "3 หลุมสุดท้าย", share: 1 / 6 },
  { from: 17, label: "หลุม 18", share: 1 / 18 },
];

function higherIsBetter(format: ScoringFormat) {
  return format === "stableford";
}

/** Value of a countback segment; handicap is prorated for net formats. */
function segmentValue(rules: CompetitionRules, player: ReturnType<typeof scorePlayer>, from: number, share: number) {
  if (rules.format === "stableford") {
    return player.holePoints.slice(from).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }
  const gross = player.strokes.slice(from).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (usesSystem36(rules) || usesDoublePeoria(rules)) return gross - (player.cardHandicap ?? 0) * share;
  if (rules.format === "stroke_net") return gross - player.playingHandicap * share;
  return gross;
}

/** Negative when `a` ranks ahead of `b`. Returns the deciding countback step label. */
function compare(rules: CompetitionRules, a: ReturnType<typeof scorePlayer>, b: ReturnType<typeof scorePlayer>) {
  if (a.score === null || b.score === null) {
    if (a.score === null && b.score === null) return { order: a.name.localeCompare(b.name, "th"), step: null, tied: true };
    return { order: a.score === null ? 1 : -1, step: null, tied: false };
  }
  const direction = higherIsBetter(rules.format) ? -1 : 1;
  if (a.score !== b.score) return { order: direction * (a.score - b.score), step: null, tied: false };
  if (rules.countback) {
    for (const step of countbackSteps) {
      const av = segmentValue(rules, a, step.from, step.share);
      const bv = segmentValue(rules, b, step.from, step.share);
      if (Math.abs(av - bv) > 1e-9) return { order: direction * (av - bv), step: step.label, tied: false };
    }
  }
  return { order: a.name.localeCompare(b.name, "th"), step: null, tied: true };
}

function rankList(rules: CompetitionRules, players: ReturnType<typeof scorePlayer>[]) {
  const sorted = [...players].sort((a, b) => compare(rules, a, b).order);
  const ranks: { rank: number | null; tieBreak: string | null }[] = [];
  sorted.forEach((player, index) => {
    if (player.score === null) {
      ranks.push({ rank: null, tieBreak: null });
      return;
    }
    if (index === 0) {
      ranks.push({ rank: 1, tieBreak: null });
      return;
    }
    const result = compare(rules, sorted[index - 1], player);
    ranks.push(
      result.tied
        ? { rank: ranks[index - 1].rank, tieBreak: null }
        : { rank: index + 1, tieBreak: result.step },
    );
  });
  return sorted.map((player, index) => ({ player, ...ranks[index] }));
}

export function flightFor(rules: CompetitionRules, handicapIndex: number | null) {
  if (!rules.flights.length) return "";
  if (handicapIndex === null) return "ไม่มีแต้มต่อ";
  const flight = rules.flights.find((item) => handicapIndex >= item.minHandicap && handicapIndex <= item.maxHandicap);
  return flight?.name ?? "นอกไฟลท์";
}

export type Leaderboard = {
  flights: { name: string; players: PlayerResult[] }[];
  overall: PlayerResult[];
};

export function computeLeaderboard(rules: CompetitionRules, players: PlayerInput[]): Leaderboard {
  const scored = players.map((player) => scorePlayer(rules, player));
  const flightByPlayer = new Map(scored.map((player) => [player.id, flightFor(rules, player.handicapIndex)]));

  const flightRank = new Map<string, number | null>();
  const flightNames = [...rules.flights.map((f) => f.name), "ไม่มีแต้มต่อ", "นอกไฟลท์"];
  const flights = rules.flights.length
    ? flightNames
        .map((name) => {
          const members = scored.filter((player) => flightByPlayer.get(player.id) === name);
          const ranked = rankList(rules, members);
          ranked.forEach((entry) => flightRank.set(entry.player.id, entry.rank));
          return { name, ranked };
        })
        .filter((flight) => flight.ranked.length)
    : [];

  const toResult = (entry: { player: ReturnType<typeof scorePlayer>; rank: number | null; tieBreak: string | null }): PlayerResult => ({
    ...entry.player,
    flight: flightByPlayer.get(entry.player.id) ?? "",
    flightRank: flightRank.get(entry.player.id) ?? null,
    rank: entry.rank,
    tieBreak: entry.tieBreak,
  });

  const overall = rankList(rules, scored).map(toResult);
  return {
    flights: flights.map((flight) => ({ name: flight.name, players: flight.ranked.map(toResult) })),
    overall,
  };
}

/** Validate an entered card: each hole blank or 1-20. */
export function sanitizeStrokes(values: (string | number | null | undefined)[]) {
  return Array.from({ length: HOLES }, (_, i) => {
    const raw = values[i];
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 1 && value <= 20 ? value : Number.NaN;
  });
}
