import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { EventsAutoRefresh } from "@/components/events-auto-refresh";
import { EventsPublicShell } from "@/components/events-public-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { card } from "@/components/ui/styles";
import { formatThaiDateLong, formatThaiDateTime, formatThaiTime } from "@/lib/display";
import { leaderboardOpen, loadPublicEvent, loadPublicLeaderboard, samplePublicEvent } from "@/lib/events/public";
import { appIcons } from "@/lib/icons";
import { type CompetitionRules, type PlayerResult, formatLabels, usesDoublePeoria, usesSystem36 } from "@/lib/scoring/engine";
import { formatHandicap } from "@/lib/scoring/handicap";
import { isAuthBypassEnabled } from "@/lib/supabase/env";

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ bypass?: string; flight?: string }>;
};

export const dynamic = "force-dynamic";

function bypassOn(bypass?: string) {
  return Boolean(bypass) && isAuthBypassEnabled();
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  const event = bypassOn(query.bypass) ? samplePublicEvent : await loadPublicEvent(eventId);
  if (!event) return { robots: { follow: false, index: false }, title: "ไม่พบตารางคะแนน" };
  const title = `ตารางคะแนน ${event.name}`;
  const description = `${formatThaiDateLong(event.eventDate)} · อันดับและสกอร์ล่าสุด`;
  return { description, openGraph: { description, title, url: `/events/${event.id}/leaderboard` }, title };
}

/** The value players look at first, per format. */
function mainScore(rules: CompetitionRules, row: PlayerResult) {
  if (rules.format === "stableford") return { label: "สเตเบิลฟอร์ด", value: row.points };
  if (rules.format === "stroke_gross") return { label: "สกอร์รวม (Gross)", value: row.gross };
  return { label: "สกอร์สุทธิ (Net)", value: row.net };
}

function subline(rules: CompetitionRules, row: PlayerResult) {
  const parts: string[] = [];
  if (rules.format !== "stroke_gross" && row.gross !== null) parts.push(`สกอร์รวม ${row.gross}`);
  if (usesSystem36(rules) || usesDoublePeoria(rules)) {
    const handicap = row.cardHandicap ?? row.s36Handicap;
    if (handicap !== null && handicap !== undefined) parts.push(`แต้มต่อจากการ์ด ${handicap}`);
  } else if (rules.format !== "stroke_gross" && row.handicapIndex !== null) {
    parts.push(`แต้มต่อ (HC) ${formatHandicap(row.handicapIndex)}`);
  }
  if (!row.complete) parts.push(`${row.holesPlayed}/18 หลุม`);
  else if (row.tieBreak) parts.push(`ชนะ Countback ${row.tieBreak}`);
  return parts.join(" · ");
}

