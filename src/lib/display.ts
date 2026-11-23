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

const thaiDateShort = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  timeZone: BANGKOK_TZ,
  weekday: "short",
  year: "2-digit",
});

const thaiDateLongParts = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "long",
  timeZone: BANGKOK_TZ,
  weekday: "long",
  year: "numeric",
});

const thaiTime = new Intl.DateTimeFormat("th-TH", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: BANGKOK_TZ,
});

const thaiDateTimeShort = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  timeZone: BANGKOK_TZ,
  year: "2-digit",
});

/** List rows: "2026-12-20" → "อา. 20 ธ.ค. 69". */
export function formatThaiDateShort(value: string | null | undefined, fallback = UNSET) {
  if (!value) return fallback;
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? fallback : thaiDateShort.format(date);
}

/** Detail pages: "2026-11-16" → "จันทร์ 16 พฤศจิกายน 2569" (no "วัน…ที่" filler). */
export function formatThaiDateLong(value: string | null | undefined, fallback = UNSET) {
  if (!value) return fallback;
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const parts = Object.fromEntries(thaiDateLongParts.formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = String(parts.weekday ?? "").replace(/^วัน/, "");
  return `${weekday} ${parts.day} ${parts.month} ${parts.year}`.trim();
}

/** "17:30:00" or "17:30" → "17:30 น."; an ISO instant → its Bangkok clock time. */
export function formatThaiTime(value: string | null | undefined, fallback = UNSET) {
  if (!value) return fallback;
  const clock = /^(\d{1,2}):(\d{2})/.exec(value);
  if (clock && !value.includes("T")) return `${clock[1].padStart(2, "0")}:${clock[2]} น.`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : `${thaiTime.format(date)} น.`;
}

/** Timestamps in lists: "16 พ.ย. 69 · 10:21 น.". */
export function formatThaiDateTime(value: string | null | undefined, fallback = UNSET) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : `${thaiDateTimeShort.format(date)} · ${thaiTime.format(date)} น.`;
}

/** Timestamps on detail pages: "จันทร์ 16 พฤศจิกายน 2569 · 10:21 น.". */
export function formatThaiDateTimeLong(value: string | null | undefined, fallback = UNSET) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : `${formatThaiDateLong(value)} · ${thaiTime.format(date)} น.`;
}

/** "0812345678" → "081-234-5678". Anything that is not a 10-digit number is shown as stored. */
export function formatPhone(value: string | null | undefined, fallback = UNSET) {
  if (!value || !value.trim()) return fallback;
  const digits = value.replace(/\D/g, "");
  return /^0\d{9}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : value;
}

/** A fee or price: 0 → "ฟรี", 1000 → "1,000 บาท". Use for registration fees and course prices. */
export function formatFee(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) && amount > 0 ? formatBaht(amount) : "ฟรี";
}

/** Tel link for a stored phone number, or null when it is not a dialable number. */
export function phoneHref(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return /^0\d{8,9}$/.test(digits) ? `tel:${digits}` : null;
}

/** Baht amount with Thai digit grouping, e.g. 2200 → "2,200 บาท". */
export function formatBaht(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return `${(Number.isFinite(amount) ? amount : 0).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}
