import "server-only";

import { cache } from "react";

import { formatFee, formatThaiDateLong, formatThaiTime } from "@/lib/display";
import { holdsSeat } from "@/lib/events/pairing";
import { prizeTitle } from "@/lib/events/prizes";
import { loadScoringData, verifiedPlayerInputs } from "@/lib/scoring/data";
import { type CompetitionRules, type Leaderboard, type PlayerResult, computeLeaderboard, defaultRules } from "@/lib/scoring/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabasePublicConfig } from "@/lib/supabase/env";
import { logDbError } from "@/lib/supabase/errors";
import type { createClient } from "@/lib/supabase/server";

// Read-only data for the public event page, its preview image and the live leaderboard. These
// pages are open to anyone with the link (shared in chat groups), so they read with the service
// role and return only public fields: no phone numbers, member codes or full surnames.

/** Events anyone with the link may see. Drafts, cancelled and archived events stay hidden. */
export const PUBLIC_EVENT_STATUSES = ["open", "closed", "completed"];
/** Competitions whose leaderboard is public: started (scoring) or published. */
export const PUBLIC_COMPETITION_STATUSES = ["scoring", "published"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicEvent = {
  capacity: number | null;
  competitionStatus: string | null;
  courseName: string | null;
  description: string | null;
  eventDate: string;
  guestPrice: number;
  id: string;
  includes: string | null;
  memberPrice: number;
  name: string;
  province: string | null;
  seats: number;
  status: string;
  teeOffTime: string | null;
  venue: string | null;
  waitlist: number;
};

export const sampleEventId = "sample-event-1";

export const samplePublicEvent: PublicEvent = {
  capacity: 72,
  competitionStatus: "scoring",
  courseName: "สนามกอล์ฟรอยัล",
  description: "ออกรอบประจำเดือน แบ่งไฟลท์ตามแต้มต่อ มีรางวัลใกล้ธงทุกหลุมพาร์ 3\nพบกันที่คลับเฮาส์ 06:30 น.",
  eventDate: "2026-12-20",
  guestPrice: 2800,
  id: sampleEventId,
  includes: "ค่ากรีน แคดดี้ อาหารเย็น",
  memberPrice: 2200,
  name: "ออกรอบประจำเดือน ธันวาคม",
  province: "ปทุมธานี",
  seats: 64,
  status: "open",
  teeOffTime: "07:00:00",
  venue: "สนามกอล์ฟรอยัล",
  waitlist: 0,
};

function canReadPublic() {
  return hasSupabasePublicConfig() && Boolean(process.env.SUPABASE_SECRET_KEY);
}

/** "สมชาย ใจดี", "ชาย" -> "สมชาย ใ. (ชาย)": first name + surname initial for public pages. */
export function publicPlayerName(fullName: string | null | undefined, nickname?: string | null) {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return nickname?.trim() || "ผู้เล่น";
  const surname = parts.slice(1).join("");
  // Skip a leading Thai vowel (เ แ โ ใ ไ) so the initial is a consonant.
  const initial = surname.match(/[^เ-ไ]/u)?.[0];
  const short = initial ? `${parts[0]} ${initial}.` : parts[0];
  return nickname?.trim() ? `${short} (${nickname.trim()})` : short;
}

/** One public event (memoised per request: page, metadata and preview image share it). */
export const loadPublicEvent = cache(async (eventId: string): Promise<PublicEvent | null> => {
  if (eventId === sampleEventId && !canReadPublic()) return samplePublicEvent;
  if (!UUID.test(eventId) || !canReadPublic()) return null;
  const admin = createAdminClient();
  const { data: event, error } = await admin
    .from("events")
    .select("id, club_id, name, venue, event_date, tee_off_time, capacity, member_price, guest_price, includes, description, status, archived_at")
    .eq("id", eventId)
    .maybeSingle();
  if (error) logDbError("public.event", error);
  if (!event || event.archived_at || !PUBLIC_EVENT_STATUSES.includes(event.status)) return null;

  const [{ data: registrations }, { data: competition }, course] = await Promise.all([
    admin.from("event_registrations").select("status").eq("event_id", eventId).limit(5000),
    admin.from("competitions").select("status").eq("event_id", eventId).maybeSingle(),
    // Course columns come with a newer migration; the page works without them.
    admin.from("events").select("golf_courses(name, province)").eq("id", eventId).maybeSingle(),
  ]);
  const courseRow = (course.data as unknown as { golf_courses: { name: string; province: string | null } | null } | null)?.golf_courses ?? null;

  return {
    capacity: event.capacity,
    competitionStatus: competition?.status ?? null,
    courseName: courseRow?.name ?? null,
    description: event.description,
    eventDate: event.event_date,
    guestPrice: Number(event.guest_price ?? 0),
    id: event.id,
    includes: event.includes,
    memberPrice: Number(event.member_price ?? 0),
    name: event.name,
    province: courseRow?.province ?? null,
    seats: (registrations ?? []).filter((row) => holdsSeat(row.status)).length,
    status: event.status,
    teeOffTime: event.tee_off_time,
    venue: event.venue,
    waitlist: (registrations ?? []).filter((row) => row.status === "waitlist").length,
  };
});

/** Venue line: the typed venue, else the course name, with the province. */
export function venueText(event: Pick<PublicEvent, "courseName" | "province" | "venue">) {
  const venue = event.venue?.trim() || event.courseName || "";
  if (!venue) return "รอแจ้งสนาม";
  return event.province && !venue.includes(event.province) ? `${venue} จ.${event.province}` : venue;
}

/** One Thai line with date, tee-off, venue and fee: the preview text in chat apps. */
export function eventSummary(event: PublicEvent) {
  return [
    formatThaiDateLong(event.eventDate),
    event.teeOffTime ? `ออกรอบ ${formatThaiTime(event.teeOffTime)}` : null,
    venueText(event),
    `ค่าสมัคร ${formatFee(event.memberPrice)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function leaderboardOpen(event: Pick<PublicEvent, "competitionStatus">) {
  return Boolean(event.competitionStatus && PUBLIC_COMPETITION_STATUSES.includes(event.competitionStatus));
}

export type PublicPrize = { id: string; title: string; winner: string };

export type PublicLeaderboard = {
  board: Leaderboard;
  /** true = published result; false = live, from cards confirmed so far. */
  official: boolean;
  prizes: PublicPrize[];
  publishedAt: string | null;
  rules: CompetitionRules;
  verifiedCount: number;
  playerCount: number;
};

/**
 * Leaderboard for the public page. Published: the latest published snapshot. Live: computed from
 * verified cards now. Names are shortened.
 */
export async function loadPublicLeaderboard(eventId: string): Promise<PublicLeaderboard | null> {
  if (eventId === sampleEventId && !canReadPublic()) return sampleLeaderboard();
  if (!UUID.test(eventId) || !canReadPublic()) return null;
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("club_id, status, archived_at").eq("id", eventId).maybeSingle();
  if (!event || event.archived_at || !PUBLIC_EVENT_STATUSES.includes(event.status)) return null;

  // The service-role client reads like the staff client (same query builder).
  const data = await loadScoringData(admin as unknown as Awaited<ReturnType<typeof createClient>>, event.club_id, eventId);
  if (!data.competition || !data.rules || !PUBLIC_COMPETITION_STATUSES.includes(data.competition.status)) return null;

  const shortName = new Map(data.players.map((player) => [player.registrationId, publicPlayerName(player.name, player.nickname)]));
  const rename = (row: PlayerResult): PlayerResult => ({ ...row, name: shortName.get(row.id) ?? publicPlayerName(row.name) });

  let board = computeLeaderboard(data.rules, verifiedPlayerInputs(data));
  let official = false;
  if (data.competition.status === "published") {
    const { data: snapshot } = await admin
      .from("leaderboard_snapshots")
      .select("rows")
      .eq("competition_id", data.competition.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rows = snapshot?.rows as Leaderboard | undefined;
    if (rows?.overall) {
      board = rows;
      official = true;
    }
  }
  board = { flights: board.flights.map((flight) => ({ ...flight, players: flight.players.map(rename) })), overall: board.overall.map(rename) };

  const { data: prizeRows, error: prizeError } = await admin
    .from("event_prizes")
    .select("id, category, rank, flight, label, guest_name, event_registration_id, members(full_name, nickname)")
    .eq("event_id", eventId)
    .limit(100);
  if (prizeError) logDbError("public.prizes", prizeError);
  type PrizeRow = {
    category: string;
    event_registration_id: string | null;
    flight: string | null;
    guest_name: string | null;
    id: string;
    label: string | null;
    members: { full_name: string; nickname: string | null } | null;
    rank: number;
  };
  const prizes = ((prizeRows ?? []) as unknown as PrizeRow[]).map((prize) => ({
    id: prize.id,
    title: prizeTitle(prize),
    winner: prize.members
      ? publicPlayerName(prize.members.full_name, prize.members.nickname)
      : (prize.event_registration_id && shortName.get(prize.event_registration_id)) || prize.guest_name || "ผู้เล่น",
  }));

  return {
    board,
    official,
    playerCount: data.players.length,
    prizes,
    publishedAt: data.competition.published_at,
    rules: data.rules,
    verifiedCount: data.verified.size,
  };
}

function sampleLeaderboard(): PublicLeaderboard {
  const rules: CompetitionRules = {
    ...defaultRules,
    flights: [
      { maxHandicap: 12, minHandicap: 0, name: "A" },
      { maxHandicap: 36, minHandicap: 12.1, name: "B" },
    ],
  };
  const card = (over: number[]) => defaultRules.pars.map((par, i) => par + (over[i % over.length] ?? 0));
  const players = [
    { handicapIndex: 6.4, id: "s1", name: "สมชาย ใ. (ชาย)", strokes: card([0, 1, 0, 0, 1, 0]) },
    { handicapIndex: 9.0, id: "s2", name: "ประเสริฐ ศ.", strokes: card([1, 0, 1, 1, 0, 0]) },
    { handicapIndex: 14.5, id: "s3", name: "สุรชัย บ.", strokes: card([1, 1, 0, 1]) },
    { handicapIndex: 18.2, id: "s4", name: "กิตติ พ. (กิต)", strokes: card([1, 1, 2, 0]) },
    { handicapIndex: 22.4, id: "s5", name: "มานพ ใ.", strokes: card([2, 1, 1, 1]) },
    { handicapIndex: 11.0, id: "s6", name: "วิชัย ท.", strokes: card([1, 0, 0, 1, 1, 0]).map((value, i) => (i > 13 ? null : value)) },
  ];
  return {
    board: computeLeaderboard(rules, players),
    official: false,
    playerCount: 8,
    prizes: [{ id: "p1", title: prizeTitle({ category: "nearest_pin", label: "หลุม 7", rank: 1 }), winner: "วิชัย ท." }],
    publishedAt: null,
    rules,
    verifiedCount: 6,
  };
}
