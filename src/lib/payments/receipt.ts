// Receipts: number format (issued by the database trigger on approval) and the amount in Thai
// words for the printed receipt.

const RECEIPT_PATTERN = /^RC(\d{4})-(\d{6,})$/;

/** "RC2569-000123": per club, per Buddhist year of approval, running number of 6+ digits. */
export function formatReceiptNo(beYear: number, sequence: number) {
  return `RC${beYear}-${String(sequence).padStart(6, "0")}`;
}

export function parseReceiptNo(value: string | null | undefined) {
  const match = RECEIPT_PATTERN.exec((value ?? "").trim());
  return match ? { beYear: Number(match[1]), sequence: Number(match[2]) } : null;
}

/** Buddhist year on the Bangkok calendar (2026-12-31T20:00Z is already 2570). */
export function buddhistYear(date: Date) {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).getUTCFullYear() + 543;
}

const digitWords = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const placeWords = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** Words for 0 < n < 1,000,000 ("" for 0). A final 1 is "เอ็ด" when anything comes before it. */
function readBelowMillion(n: number, hasHigher: boolean) {
  const text = String(n);
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const digit = Number(text[index]);
    const place = text.length - 1 - index;
    if (digit === 0) continue;
    if (place === 0) out += digit === 1 && (n > 9 || hasHigher) ? "เอ็ด" : digitWords[digit];
    else if (place === 1) out += digit === 1 ? "สิบ" : digit === 2 ? "ยี่สิบ" : `${digitWords[digit]}สิบ`;
    else out += `${digitWords[digit]}${placeWords[place]}`;
  }
  return out;
}

function readInteger(n: number, hasHigher = false): string {
  if (n >= 1_000_000) {
    const high = Math.floor(n / 1_000_000);
    return `${readInteger(high, hasHigher)}ล้าน${readBelowMillion(n % 1_000_000, true)}`;
  }
  return readBelowMillion(n, hasHigher);
}

/**
 * Amount in Thai words as written on receipts and cheques:
 * 2200 → "สองพันสองร้อยบาทถ้วน", 1234.5 → "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์".
 */
export function bahtText(amount: number) {
  if (!Number.isFinite(amount)) return "";
  const satangTotal = Math.round(Math.abs(amount) * 100);
  const baht = Math.floor(satangTotal / 100);
  const satang = satangTotal % 100;
  const sign = amount < 0 && satangTotal > 0 ? "ลบ" : "";

  if (!baht && !satang) return "ศูนย์บาทถ้วน";
  const bahtPart = baht ? `${readInteger(baht)}บาท` : "";
  const satangPart = satang ? `${readBelowMillion(satang, false)}สตางค์` : "ถ้วน";
  return `${sign}${bahtPart}${satangPart}`;
}
