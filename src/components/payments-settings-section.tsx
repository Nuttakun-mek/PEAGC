import { Check, Landmark } from "lucide-react";

import { PromptPayPaymentCard } from "@/components/promptpay-payment-card";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, card, fieldHint, fieldInput, fieldInputClass, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { savePaymentSettings } from "@/app/admin/payments/settings-actions";
import { getStaffClub } from "@/lib/auth/staff";
import { formatThaiDateTime } from "@/lib/display";
import { formatPromptPayId } from "@/lib/promptpay";
import {
  DEFAULT_SLIP_RETENTION_DAYS,
  MAX_SLIP_RETENTION_DAYS,
  MIN_SLIP_RETENTION_DAYS,
  type PaymentSettings,
  formatBankAccountNo,
  loadPaymentSettings,
  thaiBanks,
} from "@/lib/payments/settings";
import { getSlipOkConfig } from "@/lib/payments/slipok";

const sampleSettings: PaymentSettings = {
  accountName: "ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค",
  autoVerify: true,
  bankAccountNo: "1234531090",
  bankName: "ธนาคารกรุงไทย",
  clubId: "sample-club",
  note: "โอนแล้วแนบสลิปในหน้าสมาชิก",
  promptPayId: "0994000165271",
  slipRetentionDays: DEFAULT_SLIP_RETENTION_DAYS,
  updatedAt: "2026-11-20T03:00:00.000Z",
};

const messages: Record<string, string> = {
  "payment-settings-account-invalid": "เลขบัญชีต้องเป็นตัวเลข (ใส่ขีดได้)",
  "payment-settings-failed": "บันทึกบัญชีรับเงินไม่สำเร็จ ลองอีกครั้ง",
  "payment-settings-partial": "บันทึกบัญชีรับเงินแล้ว แต่ตัวเลือกตรวจสลิปและระยะเก็บสลิปยังบันทึกไม่ได้ (ฐานข้อมูลยังไม่ได้อัปเดต)",
  "payment-settings-promptpay-invalid": "พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก เลขบัตรประชาชน/เลขผู้เสียภาษี 13 หลัก หรือ e-Wallet 15 หลัก",
  "payment-settings-retention-invalid": `ระยะเก็บสลิปต้องอยู่ระหว่าง ${MIN_SLIP_RETENTION_DAYS}–${MAX_SLIP_RETENTION_DAYS.toLocaleString("th-TH")} วัน`,
  "payment-settings-saved": "บันทึกบัญชีรับเงินแล้ว",
};

/**
 * "บัญชีรับเงิน" settings: PromptPay ID, account name, bank account, note for members, automatic
 * slip check, and how long slips are kept (PDPA). Shown on /admin/settings and
 * /admin/payments/settings (finance officers may edit; others with access read only).
 */