export default async function PublicLeaderboardPage({ params, searchParams }: PageProps) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  const bypass = bypassOn(query.bypass);
  const [event, result] = bypass
    ? [{ ...samplePublicEvent, id: eventId }, await loadPublicLeaderboard("sample-event-1")]
    : await Promise.all([loadPublicEvent(eventId), loadPublicLeaderboard(eventId)]);
  if (!event) notFound();

  const bypassQuery = bypass ? `bypass=${query.bypass}` : "";
  const backHref = `/events/${event.id}${bypassQuery ? `?${bypassQuery}` : ""}`;

  if (!result || !leaderboardOpen(event)) {
    return (
      <EventsPublicShell>
        <Link className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-brand-600" href={backHref}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {event.name}
        </Link>
        <p className={`${card} mt-3 text-center text-base text-ink-muted`}>ตารางคะแนนจะเปิดเมื่อเริ่มการแข่งขัน</p>
      </EventsPublicShell>
    );
  }

  const { board, rules } = result;
  const tabs = [{ key: "", label: "รวม" }, ...board.flights.map((flight) => ({ key: flight.name, label: `ไฟลท์ ${flight.name}` }))];
  const activeFlight = board.flights.find((flight) => flight.name === query.flight) ?? null;
  const rows = activeFlight ? activeFlight.players : board.overall;
  const tabHref = (key: string) => {
    const search = new URLSearchParams();
    if (key) search.set("flight", key);
    if (bypassQuery) search.set("bypass", query.bypass!);
    const text = search.toString();
    return `/events/${event.id}/leaderboard${text ? `?${text}` : ""}`;
  };
  const AwardsIcon = appIcons.awards;

  return (
    <EventsPublicShell>
      <Link className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-brand-600" href={backHref}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        รายละเอียดกิจกรรม
      </Link>
      <header className="mt-2">
        <h1 className="text-[1.625rem] font-semibold leading-[2.125rem] text-brand-600 sm:text-display">{event.name}</h1>
        <p className="mt-1 text-base text-ink-muted">
          {formatThaiDateLong(event.eventDate)} · {formatLabels[rules.format]}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {result.official ? (
            <StatusBadge tone="success">ผลอย่างเป็นทางการ</StatusBadge>
          ) : (
            <StatusBadge tone="info">ระหว่างแข่ง ผลยังไม่เป็นทางการ</StatusBadge>
          )}
          <span className="text-sm text-ink-muted tabular-nums">
            ยืนยันสกอร์แล้ว {result.verifiedCount}/{result.playerCount} คน
          </span>
        </div>
        <div className="mt-2">
          {result.official ? (
            <p className="text-sm text-ink-muted">ประกาศผล {formatThaiDateTime(result.publishedAt)}</p>
          ) : (
            <EventsAutoRefresh seconds={30} updatedLabel={formatThaiTime(new Date().toISOString())} />
          )}
        </div>
      </header>

      {tabs.length > 1 ? (
        <nav aria-label="ไฟลท์" className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {tabs.map((tab) => {
            const active = (activeFlight?.name ?? "") === tab.key;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-11 shrink-0 items-center rounded-full px-4 text-base font-semibold transition ${
                  active ? "bg-brand-600 text-white" : "border border-line bg-white text-ink-muted hover:text-brand-600"
                }`}
                href={tabHref(tab.key)}
                key={tab.key || "all"}
                replace
                scroll={false}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <section aria-label={activeFlight ? `อันดับไฟลท์ ${activeFlight.name}` : "อันดับรวม"} className="mt-4 rounded-xl border border-line bg-white shadow-card">
        {rows.length ? (
          <ol className="divide-y divide-line">
            {rows.map((row) => {
              const rank = activeFlight ? row.flightRank : row.rank;
              const score = mainScore(rules, row);
              return (
                <li className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5" key={row.id}>
                  <span
                    className={`flex size-11 items-center justify-center rounded-full text-h3 font-semibold tabular-nums ${
                      rank === 1 ? "bg-gold-500 text-gold-ink" : "bg-canvas text-ink"
                    }`}
                  >
                    {rank ?? "–"}
                    <span className="sr-only">{rank ? ` อันดับ ${rank}` : " ยังไม่มีอันดับ"}</span>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-h3 font-semibold text-ink">{row.name}</p>
                    <p className="text-sm text-ink-muted tabular-nums">
                      {!activeFlight && row.flight ? `ไฟลท์ ${row.flight} · ` : ""}
                      {subline(rules, row)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-kpi font-semibold tabular-nums text-ink">{score.value ?? "–"}</p>
                    <p className="text-xs text-ink-subtle">{score.label}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="px-4 py-8 text-center text-base text-ink-muted">ยังไม่มีสกอร์ที่ยืนยันแล้ว อันดับจะขึ้นเมื่อยืนยันการ์ดใบแรก</p>
        )}
      </section>

      {result.prizes.length ? (
        <section aria-labelledby="prizes-title" className={`${card} mt-4`}>
          <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink" id="prizes-title">
            <AwardsIcon className="size-5 text-gold-700" aria-hidden="true" />
            รางวัล
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {result.prizes.map((prize) => (
              <li className="flex flex-wrap items-baseline justify-between gap-x-3 py-2" key={prize.id}>
                <span className="text-base text-ink-muted">{prize.title}</span>
                <span className="text-base font-semibold text-ink">{prize.winner}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </EventsPublicShell>
  );
}
