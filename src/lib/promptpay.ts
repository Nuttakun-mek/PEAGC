/**
 * PromptPay QR payloads (EMVCo merchant-presented QR, Thai PromptPay profile).
 *
 * Any Thai banking app can scan the result and pre-fills the receiver and, when given, the
 * exact amount. The receiver is a mobile number (10 digits), a national ID / tax ID
 * (13 digits) or an e-wallet ID (15 digits).
 */

const PROMPTPAY_AID = "A000000677010111";

function field(id: string, value: string) {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as required by EMVCo tag 63. */
export function crc16(input: string) {
  let crc = 0xffff;
  for (let index = 0; index < input.length; index += 1) {
    crc ^= input.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Digits only; returns null when the ID is not a valid PromptPay receiver. */
export function normalizePromptPayId(raw: string | null | undefined) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  if (digits.length === 13 || digits.length === 15) return digits;
  return null;
}

function receiverField(id: string) {
  if (id.length === 10) {
    // 0812345678 -> 0066812345678
    return field("01", `66${id.slice(1)}`.padStart(13, "0"));
  }
  if (id.length === 13) return field("02", id);
  return field("03", id);
}

/**
 * Builds the QR text. `amount` (baht) makes it a one-time QR with the amount filled in;
 * leave it out for a reusable QR where the payer types the amount.
 */
export function promptPayPayload(receiver: string, amount?: number | null) {
  const id = normalizePromptPayId(receiver);
  if (!id) throw new Error("INVALID_PROMPTPAY_ID");
  const hasAmount = typeof amount === "number" && Number.isFinite(amount) && amount > 0;

  const body = [
    field("00", "01"),
    field("01", hasAmount ? "12" : "11"),
    field("29", field("00", PROMPTPAY_AID) + receiverField(id)),
    field("53", "764"),
    hasAmount ? field("54", amount.toFixed(2)) : "",
    field("58", "TH"),
  ].join("");

  const withCrcTag = `${body}6304`;
  return `${withCrcTag}${crc16(withCrcTag)}`;
}

/** "081-234-5678" / "1-2345-67890-12-3" style display of a PromptPay ID. */
export function formatPromptPayId(raw: string | null | undefined) {
  const id = normalizePromptPayId(raw);
  if (!id) return raw ?? "";
  if (id.length === 10) return `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;
  if (id.length === 13) return `${id.slice(0, 1)}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id.slice(12)}`;
  return id;
}
