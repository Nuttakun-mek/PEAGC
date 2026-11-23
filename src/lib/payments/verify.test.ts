import { describe, expect, it } from "vitest";

import { checkFileDuplicates, duplicateWarningText, isTransactionRefTaken } from "./duplicates";
import { type PaymentSettings, toPaymentSettings } from "./settings";
import type { SlipOkSlip } from "./slipok";
import { summarizeVerification } from "./verification";
import { evaluateSlip, maskedAccountMatches, nameMatches } from "./verify";

const settings: PaymentSettings = toPaymentSettings({
  account_name: "ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค",
  bank_account_no: "123-4-53109-0",
  bank_name: "ธนาคารกรุงไทย",
  club_id: "club-1",
  promptpay_id: "0994000165271",
});

function slip(overrides: Partial<SlipOkSlip> = {}, receiver: Partial<SlipOkSlip["receiver"]> = {}): SlipOkSlip {
  return {
    amount: 2200,
    receiver: { account: "xxx-x-x3109-x", bank: "006", displayName: "ชมรมกอล์ฟการไฟฟ้าส", name: null, proxy: null, proxyType: null, ...receiver },
    ref1: null,
    sender: { account: null, bank: "004", displayName: "นาย ก", name: null, proxy: null, proxyType: null },
    transRef: "REF1",
    transferredAt: "2026-11-20T03:15:07.000Z",
    ...overrides,
  };
}

describe("maskedAccountMatches", () => {
  it("compares only the digits the bank shows, at the same positions", () => {
    expect(maskedAccountMatches("xxx-x-x3109-x", "1234531090")).toBe("match");
    expect(maskedAccountMatches("XXX-X-XX123-4", "9999991234")).toBe("match");
    expect(maskedAccountMatches("xxx-x-x3109-x", "1234599990")).toBe("mismatch");
  });

  it("handles PromptPay phone numbers shown with the country code", () => {
    expect(maskedAccountMatches("086xxx0000", "0861230000")).toBe("match");
    expect(maskedAccountMatches("66-86-xxx-0000", "0861230000")).toBe("match");
    expect(maskedAccountMatches("xxx-xxx-1111", "0861230000")).toBe("mismatch");
  });

  it("cannot decide with fewer than 3 visible digits or nothing to compare", () => {
    expect(maskedAccountMatches("xxx-x-xxxx9-x", "1234531090")).toBe("unknown");
    expect(maskedAccountMatches("", "1234531090")).toBe("unknown");
    expect(maskedAccountMatches("xxx", "1234531090")).toBe("unknown");
    expect(maskedAccountMatches("xxx-1234", null)).toBe("unknown");
  });
});

describe("nameMatches", () => {
  it("accepts names the slip cut short, without titles", () => {
    expect(nameMatches(["นาย สวัสดี ค"], "สวัสดี ครับ")).toBe("match");
    expect(nameMatches(["ชมรมกอล์ฟการไฟฟ้าส"], "ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค")).toBe("match");
    expect(nameMatches([null, "PEA GOLF C"], "PEA Golf Club")).toBe("match");
  });

  it("flags a different name but cannot compare Thai with English", () => {
    expect(nameMatches(["นาย สมชาย ใจดี"], "ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค")).toBe("mismatch");
    expect(nameMatches(["THANATORN R"], "ธนาทร รักดี")).toBe("unknown");
    expect(nameMatches(["ก"], null)).toBe("unknown");
  });
});

