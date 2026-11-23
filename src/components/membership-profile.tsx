import Link from "next/link";
import { Download, FileLock2, ShieldCheck, Trash2 } from "lucide-react";

import { requestDataDeletion } from "@/app/member/membership/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { MembershipApplicantFields } from "@/components/membership-applicant-fields";
import { buttonClass, fieldHint, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { formatThaiDateTime } from "@/lib/display";
import { loadMyMembership } from "@/lib/membership/member-data";

function Required() {
  return (
    <span aria-hidden="true" className="text-danger">
      {" "}*
    </span>
  );
}

/**
 * Identity block of the sign-up form: "พนักงาน กฟภ." (employee code, checked against the
 * association directory) or "บุคคลภายนอก" (member number of a sponsor). Replaces the plain
 * employee-code field; same field name `employeeCode`.
 */
export async function MembershipIdentityFields({
  defaultEmployeeCode,
  disabled,
  inputClassName,
  userId,
}: {
  defaultEmployeeCode?: string | null;
  disabled?: boolean;
  inputClassName: string;
  userId: string | null;
}) {
  const mine = await loadMyMembership(userId);
  const external = mine.member?.applicant_type === "external";
  return (
    <MembershipApplicantFields
      defaultEmployeeCode={defaultEmployeeCode}
      defaultSponsorCode={mine.sponsor?.member_code ?? null}
      defaultType={external ? "external" : "staff"}
      disabled={disabled}
      inputClassName={inputClassName}
    />
  );
}

/**
 * PDPA consent inside the sign-up / profile form: required once (stored with the policy version),
 * plus the optional consent to publish event photos, which members can change any time.
 */
export async function MembershipConsentFields({ disabled, userId }: { disabled?: boolean; userId: string | null }) {
  const mine = await loadMyMembership(userId);
  if (!mine.available && !disabled) return null;
  const consentedAt = mine.member?.pdpa_consent_at ?? null;

  return (
    <section aria-labelledby="consent-title" className="rounded-xl border border-line bg-white p-4 shadow-card sm:p-6" id="consent">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-h2 font-semibold text-ink" id="consent-title">
            ความยินยอมข้อมูลส่วนบุคคล
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            อ่าน
            <Link className="mx-1 font-semibold text-brand-600 underline underline-offset-4" href="/privacy">
              ประกาศความเป็นส่วนตัว
            </Link>
            ว่าชมรมเก็บข้อมูลอะไร ใช้ทำอะไร และเก็บนานเท่าไร
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {consentedAt ? (
          <p className="flex items-start gap-2 rounded-lg bg-success-bg px-3 py-2.5 text-sm font-medium text-success">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ยินยอมให้เก็บและใช้ข้อมูลแล้ว เมื่อ {formatThaiDateTime(consentedAt)}
          </p>
        ) : (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
            <input
              className="mt-1 size-5 shrink-0 accent-brand-600"
              data-required-message="กรุณาติ๊กยินยอมก่อนสมัครสมาชิก"
              disabled={disabled}
              name="pdpaConsent"
              required
              type="checkbox"
              value="yes"
            />
            <span className="text-base text-ink">
              ยินยอมให้ชมรมเก็บและใช้ชื่อ เบอร์โทร รหัสพนักงาน และประวัติการจอง/ออกรอบ เพื่อดูแลสมาชิก จัดคลาสเรียนและกิจกรรม
              <Required />
            </span>
          </label>
        )}

        <input name="photoConsentShown" type="hidden" value="1" />
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
          <input
            className="mt-1 size-5 shrink-0 accent-brand-600"
            defaultChecked={Boolean(mine.member?.photo_consent)}
            disabled={disabled}
            name="photoConsent"
            type="checkbox"
            value="yes"
          />
          <span className="text-base text-ink">
            ยินยอมให้ชมรมเผยแพร่รูปกิจกรรมที่มีฉันในข่าวและกลุ่มของชมรม
            <span className="block text-sm text-ink-muted">ไม่บังคับ เปลี่ยนใจได้ทุกเมื่อที่หน้านี้</span>
          </span>
        </label>
      </div>
    </section>
  );
}

/**
 * Outside the profile form: download my data (JSON of my own rows) and ask the club to delete it.
 * Shown once the member row exists.
 */
export async function MembershipPrivacyPanel({ isBypass, userId }: { isBypass: boolean; userId: string | null }) {
  const mine = await loadMyMembership(userId);
  if (!isBypass && (!mine.available || !mine.member)) return null;

  return (
    <section aria-labelledby="privacy-title" className="mt-5 rounded-xl border border-line bg-white p-4 shadow-card sm:p-6" id="privacy">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <FileLock2 className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-h2 font-semibold text-ink" id="privacy-title">
            ข้อมูลส่วนตัวของฉัน
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">ขอสำเนาหรือขอให้ลบข้อมูลได้ตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล (PDPA)</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-line p-4">
          <h3 className="font-semibold text-ink">ดาวน์โหลดข้อมูลของฉัน</h3>
          <p className="mt-1 text-sm text-ink-muted">ไฟล์ JSON รวมข้อมูลสมาชิก การจอง การชำระเงิน สกอร์ และแต้มสะสมของคุณ</p>
          {isBypass ? (
            <button className={`${buttonClass("secondary", "md")} mt-3`} disabled type="button">
              <Download className="size-4" aria-hidden="true" />
              ดาวน์โหลดข้อมูลของฉัน
            </button>
          ) : (
            <a className={`${buttonClass("secondary", "md")} mt-3`} download href="/member/membership/export">
              <Download className="size-4" aria-hidden="true" />
              ดาวน์โหลดข้อมูลของฉัน
            </a>
          )}
        </div>

        <div className="rounded-lg border border-danger/20 p-4">
          <h3 className="font-semibold text-ink">ขอลบข้อมูล</h3>
          {mine.openDeleteRequestAt ? (
            <p className="mt-1 text-sm text-warning">
              ส่งคำขอแล้วเมื่อ {formatThaiDateTime(mine.openDeleteRequestAt)} ผู้ดูแลจะติดต่อกลับและปิดบัญชีให้
            </p>
          ) : (
            <form action={requestDataDeletion} className="mt-1 grid gap-3">
              <p className="text-sm text-ink-muted">
                ผู้ดูแลจะปิดบัญชีและลบข้อมูลที่ไม่ต้องเก็บตามกฎหมาย ส่วนข้อมูลการเงินต้องเก็บไว้ตามระยะที่กฎหมายกำหนด
              </p>
              <label className="block">
                <span className={fieldLabel}>เหตุผล (ไม่บังคับ)</span>
                <textarea className={fieldTextarea} disabled={isBypass} maxLength={500} name="note" rows={2} />
                <span className={fieldHint}>ไม่เกิน 500 ตัวอักษร</span>
              </label>
              <ConfirmSubmitButton
                className={`${buttonClass("danger", "md")} w-full sm:w-fit`}
                confirmLabel="ส่งคำขอลบข้อมูล"
                disabled={isBypass}
                message="ส่งคำขอให้ผู้ดูแลลบข้อมูลและปิดบัญชีสมาชิกของคุณ เมื่อดำเนินการแล้วจะจองเรียนและสมัครกิจกรรมไม่ได้"
                title="ขอลบข้อมูล"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                ขอลบข้อมูล
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
