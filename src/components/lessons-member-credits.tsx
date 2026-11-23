import { AlertTriangle } from "lucide-react";

import { requestLessonPackage, uploadLessonPackageSlip } from "@/app/member/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PaymentSlipInput } from "@/components/payment-slip-input";
import { PromptPayPaymentCard } from "@/components/promptpay-payment-card";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { formatBaht, formatFee, formatThaiDate } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { creditSummary, expiryLabel, expiryWarnings } from "@/lib/lessons/credits";
import { formatCredits, lessonEnrollmentStatusLabels } from "@/lib/lessons/labels";
import type { LessonEnrollmentBalance, LessonPackage } from "@/lib/lessons/types";
import type { PaymentSettings } from "@/lib/payments/settings";

const UploadIcon = appIcons.upload;
const PaymentsIcon = appIcons.payments;

type Payment = { amount: number; id: string; status: string };

function scopeText(programId: string | null, courseNames: Record<string, string>) {
  return programId ? `เฉพาะคอร์ส ${courseNames[programId] ?? "ที่กำหนด"}` : "ใช้ได้ทุกคอร์ส";
}

/**
 * "เครดิตของฉัน": credits left per package with the expiry (yellow when it runs out soon), and the
 * payment screen for packages waiting for a slip (PromptPay QR with the exact amount + slip upload).
 */
