import { saveMembershipSettings } from "@/app/admin/members/settings-actions";
import { StatusBanner } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass, fieldHint, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { appIcons } from "@/lib/icons";
import { type MembershipSettings, defaultMembershipSettings, loadMembershipSettings } from "@/lib/membership/settings";
import { classifyDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const MembersIcon = appIcons.members;
const SaveIcon = appIcons.save;

const messages: Record<string, { text: string; tone: "success" | "error" | "warning" }> = {
  "membership-fee-invalid": { text: "ค่าบำรุงต้องเป็นตัวเลข 0–100,000 บาท", tone: "error" },
  "membership-number-invalid": { text: "ตรวจตัวเลข: อายุสมาชิก 1–36 เดือน แจ้งเตือน 1–120 วัน ผ่อนผัน 0–365 วัน", tone: "error" },
  "membership-settings-failed": { text: "บันทึกการตั้งค่าสมาชิกไม่สำเร็จ", tone: "error" },
  "membership-settings-saved": { text: "บันทึกการตั้งค่าสมาชิกแล้ว", tone: "success" },
};

/**
 * "การรับสมาชิกและค่าบำรุง" on /admin/settings: auto-approve, annual fee, membership length,
 * renewal reminder and the grace period for members who left the association directory.
 */
export async function MembershipSettingsCard({
  canManage,
  clubId,
  isBypass,
  status,
}: {
  canManage: boolean;
  clubId: string | null;
  isBypass: boolean;
  status?: string;
}) {
  let settings: MembershipSettings = { ...defaultMembershipSettings };
  let outdated = false;
  if (!isBypass && clubId) {
    const supabase = await createClient();
    const result = await loadMembershipSettings(supabase, clubId);
    settings = result.settings;
    outdated = classifyDbError(result.error) === "schema-outdated";
  }
  const disabled = isBypass || !canManage || outdated;
  const message = status ? messages[status] : null;
  const input = fieldInputClass("md");

  return (
    <section aria-labelledby="membership-settings-title" className="mt-6 scroll-mt-20 rounded-xl border border-line bg-white p-5 shadow-card" id="membership">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <MembersIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-h3 font-semibold text-ink" id="membership-settings-title">
            การรับสมาชิกและค่าบำรุง
          </h2>
          <p className="mt-1 text-sm text-ink-muted">ใช้กับผู้สมัครใหม่และการต่ออายุ ตรวจวันหมดอายุทุกวันตอนตีหนึ่ง</p>
        </div>
      </div>

      {message ? (
        <StatusBanner className="mt-4" tone={message.tone}>
          {message.text}
        </StatusBanner>
      ) : null}
      {outdated ? (
        <StatusBanner className="mt-4" tone="warning">
          ฐานข้อมูลยังไม่ได้อัปเดต ตั้งค่าส่วนนี้ได้หลังอัปเดตฐานข้อมูล
        </StatusBanner>
      ) : null}

      <form action={saveMembershipSettings} className="mt-5 grid gap-5">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-4 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
          <input
            className="mt-1 size-5 shrink-0 accent-brand-600"
            defaultChecked={settings.autoApprove}
            disabled={disabled}
            name="autoApprove"
            type="checkbox"
          />
          <span>
            <span className="block font-semibold text-ink">อนุมัติอัตโนมัติ</span>
            <span className="block text-sm text-ink-muted">
              รหัสพนักงานอยู่ในฐานสมาชิกสมาคม (สถานะปกติ) และชื่อตรงกัน ได้เลขสมาชิกทันที ไม่ตรงเข้าคิวรอตรวจพร้อมเหตุผล
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={fieldLabel}>ค่าบำรุงรายปี</span>
            <span className="relative block">
              <input
                className={`${input} pr-12 tabular-nums`}
                defaultValue={settings.annualFee > 0 ? String(settings.annualFee) : ""}
                disabled={disabled}
                inputMode="decimal"
                min={0}
                name="annualFee"
                placeholder="0 = ไม่เก็บ"
                step="0.01"
                type="number"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 mt-0.75 -translate-y-1/2 text-sm text-ink-subtle">บาท</span>
            </span>
            <span className={fieldHint}>สมาชิกโอนผ่านพร้อมเพย์แล้วแนบสลิป</span>
          </label>
          <label className="block">
            <span className={fieldLabel}>อายุสมาชิกต่อครั้ง (เดือน)</span>
            <input className={`${input} tabular-nums`} defaultValue={settings.termMonths} disabled={disabled} max={36} min={1} name="termMonths" type="number" />
          </label>
          <label className="block">
            <span className={fieldLabel}>แจ้งเตือนต่ออายุล่วงหน้า (วัน)</span>
            <input
              className={`${input} tabular-nums`}
              defaultValue={settings.renewalNoticeDays}
              disabled={disabled}
              max={120}
              min={1}
              name="renewalNoticeDays"
              type="number"
            />
            <span className={fieldHint}>ช่วงนี้บัตรขึ้น &quot;ใกล้หมดอายุ&quot; และต่ออายุได้</span>
          </label>
          <label className="block">
            <span className={fieldLabel}>ผ่อนผันเมื่อหายจากฐานสมาคม (วัน)</span>
            <input
              className={`${input} tabular-nums`}
              defaultValue={settings.directoryGraceDays}
              disabled={disabled}
              max={365}
              min={0}
              name="directoryGraceDays"
              type="number"
            />
            <span className={fieldHint}>ครบกำหนดแล้วระงับสิทธิ์จอง</span>
          </label>
        </div>

        <SubmitButton className={`${buttonClass("primary")} w-full sm:w-fit`} disabled={disabled}>
          <SaveIcon className="size-4" aria-hidden="true" />
          บันทึกการตั้งค่าสมาชิก
        </SubmitButton>
      </form>
    </section>
  );
}
