// What the "โอนเงิน" card shows: a PromptPay QR with the exact amount, the account name and the
// receiver ID, or the bank account when the club has no PromptPay. Pure so it is unit-tested.

import { formatPromptPayId, promptPayPayload } from "../promptpay";

import { type PaymentSettings, formatBankAccountNo, hasReceiverAccount } from "./settings";

export const PAYMENT_SETTINGS_MISSING_TEXT = "ชมรมยังไม่ได้ตั้งค่าบัญชีรับเงิน กรุณาติดต่อผู้ดูแล";

export type PromptPayCardData =
  | { kind: "missing"; message: string }
  | {
      accountName: string | null;
      /** Baht rounded to satang; 0 when the amount is unknown (QR then asks the payer to type it). */
      amount: number;
      bankAccountNo: string | null;
      bankName: string | null;
      description: string;
      kind: "ready";
      note: string | null;
      /** EMVCo text for the QR; null when the club only has a bank account. */
      qrPayload: string | null;
      promptPayId: string | null;
    };

export function promptPayCardData(amount: number, description: string, settings: PaymentSettings | null | undefined): PromptPayCardData {
  if (!hasReceiverAccount(settings)) return { kind: "missing", message: PAYMENT_SETTINGS_MISSING_TEXT };

  const rounded = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
  return {
    accountName: settings.accountName,
    amount: rounded,
    bankAccountNo: settings.bankAccountNo ? formatBankAccountNo(settings.bankAccountNo) : null,
    bankName: settings.bankName,
    description,
    kind: "ready",
    note: settings.note,
    promptPayId: settings.promptPayId ? formatPromptPayId(settings.promptPayId) : null,
    qrPayload: settings.promptPayId ? promptPayPayload(settings.promptPayId, rounded || null) : null,
  };
}
