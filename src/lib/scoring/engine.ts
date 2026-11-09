// Competition scoring engine. Pure functions only: rules arrive as data (versioned in the
// DB as JSON), so new formats/flights/allowances never need branching elsewhere.
//
// Supported formats
//   stroke_gross  lowest gross wins
//   stroke_net    lowest gross - playing handicap
//   stableford    most points, 2 + par + strokes received - strokes (min 0) per hole
//   system36      handicap = 36 - points (par or better 2, bogey 1, worse 0); lowest net wins
// Ties are broken by countback (back 9, back 6, back 3, 18th) when enabled.

export const HOLES = 18;

export type ScoringFormat = "stroke_gross" | "stroke_net" | "stableford" | "system36";

export const formatLabels: Record<ScoringFormat, string> = {
  stableford: "สเตเบิลฟอร์ด",
  stroke_gross: "สโตรกเพลย์ (Gross)",
  stroke_net: "สโตรกเพลย์ (Net)",
  system36: "System 36",
};

export type Flight = { maxHandicap: number; minHandicap: number; name: string };

export type CompetitionRules = {
  countback: boolean;
  flights: Flight[];
  format: ScoringFormat;
  /** Percentage of handicap index used as playing handicap (e.g. 100, 90, 85). */
  handicapAllowance: number;
  pars: number[];
  strokeIndex: number[];
};

export const defaultRules: CompetitionRules = {
  countback: true,
  flights: [],
  format: "stroke_net",
  handicapAllowance: 100,
  pars: [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5],
  strokeIndex: [7, 11, 15, 1, 5, 13, 17, 9, 3, 8, 12, 16, 2, 6, 14, 18, 10, 4],
};

export function validateRules(rules: CompetitionRules): string[] {
  const errors: string[] = [];
  if (!["stroke_gross", "stroke_net", "stableford", "system36"].includes(rules.format)) {
    errors.push("รูปแบบการแข่งขันไม่ถูกต้อง");
  }
  if (rules.pars.length !== HOLES || rules.pars.some((par) => !Number.isInteger(par) || par < 3 || par > 6)) {
    errors.push("พาร์ต้องมี 18 หลุม ค่าละ 3-6");
  }
  const si = [...rules.strokeIndex].sort((a, b) => a - b);
  if (rules.strokeIndex.length !== HOLES || si.some((value, index) => value !== index + 1)) {
    errors.push("Stroke index ต้องเป็นเลข 1-18 ไม่ซ้ำกัน");
  }
  if (!(rules.handicapAllowance >= 0 && rules.handicapAllowance <= 100)) {
    errors.push("สัดส่วนแฮนดิแคปต้องอยู่ระหว่าง 0-100%");
  }
  const flights = [...rules.flights].sort((a, b) => a.minHandicap - b.minHandicap);
  flights.forEach((flight, index) => {
    if (!flight.name.trim()) errors.push("ไฟลท์ต้องมีชื่อ");
    if (flight.maxHandicap < flight.minHandicap) errors.push(`ไฟลท์ ${flight.name}: ช่วงแฮนดิแคปไม่ถูกต้อง`);
    const next = flights[index + 1];
    if (next && next.minHandicap <= flight.maxHandicap) errors.push(`ไฟลท์ ${flight.name} กับ ${next.name} ช่วงแฮนดิแคปทับกัน`);
  });
  return errors;
}

/** Coerce stored JSON into rules, falling back to defaults field by field. */
export function parseRules(value: unknown): CompetitionRules {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<CompetitionRules>;
  return {
    countback: typeof raw.countback === "boolean" ? raw.countback : defaultRules.countback,
    flights: Array.isArray(raw.flights)
      ? raw.flights
          .filter((f): f is Flight => Boolean(f) && typeof f === "object")
          .map((f) => ({ maxHandicap: Number(f.maxHandicap), minHandicap: Number(f.minHandicap), name: String(f.name ?? "") }))
      : [],
    format: (raw.format as ScoringFormat) ?? defaultRules.format,
    handicapAllowance: Number.isFinite(Number(raw.handicapAllowance)) ? Number(raw.handicapAllowance) : 100,
    pars: Array.isArray(raw.pars) && raw.pars.length === HOLES ? raw.pars.map(Number) : [...defaultRules.pars],
    strokeIndex:
      Array.isArray(raw.strokeIndex) && raw.strokeIndex.length === HOLES ? raw.strokeIndex.map(Number) : [...defaultRules.strokeIndex],
  };
}

// ---------- handicap ----------

export function playingHandicap(handicapIndex: number | null | undefined, allowance: number) {
  if (handicapIndex === null || handicapIndex === undefined || !Number.isFinite(handicapIndex)) return 0;
  return Math.round((handicapIndex * allowance) / 100);
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
  const playing = playingHandicap(player.handicapIndex, rules.handicapAllowance);
  const received = strokesReceived(playing, rules.strokeIndex);

  const holePoints = strokes.map((value, i) => {
    if (value === null) return pickups[i] && stablefordLike ? 0 : null;
    if (rules.format === "stableford") return stablefordPoints(value, rules.pars[i], received[i]);
    if (rules.format === "system36") return system36Points(value, rules.pars[i]);
    return null;
  });

  const gross = allStrokes ? strokes.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
  const points = rules.format === "stableford" || rules.format === "system36"
    ? holePoints.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const s36Handicap = rules.format === "system36" && complete && points !== null ? 36 - points : null;

  let net: number | null = null;
  if (gross !== null && rules.format === "stroke_net") net = gross - playing;
  if (gross !== null && rules.format === "system36" && s36Handicap !== null) net = gross - s36Handicap;

  let score: number | null = null;
  if (complete) {
    if (rules.format === "stroke_gross") score = gross;
    else if (rules.format === "stableford") score = points;
    else score = net;
  }

  return {
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
  if (rules.format === "stroke_net") return gross - player.playingHandicap * share;
  if (rules.format === "system36") return gross - (player.s36Handicap ?? 0) * share;
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
  if (handicapIndex === null) return "ไม่มีแฮนดิแคป";
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
  const flightNames = [...rules.flights.map((f) => f.name), "ไม่มีแฮนดิแคป", "นอกไฟลท์"];
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
