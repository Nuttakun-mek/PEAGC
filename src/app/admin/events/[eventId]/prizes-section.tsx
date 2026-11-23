import Link from "next/link";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass, buttonPrimary, card, fieldHint, fieldInput, fieldLabel } from "@/components/ui/styles";
import { StatusBadge } from "@/components/ui/status-badge";
import { orUnset } from "@/lib/display";
import { prizeCategories, prizeCategoryLabels, prizeTitle } from "@/lib/events/prizes";
import { appIcons } from "@/lib/icons";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import type { createClient } from "@/lib/supabase/server";

import { applySuggestedPrizes, deletePrize, savePrize } from "./actions";

type Client = Awaited<ReturnType<typeof createClient>>;

type PrizeRow = {
  category: string;
  event_registration_id: string | null;
  flight: string | null;
  guest_name: string | null;
  id: string;
  label: string | null;
  members: { full_name: string; nickname: string | null } | null;
  note: string | null;
  rank: number;
  source: string;
};

const categoryOrder = new Map<string, number>(prizeCategories.map((category, index) => [category, index]));

/**
 * Prizes of one event: winners filled from the verified leaderboard (best gross / net /
 * stableford / flight winners) plus prizes typed in by staff (longest drive, nearest to pin,
 * special). Member winners also appear in the member's awards list.
 */
