import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Club membership settings (club_membership_settings). A missing row means the defaults below;
 * keep them in sync with public.membership_settings_for() in the membership_points migration.
 */

export type MembershipSettings = {
  annualFee: number;
  autoApprove: boolean;
  directoryGraceDays: number;
  privacyPolicyVersion: string;
  renewalNoticeDays: number;
  termMonths: number;
};

export const PRIVACY_POLICY_VERSION = "2026-11";

export const defaultMembershipSettings: MembershipSettings = {
  annualFee: 0,
  autoApprove: true,
  directoryGraceDays: 30,
  privacyPolicyVersion: PRIVACY_POLICY_VERSION,
  renewalNoticeDays: 30,
  termMonths: 12,
};

export type MembershipSettingsRow = {
  annual_fee: number | string | null;
  auto_approve: boolean | null;
  directory_grace_days: number | null;
  privacy_policy_version: string | null;
  renewal_notice_days: number | null;
  term_months: number | null;
};

export function settingsFromRow(row: MembershipSettingsRow | null | undefined): MembershipSettings {
  if (!row) return { ...defaultMembershipSettings };
  const fee = Number(row.annual_fee ?? 0);
  return {
    annualFee: Number.isFinite(fee) && fee > 0 ? fee : 0,
    autoApprove: row.auto_approve ?? true,
    directoryGraceDays: row.directory_grace_days ?? defaultMembershipSettings.directoryGraceDays,
    privacyPolicyVersion: row.privacy_policy_version || PRIVACY_POLICY_VERSION,
    renewalNoticeDays: row.renewal_notice_days ?? defaultMembershipSettings.renewalNoticeDays,
    termMonths: row.term_months ?? defaultMembershipSettings.termMonths,
  };
}

export const membershipSettingsColumns =
  "auto_approve, annual_fee, term_months, renewal_notice_days, directory_grace_days, privacy_policy_version";

type IntField = { key: string; max: number; min: number };

function parseInteger(value: string, field: IntField) {
  if (!/^\d{1,4}$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return parsed >= field.min && parsed <= field.max ? parsed : null;
}

/** Admin form → row values, or the `?status=` key of the first invalid field. */
export function parseMembershipSettingsForm(form: { get(name: string): FormDataEntryValue | null }) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const feeText = text("annualFee").replace(/,/g, "");
  const annualFee = feeText === "" ? 0 : Number(feeText);
  if (!Number.isFinite(annualFee) || annualFee < 0 || annualFee > 100000 || !/^\d+(\.\d{1,2})?$/.test(feeText || "0")) {
    return { error: "membership-fee-invalid", values: null } as const;
  }
  const termMonths = parseInteger(text("termMonths") || "12", { key: "termMonths", max: 36, min: 1 });
  const renewalNoticeDays = parseInteger(text("renewalNoticeDays") || "30", { key: "renewalNoticeDays", max: 120, min: 1 });
  const directoryGraceDays = parseInteger(text("directoryGraceDays") || "30", { key: "directoryGraceDays", max: 365, min: 0 });
  if (termMonths === null || renewalNoticeDays === null || directoryGraceDays === null) {
    return { error: "membership-number-invalid", values: null } as const;
  }
  return {
    error: null,
    values: {
      annual_fee: annualFee,
      auto_approve: text("autoApprove") === "on" || text("autoApprove") === "true",
      directory_grace_days: directoryGraceDays,
      renewal_notice_days: renewalNoticeDays,
      term_months: termMonths,
    },
  } as const;
}

/**
 * Settings for a club. Falls back to the defaults when the row is missing or the table does not
 * exist yet (migration not applied); `error` says which.
 */
export async function loadMembershipSettings(supabase: SupabaseClient, clubId: string | null | undefined) {
  if (!clubId) return { error: null, settings: { ...defaultMembershipSettings } };
  const { data, error } = await supabase
    .from("club_membership_settings")
    .select(membershipSettingsColumns)
    .eq("club_id", clubId)
    .maybeSingle();
  return { error, settings: settingsFromRow(error ? null : (data as MembershipSettingsRow | null)) };
}
