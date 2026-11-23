import { cancelMyRedemption, redeemPointReward } from "@/app/member/membership/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { MemberAvatar } from "@/components/member-avatar";
import { MemberSection } from "@/components/member-section";
import { StatusBanner } from "@/components/status-banner";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/styles";
import { formatThaiDate, formatThaiDateShort } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { redemptionStatusLabels } from "@/lib/labels";
import { bangkokToday } from "@/lib/membership/lifecycle";
import { expiringWithin, nextExpiry } from "@/lib/points/ledger";
import { loadMemberPoints } from "@/lib/points/member-points";
import {
  formatPointDelta,
  pointReasonLabels,
  pointRuleLabels,
  resolvePointRules,
} from "@/lib/points/rules";
import { createClient } from "@/lib/supabase/server";

const PointsIcon = appIcons.points;
const AwardIcon = appIcons.awards;

export const pointsStatusMessages: Record<string, string> = {
  "points-cancel-failed": "ยกเลิกไม่สำเร็จ ลองอีกครั้ง",
  "points-not-approved": "แลกของรางวัลได้เมื่อสมาชิกใช้งานได้ตามปกติ",
  "points-not-enough": "แต้มสะสมไม่พอสำหรับของรางวัลนี้",
  "points-out-of-stock": "ของรางวัลนี้หมดแล้ว",
  "points-redeem-failed": "แลกไม่สำเร็จ ลองอีกครั้ง",
  "points-redeemed": "แลกแล้ว รับของได้ที่ผู้ดูแลชมรม",
  "points-redemption-cancelled": "ยกเลิกการแลกแล้ว คืนแต้มสะสมเรียบร้อย",
  "points-redemption-closed": "รายการนี้ส่งของแล้วหรือยกเลิกไปแล้ว",
  "points-reward-closed": "ของรางวัลนี้ปิดการแลกแล้ว",
};

type Reward = { cost: number; description: string | null; id: string; name: string; stock: number | null };
type Redemption = { cost: number; id: string; requested_at: string; reward_name: string; status: string };
type Leader = { avatar_url: string | null; full_name: string; member_code: string | null; member_id: string; nickname: string | null; points: number; rank: number };
type Txn = { created_at: string; delta: number; id: string; note: string | null; reason: string };

type View = {
  balance: number;
  expiringSoon: number;
  leaders: Leader[];
  nextExpiryAt: string | null;
  recent: Txn[];
  redemptions: Redemption[];
  rewards: Reward[];
  rules: ReturnType<typeof resolvePointRules>;
};

function sampleView(today: string): View {
  return {
    balance: 145,
    expiringSoon: 10,
    leaders: [
      { avatar_url: null, full_name: "สมชาย ใจดี", member_code: "PEAGC-0012", member_id: "s1", nickname: "ชาย", points: 95, rank: 1 },
      { avatar_url: null, full_name: "สมาชิกทดลอง", member_code: "PEAGC-0001", member_id: "demo-member", nickname: null, points: 70, rank: 2 },
      { avatar_url: null, full_name: "วิภา รักกอล์ฟ", member_code: "PEAGC-0031", member_id: "s3", nickname: "วิ", points: 40, rank: 3 },
    ],
    nextExpiryAt: `${today}T00:00:00+07:00`,
    recent: [
      { created_at: "2026-11-20T10:00:00+07:00", delta: 30, id: "t1", note: null, reason: "event_checkin" },
      { created_at: "2026-11-18T18:00:00+07:00", delta: 10, id: "t2", note: null, reason: "attend_lesson" },
      { created_at: "2026-11-10T09:00:00+07:00", delta: -100, id: "t3", note: "หมวกชมรม", reason: "redemption" },
      { created_at: "2026-11-02T12:00:00+07:00", delta: 5, id: "t4", note: "ออกรอบประจำเดือน", reason: "scorecard_on_time" },
    ],
    redemptions: [{ cost: 100, id: "r1", requested_at: "2026-11-10T09:00:00+07:00", reward_name: "หมวกชมรม", status: "requested" }],
    rewards: [
      { cost: 100, description: "ปักโลโก้ชมรม", id: "w1", name: "หมวกชมรม", stock: 12 },
      { cost: 300, description: null, id: "w2", name: "ส่วนลดค่าเรียน 300 บาท", stock: null },
      { cost: 500, description: null, id: "w3", name: "เสื้อโปโลชมรม", stock: 0 },
    ],
    rules: resolvePointRules(null),
  };
}

