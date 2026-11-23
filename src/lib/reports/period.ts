// Report date ranges (pure, shared by the reports page and its CSV export).

import { bangkokDate } from "../lessons/booking";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Report period from query params; defaults to the whole current (Bangkok) year, so rounds and
 * events already scheduled later this year are included (the old default stopped at today).
 */
export function reportPeriod(from?: string, to?: string, today = bangkokDate()) {
  const year = today.slice(0, 4);
  const start = from && datePattern.test(from) ? from : `${year}-01-01`;
  const end = to && datePattern.test(to) ? to : `${year}-12-31`;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Last day of a month (1-12) as "YYYY-MM-DD". */
function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Calendar quarter holding `today`: Jan–Mar, Apr–Jun, Jul–Sep or Oct–Dec. */
export function quarterRange(today = bangkokDate()) {
  const year = Number(today.slice(0, 4));
  const first = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
  return { from: `${year}-${String(first).padStart(2, "0")}-01`, to: lastDayOfMonth(year, first + 2) };
}

/** Thai fiscal year holding `today`: 1 Oct – 30 Sep (ปีงบประมาณ 2570 = 1 Oct 2026 – 30 Sep 2027). */
export function fiscalYearRange(today = bangkokDate()) {
  const year = Number(today.slice(0, 4));
  const startYear = Number(today.slice(5, 7)) >= 10 ? year : year - 1;
  return { from: `${startYear}-10-01`, to: `${startYear + 1}-09-30` };
}

/** Quick ranges offered above the report (past and future). */
export function reportPresets(today = bangkokDate()) {
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const monthEnd = lastDayOfMonth(year, Number(today.slice(5, 7)));
  return [
    { from: `${month}-01`, label: "เดือนนี้", to: monthEnd },
    { ...quarterRange(today), label: "ไตรมาสนี้" },
    { ...fiscalYearRange(today), label: "ปีงบประมาณนี้" },
    { from: today, label: "30 วันข้างหน้า", to: shiftDays(today, 30) },
    { from: shiftDays(today, -30), label: "30 วันที่ผ่านมา", to: today },
    { from: `${year}-01-01`, label: "ปีนี้", to: `${year}-12-31` },
    { from: `${year - 1}-01-01`, label: "ปีที่แล้ว", to: `${year - 1}-12-31` },
  ];
}

