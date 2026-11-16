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

/** Quick ranges offered above the report (past and future). */
export function reportPresets(today = bangkokDate()) {
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const monthEnd = new Date(Date.UTC(year, Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return [
    { from: `${month}-01`, label: "เดือนนี้", to: monthEnd },
    { from: today, label: "30 วันข้างหน้า", to: shiftDays(today, 30) },
    { from: shiftDays(today, -30), label: "30 วันที่ผ่านมา", to: today },
    { from: `${year}-01-01`, label: "ปีนี้", to: `${year}-12-31` },
    { from: `${year - 1}-01-01`, label: "ปีที่แล้ว", to: `${year - 1}-12-31` },
  ];
}

