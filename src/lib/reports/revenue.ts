// Monthly revenue for the reports chart (pure). Approved payments only, bucketed by the Bangkok
// month they were approved in (reviewed_at; created_at when an old row has no review time), and
// split by what the money paid for.

export const revenuePurposes = ["event", "lesson_package", "membership_fee", "other"] as const;
export type RevenuePurpose = (typeof revenuePurposes)[number];

export const revenuePurposeLabels: Record<RevenuePurpose, string> = {
  event: "กิจกรรม",
  lesson_package: "แพ็กเกจเรียน",
  membership_fee: "ค่าบำรุง",
  other: "อื่นๆ",
};

export type RevenuePaymentRow = {
  amount: number | string;
  created_at: string;
  /** Missing before migration 20261123091000: every row is an event payment then. */
  purpose?: string | null;
  reviewed_at: string | null;
  status: string;
};

export type RevenueMonth = {
  byPurpose: Record<RevenuePurpose, number>;
  count: number;
  /** "YYYY-MM" */
  month: string;
  total: number;
};

const bangkokMonthFormat = new Intl.DateTimeFormat("en-CA", {
  month: "2-digit",
  timeZone: "Asia/Bangkok",
  year: "numeric",
});

/** Bangkok calendar month ("YYYY-MM") of an ISO instant, or null when unparseable. */
export function bangkokMonth(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(bangkokMonthFormat.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}`;
}

/** Every month from the month of `from` to the month of `to` (both "YYYY-MM-DD"), inclusive. */
export function monthsInPeriod(from: string, to: string, maxMonths = 60) {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  while (months.length < maxMonths) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > endKey) break;
    months.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function toPurpose(value: string | null | undefined): RevenuePurpose {
  return (revenuePurposes as readonly string[]).includes(value ?? "") ? (value as RevenuePurpose) : value ? "other" : "event";
}

function emptyPurposes(): Record<RevenuePurpose, number> {
  return { event: 0, lesson_package: 0, membership_fee: 0, other: 0 };
}

/**
 * Approved revenue per month of the period (empty months are 0, so the chart keeps its gaps),
 * the purposes that actually have money (only those get a series), and totals.
 */
export function monthlyRevenue(rows: RevenuePaymentRow[], period: { from: string; to: string }) {
  const months = monthsInPeriod(period.from, period.to);
  const byMonth = new Map<string, RevenueMonth>(
    months.map((month) => [month, { byPurpose: emptyPurposes(), count: 0, month, total: 0 }]),
  );
  const purposeTotals = emptyPurposes();

  for (const row of rows) {
    if (row.status !== "approved") continue;
    const month = bangkokMonth(row.reviewed_at) ?? bangkokMonth(row.created_at);
    const bucket = month ? byMonth.get(month) : undefined;
    if (!bucket) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const purpose = toPurpose(row.purpose);
    bucket.byPurpose[purpose] += amount;
    bucket.total += amount;
    bucket.count += 1;
    purposeTotals[purpose] += amount;
  }

  const list = [...byMonth.values()];
  return {
    months: list,
    purposeTotals,
    purposes: revenuePurposes.filter((purpose) => purposeTotals[purpose] !== 0),
    total: list.reduce((sum, month) => sum + month.total, 0),
  };
}

export type MonthlyRevenue = ReturnType<typeof monthlyRevenue>;

const thaiMonthShort = new Intl.DateTimeFormat("th-TH", { month: "short", timeZone: "Asia/Bangkok", year: "2-digit" });
const thaiMonthLong = new Intl.DateTimeFormat("th-TH", { month: "long", timeZone: "Asia/Bangkok", year: "numeric" });

/** "2026-01" → "ม.ค. 69". */
export function formatThaiMonth(month: string) {
  return thaiMonthShort.format(new Date(`${month}-15T12:00:00+07:00`));
}

/** "2026-01" → "มกราคม 2569". */
export function formatThaiMonthLong(month: string) {
  return thaiMonthLong.format(new Date(`${month}-15T12:00:00+07:00`));
}

/** Clean y-axis steps (1 / 2 / 2.5 / 5 × 10ⁿ) covering `max`, 0 included. */
export function revenueTicks(max: number, target = 4) {
  if (!(max > 0)) return [0];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value < max + step * 0.999; value += step) ticks.push(Math.round(value * 100) / 100);
  return ticks;
}

/** Axis label: full numbers with grouping, "1.5 ล้าน" from a million up. */
export function formatAxisBaht(value: number) {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })} ล้าน`;
  }
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}