export async function LessonsMemberCredits({
  courseNames,
  demo,
  enrollments,
  now,
  packages,
  paymentSettings,
  payments,
  warningDays,
}: {
  courseNames: Record<string, string>;
  demo: boolean;
  enrollments: LessonEnrollmentBalance[];
  now: number;
  packages: LessonPackage[];
  paymentSettings: PaymentSettings | null;
  payments: Record<string, Payment>;
  warningDays: number;
}) {
  const summary = creditSummary(enrollments, { now });
  const warnings = expiryWarnings(enrollments, warningDays, now);
  const warned = new Set(warnings.map((item) => item.enrollment.enrollment_id));
  const active = enrollments.filter((item) => item.status === "active" && item.credits_remaining > 0 && item.expires_at && Date.parse(item.expires_at) > now);
  const pending = enrollments.filter((item) => item.status === "pending_payment");
  const past = enrollments.filter((item) => !active.includes(item) && !pending.includes(item));
  const validDays = new Map(packages.map((item) => [item.id, item.valid_days]));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg bg-canvas px-4 py-3">
        <div>
          <p className="text-sm font-medium text-ink-muted">เครดิตคงเหลือ</p>
          <p className="text-kpi font-semibold tabular-nums text-ink">
            {summary.available}
            <span className="ml-1 text-base font-medium text-ink-muted">ครั้ง</span>
          </p>
        </div>
        {summary.nextExpiry ? (
          <p className="pb-1 text-base text-ink-muted">หมดอายุเร็วสุด {formatThaiDate(summary.nextExpiry)}</p>
        ) : null}
      </div>

      {warnings.map(({ daysLeft, enrollment }) => (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2.5 text-base text-warning" key={enrollment.enrollment_id}>
          <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden="true" />
          <span>
            “{enrollment.package_name}” เหลือ {formatCredits(enrollment.credits_remaining)}{" "}
            {daysLeft <= 0 ? "หมดอายุวันนี้" : `หมดอายุใน ${daysLeft} วัน (${formatThaiDate(enrollment.expires_at)})`} รีบจองก่อนเครดิตหมดอายุ
          </span>
        </p>
      ))}

      {active.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {active.map((item) => {
            const percent = item.credits_total > 0 ? Math.round((item.credits_remaining * 100) / item.credits_total) : 0;
            return (
              <li className="rounded-lg border border-line p-4" key={item.enrollment_id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-base font-semibold text-ink">{item.package_name}</p>
                  <StatusBadge kind="enrollment" status={item.status}>
                    {lessonEnrollmentStatusLabels[item.status]}
                  </StatusBadge>
                </div>
                <p className="text-sm text-ink-muted">{scopeText(item.program_id, courseNames)}</p>
                <p className="mt-2 text-base text-ink-muted">
                  เหลือ <span className="text-h3 font-semibold tabular-nums text-ink">{item.credits_remaining}</span> จาก{" "}
                  <span className="tabular-nums">{item.credits_total}</span> ครั้ง
                </p>
                <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
                </div>
                <p className={`mt-2 text-sm ${warned.has(item.enrollment_id) ? "font-medium text-warning" : "text-ink-muted"}`}>
                  {expiryLabel(item.expires_at, now, warningDays)}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-base text-ink-muted">ยังไม่มีเครดิตที่ใช้ได้</p>
      )}

      {pending.length ? (
        <div className="grid gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
            <PaymentsIcon className="size-4 text-ink-subtle" aria-hidden="true" />
            แพ็กเกจรอชำระเงิน
          </h3>
          {pending.map((item) => {
            const payment = payments[item.enrollment_id];
            const inReview = payment?.status === "review";
            const rejected = payment?.status === "rejected";
            const days = item.package_id ? validDays.get(item.package_id) : undefined;
            return (
              <section
                aria-label={`ชำระเงิน ${item.package_name}`}
                className="scroll-mt-24 rounded-lg border border-warning/30 p-4"
                id={`pay-${item.enrollment_id}`}
                key={item.enrollment_id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-base font-semibold text-ink">{item.package_name}</p>
                  <StatusBadge kind="enrollment" status="pending_payment">
                    {inReview ? "รอตรวจสลิป" : lessonEnrollmentStatusLabels.pending_payment}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-base text-ink-muted">
                  {formatCredits(item.credits_total)} · {scopeText(item.program_id, courseNames)}
                  {days ? ` · ใช้ได้ ${days} วันหลังเครดิตเข้า` : ""}
                </p>
                <p className="mt-1 text-base text-ink">
                  ยอดชำระ <span className="font-semibold tabular-nums">{formatBaht(item.price)}</span>
                </p>
                {inReview ? (
                  <p className="mt-3 rounded-lg bg-info-bg px-3 py-2.5 text-base text-info">
                    ส่งสลิปแล้ว ผู้ดูแลกำลังตรวจ ตรวจผ่านแล้วเครดิตจะเข้าเอง
                  </p>
                ) : (
                  <>
                    {rejected ? (
                      <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2.5 text-base font-medium text-danger">
                        สลิปเดิมไม่ผ่านการตรวจ โอนให้ครบยอดแล้วส่งสลิปใหม่
                      </p>
                    ) : null}
                    <PromptPayPaymentCard
                      amount={Number(item.price)}
                      className="mt-3"
                      description={`แพ็กเกจเรียน ${item.package_name}`}
                      settings={paymentSettings}
                    />
                    <form action={uploadLessonPackageSlip} className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-start">
                      <input name="enrollmentId" type="hidden" value={item.enrollment_id} />
                      <PaymentSlipInput disabled={demo} name="slip" required />
                      <div>
                        <label className={fieldLabel} htmlFor={`lesson-slip-at-${item.enrollment_id}`}>
                          วันและเวลาที่โอน
                        </label>
                        <input
                          className={fieldInputClass("lg")}
                          disabled={demo}
                          id={`lesson-slip-at-${item.enrollment_id}`}
                          name="transferredAt"
                          type="datetime-local"
                        />
                      </div>
                      <SubmitButton
                        className={`${buttonClass("primary", "lg")} w-full sm:col-span-2 sm:w-fit`}
                        disabled={demo}
                        pendingText="กำลังส่งสลิป..."
                      >
                        <UploadIcon className="size-4" aria-hidden="true" />
                        ส่งสลิป
                      </SubmitButton>
                    </form>
                  </>
                )}
              </section>
            );
          })}
        </div>
      ) : null}

      {past.length ? (
        <details className="rounded-lg border border-line px-4 py-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold text-brand-600">
            แพ็กเกจที่ใช้หมดหรือหมดอายุ ({past.length})
          </summary>
          <ul className="mt-2 divide-y divide-line">
            {past.map((item) => (
              <li className="flex flex-wrap items-start justify-between gap-2 py-3" key={item.enrollment_id}>
                <div className="min-w-0">
                  <p className="text-base font-medium text-ink">{item.package_name}</p>
                  <p className="text-sm text-ink-muted">
                    ใช้ไป {item.credits_used} จาก {item.credits_total} ครั้ง
                    {item.expires_at ? ` · ${item.status === "active" ? "ใช้ได้ถึง" : "หมดอายุ"} ${formatThaiDate(item.expires_at)}` : ""}
                  </p>
                </div>
                <StatusBadge kind="enrollment" status={item.status === "active" ? "expired" : item.status}>
                  {item.status === "active" ? "ใช้ครบแล้ว" : lessonEnrollmentStatusLabels[item.status]}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** "ซื้อแพ็กเกจ": the club's packages for sale; free trials activate at once. */
export function LessonsMemberPackages({
  courseNames,
  demo,
  enrollments,
  isActive,
  packages,
}: {
  courseNames: Record<string, string>;
  demo: boolean;
  enrollments: LessonEnrollmentBalance[];
  isActive: boolean;
  packages: LessonPackage[];
}) {
  if (!packages.length) {
    return <p className="text-base text-ink-muted">ยังไม่มีแพ็กเกจเปิดขาย ติดต่อผู้ดูแลชมรม</p>;
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {packages.map((item) => {
        const pending = enrollments.find((enrollment) => enrollment.package_id === item.id && enrollment.status === "pending_payment");
        const used = enrollments.filter(
          (enrollment) => enrollment.package_id === item.id && (enrollment.status === "active" || enrollment.status === "expired"),
        ).length;
        const limitReached = item.max_per_member !== null && used >= item.max_per_member;
        const free = Number(item.price) <= 0;
        return (
          <li className="flex flex-col rounded-lg border border-line p-4" key={item.id}>
            <p className="text-h3 font-semibold text-ink">{item.name}</p>
            {item.description ? <p className="mt-1 text-base text-ink-muted">{item.description}</p> : null}
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-md bg-canvas px-3 py-2">
                <dt className="text-xs font-medium text-ink-subtle">เครดิต</dt>
                <dd className="font-semibold tabular-nums text-ink">{item.credits} ครั้ง</dd>
              </div>
              <div className="rounded-md bg-canvas px-3 py-2">
                <dt className="text-xs font-medium text-ink-subtle">ใช้ภายใน</dt>
                <dd className="font-semibold tabular-nums text-ink">{item.valid_days} วัน</dd>
              </div>
              <div className="rounded-md bg-canvas px-3 py-2">
                <dt className="text-xs font-medium text-ink-subtle">ราคา</dt>
                <dd className="font-semibold tabular-nums text-ink">{formatFee(item.price)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-sm text-ink-muted">
              {scopeText(item.program_id, courseNames)}
              {item.max_per_member ? ` · คนละ ${item.max_per_member} ครั้ง` : ""}
            </p>
            <div className="mt-auto pt-4">
              {pending ? (
                <a className={`${buttonClass("secondary", "lg")} w-full`} href={`#pay-${pending.enrollment_id}`}>
                  ไปชำระเงิน
                </a>
              ) : limitReached ? (
                <p className="text-base text-ink-muted">ใช้สิทธิ์แพ็กเกจนี้ครบแล้ว</p>
              ) : !isActive ? (
                <p className="text-base text-ink-muted">ซื้อได้เมื่อสมาชิกได้รับการอนุมัติ</p>
              ) : (
                <form action={requestLessonPackage}>
                  <input name="packageId" type="hidden" value={item.id} />
                  <input name="returnTo" type="hidden" value="/member/lessons" />
                  <ConfirmSubmitButton
                    className={`${buttonClass(free ? "gold" : "primary", "lg")} w-full`}
                    confirmLabel={free ? "รับสิทธิ์" : "สั่งซื้อ"}
                    details={
                      <dl className="grid gap-1.5 rounded-lg bg-canvas p-3">
                        <div>
                          <dt className="sr-only">แพ็กเกจ</dt>
                          <dd className="font-semibold text-ink">{item.name}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-ink-subtle">เครดิต</dt>
                          <dd>
                            {item.credits} ครั้ง · ใช้ได้ {item.valid_days} วัน
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-ink-subtle">ราคา</dt>
                          <dd className="font-semibold tabular-nums text-ink">{formatFee(item.price)}</dd>
                        </div>
                      </dl>
                    }
                    disabled={demo}
                    message={
                      free
                        ? "ได้เครดิตทันที เริ่มนับวันหมดอายุจากวันนี้"
                        : "สั่งซื้อแล้วโอนเงินตามยอดผ่านพร้อมเพย์ แนบสลิป เครดิตเข้าเมื่อผู้ดูแลตรวจสลิปแล้ว"
                    }
                    title={free ? "รับสิทธิ์แพ็กเกจ" : "สั่งซื้อแพ็กเกจ"}
                    tone="primary"
                  >
                    {free ? "รับสิทธิ์ฟรี" : "ซื้อแพ็กเกจ"}
                  </ConfirmSubmitButton>
                </form>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
