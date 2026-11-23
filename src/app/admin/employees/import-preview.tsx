import Link from "next/link";
import { FileSpreadsheet, X } from "lucide-react";

import { cancelDirectoryImport, confirmDirectoryImport } from "@/app/admin/employees/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { StatusBanner } from "@/components/status-banner";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/styles";
import { UNSET, formatThaiDateTime, formatThaiTime, orUnset } from "@/lib/display";
import { type AffectedMember, type FieldChange, summarizeDirectoryPreview } from "@/lib/directory/preview";
import { appIcons } from "@/lib/icons";
import type { StatusTone } from "@/lib/status";

import type { ImportPreviewState } from "./preview-data";

const SaveIcon = appIcons.save;

/** Long lists show this many rows, then "และอีก N คน". */
const LIST_CAP = 50;

const membershipValueLabels: Record<string, string> = {
  active: "สมาชิกปัจจุบัน",
  inactive: "พ้นสภาพสมาชิก",
  suspended: "พักสิทธิ์",
  unknown: "ไม่ระบุ",
};

const employmentValueLabels: Record<string, string> = {
  active: "ปฏิบัติงาน",
  inactive: "ไม่ปฏิบัติงาน",
  retired: "เกษียณ",
  unknown: "ไม่ระบุ",
};

const flagReasonLabels: Record<AffectedMember["reason"], string> = {
  archived: "รายชื่อถูกลบออกจากฐาน",
  left_file: "ไม่อยู่ในไฟล์เดือนนี้",
  not_active_in_file: "ไฟล์ระบุว่าไม่ใช่สมาชิกปัจจุบัน",
};

const th = "whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink-subtle";
const td = "px-3 py-2.5 align-top";

function changeValue(change: FieldChange, value: string | null) {
  if (value === null) return UNSET;
  if (change.field === "membership_status") return membershipValueLabels[value] ?? value;
  if (change.field === "employment_status") return employmentValueLabels[value] ?? value;
  return value;
}

function count(value: number) {
  return value.toLocaleString("th-TH");
}

function More({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return <p className="px-3 py-2.5 text-sm text-ink-subtle">และอีก {count(total - shown)} คน (แสดง {count(shown)} คนแรก)</p>;
}

function Stat({ label, tone, unit = "", value }: { label: string; tone?: StatusTone; unit?: string; value: number }) {
  const color =
    value && tone === "danger" ? "text-danger" : value && tone === "warning" ? "text-warning" : value && tone === "success" ? "text-success" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={`mt-0.5 text-h3 font-semibold tabular-nums ${color}`}>
        {count(value)}
        {unit ? <span className="ml-1 text-xs font-medium text-ink-subtle">{unit}</span> : null}
      </p>
    </div>
  );
}

function Section({ children, count: total, open = false, title }: { children: React.ReactNode; count: number; open?: boolean; title: string }) {
  if (!total) return null;
  return (
    <details className="group rounded-lg border border-line bg-white" open={open}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-ink hover:bg-brand-50/50">
        <span>
          {title} <span className="tabular-nums">{count(total)}</span> คน
        </span>
        <span className="text-xs font-medium text-brand-600 group-open:hidden">ดูรายชื่อ</span>
        <span className="hidden text-xs font-medium text-brand-600 group-open:inline">ซ่อน</span>
      </summary>
      <div className="overflow-x-auto border-t border-line">{children}</div>
    </details>
  );
}

