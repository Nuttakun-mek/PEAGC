import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  adjustMemberPoints,
  createPointReward,
  decideRedemption,
  savePointRules,
  updatePointReward,
} from "@/app/admin/points/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CreatePanel } from "@/components/create-panel";
import { MemberAvatar } from "@/components/member-avatar";
import { LoadErrorBanner, StatusBanner } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, card, fieldHint, fieldInputClass, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { formatThaiDateShort, formatThaiDateTime } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { addMonths, bangkokToday } from "@/lib/membership/lifecycle";
import {
  type ResolvedPointRule,
  formatPointDelta,
  pointReasonLabels,
  pointRuleLabels,
  resolvePointRules,
} from "@/lib/points/rules";
import { classifyDbError, collectLoadErrors, dbFailureMessages } from "@/lib/supabase/errors";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

type MemberRef = { full_name: string; member_code: string | null } | null;
type Leader = { avatar_url: string | null; full_name: string; member_code: string | null; member_id: string; nickname: string | null; points: number; rank: number };
type Reward = { cost: number; description: string | null; id: string; name: string; status: string; stock: number | null };
type Redemption = { cost: number; id: string; member_id: string; members: MemberRef; requested_at: string; reward_name: string; status: string };
type Txn = { created_at: string; delta: number; id: string; member_id: string; members: MemberRef; note: string | null; reason: string };

const PointsIcon = appIcons.points;
const SaveIcon = appIcons.save;
const AwardIcon = appIcons.awards;
const AddIcon = appIcons.add;

const statusMessages: Record<string, { text: string; tone: "success" | "error" | "warning" }> = {
  "adjust-failed": { text: "บันทึกแต้มสะสมไม่สำเร็จ", tone: "error" },
  "adjust-member-not-found": { text: "ไม่พบเลขสมาชิกนี้", tone: "error" },
  "adjust-missing": { text: "กรอกเลขสมาชิก จำนวน และเหตุผลให้ครบ", tone: "error" },
  "adjust-saved": { text: "บันทึกแต้มสะสมแล้ว", tone: "success" },
  "permission-denied": { text: dbFailureMessages["permission-denied"], tone: "error" },
  "db-outdated": { text: dbFailureMessages["db-outdated"], tone: "error" },
  duplicate: { text: dbFailureMessages.duplicate, tone: "error" },
  "points-invalid": { text: "จำนวนแต้มสะสมต้องเป็นตัวเลข 1–10,000", tone: "error" },
  "points-needs-reason": { text: "กรุณาใส่เหตุผล", tone: "error" },
  "points-redemption-closed": { text: "รายการนี้ส่งของแล้วหรือยกเลิกไปแล้ว", tone: "warning" },
  "redemption-cancelled": { text: "ยกเลิกการแลกและคืนแต้มสะสมแล้ว", tone: "success" },
  "redemption-failed": { text: "บันทึกรายการแลกไม่สำเร็จ", tone: "error" },
  "redemption-fulfilled": { text: "บันทึกส่งของแล้ว", tone: "success" },
  "reward-cost-invalid": { text: "แต้มสะสมที่ใช้แลกต้องเป็นตัวเลข 1–100,000", tone: "error" },
  "reward-created": { text: "เพิ่มของรางวัลแล้ว", tone: "success" },
  "reward-failed": { text: "บันทึกของรางวัลไม่สำเร็จ", tone: "error" },
  "reward-missing": { text: "กรอกชื่อของรางวัลและแต้มสะสมที่ใช้แลก", tone: "error" },
  "reward-saved": { text: "บันทึกของรางวัลแล้ว", tone: "success" },
  "reward-stock-invalid": { text: "จำนวนคงเหลือต้องเป็นตัวเลข หรือเว้นว่าง = ไม่จำกัด", tone: "error" },
  "rules-failed": { text: "บันทึกกติกาไม่สำเร็จ", tone: "error" },
  "rules-invalid": { text: "แต้มสะสมของแต่ละกติกาต้องเป็นตัวเลข 0–1,000", tone: "error" },
  "rules-saved": { text: "บันทึกกติกาแต้มสะสมแล้ว", tone: "success" },
  "text-corrupted": { text: "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) กรุณาพิมพ์ใหม่", tone: "error" },
};

