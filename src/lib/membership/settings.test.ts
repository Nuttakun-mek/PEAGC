import { describe, expect, it } from "vitest";

import { defaultMembershipSettings, parseMembershipSettingsForm, settingsFromRow } from "./settings";

function form(values: Record<string, string>) {
  return { get: (name: string) => values[name] ?? null };
}

describe("membership settings", () => {
  it("defaults when there is no row", () => {
    expect(settingsFromRow(null)).toEqual(defaultMembershipSettings);
  });

  it("parses the admin form", () => {
    expect(parseMembershipSettingsForm(form({ annualFee: "1,200", autoApprove: "on", directoryGraceDays: "45", renewalNoticeDays: "30", termMonths: "12" }))).toEqual({
      error: null,
      values: { annual_fee: 1200, auto_approve: true, directory_grace_days: 45, renewal_notice_days: 30, term_months: 12 },
    });
    expect(parseMembershipSettingsForm(form({})).values).toMatchObject({ annual_fee: 0, auto_approve: false });
  });

  it("rejects bad numbers", () => {
    expect(parseMembershipSettingsForm(form({ annualFee: "-5" })).error).toBe("membership-fee-invalid");
    expect(parseMembershipSettingsForm(form({ termMonths: "0" })).error).toBe("membership-number-invalid");
    expect(parseMembershipSettingsForm(form({ directoryGraceDays: "400" })).error).toBe("membership-number-invalid");
  });
});
