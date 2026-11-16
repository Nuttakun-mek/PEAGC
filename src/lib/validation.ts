// Input rules shared by server actions and the matching form attributes, so the browser hint and
// the server check never disagree. Messages are Thai and say what a valid value looks like.

type Normalized = { ok: true; value: string | null } | { ok: false };

/** HTML `pattern` for a Thai mobile number typed as digits only. */
export const PHONE_PATTERN = "0[0-9]{9}";
export const PHONE_HINT = "ตัวเลข 10 หลัก ขึ้นต้นด้วย 0 เช่น 0812345678";
export const PHONE_ERROR = `เบอร์โทรไม่ถูกต้อง กรุณากรอก${PHONE_HINT}`;

export const EMAIL_HINT = "เช่น name@example.com";
export const EMAIL_ERROR = `รูปแบบอีเมลไม่ถูกต้อง ${EMAIL_HINT}`;

/**
 * Thai phone number → 10 digits starting with 0 ("0812345678"). Spaces, dashes, dots and
 * brackets are accepted and removed, and +66 is turned into a leading 0. Empty input is allowed
 * (`value: null`); callers decide whether the field is required.
 */
export function normalizePhone(input: string | null | undefined): Normalized {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, value: null };
  if (/[^0-9+\s\-().]/.test(raw)) return { ok: false };

  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+66") || (digits.length === 11 && digits.startsWith("66"))) {
    digits = `0${digits.slice(2)}`;
  }

  return /^0\d{9}$/.test(digits) ? { ok: true, value: digits } : { ok: false };
}

/** Lower-cased e-mail address, or an error when it does not look like one. Empty is allowed. */
export function normalizeEmail(input: string | null | undefined): Normalized {
  const value = (input ?? "").trim().toLowerCase();
  if (!value) return { ok: true, value: null };
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(value) ? { ok: true, value } : { ok: false };
}

/** Employee codes are compared without spaces and case ("uat 001" is the same person as "UAT001"). */
export function normalizeEmployeeCode(input: string | null | undefined) {
  return (input ?? "").replace(/\s+/g, "").toUpperCase();
}

/** Handicap index range accepted by the forms (WHS allows up to 54; plus handicaps go below 0). */
export const HANDICAP_MIN = -10;
export const HANDICAP_MAX = 54;

export function isValidHandicap(value: number | null) {
  return value === null || (Number.isFinite(value) && value >= HANDICAP_MIN && value <= HANDICAP_MAX);
}
