// Shared display helpers so every screen shows empty values, dates and phone numbers the same way.

const BANGKOK_TZ = "Asia/Bangkok";

/** The one wording for "no value" on every screen (instead of a mix of "-", "—" and blanks). */
export const UNSET = "ยังไม่ระบุ";

export function orUnset(value: string | number | null | undefined, fallback = UNSET): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

const thaiDate = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  timeZone: BANGKOK_TZ,
  year: "numeric",
});

const thaiDateWithWeekday = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  timeZone: BANGKOK_TZ,
  weekday: "short",
  year: "numeric",
});

function toDate(value: string) {
  // A bare calendar date is a Bangkok day; noon keeps it on the same day in every zone.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+07:00`) : new Date(value);
}

/** "2026-08-15" (or an ISO instant) → "15 ส.ค. 2569" on the Bangkok calendar. */
export function formatThaiDate(value: string | null | undefined, fallback = UNSET) {
  if (!value) return fallback;
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? fallback : thaiDate.format(date);
}

/** "2026-08-15" → "ส. 15 ส.ค. 2569". */
export function formatThaiDateWithWeekday(value: string | null | undefined, fallback = UNSET) {
  if (!value) return fallback;
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? fallback : thaiDateWithWeekday.format(date);
}

/** "0812345678" → "081-234-5678". Anything that is not a 10-digit number is shown as stored. */
export function formatPhone(value: string | null | undefined, fallback = UNSET) {
  if (!value || !value.trim()) return fallback;
  const digits = value.replace(/\D/g, "");
  return /^0\d{9}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : value;
}

/** Baht amount with Thai digit grouping, e.g. 2200 → "2,200 บาท". */
export function formatBaht(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return `${(Number.isFinite(amount) ? amount : 0).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}
