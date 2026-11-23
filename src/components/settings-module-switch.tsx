"use client";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

const switchButton =
  "inline-flex h-11 shrink-0 items-center rounded-full px-1 outline-none transition focus-visible:ring-4 focus-visible:ring-brand-600/20 disabled:cursor-not-allowed disabled:opacity-50";

function Track({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={`flex h-7 w-12 items-center rounded-full transition ${on ? "bg-brand-600" : "bg-ink-subtle"}`}>
      <span className={`size-5 rounded-full bg-white shadow-sm transition ${on ? "translate-x-6" : "translate-x-1"}`} />
    </span>
  );
}

/**
 * On/off switch for one member-facing module. It is the submit button of the module form (the
 * form's hidden `enabled` field carries the new value) and asks first through ConfirmSubmitButton:
 * turning a module off warns that members lose access.
 */
export function SettingsModuleSwitch({ disabled, enabled, label }: { disabled?: boolean; enabled: boolean; label: string }) {
  const name = `เปิดให้สมาชิกใช้ ${label}`;

  if (disabled) {
    return (
      <button aria-checked={enabled} aria-label={name} className={switchButton} disabled role="switch" type="button">
        <Track on={enabled} />
      </button>
    );
  }

  return (
    <ConfirmSubmitButton
      aria-checked={enabled}
      aria-label={name}
      className={switchButton}
      confirmLabel={enabled ? "ปิดโมดูล" : "เปิดโมดูล"}
      message={
        enabled
          ? `ปิด "${label}" แล้วสมาชิกจะไม่เห็นเมนูนี้และทำรายการใหม่ไม่ได้ ผู้ดูแลยังเตรียมข้อมูลได้ตามปกติ`
          : `เปิด "${label}" แล้วสมาชิกจะเห็นเมนูนี้และใช้งานได้ทันที`
      }
      role="switch"
      title={enabled ? `ปิด ${label}?` : `เปิด ${label}?`}
      tone={enabled ? "danger" : "primary"}
    >
      <Track on={enabled} />
    </ConfirmSubmitButton>
  );
}