export async function PrizesSection({
  eventId,
  flights,
  players,
  supabase,
}: {
  eventId: string;
  flights: string[];
  players: { id: string; name: string }[];
  supabase: Client;
}) {
  const [{ data, error }, { data: competition }] = await Promise.all([
    supabase
      .from("event_prizes")
      .select("id, category, rank, flight, label, guest_name, note, source, event_registration_id, members(full_name, nickname)")
      .eq("event_id", eventId)
      .limit(200),
    supabase.from("competitions").select("id, status").eq("event_id", eventId).maybeSingle(),
  ]);
  const AwardsIcon = appIcons.awards;
  const AddIcon = appIcons.add;
  const DeleteIcon = appIcons.delete;

  if (error) {
    logDbError("admin.event prizes", error);
    return (
      <section className={`${card} mt-8 scroll-mt-20`} id="prizes">
        <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink">
          <AwardsIcon className="size-5 text-ink-subtle" aria-hidden="true" /> รางวัล
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {classifyDbError(error) === "schema-outdated"
            ? "ฐานข้อมูลยังไม่ได้อัปเดต (migration ค้างอยู่) จึงยังบันทึกรางวัลไม่ได้"
            : "โหลดรางวัลไม่สำเร็จ ลองโหลดหน้าใหม่"}
        </p>
      </section>
    );
  }

  const prizes = ((data ?? []) as unknown as PrizeRow[]).sort(
    (a, b) =>
      (categoryOrder.get(a.category) ?? 99) - (categoryOrder.get(b.category) ?? 99) ||
      (a.flight ?? "").localeCompare(b.flight ?? "", "th") ||
      (a.label ?? "").localeCompare(b.label ?? "", "th") ||
      a.rank - b.rank,
  );
  const playerName = new Map(players.map((player) => [player.id, player.name]));
  const winner = (prize: PrizeRow) => {
    if (prize.members) return prize.members.nickname ? `${prize.members.full_name} (${prize.members.nickname})` : prize.members.full_name;
    if (prize.event_registration_id && playerName.get(prize.event_registration_id)) return playerName.get(prize.event_registration_id)!;
    return orUnset(prize.guest_name);
  };

  return (
    <section className={`${card} mt-8 scroll-mt-20`} id="prizes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink">
          <AwardsIcon className="size-5 text-ink-subtle" aria-hidden="true" /> รางวัล{" "}
          <span className="text-base font-medium text-ink-muted tabular-nums">{prizes.length} รายการ</span>
        </h2>
        <Link className={buttonClass("secondary", "sm")} href={`/events/${eventId}/leaderboard`} target="_blank">
          ดูหน้าตารางคะแนน
        </Link>
      </div>

      {prizes.length ? (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {prizes.map((prize) => (
            <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" key={prize.id}>
              <div className="min-w-0">
                <p className="font-semibold text-ink">{prizeTitle(prize)}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {winner(prize)}
                  {prize.note ? <span className="text-ink-subtle"> · {prize.note}</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {prize.source === "leaderboard" ? <StatusBadge tone="info">จากตารางคะแนน</StatusBadge> : null}
                <form action={deletePrize}>
                  <input name="eventId" type="hidden" value={eventId} />
                  <input name="prizeId" type="hidden" value={prize.id} />
                  <ConfirmSubmitButton
                    aria-label={`ลบรางวัล ${prizeTitle(prize)}`}
                    className={buttonClass("ghost", "sm")}
                    confirmLabel="ลบรางวัล"
                    message={`ลบรางวัล “${prizeTitle(prize)}” ของ ${winner(prize)}?`}
                  >
                    <DeleteIcon className="size-4" aria-hidden="true" />
                  </ConfirmSubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-lg bg-canvas px-4 py-3 text-sm text-ink-muted">
          ยังไม่มีรางวัล เติมผู้ชนะจากตารางคะแนน หรือเพิ่มรางวัลพิเศษด้านล่าง
        </p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <form action={applySuggestedPrizes} className="grid content-start gap-3 rounded-lg border border-line p-4">
          <input name="eventId" type="hidden" value={eventId} />
          <h3 className="text-h3 font-semibold text-ink">เติมผู้ชนะจากตารางคะแนน</h3>
          <p className="text-sm text-ink-muted">
            สกอร์รวมดีที่สุด สกอร์สุทธิ/สเตเบิลฟอร์ด และชนะเลิศแต่ละไฟลท์ จากการ์ดที่ยืนยันแล้ว รางวัลที่เพิ่มเองไม่ถูกแทนที่
          </p>
          {!competition ? (
            <p className="text-sm text-warning">
              ยังไม่ได้ตั้งกติกาการแข่งขัน{" "}
              <Link className="font-semibold text-brand-600 underline underline-offset-4" href={`/admin/events/${eventId}/scoring#setup`}>
                ตั้งกติกา
              </Link>
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabel}>อันดับต่อประเภท</span>
              <select className={fieldInput} defaultValue="1" name="topN">
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>{value === 1 ? "ที่ 1 เท่านั้น" : `ที่ 1-${value}`}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input defaultChecked name="oneWin" type="checkbox" /> หนึ่งคนรับได้หนึ่งรางวัล
          </label>
          <SubmitButton className={`${buttonPrimary} w-fit`} disabled={!competition} pendingText="กำลังคำนวณ...">
            <AwardsIcon className="size-4" aria-hidden="true" />
            เติมผู้ชนะ
          </SubmitButton>
        </form>

        <form action={savePrize} className="grid content-start gap-3 rounded-lg border border-line p-4">
          <input name="eventId" type="hidden" value={eventId} />
          <h3 className="text-h3 font-semibold text-ink">เพิ่มรางวัลเอง</h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
            <label className="block">
              <span className={fieldLabel}>
                ประเภท
                <span aria-hidden="true" className="ml-0.5 text-danger">*</span>
              </span>
              <select className={fieldInput} defaultValue="nearest_pin" name="category" required>
                {prizeCategories.map((category) => (
                  <option key={category} value={category}>{prizeCategoryLabels[category]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>อันดับ</span>
              <input className={`${fieldInput} tabular-nums`} defaultValue={1} inputMode="numeric" max={20} min={1} name="rank" type="number" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabel}>หลุม / ชื่อรางวัล</span>
              <input className={fieldInput} name="label" placeholder="เช่น หลุม 7 หรือ Hole in one" />
            </label>
            <label className="block">
              <span className={fieldLabel}>ไฟลท์</span>
              <input className={fieldInput} list={`prize-flights-${eventId}`} name="flight" placeholder="เฉพาะชนะเลิศไฟลท์" />
              <datalist id={`prize-flights-${eventId}`}>
                {flights.map((flight) => (
                  <option key={flight} value={flight} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabel}>ผู้ได้รับ (ผู้เล่น)</span>
              <select className={fieldInput} defaultValue="" name="registrationId">
                <option value="">แขก / คนนอกรายชื่อ</option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>{player.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>หรือชื่อแขก</span>
              <input className={fieldInput} name="guestName" placeholder="ถ้าไม่ได้เลือกผู้เล่น" />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabel}>หมายเหตุ</span>
            <input className={fieldInput} name="note" placeholder="เช่น 2.3 เมตร" />
            <span className={fieldHint}>สมาชิกที่ได้รางวัลเห็นในหน้าสมาชิก หัวข้อรางวัล</span>
          </label>
          <SubmitButton className={`${buttonPrimary} w-fit`}>
            <AddIcon className="size-4" aria-hidden="true" />
            เพิ่มรางวัล
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}
