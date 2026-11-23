import "server-only";

import { confirmMyScoreCard } from "@/app/events/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/styles";
import { formatThaiDateShort } from "@/lib/display";
import { defaultRules } from "@/lib/scoring/engine";
import { logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

type PendingCard = {
  entered_at: string;
  event_date: string;
  event_name: string;
  event_registration_id: string;
  is_own: boolean;
  marker_confirmed: boolean;
  pars: number[] | null;
  pickups: boolean[] | null;
  player_confirmed: boolean;
  player_name: string;
  score_entry_id: string;
  strokes: (number | null)[];
};

const sampleCards: PendingCard[] = [
  {
    entered_at: "2026-11-22T10:00:00Z",
    event_date: "2026-11-22",
    event_name: "ออกรอบประจำเดือน พฤศจิกายน",
    event_registration_id: "sample-reg-1",
    is_own: true,
    marker_confirmed: false,
    pars: defaultRules.pars,
    pickups: null,
    player_confirmed: false,
    player_name: "สมาชิกทดลอง (Demo)",
    score_entry_id: "sample-entry-1",
    strokes: defaultRules.pars.map((par, i) => par + (i % 3 === 0 ? 1 : 0)),
  },
  {
    entered_at: "2026-11-22T10:05:00Z",
    event_date: "2026-11-22",
    event_name: "ออกรอบประจำเดือน พฤศจิกายน",
    event_registration_id: "sample-reg-2",
    is_own: false,
    marker_confirmed: false,
    pars: defaultRules.pars,
    pickups: null,
    player_confirmed: true,
    player_name: "วิชัย ทองดี",
    score_entry_id: "sample-entry-2",
    strokes: defaultRules.pars.map((par, i) => par + (i % 2)),
  },
];

function CardStrip({ card }: { card: PendingCard }) {
  const value = (i: number) => card.strokes[i] ?? (card.pickups?.[i] ? "X" : "");
  const sum = (from: number, to: number) => card.strokes.slice(from, to).reduce<number>((total, item) => total + (item ?? 0), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] table-fixed text-center text-sm tabular-nums">
        <caption className="sr-only">สกอร์รายหลุมของ {card.player_name}</caption>
        <tbody>
          {[0, 9].map((start) => (
            <tr className="border-t border-line first:border-t-0" key={start}>
              <th className="w-12 py-1.5 text-left text-xs font-medium text-ink-subtle" scope="row">
                {start === 0 ? "OUT" : "IN"}
              </th>
              {Array.from({ length: 9 }, (_, i) => start + i).map((index) => (
                <td className="py-1.5" key={index}>
                  <span className="block text-xs text-ink-subtle">{index + 1}</span>
                  <span className="block font-semibold text-ink">{value(index)}</span>
                </td>
              ))}
              <td className="w-12 py-1.5 font-semibold text-ink">{sum(start, start + 9)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Scorecards waiting on the member: their own card (player step) and group-mates' cards to
 * confirm as marker. Hidden when there is nothing to do or the database is not updated yet.
 */
export async function EventsMemberScoreCards({ isBypass }: { isBypass: boolean }) {
  let cards: PendingCard[] = sampleCards;
  if (!isBypass) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("member_pending_score_cards");
    if (error) {
      logDbError("member.pending_score_cards", error);
      return null;
    }
    cards = (data ?? []) as PendingCard[];
  }
  const actionable = cards.filter((card) => (card.is_own ? !card.player_confirmed || !card.marker_confirmed : card.player_confirmed && !card.marker_confirmed));
  if (!actionable.length) return null;

  return (
    <section aria-labelledby="score-cards-title" className="mb-4 rounded-lg border border-warning/30 bg-warning-bg/40 p-4">
      <h3 className="text-base font-semibold text-ink" id="score-cards-title">
        สกอร์การ์ดรอยืนยัน <span className="tabular-nums">{actionable.length}</span> ใบ
      </h3>
      <p className="mt-0.5 text-sm text-ink-muted">ผู้เล่นตรวจการ์ดของตัวเองก่อน แล้ว marker ในก๊วนยืนยันอีกคน ถ้าตัวเลขผิดแจ้งทีมงานกิจกรรมให้แก้</p>
      <ul className="mt-3 grid gap-3">
        {actionable.map((card) => {
          const total = card.strokes.every((value) => value !== null) ? card.strokes.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
          const role = card.is_own ? "player" : "marker";
          const canAct = card.is_own ? !card.player_confirmed : true;
          return (
            <li className="rounded-lg border border-line bg-white p-3" key={card.score_entry_id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{card.is_own ? "การ์ดของคุณ" : `การ์ดของ ${card.player_name}`}</p>
                  <p className="text-sm text-ink-muted">
                    {card.event_name} · {formatThaiDateShort(card.event_date)}
                    {total !== null ? (
                      <>
                        {" "}· สกอร์รวม <span className="font-semibold tabular-nums text-ink">{total}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                {card.is_own && card.player_confirmed ? (
                  <StatusBadge tone="warning">รอ marker ยืนยัน</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">{card.is_own ? "รอคุณยืนยัน" : "รอคุณยืนยันในฐานะ marker"}</StatusBadge>
                )}
              </div>
              <div className="mt-2">
                <CardStrip card={card} />
              </div>
              {canAct ? (
                <form action={confirmMyScoreCard} className="mt-3">
                  <input name="entryId" type="hidden" value={card.score_entry_id} />
                  <input name="role" type="hidden" value={role} />
                  <ConfirmSubmitButton
                    className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}
                    confirmLabel="ยืนยัน"
                    disabled={isBypass}
                    message={
                      card.is_own
                        ? "ตัวเลขทุกหลุมตรงกับที่คุณตีจริง? ยืนยันแล้วแก้เองไม่ได้ ต้องแจ้งทีมงาน"
                        : `ตรวจการ์ดของ ${card.player_name} แล้ว ตัวเลขถูกต้อง?`
                    }
                    title={card.is_own ? "ยืนยันสกอร์ของคุณ" : "ยืนยันในฐานะ marker"}
                    tone="primary"
                  >
                    {card.is_own ? "สกอร์ถูกต้อง ยืนยัน" : "ยืนยันในฐานะ marker"}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
