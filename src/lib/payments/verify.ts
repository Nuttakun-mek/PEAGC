// Compares what a slip says (SlipOK result) with what the club expects: the amount, the receiving
// account and the transfer time. Pure, so the rules are unit-tested. All reasons are Thai text for
// the admin who checks the slip by hand when the automatic check does not pass.

import { formatBaht, formatThaiDateTime } from "../display";

import type { PaymentSettings } from "./settings";
import type { SlipOkSlip } from "./slipok";

export type Match = "match" | "mismatch" | "unknown";

function phoneVariants(digits: string) {
  // 0812345678 may appear on a slip as 66812345678 / 0066812345678.
  return /^0\d{9}$/.test(digits) ? [digits, `66${digits.slice(1)}`, `0066${digits.slice(1)}`] : [digits];
}

/**
 * Masked account from a slip ("xxx-x-x3109-x", "086xxx0000") against the full number. Banks mask
 * different digits, so every digit that is shown must sit at the same position as in the real
 * number. Fewer than 3 visible digits cannot prove anything.
 */
export function maskedAccountMatches(masked: string | null | undefined, actual: string | null | undefined): Match {
  const shown = (masked ?? "").replace(/[^0-9xX]/g, "").toUpperCase();
  const digits = (actual ?? "").replace(/\D/g, "");
  if (!shown || !digits || !/\d/.test(shown)) return "unknown";

  const compare = (candidate: string) => {
    // Right-align: banks sometimes drop leading characters.
    const length = Math.min(candidate.length, shown.length);
    let compared = 0;
    for (let index = 1; index <= length; index += 1) {
      const char = shown[shown.length - index];
      if (char === "X") continue;
      if (char !== candidate[candidate.length - index]) return "mismatch" as const;
      compared += 1;
    }
    return compared >= 3 ? ("match" as const) : ("unknown" as const);
  };

  const candidates = phoneVariants(digits);
  const sameLength = candidates.filter((candidate) => candidate.length === shown.length);
  const results = (sameLength.length ? sameLength : candidates).map(compare);
  if (results.includes("match")) return "match";
  if (results.includes("mismatch")) return "mismatch";
  return "unknown";
}

const titles = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i;

function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .replace(titles, "")
    .toLowerCase()
    .replace(/[^a-z฀-๿]/g, "");
}

const isThai = (value: string) => /[฀-๿]/.test(value);

/**
 * Account holder name on the slip against the club's account name. Slips cut names short
 * ("นาย สวัสดี ค"), so a prefix in either direction is a match. Thai vs English cannot be compared.
 */
export function nameMatches(slipNames: Array<string | null | undefined>, accountName: string | null | undefined): Match {
  const account = normalizeName(accountName);
  if (account.length < 2) return "unknown";
  let compared = false;
  for (const raw of slipNames) {
    const name = normalizeName(raw);
    if (name.length < 2 || isThai(name) !== isThai(account)) continue;
    compared = true;
    if (account.startsWith(name) || name.startsWith(account) || account.includes(name)) return "match";
  }
  return compared ? "mismatch" : "unknown";
}

export type SlipEvaluation = {
  amount: Match;
  passed: boolean;
  reasons: string[];
  receiver: Match;
  time: "ok" | "too-early" | "unknown";
};

/** Transfers made up to this long before the record was created still count (clock skew). */
const EARLY_TOLERANCE_MS = 10 * 60 * 1000;

export function evaluateSlip({
  expectedAmount,
  notBefore,
  settings,
  slip,
}: {
  expectedAmount: number;
  /** The slip must not be older than this (when the registration or order was created). */
  notBefore?: string | null;
  settings: PaymentSettings | null;
  slip: SlipOkSlip;
}): SlipEvaluation {
  const reasons: string[] = [];

  const amount: Match = Math.abs(slip.amount - expectedAmount) < 0.01 ? "match" : "mismatch";
  if (amount === "mismatch") {
    reasons.push(`ยอดในสลิป ${formatBaht(slip.amount)} ไม่ตรงกับยอดที่ต้องชำระ ${formatBaht(expectedAmount)}`);
  }

  let receiver: Match = "unknown";
  if (!settings || (!settings.bankAccountNo && !settings.promptPayId)) {
    reasons.push("ยังไม่ได้ตั้งค่าบัญชีรับเงินของชมรม จึงเทียบบัญชีผู้รับไม่ได้");
  } else {
    const accountChecks: Match[] = [];
    if (settings.bankAccountNo) {
      accountChecks.push(maskedAccountMatches(slip.receiver.account, settings.bankAccountNo));
      accountChecks.push(maskedAccountMatches(slip.receiver.proxy, settings.bankAccountNo));
    }
    if (settings.promptPayId) {
      accountChecks.push(maskedAccountMatches(slip.receiver.proxy, settings.promptPayId));
      accountChecks.push(maskedAccountMatches(slip.receiver.account, settings.promptPayId));
    }
    const account: Match = accountChecks.includes("match") ? "match" : accountChecks.includes("mismatch") ? "mismatch" : "unknown";
    const name = nameMatches([slip.receiver.displayName, slip.receiver.name], settings.accountName);
    const shown = slip.receiver.account ?? slip.receiver.proxy ?? "";

    if (account === "mismatch") {
      receiver = "mismatch";
      reasons.push(`บัญชีผู้รับในสลิป${shown ? ` (${shown})` : ""} ไม่ใช่บัญชีของชมรม`);
    } else if (name === "mismatch") {
      receiver = "mismatch";
      const slipName = slip.receiver.displayName ?? slip.receiver.name ?? "";
      reasons.push(`ชื่อผู้รับในสลิป${slipName ? ` “${slipName}”` : ""} ไม่ตรงกับชื่อบัญชีของชมรม`);
    } else if (account === "match" || name === "match") {
      receiver = "match";
    } else {
      reasons.push("สลิปไม่แสดงเลขบัญชีหรือชื่อผู้รับพอให้เทียบได้");
    }
  }

  let time: SlipEvaluation["time"] = "unknown";
  if (slip.transferredAt) {
    const transferred = new Date(slip.transferredAt).getTime();
    const earliest = notBefore ? new Date(notBefore).getTime() - EARLY_TOLERANCE_MS : Number.NaN;
    if (Number.isFinite(earliest) && transferred < earliest) {
      time = "too-early";
      reasons.push(`สลิปโอนเมื่อ ${formatThaiDateTime(slip.transferredAt)} ก่อนสมัครรายการนี้`);
    } else {
      time = "ok";
    }
  }

  return { amount, passed: amount === "match" && receiver === "match" && time !== "too-early", reasons, receiver, time };
}