const rewardStatusLabels: Record<string, string> = { active: "เปิดให้แลก", archived: "เก็บถาวร", inactive: "ปิดชั่วคราว" };
const rewardStatusTone: Record<string, "success" | "neutral"> = { active: "success", archived: "neutral", inactive: "neutral" };

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** "2026-11" from ?month=, default this month (Bangkok). */
function parseMonth(value: string | undefined, today: string) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : today.slice(0, 7);
}

const thaiMonth = new Intl.DateTimeFormat("th-TH", { month: "long", timeZone: "Asia/Bangkok", year: "numeric" });

function monthLabel(month: string) {
  return thaiMonth.format(new Date(`${month}-15T12:00:00+07:00`));
}

const sample = {
  leaders: [
    { avatar_url: null, full_name: "สมชาย ใจดี", member_code: "PEAGC-0003", member_id: "s3", nickname: "ชาย", points: 95, rank: 1 },
    { avatar_url: null, full_name: "วิภา รักกอล์ฟ", member_code: "PEAGC-0004", member_id: "s4", nickname: "วิ", points: 70, rank: 2 },
    { avatar_url: null, full_name: "ประเสริฐ ตีไกล", member_code: "PEAGC-0005", member_id: "s5", nickname: null, points: 40, rank: 3 },
  ] as Leader[],
  queue: [
    {
      cost: 100,
      id: "r1",
      member_id: "s4",
      members: { full_name: "วิภา รักกอล์ฟ", member_code: "PEAGC-0004" },
      requested_at: "2026-11-20T09:00:00+07:00",
      reward_name: "หมวกชมรม",
      status: "requested",
    },
  ] as Redemption[],
  recent: [
    { created_at: "2026-11-22T10:00:00+07:00", delta: 30, id: "t1", member_id: "s3", members: { full_name: "สมชาย ใจดี", member_code: "PEAGC-0003" }, note: null, reason: "event_checkin" },
    { created_at: "2026-11-21T18:00:00+07:00", delta: 20, id: "t2", member_id: "s5", members: { full_name: "ประเสริฐ ตีไกล", member_code: "PEAGC-0005" }, note: "ช่วยจัดงานวันเสาร์", reason: "staff_award" },
    { created_at: "2026-11-20T09:00:00+07:00", delta: -100, id: "t3", member_id: "s4", members: { full_name: "วิภา รักกอล์ฟ", member_code: "PEAGC-0004" }, note: "หมวกชมรม", reason: "redemption" },
    { created_at: "2026-11-18T19:00:00+07:00", delta: -10, id: "t4", member_id: "s4", members: { full_name: "วิภา รักกอล์ฟ", member_code: "PEAGC-0004" }, note: null, reason: "no_show" },
  ] as Txn[],
  rewards: [
    { cost: 100, description: "ปักโลโก้ชมรม", id: "w1", name: "หมวกชมรม", status: "active", stock: 12 },
    { cost: 300, description: null, id: "w2", name: "ส่วนลดค่าเรียน 300 บาท", status: "active", stock: null },
    { cost: 500, description: null, id: "w3", name: "เสื้อโปโลชมรม", status: "inactive", stock: 0 },
  ] as Reward[],
};

