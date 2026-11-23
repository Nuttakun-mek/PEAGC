"use client";

import { useEffect, useRef, useState } from "react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { buttonClass } from "@/components/ui/styles";
import { appIcons } from "@/lib/icons";

const SaveIcon = appIcons.save;

/**
 * Bulk approve bar for the member list. Row checkboxes live in the rows and point at this form with
 * `form={formId}`; this bar counts them, offers "เลือกทั้งหมด" and submits with a confirm dialog.
 */
export function MembersBulkApproveBar({ disabled, formId, total }: { disabled?: boolean; formId: string; total: number }) {
  const [selected, setSelected] = useState(0);
  const allRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="memberIds"][form="${formId}"]`));
    const update = () => {
      const all = boxes();
      const count = all.filter((box) => box.checked).length;
      setSelected(count);
      if (allRef.current) {
        allRef.current.checked = count > 0 && count === all.length;
        allRef.current.indeterminate = count > 0 && count < all.length;
      }
    };
    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (target?.name === "memberIds" && target.getAttribute("form") === formId) update();
    };
    document.addEventListener("change", onChange);
    update();
    return () => document.removeEventListener("change", onChange);
  }, [formId]);

  function toggleAll(checked: boolean) {
    document
      .querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="memberIds"][form="${formId}"]`)
      .forEach((box) => {
        if (!box.disabled) box.checked = checked;
      });
    const count = checked ? total : 0;
    setSelected(count);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-warning-bg/60 px-5 py-3">
      <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
        <input
          className="size-5 accent-brand-600"
          disabled={disabled}
          onChange={(event) => toggleAll(event.target.checked)}
          ref={allRef}
          type="checkbox"
        />
        เลือกทุกคนที่รอตรวจในหน้านี้ (<span className="tabular-nums">{total}</span> คน)
      </label>
      <div className="flex items-center gap-3">
        <span aria-live="polite" className="text-sm text-ink-muted">
          เลือกแล้ว <span className="font-semibold tabular-nums text-ink">{selected}</span> คน
        </span>
        <ConfirmSubmitButton
          className={buttonClass("primary", "sm")}
          confirmLabel="อนุมัติ"
          disabled={disabled || selected === 0}
          message={`อนุมัติสมาชิกที่เลือก ${selected} คน ทุกคนได้เลขสมาชิกและเข้าใช้งานได้ทันที`}
          title="อนุมัติหลายคนพร้อมกัน"
          tone="primary"
        >
          <SaveIcon className="size-4" aria-hidden="true" />
          อนุมัติที่เลือก
        </ConfirmSubmitButton>
      </div>
    </div>
  );
}
