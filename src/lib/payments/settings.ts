// Club bank / PromptPay account shown to members when they pay, and the slip-check options.
// Columns `auto_verify` and `slip_retention_days` come with the payments migration; until it is
// applied the base columns still load and the options fall back to their defaults.

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePromptPayId } from "../promptpay";

export const DEFAULT_SLIP_RETENTION_DAYS = 365;
export const MIN_SLIP_RETENTION_DAYS = 30;
export const MAX_SLIP_RETENTION_DAYS = 3650;

export type PaymentSettings = {
  accountName: string | null;
  /** Automatic slip check (SlipOK) on for this club; it only runs when the API keys are set. */
  autoVerify: boolean;
  bankAccountNo: string | null;
  bankName: string | null;
  clubId: string;
  note: string | null;
  /** Digits only (10, 13 or 15), already validated. */
  promptPayId: string | null;
  /** PDPA: slips of settled payments are deleted after this many days. */
  slipRetentionDays: number;
  updatedAt: string | null;
};

export type PaymentSettingsRow = {
  account_name?: string | null;
  auto_verify?: boolean | null;
  bank_account_no?: string | null;
  bank_name?: string | null;
  club_id: string;
  note?: string | null;
  promptpay_id?: string | null;
  slip_retention_days?: number | null;
  updated_at?: string | null;
};

function clean(value: string | null | undefined) {
  const text = (value ?? "").trim();
  return text ? text : null;
}

export function toPaymentSettings(row: PaymentSettingsRow): PaymentSettings {
  const days = Number(row.slip_retention_days);
  return {
    accountName: clean(row.account_name),
    autoVerify: row.auto_verify ?? true,
    bankAccountNo: clean(row.bank_account_no),
    bankName: clean(row.bank_name),
    clubId: row.club_id,
    note: clean(row.note),
    promptPayId: normalizePromptPayId(row.promptpay_id),
    slipRetentionDays: Number.isFinite(days) && days >= MIN_SLIP_RETENTION_DAYS ? Math.min(days, MAX_SLIP_RETENTION_DAYS) : DEFAULT_SLIP_RETENTION_DAYS,
    updatedAt: row.updated_at ?? null,
  };
}

/** True when members can be told where to pay (a PromptPay ID or a bank account number). */
export function hasReceiverAccount(settings: PaymentSettings | null | undefined): settings is PaymentSettings {
  return Boolean(settings && (settings.promptPayId || settings.bankAccountNo));
}

const baseColumns = "club_id, promptpay_id, account_name, bank_name, bank_account_no, note, updated_at";

/**
 * The club's payment settings, or null when none are saved or the table cannot be read.
 * Works with the user's client (RLS lets club members and staff read) or the service-role client.
 */
export async function loadPaymentSettings(supabase: SupabaseClient, clubId: string | null | undefined): Promise<PaymentSettings | null> {
  if (!clubId) return null;
  const table = () => supabase.from("club_payment_settings");
  let result = await table().select(`${baseColumns}, auto_verify, slip_retention_days`).eq("club_id", clubId).maybeSingle();
  if (result.error && ["42703", "PGRST204"].includes(result.error.code ?? "")) {
    result = await table().select(baseColumns).eq("club_id", clubId).maybeSingle();
  }
  if (result.error) {
    console.error("[payments] settings load:", result.error.code ?? "-", result.error.message ?? "");
    return null;
  }
  return result.data ? toPaymentSettings(result.data as PaymentSettingsRow) : null;
}

/** Thai banks, in the order members usually look for them. */
export const thaiBanks = [
  "ธนาคารกรุงไทย",
  "ธนาคารกสิกรไทย",
  "ธนาคารไทยพาณิชย์",
  "ธนาคารกรุงเทพ",
  "ธนาคารกรุงศรีอยุธยา",
  "ธนาคารทหารไทยธนชาต",
  "ธนาคารออมสิน",
  "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร",
  "ธนาคารอาคารสงเคราะห์",
  "ธนาคารยูโอบี",
  "ธนาคารซีไอเอ็มบีไทย",
  "ธนาคารเกียรตินาคินภัทร",
  "ธนาคารแลนด์ แอนด์ เฮ้าส์",
  "ธนาคารทิสโก้",
] as const;

/** "1234567890" → "123-4-56789-0" (the usual Thai 10-digit layout); other lengths as typed. */
export function formatBankAccountNo(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4, 9)}-${digits.slice(9)}`;
  return (value ?? "").trim();
}