function RuleRow({ disabled, rule }: { disabled: boolean; rule: ResolvedPointRule }) {
  const deduct = rule.reason === "no_show";
  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_7rem] sm:items-center">
      <div className="min-w-0">
        <p className="font-medium text-ink">{pointRuleLabels[rule.reason]}</p>
        {rule.reason === "scorecard_on_time" ? (
          <p className="text-xs text-ink-subtle">นับจบรอบ = เวลาออกรอบ + 6 ชม. (ไม่ระบุเวลาออกรอบ = 18:00 น.)</p>
        ) : rule.reason === "staff_award" ? (
          <p className="text-xs text-ink-subtle">ค่าเริ่มต้นของฟอร์ม &quot;ให้แต้มสะสม&quot; ด้านบน</p>
        ) : null}
      </div>
      <label className="block">
        <span className="sr-only">{deduct ? "หักแต้มสะสม" : "ได้แต้มสะสม"} {pointRuleLabels[rule.reason]}</span>
        <span className="relative block">
          <span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold ${deduct ? "text-danger" : "text-success"}`}>
            {deduct ? "−" : "+"}
          </span>
          <input
            className={`${fieldInputClass("sm", { margin: false })} pl-7 tabular-nums`}
            defaultValue={Math.abs(rule.points)}
            disabled={disabled}
            inputMode="numeric"
            max={1000}
            min={0}
            name={`points_${rule.reason}`}
            type="number"
          />
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input className="size-5 accent-brand-600" defaultChecked={rule.enabled} disabled={disabled} name={`enabled_${rule.reason}`} type="checkbox" />
        ใช้กติกานี้
      </label>
    </li>
  );
}

function RewardFields({ disabled, reward }: { disabled: boolean; reward?: Reward }) {
  return (
    <>
      <label className="block sm:col-span-2">
        <span className={fieldLabel}>
          ชื่อของรางวัล<span aria-hidden="true" className="text-danger"> *</span>
        </span>
        <input className={fieldInputClass("sm")} defaultValue={reward?.name ?? ""} disabled={disabled} maxLength={120} name="name" required />
      </label>
      <label className="block">
        <span className={fieldLabel}>
          ใช้แต้มสะสม<span aria-hidden="true" className="text-danger"> *</span>
        </span>
        <input className={`${fieldInputClass("sm")} tabular-nums`} defaultValue={reward?.cost ?? ""} disabled={disabled} inputMode="numeric" max={100000} min={1} name="cost" required type="number" />
      </label>
      <label className="block">
        <span className={fieldLabel}>คงเหลือ (ชิ้น)</span>
        <input
          className={`${fieldInputClass("sm")} tabular-nums`}
          defaultValue={reward?.stock ?? ""}
          disabled={disabled}
          inputMode="numeric"
          min={0}
          name="stock"
          placeholder="ว่าง = ไม่จำกัด"
          type="number"
        />
      </label>
      <label className="block sm:col-span-2">
        <span className={fieldLabel}>รายละเอียด</span>
        <input className={fieldInputClass("sm")} defaultValue={reward?.description ?? ""} disabled={disabled} maxLength={300} name="description" />
      </label>
      <label className="block">
        <span className={fieldLabel}>สถานะ</span>
        <select className={fieldInputClass("sm")} defaultValue={reward?.status ?? "active"} disabled={disabled} name="status">
          {Object.entries(rewardStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export default async function AdminPointsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/points",
    requiredRole: "admin",
    searchParams: params,
  });
  await requireAdminArea("points", access);

  const today = bangkokToday();
  const month = parseMonth(params.month, today);
  const monthStart = `${month}-01`;
  const nextMonthStart = addMonths(monthStart, 1);
  const prevMonth = addMonths(monthStart, -1).slice(0, 7);
  const nextMonth = nextMonthStart.slice(0, 7);

  let rules = resolvePointRules(null);
  let leaders: Leader[] = sample.leaders;
  let rewards: Reward[] = sample.rewards;
  let queue: Redemption[] = sample.queue;
  let recent: Txn[] = sample.recent;
  let earned = 185;
  let spent = 100;
  let loadError: ReturnType<typeof collectLoadErrors> = null;

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const clubId = access.clubId;
    // Month bounds in Bangkok time.
    const fromIso = new Date(`${monthStart}T00:00:00+07:00`).toISOString();
    const toIso = new Date(`${nextMonthStart}T00:00:00+07:00`).toISOString();
    const [rulesResult, leadersResult, rewardsResult, queueResult, recentResult, monthResult] = await Promise.all([
      supabase.from("point_rules").select("reason, points, enabled").eq("club_id", clubId),
      supabase.rpc("point_leaderboard", { p_club: clubId, p_limit: 20, p_month: monthStart }),
      supabase.from("point_rewards").select("id, name, description, cost, stock, status").eq("club_id", clubId).neq("status", "archived").order("cost"),
      supabase
        .from("point_redemptions")
        .select("id, member_id, reward_name, cost, status, requested_at, members(full_name, member_code)")
        .eq("club_id", clubId)
        .eq("status", "requested")
        .order("requested_at", { ascending: true })
        .limit(100),
      supabase
        .from("point_txns")
        .select("id, member_id, delta, reason, note, created_at, members(full_name, member_code)")
        .eq("club_id", clubId)
        .order("created_at", { ascending: false })
        .limit(30),
      fetchAllRows<{ delta: number; reason: string }>((from, to) =>
        supabase
          .from("point_txns")
          .select("delta, reason")
          .eq("club_id", clubId)
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .order("id")
          .range(from, to),
      ),
    ]);

    loadError = collectLoadErrors("admin.points", [
      { error: rulesResult.error, label: "กติกา" },
      { error: leadersResult.error, label: "อันดับ" },
      { error: rewardsResult.error, label: "ของรางวัล" },
      { error: queueResult.error, label: "คำขอแลก" },
      { error: recentResult.error, label: "รายการล่าสุด" },
    ]);
    rules = resolvePointRules(rulesResult.data as { enabled: boolean; points: number; reason: string }[] | null);
    leaders = ((leadersResult.data ?? []) as Leader[]).map((row) => ({ ...row, points: Number(row.points), rank: Number(row.rank) }));
    rewards = (rewardsResult.data ?? []) as Reward[];
    queue = ((queueResult.data ?? []) as Array<Omit<Redemption, "members"> & { members: MemberRef | MemberRef[] }>).map((row) => ({ ...row, members: first(row.members) }));
    recent = ((recentResult.data ?? []) as Array<Omit<Txn, "members"> & { members: MemberRef | MemberRef[] }>).map((row) => ({ ...row, members: first(row.members) }));
    const monthRows = monthResult.data ?? [];
    earned = monthRows
      .filter((row) => ["attend_lesson", "event_checkin", "scorecard_on_time", "referral", "staff_award"].includes(row.reason))
      .reduce((sum, row) => sum + row.delta, 0);
    spent = monthRows.filter((row) => row.reason === "redemption").reduce((sum, row) => sum - row.delta, 0);
    if (!loadError && monthResult.error) loadError = collectLoadErrors("admin.points", [{ error: monthResult.error, label: "ยอดเดือนนี้" }]);
    if (loadError && classifyDbError(rulesResult.error) === "schema-outdated") loadError = { ...loadError, outdated: true };
  }

  const disabled = access.isBypass || Boolean(loadError?.outdated);
  const message = params.status ? statusMessages[params.status] : null;
  const messageText =
    params.status === "adjust-saved" && params.who
      ? `บันทึกแล้ว: ${params.who} ${formatPointDelta(Number(params.delta ?? 0))} แต้มสะสม`
      : params.status === "adjust-member-not-found" && params.code
        ? `ไม่พบเลขสมาชิก ${params.code}`
        : message?.text;
  const bypass = access.isBypass ? "&bypass=admin" : "";
  const kpis = [
    { label: `แต้มสะสมที่ได้ ${monthLabel(month)}`, value: earned },
    { label: `ใช้แลกของรางวัล ${monthLabel(month)}`, value: spent },
    { label: "คำขอแลกที่รอส่งของ", value: queue.length },
  ];

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader description="แต้มสะสมได้จากการเข้าเรียน ออกรอบ และช่วยงานชมรม ใช้แลกของรางวัล มีอายุ 12 เดือน" title="แต้มสะสม" />

        {message ? (
          <StatusBanner className="mt-4" floating tone={message.tone}>
            {messageText}
          </StatusBanner>
        ) : null}
        <LoadErrorBanner className="mt-4" error={loadError} />
        {access.isBypass ? (
          <StatusBanner className="mt-4" tone="warning">
            โหมดผู้ดูแลทดลอง: แสดงข้อมูลตัวอย่าง บันทึกไม่ได้
          </StatusBanner>
        ) : null}

        <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {kpis.map((kpi) => (
            <div className={card} key={kpi.label}>
              <dt className="text-sm font-medium text-ink-muted">{kpi.label}</dt>
              <dd className="mt-1 text-kpi font-semibold tabular-nums text-ink">{kpi.value.toLocaleString("th-TH")}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start">
          <div className="grid gap-6">
            <section aria-labelledby="queue-title" className={`${card} scroll-mt-20`} id="queue">
              <h2 className="text-h3 font-semibold text-ink" id="queue-title">
                คำขอแลกของรางวัล <span className="tabular-nums">{queue.length}</span> รายการ
              </h2>
              {queue.length ? (
                <ul className="mt-3 divide-y divide-line">
                  {queue.map((item) => (
                    <li className="grid gap-3 py-3 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-end" key={item.id}>
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{item.reward_name}</p>
                        <p className="text-sm text-ink-muted">
                          <Link className="font-medium text-brand-600 hover:underline" href={`/admin/members/${item.member_id}${access.isBypass ? "?bypass=admin" : ""}`}>
                            {item.members?.full_name ?? "สมาชิก"}
                          </Link>
                          {item.members?.member_code ? <span className="tabular-nums"> · {item.members.member_code}</span> : null}
                        </p>
                        <p className="text-xs text-ink-subtle">
                          {formatThaiDateTime(item.requested_at)} · <span className="tabular-nums">{item.cost.toLocaleString("th-TH")}</span> แต้มสะสม
                        </p>
                      </div>
                      <form action={decideRedemption} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                        <input name="redemptionId" type="hidden" value={item.id} />
                        <label className="block">
                          <span className={fieldLabel}>หมายเหตุ (ยกเลิกต้องใส่)</span>
                          <input className={fieldInputClass("sm")} disabled={disabled} maxLength={300} name="note" placeholder="เช่น รับที่สนามวันเสาร์" />
                        </label>
                        <button className={buttonClass("primary", "sm")} disabled={disabled} name="decision" type="submit" value="fulfilled">
                          <SaveIcon className="size-4" aria-hidden="true" />
                          ส่งของแล้ว
                        </button>
                        <ConfirmSubmitButton
                          className={buttonClass("danger", "sm")}
                          confirmLabel="ยกเลิกการแลก"
                          disabled={disabled}
                          message={`ยกเลิกการแลก ${item.reward_name} และคืน ${item.cost.toLocaleString("th-TH")} แต้มสะสมให้สมาชิก`}
                          name="decision"
                          title="ยกเลิกการแลกของรางวัล"
                          value="cancelled"
                        >
                          ยกเลิก
                        </ConfirmSubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">ไม่มีคำขอที่รอส่งของ</p>
              )}
            </section>

            <section aria-labelledby="adjust-title" className={`${card} scroll-mt-20`} id="adjust">
              <h2 className="text-h3 font-semibold text-ink" id="adjust-title">
                ให้หรือหักแต้มสะสม
              </h2>
              <p className="mt-1 text-sm text-ink-muted">ทุกครั้งต้องใส่เหตุผล บันทึกชื่อผู้ทำไว้ และสมาชิกเห็นในแจ้งเตือน</p>
              <form action={adjustMemberPoints} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                  <span className={fieldLabel}>
                    เลขสมาชิก<span aria-hidden="true" className="text-danger"> *</span>
                  </span>
                  <input autoComplete="off" className={`${fieldInputClass("md")} uppercase`} disabled={disabled} name="memberCode" placeholder="PEAGC-0012" required />
                </label>
                <label className="block">
                  <span className={fieldLabel}>ประเภท</span>
                  <select className={fieldInputClass("md")} defaultValue="award" disabled={disabled} name="kind">
                    <option value="award">ช่วยงานชมรม (+)</option>
                    <option value="add">เพิ่มแต้มสะสม (ปรับ)</option>
                    <option value="deduct">หักแต้มสะสม (ปรับ)</option>
                  </select>
                </label>
                <label className="block">
                  <span className={fieldLabel}>
                    จำนวนแต้มสะสม<span aria-hidden="true" className="text-danger"> *</span>
                  </span>
                  <input
                    className={`${fieldInputClass("md")} tabular-nums`}
                    defaultValue={Math.abs(rules.find((rule) => rule.reason === "staff_award")?.points ?? 20)}
                    disabled={disabled}
                    inputMode="numeric"
                    max={10000}
                    min={1}
                    name="points"
                    required
                    type="number"
                  />
                </label>
                <label className="block sm:col-span-2 lg:col-span-4">
                  <span className={fieldLabel}>
                    เหตุผล<span aria-hidden="true" className="text-danger"> *</span>
                  </span>
                  <textarea className={fieldTextarea} disabled={disabled} maxLength={300} name="note" placeholder="เช่น ช่วยจัดงานแข่งประจำเดือน พ.ย." required rows={2} />
                  <span className={fieldHint}>ไม่เกิน 300 ตัวอักษร</span>
                </label>
                <SubmitButton className={`${buttonClass("primary")} w-full sm:w-fit`} disabled={disabled}>
                  <SaveIcon className="size-4" aria-hidden="true" />
                  บันทึกแต้มสะสม
                </SubmitButton>
              </form>
            </section>

            <section aria-labelledby="recent-title" className={card}>
              <h2 className="text-h3 font-semibold text-ink" id="recent-title">
                รายการล่าสุด
              </h2>
              {recent.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs font-medium text-ink-subtle">
                        <th className="py-2 pr-3 font-medium" scope="col">วันที่</th>
                        <th className="py-2 pr-3 font-medium" scope="col">สมาชิก</th>
                        <th className="py-2 pr-3 font-medium" scope="col">รายการ</th>
                        <th className="py-2 text-right font-medium" scope="col">แต้มสะสม</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {recent.map((txn) => (
                        <tr key={txn.id}>
                          <td className="whitespace-nowrap py-2 pr-3 text-ink-muted">{formatThaiDateShort(txn.created_at)}</td>
                          <td className="py-2 pr-3 text-ink">
                            {txn.members?.full_name ?? "สมาชิก"}
                            {txn.members?.member_code ? <span className="ml-1 tabular-nums text-ink-subtle">{txn.members.member_code}</span> : null}
                          </td>
                          <td className="py-2 pr-3 text-ink">
                            {pointReasonLabels[txn.reason] ?? txn.reason}
                            {txn.note ? <span className="text-ink-muted"> · {txn.note}</span> : null}
                          </td>
                          <td className={`whitespace-nowrap py-2 text-right font-semibold tabular-nums ${txn.delta > 0 ? "text-success" : "text-danger"}`}>
                            {formatPointDelta(txn.delta)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">ยังไม่มีรายการ แต้มสะสมเริ่มขึ้นเมื่อเช็กชื่อเรียนหรือเช็กอินออกรอบ</p>
              )}
            </section>
          </div>

          <div className="grid gap-6">
            <section aria-labelledby="leaders-title" className={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-h3 font-semibold text-ink" id="leaders-title">
                  อันดับ{monthLabel(month)}
                </h2>
                <nav aria-label="เลือกเดือน" className="flex gap-1">
                  <Link aria-label="เดือนก่อน" className={buttonClass("ghost", "sm")} href={`/admin/points?month=${prevMonth}${bypass}#leaders-title`}>
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </Link>
                  {month < today.slice(0, 7) ? (
                    <Link aria-label="เดือนถัดไป" className={buttonClass("ghost", "sm")} href={`/admin/points?month=${nextMonth}${bypass}#leaders-title`}>
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </Link>
                  ) : null}
                </nav>
              </div>
              {leaders.length ? (
                <ol className="mt-3 divide-y divide-line">
                  {leaders.map((leader) => (
                    <li className="flex items-center gap-3 py-2" key={leader.member_id}>
                      <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-ink-muted">{leader.rank}</span>
                      <MemberAvatar avatarUrl={leader.avatar_url} displayName={leader.full_name} seed={leader.member_code ?? leader.member_id} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{leader.full_name}</span>
                        {leader.member_code ? <span className="block text-xs tabular-nums text-ink-subtle">{leader.member_code}</span> : null}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{leader.points.toLocaleString("th-TH")}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">เดือนนี้ยังไม่มีใครได้แต้มสะสม</p>
              )}
            </section>

            <section aria-labelledby="rules-title" className={`${card} scroll-mt-20`} id="rules">
              <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="rules-title">
                <PointsIcon className="size-5 text-brand-600" aria-hidden="true" />
                กติกาแต้มสะสม
              </h2>
              <p className="mt-1 text-sm text-ink-muted">ได้อัตโนมัติครั้งเดียวต่อรายการ แก้ตัวเลขแล้วใช้กับรายการถัดไป</p>
              <form action={savePointRules} className="mt-3">
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {rules.map((rule) => (
                    <RuleRow disabled={disabled} key={rule.reason} rule={rule} />
                  ))}
                </ul>
                <SubmitButton className={`${buttonClass("primary")} mt-4 w-full sm:w-fit`} disabled={disabled}>
                  <SaveIcon className="size-4" aria-hidden="true" />
                  บันทึกกติกา
                </SubmitButton>
              </form>
            </section>

            <section aria-labelledby="rewards-title" className={`${card} scroll-mt-20`} id="rewards">
              <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="rewards-title">
                <AwardIcon className="size-5 text-gold-700" aria-hidden="true" />
                ของรางวัล <span className="tabular-nums">{rewards.length}</span> รายการ
              </h2>
              {rewards.length ? (
                <ul className="mt-3 grid gap-2">
                  {rewards.map((reward) => (
                    <li key={reward.id}>
                      <details className="group rounded-lg border border-line">
                        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5 hover:bg-brand-50/50">
                          <span className="min-w-0">
                            <span className="block font-semibold text-ink">{reward.name}</span>
                            <span className="block text-sm text-ink-muted">
                              <span className="tabular-nums">{reward.cost.toLocaleString("th-TH")}</span> แต้มสะสม ·{" "}
                              {reward.stock === null ? "ไม่จำกัดจำนวน" : `เหลือ ${reward.stock.toLocaleString("th-TH")} ชิ้น`}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <StatusBadge tone={rewardStatusTone[reward.status] ?? "neutral"}>{rewardStatusLabels[reward.status] ?? reward.status}</StatusBadge>
                            <span className={`${buttonClass("secondary", "sm")} group-open:bg-brand-50`}>แก้ไข</span>
                          </span>
                        </summary>
                        <form action={updatePointReward} className="grid gap-3 border-t border-line p-3 sm:grid-cols-2">
                          <input name="rewardId" type="hidden" value={reward.id} />
                          <RewardFields disabled={disabled} reward={reward} />
                          <SubmitButton className={`${buttonClass("primary", "sm")} w-full sm:w-fit`} disabled={disabled}>
                            <SaveIcon className="size-4" aria-hidden="true" />
                            บันทึก
                          </SubmitButton>
                        </form>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">ยังไม่มีของรางวัล เพิ่มรายการแรกด้านล่าง สมาชิกจะเห็นในหน้าสมาชิก</p>
              )}
              <CreatePanel title="เพิ่มของรางวัล">
                <form action={createPointReward} className="grid gap-3 sm:grid-cols-2">
                  <RewardFields disabled={disabled} />
                  <SubmitButton className={`${buttonClass("primary", "sm")} w-full sm:w-fit`} disabled={disabled}>
                    <AddIcon className="size-4" aria-hidden="true" />
                    เพิ่มของรางวัล
                  </SubmitButton>
                </form>
              </CreatePanel>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