describe("evaluateSlip", () => {
  it("passes when amount, receiver and time all match", () => {
    const result = evaluateSlip({ expectedAmount: 2200, notBefore: "2026-11-19T00:00:00Z", settings, slip: slip() });
    expect(result).toEqual({ amount: "match", passed: true, reasons: [], receiver: "match", time: "ok" });
  });

  it("explains a wrong amount in Thai", () => {
    const result = evaluateSlip({ expectedAmount: 2200, settings, slip: slip({ amount: 2000 }) });
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(["ยอดในสลิป 2,000 บาท ไม่ตรงกับยอดที่ต้องชำระ 2,200 บาท"]);
  });

  it("refuses money sent to another account", () => {
    const result = evaluateSlip({ expectedAmount: 2200, settings, slip: slip({}, { account: "xxx-x-x7777-x", displayName: "นาย มิจฉา" }) });
    expect(result.receiver).toBe("mismatch");
    expect(result.reasons[0]).toContain("ไม่ใช่บัญชีของชมรม");
  });

  it("matches a PromptPay receiver against the club's PromptPay ID", () => {
    const viaPromptPay = slip({}, { account: null, displayName: null, proxy: "x-xxxx-x0165-27-1", proxyType: "NATID" });
    expect(evaluateSlip({ expectedAmount: 2200, settings, slip: viaPromptPay }).receiver).toBe("match");
  });

  it("needs the club's account to check the receiver", () => {
    const result = evaluateSlip({ expectedAmount: 2200, settings: null, slip: slip() });
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(["ยังไม่ได้ตั้งค่าบัญชีรับเงินของชมรม จึงเทียบบัญชีผู้รับไม่ได้"]);
  });

  it("flags a slip dated before the registration", () => {
    const result = evaluateSlip({ expectedAmount: 2200, notBefore: "2026-11-21T00:00:00Z", settings, slip: slip() });
    expect(result.time).toBe("too-early");
    expect(result.passed).toBe(false);
  });
});

describe("duplicate slips", () => {
  it("blocks a file already approved for another payment", () => {
    expect(checkFileDuplicates([{ id: "p1", status: "approved" }], "p2").blocked).toBe(true);
  });

  it("warns (does not block) when the file is on a waiting or rejected payment", () => {
    const check = checkFileDuplicates([{ id: "p1", status: "review" }, { id: "p3", status: "rejected" }], "p2");
    expect(check.blocked).toBe(false);
    expect(check.warnings).toEqual([
      { payment_id: "p1", reason: "same-file", status: "review" },
      { payment_id: "p3", reason: "same-file", status: "rejected" },
    ]);
    expect(duplicateWarningText(check.warnings[0])).toBe("ไฟล์เดียวกับสลิปของอีกรายการ (รอตรวจ)");
  });

  it("ignores the payment being re-uploaded", () => {
    expect(checkFileDuplicates([{ id: "p2", status: "approved" }], "p2")).toEqual({ blocked: false, warnings: [] });
  });

  it("treats a transaction reference as taken unless the other payment was rejected", () => {
    expect(isTransactionRefTaken([{ id: "p1", status: "review" }], "p2")).toBe(true);
    expect(isTransactionRefTaken([{ id: "p1", status: "rejected" }], "p2")).toBe(false);
    expect(isTransactionRefTaken([{ id: "p2", status: "review" }], "p2")).toBe(false);
  });
});

describe("summarizeVerification", () => {
  it("labels automatic passes and manual checks for the admin", () => {
    expect(summarizeVerification({ auto: { checked_at: "", provider: "slipok", reasons: [], state: "passed" }, verified_by: "slipok" })).toMatchObject({
      label: "ผ่านอัตโนมัติ",
      tone: "success",
    });
    expect(summarizeVerification({ auto: { checked_at: "", provider: "slipok", reasons: ["ยอดไม่ตรง"], state: "failed" } })).toMatchObject({
      label: "ต้องตรวจเอง",
      reasons: ["ยอดไม่ตรง"],
    });
    expect(summarizeVerification({ auto: { checked_at: "", provider: "slipok", reasons: [], state: "unavailable" } }).reasons[0]).toContain("ตรวจอัตโนมัติไม่ได้");
    expect(summarizeVerification({ duplicates: [{ payment_id: "p", reason: "same-file", status: "review" }] })).toMatchObject({ label: "ต้องตรวจเอง", tone: "warning" });
    expect(summarizeVerification(null)).toEqual({ duplicates: [], label: null, reasons: [], tone: "neutral" });
  });
});