export async function PaymentSettingsSection({
  clubId,
  isBypass,
  returnTo,
  status,
}: {
  clubId: string | null;
  isBypass: boolean;
  returnTo: "/admin/settings" | "/admin/payments/settings";
  status?: string;
}) {
  let settings: PaymentSettings | null = isBypass ? sampleSettings : null;
  let canEdit = false;

  if (!isBypass && clubId) {
    const staff = await getStaffClub(["platform_owner", "club_admin", "finance_officer"]);
    canEdit = staff.status === "ok";
    settings = await loadPaymentSettings(staff.supabase, clubId);
  }

  const slipOkReady = Boolean(getSlipOkConfig());
  const message = status ? messages[status] : null;
  const disabled = isBypass || !canEdit;

  return (
    <section aria-labelledby="payment-settings-title" className={`${card} scroll-mt-24`} id="payment-settings">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Landmark className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-h3 font-semibold text-ink" id="payment-settings-title">
            บัญชีรับเงิน
          </h2>
          <p className="mt-1 text-sm text-ink-muted">สมาชิกเห็นคิวอาร์พร้อมเพย์พร้อมยอดเงินและชื่อบัญชีนี้ตอนจ่ายค่าสมัคร ค่าแพ็กเกจเรียน และค่าบำรุง</p>
          {settings?.updatedAt ? <p className="mt-1 text-xs text-ink-subtle">แก้ไขล่าสุด {formatThaiDateTime(settings.updatedAt)}</p> : null}
        </div>
      </div>

      {message ? (
        <StatusBanner className="mt-4" floating tone={toneForStatus(status)}>
          {message}
        </StatusBanner>
      ) : null}
      {!isBypass && !canEdit ? (
        <StatusBanner className="mt-4" tone="info">
          ดูได้อย่างเดียว เฉพาะเหรัญญิกหรือผู้ดูแลชมรมที่แก้บัญชีรับเงินได้
        </StatusBanner>
      ) : null}

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <form action={savePaymentSettings} className="grid content-start gap-4">
          <input name="returnTo" type="hidden" value={returnTo} />
          <fieldset className="grid gap-4 sm:grid-cols-2" disabled={disabled}>
            <legend className="sr-only">บัญชีรับเงินของชมรม</legend>
            <label className="block">
              <span className={fieldLabel}>พร้อมเพย์</span>
              <input
                autoComplete="off"
                className={`${fieldInput} tabular-nums`}
                defaultValue={settings?.promptPayId ? formatPromptPayId(settings.promptPayId) : ""}
                inputMode="numeric"
                name="promptpayId"
                placeholder="เบอร์มือถือ หรือเลข 13 หลัก"
              />
              <span className={fieldHint}>เบอร์มือถือ 10 หลัก เลขผู้เสียภาษี 13 หลัก หรือ e-Wallet 15 หลัก</span>
            </label>
            <label className="block">
              <span className={fieldLabel}>ชื่อบัญชี</span>
              <input className={fieldInput} defaultValue={settings?.accountName ?? ""} maxLength={120} name="accountName" placeholder="ตามที่แอปธนาคารแสดง" />
              <span className={fieldHint}>ใช้เทียบชื่อผู้รับในสลิป</span>
            </label>
            <label className="block">
              <span className={fieldLabel}>ธนาคาร</span>
              <input className={fieldInput} defaultValue={settings?.bankName ?? ""} list="payment-settings-banks" maxLength={120} name="bankName" />
              <datalist id="payment-settings-banks">
                {thaiBanks.map((bank) => (
                  <option key={bank} value={bank} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className={fieldLabel}>เลขบัญชี</span>
              <input
                autoComplete="off"
                className={`${fieldInput} tabular-nums`}
                defaultValue={settings?.bankAccountNo ? formatBankAccountNo(settings.bankAccountNo) : ""}
                inputMode="numeric"
                maxLength={30}
                name="bankAccountNo"
                placeholder="123-4-56789-0"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className={fieldLabel}>ข้อความถึงสมาชิก</span>
              <textarea className={fieldTextarea} defaultValue={settings?.note ?? ""} maxLength={500} name="note" placeholder="เช่น โอนแล้วแนบสลิปภายใน 3 วัน" />
            </label>

            <div className="rounded-lg border border-line bg-canvas p-4 sm:col-span-2">
              <label className="flex items-start gap-3">
                <input
                  className="mt-1 size-5 shrink-0 accent-brand-600"
                  defaultChecked={settings?.autoVerify ?? true}
                  name="autoVerify"
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    ตรวจสลิปอัตโนมัติ
                    {slipOkReady ? <StatusBadge tone="success">เชื่อม SlipOK แล้ว</StatusBadge> : <StatusBadge tone="neutral">ยังไม่ได้ตั้งค่า SlipOK</StatusBadge>}
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">
                    อ่าน QR บนสลิป เทียบยอดและบัญชีผู้รับ ตรงครบอนุมัติให้ทันที ไม่ตรงหรือตรวจไม่ได้จะรอให้เหรัญญิกตรวจ
                  </span>
                  {slipOkReady ? null : (
                    <span className="mt-1 block text-xs text-ink-subtle">ยังไม่ได้ตั้งค่า SlipOK (SLIPOK_BRANCH_ID, SLIPOK_API_KEY) ทุกสลิปจึงต้องตรวจเอง</span>
                  )}
                </span>
              </label>
            </div>

            <label className="block sm:col-span-2">
              <span className={fieldLabel}>
                เก็บรูปสลิปไว้<span aria-hidden="true" className="text-danger"> *</span>
              </span>
              <span className="relative mt-1.5 block sm:max-w-56">
                <input
                  className={`${fieldInputClass("md", { margin: false })} pr-12 tabular-nums`}
                  defaultValue={settings?.slipRetentionDays ?? DEFAULT_SLIP_RETENTION_DAYS}
                  inputMode="numeric"
                  max={MAX_SLIP_RETENTION_DAYS}
                  min={MIN_SLIP_RETENTION_DAYS}
                  name="slipRetentionDays"
                  required
                  step={1}
                  type="number"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-subtle">วัน</span>
              </span>
              <span className={fieldHint}>
                นับจากวันที่ตรวจเสร็จ เลยกำหนดแล้วลบรูปสลิปทุกคืน (PDPA) รายการชำระเงินและใบเสร็จยังอยู่ สลิปที่ยังรอตรวจไม่ถูกลบ
              </span>
            </label>
          </fieldset>

          {disabled ? null : (
            <SubmitButton className={`${buttonClass("primary", "lg")} w-full sm:w-fit`} pendingText="กำลังบันทึก...">
              <Check className="size-4" aria-hidden="true" />
              บันทึกบัญชีรับเงิน
            </SubmitButton>
          )}
        </form>

        <div className="min-w-0">
          <p className="mb-2 text-sm font-medium text-ink-muted">ตัวอย่างที่สมาชิกเห็น (ยอด 100 บาท)</p>
          <PromptPayPaymentCard amount={100} description="ค่าสมัครกิจกรรม" settings={settings} />
          {settings?.promptPayId ? (
            <p className="mt-2 text-xs text-ink-subtle">ลองสแกนด้วยแอปธนาคาร ชื่อบัญชีที่ขึ้นต้องเป็นของชมรม (ไม่ต้องกดโอน)</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
