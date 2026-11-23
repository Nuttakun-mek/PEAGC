import { ChevronDown } from "lucide-react";

import { formatBaht } from "@/lib/display";
import {
  type MonthlyRevenue,
  type RevenuePurpose,
  formatAxisBaht,
  formatThaiMonth,
  formatThaiMonthLong,
  revenuePurposeLabels,
  revenueTicks,
} from "@/lib/reports/revenue";

/**
 * Series colours, fixed per purpose (never re-assigned when a purpose has no money). Validated
 * with the dataviz palette checker on white: lightness band, chroma, adjacent and all-pairs CVD
 * separation pass. Gold is under 3:1 against white, so the chart always ships the legend and the
 * table view. Text never uses these colours.
 */
export const revenueSeriesColors: Record<RevenuePurpose, string> = {
  event: "#a63483",
  lesson_package: "#c69214",
  membership_fee: "#2a78d6",
  other: "#008300",
};

const PLOT_HEIGHT = 200;
const TOP = 28;
const BOTTOM = 32;
const LEFT = 72;
const RIGHT = 16;
const GAP = 2;
const RADIUS = 4;

/** Column with a rounded data end (top) and a square baseline end. */
function roundedTopPath(x: number, y: number, width: number, height: number) {
  const r = Math.min(RADIUS, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

function monthSummary(month: MonthlyRevenue["months"][number], purposes: RevenuePurpose[]) {
  const parts = purposes
    .filter((purpose) => month.byPurpose[purpose])
    .map((purpose) => `${revenuePurposeLabels[purpose]} ${formatBaht(month.byPurpose[purpose])}`);
  return `${formatThaiMonthLong(month.month)}: รวม ${formatBaht(month.total)}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

/**
 * Monthly approved revenue, stacked by what it paid for. Server-rendered SVG; every column has a
 * hover/focus readout with all series, and the same numbers are in the table below.
 */
export function ReportsRevenueChart({ revenue }: { revenue: MonthlyRevenue }) {
  const { months, purposes } = revenue;
  const band = months.length <= 6 ? 88 : months.length <= 12 ? 64 : 44;
  const barWidth = Math.min(24, band - 16);
  const width = LEFT + months.length * band + RIGHT;
  const height = TOP + PLOT_HEIGHT + BOTTOM;
  const maxTotal = Math.max(0, ...months.map((month) => month.total));
  const ticks = revenueTicks(maxTotal);
  const yMax = ticks[ticks.length - 1] || 1;
  const y = (value: number) => TOP + PLOT_HEIGHT - (value / yMax) * PLOT_HEIGHT;
  const peak = months.reduce<(typeof months)[number] | null>((best, month) => (month.total > (best?.total ?? 0) ? month : best), null);
  const labelEvery = band < 56 ? 2 : 1;
  const busiest = peak ? `เดือนที่รายรับสูงสุด ${formatThaiMonthLong(peak.month)} ${formatBaht(peak.total)}` : "";

  return (
    <div className="grid gap-4">
      <ul aria-label="คำอธิบายสี" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {purposes.map((purpose) => (
          <li className="flex items-center gap-2" key={purpose}>
            <span aria-hidden="true" className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: revenueSeriesColors[purpose] }} />
            <span className="text-ink-muted">{revenuePurposeLabels[purpose]}</span>
            <span className="font-semibold tabular-nums text-ink">{formatBaht(revenue.purposeTotals[purpose])}</span>
          </li>
        ))}
      </ul>

      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="relative" style={{ height, width }}>
          <svg aria-labelledby="revenue-chart-title revenue-chart-desc" className="block" height={height} role="img" width={width}>
            <title id="revenue-chart-title">รายรับรายเดือนที่อนุมัติแล้ว</title>
            <desc id="revenue-chart-desc">
              {`รวม ${formatBaht(revenue.total)} ใน ${months.length} เดือน${busiest ? ` · ${busiest}` : ""} · ตัวเลขทุกเดือนอยู่ในตารางใต้กราฟ`}
            </desc>

            {/* Gridlines and y-axis ticks: hairline, recessive. */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line stroke={tick === 0 ? "#c4cad4" : "#e2e8ef"} strokeWidth={1} x1={LEFT} x2={width - RIGHT} y1={Math.round(y(tick)) + 0.5} y2={Math.round(y(tick)) + 0.5} />
                <text
                  dominantBaseline="middle"
                  fill="#667085"
                  fontSize={13}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                  textAnchor="end"
                  x={LEFT - 10}
                  y={y(tick)}
                >
                  {formatAxisBaht(tick)}
                </text>
              </g>
            ))}

            {months.map((month, index) => {
              const x = LEFT + index * band + (band - barWidth) / 2;
              const stack = purposes.filter((purpose) => month.byPurpose[purpose] > 0);
              let base = 0;
              return (
                <g key={month.month}>
                  {stack.map((purpose, stackIndex) => {
                    const value = month.byPurpose[purpose];
                    const bottom = y(base);
                    const top = y(base + value);
                    base += value;
                    const isTop = stackIndex === stack.length - 1;
                    // 2px surface gap between stacked segments, taken from the lower segment.
                    const segmentTop = isTop ? top : top + GAP;
                    const segmentHeight = bottom - segmentTop;
                    if (segmentHeight < 0.5) return null;
                    return isTop ? (
                      <path d={roundedTopPath(x, segmentTop, barWidth, segmentHeight)} fill={revenueSeriesColors[purpose]} key={purpose} />
                    ) : (
                      <rect fill={revenueSeriesColors[purpose]} height={segmentHeight} key={purpose} width={barWidth} x={x} y={segmentTop} />
                    );
                  })}
                  {index % labelEvery === 0 || index === months.length - 1 ? (
                    <text fill="#667085" fontSize={13} textAnchor="middle" x={LEFT + index * band + band / 2} y={TOP + PLOT_HEIGHT + 22}>
                      {formatThaiMonth(month.month)}
                    </text>
                  ) : null}
                  {/* One direct label: the best month, on its cap. */}
                  {peak && peak.month === month.month ? (
                    <text
                      fill="#1f2937"
                      fontSize={13}
                      fontWeight={600}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                      textAnchor="middle"
                      x={LEFT + index * band + band / 2}
                      y={y(month.total) - 8}
                    >
                      {formatAxisBaht(month.total)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {/* Hover / keyboard layer: the whole column is the target; the readout lists every series. */}
          {months.map((month, index) => {
            const alignRight = index >= months.length / 2;
            return (
              <div
                aria-label={monthSummary(month, purposes)}
                className="group absolute rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                key={month.month}
                role="img"
                style={{ height: TOP + PLOT_HEIGHT - 4, left: LEFT + index * band + 2, top: 4, width: band - 4 }}
                tabIndex={0}
              >
                <span aria-hidden="true" className="absolute inset-0 rounded-md bg-ink/5 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-0 z-10 hidden w-52 rounded-lg border border-line bg-white p-3 text-left shadow-card group-hover:block group-focus-visible:block ${alignRight ? "right-full mr-2" : "left-full ml-2"}`}
                >
                  <span className="block text-xs text-ink-subtle">{formatThaiMonthLong(month.month)}</span>
                  <span className="mt-0.5 block text-h3 font-semibold tabular-nums text-ink">{formatBaht(month.total)}</span>
                  {purposes.map((purpose) => (
                    <span className="mt-1.5 flex items-center gap-2 text-sm" key={purpose}>
                      <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: revenueSeriesColors[purpose] }} />
                      <span className="font-semibold tabular-nums text-ink">{formatBaht(month.byPurpose[purpose])}</span>
                      <span className="text-ink-muted">{revenuePurposeLabels[purpose]}</span>
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <details className="group rounded-lg border border-line">
        <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50">
          ดูเป็นตาราง
          <ChevronDown aria-hidden="true" className="size-4 text-ink-subtle transition group-open:rotate-180" />
        </summary>
        <div className="overflow-x-auto border-t border-line px-4 pb-3">
          <table className="min-w-full text-sm">
            <caption className="sr-only">รายรับรายเดือนที่อนุมัติแล้ว แยกตามประเภท</caption>
            <thead className="border-b border-line">
              <tr>
                <th className="whitespace-nowrap py-2 pr-4 text-left text-xs font-medium text-ink-muted" scope="col">
                  เดือน
                </th>
                {purposes.map((purpose) => (
                  <th className="whitespace-nowrap py-2 pr-4 text-right text-xs font-medium text-ink-muted" key={purpose} scope="col">
                    {revenuePurposeLabels[purpose]}
                  </th>
                ))}
                <th className="whitespace-nowrap py-2 text-right text-xs font-medium text-ink-muted" scope="col">
                  รวม
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {months.map((month) => (
                <tr key={month.month}>
                  <th className="whitespace-nowrap py-2 pr-4 text-left font-normal text-ink" scope="row">
                    {formatThaiMonthLong(month.month)}
                  </th>
                  {purposes.map((purpose) => (
                    <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums text-ink" key={purpose}>
                      {formatBaht(month.byPurpose[purpose])}
                    </td>
                  ))}
                  <td className="whitespace-nowrap py-2 text-right font-semibold tabular-nums text-ink">{formatBaht(month.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line font-semibold">
              <tr>
                <th className="py-2 pr-4 text-left" scope="row">
                  รวม
                </th>
                {purposes.map((purpose) => (
                  <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums" key={purpose}>
                    {formatBaht(revenue.purposeTotals[purpose])}
                  </td>
                ))}
                <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatBaht(revenue.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </div>
  );
}