async function loadView(memberId: string, clubId: string): Promise<View | null> {
  const points = await loadMemberPoints(memberId);
  if (!points.available) return null;
  const supabase = await createClient();
  const [rewardsResult, redemptionsResult, leadersResult, rulesResult] = await Promise.all([
    supabase.from("point_rewards").select("id, name, description, cost, stock").eq("club_id", clubId).eq("status", "active").order("cost").limit(20),
    supabase
      .from("point_redemptions")
      .select("id, reward_name, cost, status, requested_at")
      .eq("member_id", memberId)
      .order("requested_at", { ascending: false })
      .limit(5),
    supabase.rpc("point_leaderboard", { p_club: clubId, p_limit: 10, p_month: null }),
    supabase.from("point_rules").select("reason, points, enabled").eq("club_id", clubId),
  ]);
  const now = new Date();
  const soon = nextExpiry(points.ledger);
  return {
    balance: points.ledger.balance,
    expiringSoon: expiringWithin(points.ledger, now, 30),
    leaders: ((leadersResult.data ?? []) as Leader[]).map((row) => ({ ...row, points: Number(row.points), rank: Number(row.rank) })),
    nextExpiryAt: soon?.expiresAt ?? null,
    recent: [...points.txns].reverse().slice(0, 10),
    redemptions: (redemptionsResult.data ?? []) as Redemption[],
    rewards: (rewardsResult.data ?? []) as Reward[],
    rules: resolvePointRules(rulesResult.data as { enabled: boolean; points: number; reason: string }[] | null),
  };
}

/**
 * "แต้มสะสม" on the member page: balance, points expiring within 30 days, the last 10 rows,
 * rewards to redeem, this month's top 10 and how to earn. Hidden until the membership migration
 * is applied, and for members who are not approved yet and have no points.
 */
