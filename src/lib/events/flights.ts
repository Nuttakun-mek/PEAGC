// Automatic flights and groups of four by handicap ("จัดกลุ่มอัตโนมัติตามแต้มต่อ").
// Players are sorted by handicap (lowest first, no handicap last), split into flights - thirds
// (A/B/C) or the club's handicap ranges - and each flight is cut into groups of up to N players
// with sizes as even as possible (9 players -> 3/3/3, not 4/4/1). Staff adjust afterwards.

export type FlightPlayer = { createdAt?: string; handicap: number | null; id: string };
export type FlightRange = { maxHandicap: number; minHandicap: number; name: string };

export type FlightMode = "thirds" | "ranges" | "single";

export const NO_HANDICAP_FLIGHT = "ไม่มีแต้มต่อ";
export const OUTSIDE_FLIGHT = "นอกไฟลท์";

function byHandicap(a: FlightPlayer, b: FlightPlayer) {
  const ah = a.handicap ?? Number.POSITIVE_INFINITY;
  const bh = b.handicap ?? Number.POSITIVE_INFINITY;
  if (ah !== bh) return ah - bh;
  return (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);
}

/** Split `n` into `parts` sizes that differ by at most one, larger first. */
export function evenSizes(n: number, parts: number) {
  if (parts <= 0 || n <= 0) return [];
  const base = Math.floor(n / parts);
  const extra = n % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Cut an ordered list into groups of at most `groupSize`, sizes as even as possible. */
export function chunkGroups<T>(items: T[], groupSize: number): T[][] {
  const size = Math.max(1, Math.trunc(groupSize));
  if (!items.length) return [];
  const sizes = evenSizes(items.length, Math.ceil(items.length / size));
  const groups: T[][] = [];
  let cursor = 0;
  for (const count of sizes) {
    groups.push(items.slice(cursor, cursor + count));
    cursor += count;
  }
  return groups;
}

export function splitIntoFlights(
  players: FlightPlayer[],
  options: { flightCount?: number; mode: FlightMode; names?: string[]; ranges?: FlightRange[] },
): { name: string; players: FlightPlayer[] }[] {
  const sorted = [...players].sort(byHandicap);
  if (options.mode === "single" || !sorted.length) return sorted.length ? [{ name: "", players: sorted }] : [];

  if (options.mode === "ranges") {
    const ranges = [...(options.ranges ?? [])].sort((a, b) => a.minHandicap - b.minHandicap);
    const buckets = new Map<string, FlightPlayer[]>();
    for (const player of sorted) {
      const name =
        player.handicap === null
          ? NO_HANDICAP_FLIGHT
          : (ranges.find((range) => player.handicap! >= range.minHandicap && player.handicap! <= range.maxHandicap)?.name ?? OUTSIDE_FLIGHT);
      buckets.set(name, [...(buckets.get(name) ?? []), player]);
    }
    return [...ranges.map((range) => range.name), NO_HANDICAP_FLIGHT, OUTSIDE_FLIGHT]
      .filter((name) => buckets.get(name)?.length)
      .map((name) => ({ name, players: buckets.get(name)! }));
  }

  const count = Math.max(1, Math.min(options.flightCount ?? 3, sorted.length));
  const names = options.names ?? ["A", "B", "C", "D", "E", "F"];
  const sizes = evenSizes(sorted.length, count);
  const flights: { name: string; players: FlightPlayer[] }[] = [];
  let cursor = 0;
  sizes.forEach((size, i) => {
    flights.push({ name: names[i] ?? String(i + 1), players: sorted.slice(cursor, cursor + size) });
    cursor += size;
  });
  return flights;
}

export type FlightGroupPlan = { flight: string; registrationIds: string[] }[];

/** Groups in tee order: flight A's groups first, then B, ... */
export function planFlightGroups(
  players: FlightPlayer[],
  options: { flightCount?: number; groupSize: number; mode: FlightMode; ranges?: FlightRange[] },
): FlightGroupPlan {
  return splitIntoFlights(players, options).flatMap((flight) =>
    chunkGroups(flight.players, options.groupSize).map((group) => ({
      flight: flight.name,
      registrationIds: group.map((player) => player.id),
    })),
  );
}
