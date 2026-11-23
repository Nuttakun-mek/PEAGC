"use client";

import { useState } from "react";
import { Upload } from "lucide-react";

import { buttonClass, fieldLabel } from "@/components/ui/styles";

/**
 * File picker, "replace everyone" switch and submit for the monthly directory import. Submitting
 * only checks the file: the next screen shows who would be added, changed or become inactive, and
 * nothing is written until the admin presses "ยืนยันนำเข้า" there.
 */
export function EmployeesImportFields({
  activeMembers,
  disabled,
}: {
  /** Current active association members, shown in the replace warning. */
  activeMembers: number;
  disabled?: boolean;
}) {
  const [replaceMode, setReplaceMode] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="block min-w-0">
          <span className={fieldLabel}>
            ไฟล์รายชื่อ (.xlsx หรือ .csv)
            <span aria-hidden="true" className="text-danger">
              {" "}*
            </span>
          </span>
          <input
            accept=".xlsx,.xls,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/tab-separated-values"
            className="mt-1.5 block w-full rounded-lg border border-line bg-white px-3 py-2 text-ink file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1 file:font-semibold file:text-brand-600"
            data-required-message="เลือกไฟล์ Excel หรือ CSV ก่อนนำเข้า"
            disabled={disabled}
            name="employeeFile"
            required
            type="file"
          />
        </label>
        <button className={`${buttonClass("primary")} w-full sm:w-auto`} disabled={disabled} type="submit">
          <Upload className="size-4" aria-hidden="true" />
          ตรวจไฟล์ก่อนนำเข้า
        </button>
      </div>

      <label
        className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-sm transition ${
          replaceMode ? "border-warning/40 bg-warning-bg" : "border-line bg-white"
        }`}
      >
        <input
          checked={replaceMode}
          className="mt-1 size-4 shrink-0"
          disabled={disabled}
          name="replaceMode"
          onChange={(event) => setReplaceMode(event.target.checked)}
          type="checkbox"
        />
        <span>
          <span className="font-medium text-ink">แทนรายชื่อทั้งหมด (ไฟล์นี้คือรายชื่อครบทั้งเดือน)</span>
          <span className="mt-0.5 block text-ink-muted">
            ติ๊กเฉพาะเมื่อไฟล์มีสมาชิกครบทุกคน: คนที่ไม่อยู่ในไฟล์จะเปลี่ยนเป็น &quot;พ้นสภาพสมาชิก&quot;
            และสมาชิกชมรมของคนนั้นจะขึ้นให้ตรวจ (บัญชียังใช้งานได้)
          </span>
          {replaceMode ? (
            <span className="mt-0.5 block text-ink-muted">
              ตอนนี้มีสมาชิกสมาคมปัจจุบัน <span className="font-semibold tabular-nums text-ink">{activeMembers.toLocaleString("th-TH")}</span> คน
              หน้าถัดไปจะแสดงรายชื่อคนที่จะพ้นสภาพให้ตรวจก่อนยืนยัน
            </span>
          ) : (
            <span className="mt-0.5 block text-ink-muted">ไม่ติ๊ก = เพิ่มหรืออัปเดตเฉพาะคนที่อยู่ในไฟล์ คนอื่นไม่เปลี่ยน</span>
          )}
        </span>
      </label>
    </>
  );
}