function MemberTable({ bypassSuffix, members, showReason }: { bypassSuffix: string; members: AffectedMember[]; showReason: boolean }) {
  const shown = members.slice(0, LIST_CAP);
  return (
    <>
      <table className="min-w-full text-sm">
        <thead className="bg-canvas">
          <tr>
            <th className={th} scope="col">สมาชิกชมรม</th>
            <th className={th} scope="col">เลขสมาชิก</th>
            <th className={th} scope="col">รหัสพนักงาน</th>
            {showReason ? <th className={th} scope="col">เหตุผล</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((member) => (
            <tr key={member.id}>
              <td className={td}>
                <Link className="font-medium text-brand-600 underline-offset-2 hover:underline" href={`/admin/members/${member.id}${bypassSuffix}`}>
                  {member.fullName}
                </Link>
              </td>
              <td className={`${td} tabular-nums`}>{orUnset(member.memberCode)}</td>
              <td className={`${td} tabular-nums`}>{member.directoryCode}</td>
              {showReason ? <td className={`${td} text-ink-muted`}>{flagReasonLabels[member.reason]}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      <More shown={shown.length} total={members.length} />
    </>
  );
}

/**
 * "ตรวจไฟล์ก่อนนำเข้า": what the uploaded directory file would change, with confirm / cancel.
 * Renders inside the import section of /admin/employees when `?preview=` is set.
 */
export function ImportPreviewCard({ bypass, preview }: { bypass: boolean; preview: ImportPreviewState }) {
  const bypassSuffix = bypass ? "?bypass=admin" : "";

  if (preview.state !== "ready") {
    const name = "meta" in preview && preview.meta ? `"${preview.meta.fileName}" ` : "";
    const message: Record<typeof preview.state, { text: string; tone: "error" | "info" | "warning" }> = {
      applied: { text: `ไฟล์ ${name}นำเข้าแล้ว`, tone: "info" },
      cancelled: { text: `ยกเลิกไฟล์ ${name}แล้ว ฐานไม่มีการเปลี่ยนแปลง`, tone: "info" },
      error: { text: "โหลดผลตรวจไฟล์ไม่สำเร็จ กรุณาโหลดหน้าใหม่ หากยังไม่หายให้อัปโหลดไฟล์อีกครั้ง", tone: "error" },
      expired: { text: `ไฟล์ ${name}หมดเวลายืนยันแล้ว (เก็บไว้ 1 ชั่วโมง) อัปโหลดไฟล์อีกครั้งด้านล่าง`, tone: "warning" },
      "not-found": { text: "ไม่พบไฟล์ที่รอยืนยัน อาจหมดเวลาหรือถูกยกเลิกแล้ว อัปโหลดไฟล์อีกครั้งด้านล่าง", tone: "warning" },
      outdated: {
        text: "ฐานข้อมูลยังไม่ได้อัปเดตให้ตรงกับระบบ (migration ค้างอยู่) จึงยังตรวจไฟล์ก่อนนำเข้าไม่ได้ กรุณาแจ้งผู้ดูแลระบบ",
        tone: "error",
      },
    };
    const { text, tone } = message[preview.state];
    return (
      <StatusBanner className="mt-4" tone={tone}>
        {text}
      </StatusBanner>
    );
  }

  const { diff, meta } = preview;
  const replace = meta.mode === "replace";
  const changedShown = diff.changed.slice(0, LIST_CAP);
  const addedShown = diff.added.slice(0, LIST_CAP);
  const deactivatedShown = diff.deactivated.slice(0, LIST_CAP);
  const nothingChanges =
    !diff.added.length && !diff.changed.length && !diff.deactivated.length && !diff.flagged.length && !diff.restored.length;
  const risky = replace && (diff.deactivated.length > 0 || diff.flagged.length > 0);

  return (
    <section aria-labelledby="import-preview-title" className="mt-4 grid gap-4 rounded-xl border border-brand-600/30 bg-canvas p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="import-preview-title">
            <FileSpreadsheet className="size-5 shrink-0 text-brand-600" aria-hidden="true" />
            ตรวจไฟล์ก่อนนำเข้า
          </h3>
          <p className="mt-1 break-all text-sm text-ink-muted">
            {meta.fileName} · <span className="tabular-nums">{count(meta.rowCount)}</span> แถว
            {meta.skipped ? (
              <>
                {" "}
                · ข้าม <span className="tabular-nums">{count(meta.skipped)}</span> แถวที่ไม่มีรหัสพนักงานหรือชื่อ
              </>
            ) : null}
          </p>
          <p className="mt-0.5 text-sm text-ink-subtle">
            อัปโหลดเมื่อ {formatThaiDateTime(meta.createdAt)} · ไฟล์นี้รอยืนยันถึง {formatThaiTime(meta.expiresAt)} ยังไม่มีการเปลี่ยนแปลงในฐานจนกว่าจะกดยืนยัน
          </p>
        </div>
        <StatusBadge className="self-start" tone={replace ? "warning" : "info"}>
          {replace ? "แทนรายชื่อทั้งหมด" : "เพิ่ม/อัปเดตเฉพาะคนในไฟล์"}
        </StatusBadge>
      </div>

      <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${replace ? "lg:grid-cols-6" : ""}`}>
        <Stat label="เพิ่มใหม่" unit="คน" value={diff.added.length} />
        <Stat label="ข้อมูลเปลี่ยน" unit="คน" value={diff.changed.length} />
        <Stat label="ไม่เปลี่ยน" unit="คน" value={diff.unchanged} />
        {replace ? (
          <>
            <Stat label="จะพ้นสภาพสมาชิก" tone="danger" unit="คน" value={diff.deactivated.length} />
            <Stat label="สมาชิกชมรมต้องตรวจ" tone="warning" unit="คน" value={diff.flagged.length} />
            <Stat label="คืนสถานะ" tone="success" unit="คน" value={diff.restored.length} />
          </>
        ) : null}
      </div>
      <p className="sr-only">{summarizeDirectoryPreview(diff, meta.mode)}</p>

      {diff.reappeared ? (
        <p className="text-sm text-ink-muted">
          ในจำนวนที่เพิ่มใหม่ มี <span className="tabular-nums">{count(diff.reappeared)}</span> คนที่เคยถูกลบออกจากฐาน จะกลับมาอยู่ในรายชื่อ
        </p>
      ) : null}
      {replace && diff.flagged.length ? (
        <StatusBanner tone="warning">
          สมาชิกชมรม {count(diff.flagged.length)} คนจะขึ้นป้าย &quot;ไม่อยู่ในฐานสมาชิกสมาคมเดือนล่าสุด&quot; ให้ตรวจในหน้ารายชื่อสมาชิก
          (บัญชียังใช้งานได้)
        </StatusBanner>
      ) : null}
      {nothingChanges ? <StatusBanner tone="info">ไฟล์นี้ตรงกับฐานทุกคน นำเข้าแล้วจะอัปเดตแค่วันที่อัปโหลดล่าสุด</StatusBanner> : null}

      <div className="grid gap-2">
        <Section count={diff.deactivated.length} open={diff.deactivated.length <= 10} title="จะพ้นสภาพสมาชิก (ไม่อยู่ในไฟล์)">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas">
              <tr>
                <th className={th} scope="col">รหัสพนักงาน</th>
                <th className={th} scope="col">ชื่อ</th>
                <th className={th} scope="col">สถานะตอนนี้</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {deactivatedShown.map((row) => (
                <tr key={row.id}>
                  <td className={`${td} tabular-nums`}>{row.employee_code}</td>
                  <td className={td}>{row.full_name}</td>
                  <td className={td}>{membershipValueLabels[row.membership_status ?? "active"] ?? row.membership_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <More shown={deactivatedShown.length} total={diff.deactivated.length} />
        </Section>

        <Section count={diff.flagged.length} open={diff.flagged.length <= 10} title="สมาชิกชมรมที่จะขึ้นให้ตรวจ">
          <MemberTable bypassSuffix={bypassSuffix} members={diff.flagged} showReason />
        </Section>

        <Section count={diff.restored.length} title="สมาชิกชมรมที่จะคืนสถานะ (กลับมาอยู่ในไฟล์)">
          <MemberTable bypassSuffix={bypassSuffix} members={diff.restored} showReason={false} />
        </Section>

        <Section count={diff.changed.length} title="ข้อมูลที่จะเปลี่ยน">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas">
              <tr>
                <th className={th} scope="col">ชื่อ</th>
                <th className={th} scope="col">ช่อง</th>
                <th className={th} scope="col">เดิม</th>
                <th className={th} scope="col">ใหม่</th>
              </tr>
            </thead>
            {changedShown.map((item) => (
              <tbody className="border-t border-line" key={item.currentId}>
                {item.changes.map((change, index) => (
                  <tr key={change.field}>
                    {index === 0 ? (
                      <th className={`${td} text-left font-medium text-ink`} rowSpan={item.changes.length} scope="rowgroup">
                        {item.row.full_name}
                        <span className="block text-xs font-normal tabular-nums text-ink-subtle">รหัสพนักงาน {item.row.employee_code}</span>
                      </th>
                    ) : null}
                    <td className={`${td} whitespace-nowrap text-ink-muted`}>{change.label}</td>
                    <td className={`${td} text-ink-muted`}>{changeValue(change, change.before)}</td>
                    <td className={`${td} font-medium text-ink`}>{changeValue(change, change.after)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          <More shown={changedShown.length} total={diff.changed.length} />
        </Section>

        <Section count={diff.added.length} title="รายชื่อใหม่">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas">
              <tr>
                <th className={th} scope="col">รหัสพนักงาน</th>
                <th className={th} scope="col">ชื่อ</th>
                <th className={th} scope="col">ตำแหน่ง</th>
                <th className={th} scope="col">สถานะสมาชิกสมาคม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {addedShown.map((row) => (
                <tr key={row.employee_code}>
                  <td className={`${td} tabular-nums`}>{row.employee_code}</td>
                  <td className={td}>{row.full_name}</td>
                  <td className={`${td} text-ink-muted`}>{orUnset(row.position ?? row.department)}</td>
                  <td className={td}>{membershipValueLabels[row.membership_status ?? "active"] ?? row.membership_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <More shown={addedShown.length} total={diff.added.length} />
        </Section>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-end">
        <form action={cancelDirectoryImport}>
          <input name="previewId" type="hidden" value={meta.id} />
          <button className={`${buttonClass("secondary")} w-full sm:w-auto`} disabled={bypass} type="submit">
            <X className="size-4" aria-hidden="true" />
            ยกเลิก
          </button>
        </form>
        <form action={confirmDirectoryImport}>
          <input name="previewId" type="hidden" value={meta.id} />
          <ConfirmSubmitButton
            className={`${buttonClass("primary")} w-full sm:w-auto`}
            confirmLabel="ยืนยันนำเข้า"
            details={<p>{summarizeDirectoryPreview(diff, meta.mode)}</p>}
            disabled={bypass}
            message={
              risky
                ? `${diff.deactivated.length ? `${count(diff.deactivated.length)} คนที่ไม่อยู่ในไฟล์จะเปลี่ยนเป็น "พ้นสภาพสมาชิก" ` : ""}${
                    diff.flagged.length ? `สมาชิกชมรม ${count(diff.flagged.length)} คนจะขึ้นให้ตรวจ` : ""
                  }`.trim()
                : `นำเข้าไฟล์ "${meta.fileName}" เข้าฐานสมาชิกสมาคม`
            }
            title={replace ? "นำเข้าและแทนรายชื่อทั้งหมด?" : "นำเข้าไฟล์นี้?"}
            tone={risky ? "danger" : "primary"}
          >
            <SaveIcon className="size-4" aria-hidden="true" />
            ยืนยันนำเข้า
          </ConfirmSubmitButton>
        </form>
      </div>
    </section>
  );
}
