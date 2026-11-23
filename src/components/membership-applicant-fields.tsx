"use client";

import { useState } from "react";

import { EmployeeCodeChecker } from "@/components/employee-code-checker";
import { fieldHint, fieldLabel } from "@/components/ui/styles";

type ApplicantType = "staff" | "external";

const options: { hint: string; label: string; value: ApplicantType }[] = [
  { hint: "มีรหัสพนักงาน", label: "พนักงาน กฟภ.", value: "staff" },
  { hint: "มีสมาชิกรับรอง", label: "บุคคลภายนอก", value: "external" },
];

function Required() {
  return (
    <span aria-hidden="true" className="text-danger">
      {" "}*
    </span>
  );
}

/**
 * Sign-up identity: PEA staff give their employee code (checked live against the association
 * directory); outsiders give the member number of an active member who vouches for them.
 */
export function MembershipApplicantFields({
  defaultEmployeeCode,
  defaultSponsorCode,
  defaultType,
  disabled,
  inputClassName,
}: {
  defaultEmployeeCode?: string | null;
  defaultSponsorCode?: string | null;
  defaultType: ApplicantType;
  disabled?: boolean;
  inputClassName: string;
}) {
  const [type, setType] = useState<ApplicantType>(defaultType);

  return (
    <div className="grid content-start gap-4">
      <fieldset>
        <legend className={fieldLabel}>
          สมัครในฐานะ<Required />
        </legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {options.map((option) => {
            const checked = type === option.value;
            return (
              <label
                className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-600/15 ${
                  checked ? "border-brand-600 bg-brand-50" : "border-line bg-white hover:border-brand-600"
                } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                key={option.value}
              >
                <input
                  checked={checked}
                  className="size-4 shrink-0 accent-brand-600"
                  disabled={disabled}
                  name="applicantType"
                  onChange={() => setType(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${checked ? "text-brand-600" : "text-ink"}`}>{option.label}</span>
                  <span className="block text-xs text-ink-subtle">{option.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {type === "staff" ? (
        <label className="block">
          <span className={fieldLabel}>
            รหัสพนักงาน<Required />
          </span>
          <EmployeeCodeChecker defaultValue={defaultEmployeeCode} disabled={disabled} inputClassName={inputClassName} />
        </label>
      ) : (
        <label className="block">
          <span className={fieldLabel}>
            เลขสมาชิกผู้รับรอง<Required />
          </span>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            className={`${inputClassName} uppercase`}
            data-required-message="กรุณากรอกเลขสมาชิกของผู้รับรอง"
            defaultValue={defaultSponsorCode ?? ""}
            disabled={disabled}
            maxLength={20}
            name="sponsorCode"
            placeholder="เช่น PEAGC-0012"
            required
            spellCheck={false}
          />
          <span className={fieldHint}>สมาชิกชมรมที่ใช้งานอยู่ 1 คนรับรองว่ารู้จักคุณ แล้วผู้ดูแลอนุมัติ</span>
        </label>
      )}
    </div>
  );
}
