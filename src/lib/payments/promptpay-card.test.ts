import { describe, expect, it } from "vitest";

import { promptPayPayload } from "../promptpay";

import { PAYMENT_SETTINGS_MISSING_TEXT, promptPayCardData } from "./promptpay-card";
import { formatBankAccountNo, hasReceiverAccount, toPaymentSettings } from "./settings";

const base = { club_id: "club-1" };

describe("promptPayCardData", () => {
  it("builds a QR with the exact amount, the account name and the formatted ID", () => {
    const settings = toPaymentSettings({ ...base, account_name: "ชมรมกอล์ฟ กฟภ.", promptpay_id: "081-234-5678" });
    const data = promptPayCardData(2200, "ค่าสมัคร ออกรอบประจำเดือน", settings);
    expect(data).toEqual({
      accountName: "ชมรมกอล์ฟ กฟภ.",
      amount: 2200,
      bankAccountNo: null,
      bankName: null,
      description: "ค่าสมัคร ออกรอบประจำเดือน",
      kind: "ready",
      note: null,
      promptPayId: "081-234-5678",
      qrPayload: promptPayPayload("0812345678", 2200),
    });
    expect(data.kind === "ready" ? data.qrPayload : "").toContain("54072200.00");
  });

  it("rounds to satang and falls back to a QR without amount when the amount is unknown", () => {
    const settings = toPaymentSettings({ ...base, promptpay_id: "0994000165271" });
    const rounded = promptPayCardData(1499.999, "x", settings);
    expect(rounded.kind === "ready" ? rounded.amount : null).toBe(1500);
    const open = promptPayCardData(0, "x", settings);
    expect(open.kind === "ready" ? open.qrPayload : "").toBe(promptPayPayload("0994000165271"));
  });

  it("shows only the bank account when there is no PromptPay ID", () => {
    const settings = toPaymentSettings({ ...base, bank_account_no: "1234567890", bank_name: "ธนาคารกรุงไทย" });
    expect(promptPayCardData(500, "x", settings)).toMatchObject({ bankAccountNo: "123-4-56789-0", kind: "ready", qrPayload: null });
  });

  it("tells the member to contact the club when nothing is set", () => {
    expect(promptPayCardData(500, "x", null)).toEqual({ kind: "missing", message: PAYMENT_SETTINGS_MISSING_TEXT });
    expect(promptPayCardData(500, "x", toPaymentSettings({ ...base, account_name: "ชื่ออย่างเดียว", promptpay_id: "12" }))).toEqual({
      kind: "missing",
      message: "ชมรมยังไม่ได้ตั้งค่าบัญชีรับเงิน กรุณาติดต่อผู้ดูแล",
    });
  });
});

describe("toPaymentSettings", () => {
  it("defaults retention to 365 days and keeps automatic checks on", () => {
    const settings = toPaymentSettings(base);
    expect(settings).toMatchObject({ autoVerify: true, promptPayId: null, slipRetentionDays: 365 });
    expect(hasReceiverAccount(settings)).toBe(false);
    expect(toPaymentSettings({ ...base, auto_verify: false, slip_retention_days: 90 })).toMatchObject({ autoVerify: false, slipRetentionDays: 90 });
    expect(toPaymentSettings({ ...base, slip_retention_days: 5 }).slipRetentionDays).toBe(365);
  });

  it("formats 10-digit Thai bank accounts", () => {
    expect(formatBankAccountNo("1234567890")).toBe("123-4-56789-0");
    expect(formatBankAccountNo("12-345")).toBe("12-345");
  });
});
