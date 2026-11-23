import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Clock, ListOrdered, MapPin, Receipt, UserPlus, UsersRound } from "lucide-react";

import { CLUB_NAME } from "@/components/brand";
import { EventsPublicShell } from "@/components/events-public-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, card } from "@/components/ui/styles";
import { getSessionUser } from "@/lib/auth/session";
import { formatFee, formatThaiDateLong, formatThaiTime } from "@/lib/display";
import { eventSummary, leaderboardOpen, loadPublicEvent, sampleEventId, samplePublicEvent, venueText } from "@/lib/events/public";
import { appIcons } from "@/lib/icons";
import { eventStatusLabels } from "@/lib/labels";
import { hasSupabasePublicConfig, isAuthBypassEnabled } from "@/lib/supabase/env";

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ bypass?: string }>;
};

/** Bypass preview (`?bypass=member` with AUTH_BYPASS_ENABLED) shows a sample event. */
async function loadEvent(eventId: string, bypass?: string) {
  if (bypass && isAuthBypassEnabled()) return { ...samplePublicEvent, id: eventId };
  return loadPublicEvent(eventId);
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  const event = await loadEvent(eventId, query.bypass);
  if (!event) {
    return { robots: { follow: false, index: false }, title: "ไม่พบกิจกรรม" };
  }
  const description = `${eventSummary(event)}${event.status === "open" ? " · สมัครได้ที่หน้าสมาชิก" : ""}`;
  return {
    alternates: { canonical: `/events/${event.id}` },
    description,
    openGraph: {
      description,
      locale: "th_TH",
      siteName: CLUB_NAME,
      title: event.name,
      type: "website",
      url: `/events/${event.id}`,
    },
    title: event.name,
    twitter: { card: "summary_large_image", description, title: event.name },
  };
}

export default async function PublicEventPage({ params, searchParams }: PageProps) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  const event = await loadEvent(eventId, query.bypass);
  if (!event) notFound();

  const signedIn = hasSupabasePublicConfig() ? Boolean(await getSessionUser().catch(() => null)) : false;
  const signUpHref = signedIn ? "/member#events" : "/login?next=/member%23events";
  const full = Boolean(event.capacity) && event.seats >= (event.capacity ?? 0);
  const seatsLeft = event.capacity ? Math.max(0, event.capacity - event.seats) : null;
  const showBoard = leaderboardOpen(event);
  const bypassQuery = query.bypass && isAuthBypassEnabled() ? `?bypass=${query.bypass}` : "";
  const WaitlistIcon = appIcons.waitlist;

  const rows: { icon: typeof CalendarDays; label: string; value: React.ReactNode }[] = [
    { icon: CalendarDays, label: "วันที่", value: formatThaiDateLong(event.eventDate) },
    { icon: Clock, label: "ออกรอบ", value: <span className="tabular-nums">{formatThaiTime(event.teeOffTime)}</span> },
    { icon: MapPin, label: "สนาม", value: venueText(event) },
    {
      icon: Receipt,
      label: "ค่าสมัคร",
      value: (
        <span className="tabular-nums">
          สมาชิก <span className="font-semibold text-ink">{formatFee(event.memberPrice)}</span>
          {event.guestPrice ? <> · แขก {formatFee(event.guestPrice)}</> : null}
        </span>
      ),
    },
  ];
  if (event.capacity) {
    rows.push({
      icon: UsersRound,
      label: "จำนวนรับ",
      value: (
        <span className="tabular-nums">
          รับ {event.capacity} คน
          {event.status === "open" ? (full ? ` · เต็มแล้ว (คิวสำรอง ${event.waitlist} คน)` : ` · เหลือ ${seatsLeft} ที่`) : ""}
        </span>
      ),
    });
  }

  return (
    <EventsPublicShell>
      <article className={card}>
        <StatusBadge kind="event" status={event.status}>{eventStatusLabels[event.status] ?? event.status}</StatusBadge>
        <h1 className="mt-2 text-[1.625rem] font-semibold leading-[2.125rem] text-brand-600 sm:text-display">{event.name}</h1>

        <dl className="mt-4 grid gap-3">
          {rows.map((row) => (
            <div className="flex items-start gap-3" key={row.label}>
              <row.icon className="mt-1 size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-sm font-medium text-ink-subtle">{row.label}</dt>
                <dd className="text-base text-ink">{row.value}</dd>
              </div>
            </div>
          ))}
        </dl>

        {event.includes ? (
          <p className="mt-4 rounded-lg bg-canvas px-4 py-3 text-base text-ink-muted">
            <span className="font-medium text-ink">รวมในค่าสมัคร:</span> {event.includes}
          </p>
        ) : null}
        {event.description ? <p className="mt-4 whitespace-pre-line text-base text-ink">{event.description}</p> : null}

        <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
          {event.status === "open" ? (
            <Link className={`${buttonClass("primary", "lg")} w-full sm:w-auto`} href={signUpHref}>
              {full ? <WaitlistIcon className="size-5" aria-hidden="true" /> : <UserPlus className="size-5" aria-hidden="true" />}
              {full ? "ต่อคิวสำรอง" : "สมัคร"}
            </Link>
          ) : null}
          {showBoard ? (
            <Link
              className={`${buttonClass(event.status === "open" ? "secondary" : "primary", "lg")} w-full sm:w-auto`}
              href={`/events/${event.id}/leaderboard${bypassQuery}`}
            >
              <ListOrdered className="size-5" aria-hidden="true" />
              {event.competitionStatus === "published" ? "ผลการแข่งขัน" : "ตารางคะแนนสด"}
            </Link>
          ) : null}
        </div>
        {event.status === "open" ? (
          <p className="mt-3 text-sm text-ink-muted">
            {signedIn ? "สมัครในหน้าสมาชิก หัวข้อกิจกรรมออกรอบ" : "เข้าสู่ระบบสมาชิกก่อน แล้วสมัครในหัวข้อกิจกรรมออกรอบ"}
          </p>
        ) : event.status === "closed" ? (
          <p className="mt-3 text-sm text-ink-muted">ปิดรับสมัครแล้ว</p>
        ) : null}
      </article>
      {eventId === sampleEventId ? <p className="mt-3 text-center text-sm text-ink-subtle">ข้อมูลตัวอย่าง</p> : null}
    </EventsPublicShell>
  );
}