export async function PointsMemberSection({
  clubId,
  isBypass,
  memberId,
  memberStatus,
  status,
}: {
  clubId: string | null | undefined;
  isBypass: boolean;
  memberId: string | null | undefined;
  memberStatus: string | null | undefined;
  status?: string;
}) {
  const today = bangkokToday();
  const view = isBypass ? sampleView(today) : memberId && clubId ? await loadView(memberId, clubId) : null;
  if (!view) return null;
  const canRedeem = isBypass ? false : memberStatus === "active";
  if (!isBypass && memberStatus !== "active" && view.recent.length === 0) return null;

  const myId = isBypass ? "demo-member" : memberId;
  const statusMessage = status ? pointsStatusMessages[status] : null;
  const openRedemptions = view.redemptions.filter((item) => item.status === "requested");
  const earnRules = view.rules.filter((rule) => rule.enabled && rule.points !== 0);

  return (
    <MemberSection description="สะสมจากการเข้าเรียน ออกรอบ และช่วยงานชมรม ใช้แลกของรางวัล" icon={PointsIcon} id="points" title="แต้มสะสม">
      {statusMessage ? (
        <StatusBanner className="mb-4" tone={status === "points-redeemed" || status === "points-redemption-cancelled" ? "success" : "error"}>
          {statusMessage}
        </StatusBanner>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-brand-50 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-ink-muted">คงเหลือ</p>
          <p className="text-kpi font-semibold tabular-nums text-brand-600">
            {view.balance.toLocaleString("th-TH")}
            <span className="ml-1.5 text-base font-medium text-ink-muted">แต้มสะสม</span>
          </p>
        </div>
        {view.expiringSoon > 0 ? (
          <p className="text-sm font-medium text-warning">
            <span className="tabular-nums">{view.expiringSoon.toLocaleString("th-TH")}</span> แต้มสะสมจะหมดอายุภายใน 30 วัน
            {view.nextExpiryAt ? ` (เริ่ม ${formatThaiDate(view.nextExpiryAt)})` : ""}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">แต้มสะสมมีอายุ 12 เดือนนับจากวันที่ได้รับ</p>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="points-recent-title">
          <h3 className="text-base font-semibold text-ink" id="points-recent-title">
            รายการล่าสุด
          </h3>
          {view.recent.length ? (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
              {view.recent.map((txn) => (
                <li className="flex items-start justify-between gap-3 px-3 py-2.5" key={txn.id}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {pointReasonLabels[txn.reason] ?? txn.reason}
                      {txn.note ? <span className="font-normal text-ink-muted"> · {txn.note}</span> : null}
                    </p>
                    <p className="text-xs text-ink-subtle">{formatThaiDateShort(txn.created_at)}</p>
                  </div>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${txn.delta > 0 ? "text-success" : "text-danger"}`}>
                    {formatPointDelta(txn.delta)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">ยังไม่มีแต้มสะสม เข้าเรียนหรือออกรอบกับชมรมเพื่อเริ่มสะสม</p>
          )}
        </section>

        <section aria-labelledby="points-top-title">
          <h3 className="text-base font-semibold text-ink" id="points-top-title">
            อันดับเดือนนี้
          </h3>
          {view.leaders.length ? (
            <ol className="mt-2 divide-y divide-line rounded-lg border border-line">
              {view.leaders.map((leader) => {
                const me = leader.member_id === myId;
                return (
                  <li className={`flex items-center gap-3 px-3 py-2 ${me ? "bg-brand-50" : ""}`} key={leader.member_id}>
                    <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-ink-muted">{leader.rank}</span>
                    <MemberAvatar avatarUrl={leader.avatar_url} displayName={leader.full_name} seed={leader.member_code ?? leader.member_id} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {leader.full_name}
                      {me ? <span className="ml-1 text-xs font-semibold text-brand-600">(คุณ)</span> : null}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{leader.points.toLocaleString("th-TH")}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">เดือนนี้ยังไม่มีใครได้แต้มสะสม</p>
          )}
        </section>
      </div>

      <section aria-labelledby="points-rewards-title" className="mt-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-ink" id="points-rewards-title">
          <AwardIcon className="size-4 text-gold-700" aria-hidden="true" />
          แลกของรางวัล
        </h3>

        {openRedemptions.length ? (
          <ul className="mt-2 grid gap-2">
            {openRedemptions.map((item) => (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2.5" key={item.id}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{item.reward_name}</p>
                  <p className="text-xs text-ink-muted">
                    แลกเมื่อ {formatThaiDateShort(item.requested_at)} · <span className="tabular-nums">{item.cost.toLocaleString("th-TH")}</span> แต้มสะสม
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge kind="redemption" status={item.status}>
                    {redemptionStatusLabels[item.status] ?? item.status}
                  </StatusBadge>
                  {isBypass ? null : (
                    <form action={cancelMyRedemption}>
                      <input name="redemptionId" type="hidden" value={item.id} />
                      <ConfirmSubmitButton
                        className={buttonClass("ghost", "sm")}
                        confirmLabel="ยกเลิกการแลก"
                        message={`ยกเลิกการแลก ${item.reward_name} แล้วรับแต้มสะสมคืน ${item.cost.toLocaleString("th-TH")} แต้มสะสม`}
                        title="ยกเลิกการแลกของรางวัล"
                      >
                        ยกเลิก
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {view.rewards.length ? (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {view.rewards.map((reward) => {
              const outOfStock = reward.stock !== null && reward.stock <= 0;
              const enough = view.balance >= reward.cost;
              return (
                <li className="flex flex-col gap-2 rounded-lg border border-line p-3" key={reward.id}>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{reward.name}</p>
                    {reward.description ? <p className="text-sm text-ink-muted">{reward.description}</p> : null}
                    <p className="mt-1 text-sm text-ink-muted">
                      ใช้ <span className="font-semibold tabular-nums text-ink">{reward.cost.toLocaleString("th-TH")}</span> แต้มสะสม
                      {reward.stock !== null ? ` · เหลือ ${reward.stock.toLocaleString("th-TH")} ชิ้น` : ""}
                    </p>
                  </div>
                  {outOfStock ? (
                    <StatusBadge className="self-start" tone="neutral">
                      หมดแล้ว
                    </StatusBadge>
                  ) : (
                    <form action={redeemPointReward} className="mt-auto">
                      <input name="rewardId" type="hidden" value={reward.id} />
                      <ConfirmSubmitButton
                        className={`${buttonClass(enough ? "primary" : "secondary", "sm")} w-full`}
                        confirmLabel="แลกเลย"
                        disabled={!canRedeem || !enough}
                        message={`ใช้ ${reward.cost.toLocaleString("th-TH")} แต้มสะสมแลก ${reward.name} แล้วรับของที่ผู้ดูแลชมรม`}
                        title="แลกของรางวัล"
                        tone="primary"
                      >
                        {enough ? "แลก" : `ขาดอีก ${(reward.cost - view.balance).toLocaleString("th-TH")} แต้มสะสม`}
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">ชมรมยังไม่เปิดของรางวัลให้แลก</p>
        )}
      </section>

      {earnRules.length ? (
        <details className="group mt-5 rounded-lg border border-line">
          <summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50">
            วิธีได้แต้มสะสม
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {earnRules.map((rule) => (
              <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={rule.reason}>
                <span className="text-ink">{pointRuleLabels[rule.reason]}</span>
                <span className={`shrink-0 font-semibold tabular-nums ${rule.points > 0 ? "text-success" : "text-danger"}`}>
                  {formatPointDelta(rule.points)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </MemberSection>
  );
}
