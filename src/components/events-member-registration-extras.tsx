import "server-only";

import Link from "next/link";
import { cache } from "react";
import { ListOrdered } from "lucide-react";

import { PUBLIC_COMPETITION_STATUSES } from "@/lib/events/public";
import { appIcons } from "@/lib/icons";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/errors";

/**
 * Competition status per event for the member's own registrations. Keyed by the comma-joined id
 * list so every item of the list shares one query within the request.
 */
const loadCompetitionStatuses = cache(async (eventIdsCsv: string) => {
  const ids = eventIdsCsv.split(",").filter(Boolean);
  const result = new Map<string, string>();
  if (!ids.length || !process.env.SUPABASE_SECRET_KEY) return result;
  try {
    const { data, error } = await createAdminClient().from("competitions").select("event_id, status").in("event_id", ids);
    if (error) logDbError("member.events competitions", error);
    for (const row of data ?? []) result.set(row.event_id, row.status);
  } catch (error) {
    console.error("[member.events] competitions:", error instanceof Error ? error.message : error);
  }
  return result;
});

function bangkokToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

/**
 * Links under one of "ที่สมัครไว้": add the round to the phone calendar (.ics) and, while the
 * competition is running or published, open the live leaderboard.
 */
export async function EventsRegistrationExtras({
  allEventIds,
  eventDate,
  eventId,
  isBypass,
  registrationId,
  status,
}: {
  /** Comma-joined event ids of every registration on the page (one shared query). */
  allEventIds: string;
  eventDate: string | null | undefined;
  eventId: string;
  isBypass: boolean;
  registrationId: string;
  status: string;
}) {
  const today = bangkokToday();
  const upcoming = Boolean(eventDate && eventDate >= today);
  const showCalendar = upcoming && !["cancelled", "no_show"].includes(status);
  const competitionStatus = isBypass ? (upcoming ? null : "scoring") : (await loadCompetitionStatuses(allEventIds)).get(eventId);
  const live = Boolean(competitionStatus && PUBLIC_COMPETITION_STATUSES.includes(competitionStatus)) && Boolean(eventDate && eventDate <= today);
  if (!showCalendar && !live) return null;
  const CalendarIcon = appIcons.calendar;

  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
      {showCalendar ? (
        <a
          className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-brand-600 underline-offset-4 hover:underline"
          download
          href={`/api/calendar/event/${registrationId}`}
        >
          <CalendarIcon className="size-4" aria-hidden="true" />
          เพิ่มลงปฏิทิน
        </a>
      ) : null}
      {live ? (
        <Link
          className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-brand-600 underline-offset-4 hover:underline"
          href={`/events/${eventId}/leaderboard${isBypass ? "?bypass=member" : ""}`}
        >
          <ListOrdered className="size-4" aria-hidden="true" />
          {competitionStatus === "published" ? "ผลการแข่งขัน" : "ตารางคะแนนสด"}
        </Link>
      ) : null}
    </div>
  );
}
