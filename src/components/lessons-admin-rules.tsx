import { Megaphone, Unlock } from "lucide-react";

import { openLessonBookingNow, saveLessonBookingSettings } from "@/app/admin/lessons/actions";
import { SchemaField, checkboxClass, phaseDetail, phaseInfo, sectionTitle } from "@/components/lessons-admin-fields";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonPrimary, card, fieldHint, fieldInput, fieldInputClass, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { appIcons } from "@/lib/icons";
import { type BookingPhase, formatBangkokDateTime, toBangkokInputValue } from "@/lib/lessons/booking";
import { type LessonRuleNumberKey, type LessonRules, describeLessonRules, lessonRuleLimits } from "@/lib/lessons/rules";

// แท็บ "กติกา" (booking window + every rule of lesson_booking_settings) and แท็บ "ประกาศ".

type RuleField = { hint?: string; key: Exclude<LessonRuleNumberKey, "announcement_version"> };

const ruleGroups: Array<{ fields: RuleField[]; title: string }> = [
  {
    fields: [
      { hint: "นับรอบที่ยังไม่ถึงเวลาเรียน รวมคิวสำรอง เรียนจบแล้วจองเพิ่มได้ · 0 = ไม่จำกัด", key: "max_bookings_per_member" },
      { hint: "0 = ไม่จำกัด", key: "max_bookings_per_week" },
      { hint: "นับจากเวลาเปิดจอง · 0 = เปิดพร้อมกันทุกคน", key: "employee_priority_days" },
    ],
    title: "การจอง",
  },
  {
    fields: [
      { hint: "ยกเลิกหลังจากนี้ = ยกเลิกช้า ไม่คืนเครดิต (คิวสำรองยกเลิกได้ตลอด)", key: "cancel_cutoff_hours" },
      { hint: "ค่าเริ่มต้นของรอบที่สร้างใหม่ แก้ทีละรอบได้", key: "change_cutoff_hours" },
    ],
    title: "ยกเลิกและเปลี่ยนรอบ",
  },
  {
    fields: [
      { hint: "ไม่ยืนยันภายในเวลานี้ ที่ว่างไปที่คนถัดไป", key: "offer_window_hours" },
      { hint: "ใกล้เวลาเรียนแล้ว ให้ที่นั่งทันทีโดยไม่ต้องรอยืนยัน · 0 = ต้องยืนยันเสมอ", key: "offer_instant_hours" },
    ],
    title: "คิวสำรอง",
  },
  {
    fields: [
      { hint: "0 = ไม่งดสิทธิ์", key: "no_show_limit" },
      { key: "no_show_window_days" },
      { key: "no_show_block_days" },
    ],
    title: "ขาดเรียน",
  },
  {
    fields: [
      { hint: "0 = ไม่แจ้ง", key: "credit_expiry_warning_days" },
      { hint: "แจ้งเตือนในแอป · 0 = ไม่แจ้ง", key: "reminder_hours" },
    ],
    title: "เครดิตและการแจ้งเตือน",
  },
];

/** Columns that exist before the lessons v2 migration. */
const v1Rules = new Set<string>(["max_bookings_per_member", "cancel_cutoff_hours"]);

export function LessonsAdminRules({
  bypass,
  phase,
  rules,
  usesCredits,
  v2,
}: {
  bypass: boolean;
  phase: BookingPhase;
  rules: LessonRules;
  usesCredits: boolean;
  v2: boolean;
}) {
  const info = phaseInfo[phase];
  const SaveIcon = appIcons.save;
  const lines = describeLessonRules(rules, { usesCredits });

  return (
    <>
      <section className={`mt-6 scroll-mt-24 ${card}`} id="booking-window">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className={sectionTitle}>ช่วงเปิดจอง</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone={info.tone}>{info.label}</StatusBadge>
              <span className="text-sm text-ink-muted">{phaseDetail(phase, rules)}</span>
            </div>
          </div>
          {phase !== "open" && !bypass ? (
            <form action={openLessonBookingNow} className="shrink-0">
              <button className={buttonPrimary} type="submit">
                <Unlock className="size-4" aria-hidden="true" />
                เปิดให้จองทันที
              </button>
            </form>
          ) : null}
        </div>
        <form action={saveLessonBookingSettings} className="@container mt-5 grid gap-4 border-t border-line pt-5">
          <input name="section" type="hidden" value="window" />
          <div className="grid gap-4 @md:grid-cols-2">
            <label className="block">
              <span className={fieldLabel}>เปิดจอง (เวลาไทย)</span>
              <input className={fieldInput} defaultValue={toBangkokInputValue(rules.booking_open_at)} disabled={bypass} name="bookingOpenAt" type="datetime-local" />
              {v2 && rules.employee_priority_days > 0 ? (
                <span className={fieldHint}>พนักงาน กฟภ. จองได้ก่อน {rules.employee_priority_days} วัน</span>
              ) : null}
            </label>
            <label className="block">
              <span className={fieldLabel}>ปิดจอง (เวลาไทย)</span>
              <input className={fieldInput} defaultValue={toBangkokInputValue(rules.booking_close_at)} disabled={bypass} name="bookingCloseAt" type="datetime-local" />
              <span className={fieldHint}>เว้นว่าง = ไม่มีกำหนดปิด{rules.booking_close_at ? ` · ตอนนี้ปิด ${formatBangkokDateTime(rules.booking_close_at)}` : ""}</span>
            </label>
          </div>
          <button className={`${buttonPrimary} w-full @md:w-fit`} disabled={bypass} type="submit">
            <SaveIcon className="size-4" aria-hidden="true" />
            บันทึกช่วงเปิดจอง
          </button>
        </form>
      </section>

      <section className={`mt-6 scroll-mt-24 ${card}`} id="rules">
        <h2 className={sectionTitle}>กติกาที่สมาชิกเห็น</h2>
        <ul className="mt-3 grid gap-1.5 text-sm text-ink">
          {lines.map((line) => (
            <li className="flex gap-2" key={line.key}>
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-600" />
              {line.text}
            </li>
          ))}
        </ul>

        <form action={saveLessonBookingSettings} className="@container mt-5 grid gap-5 border-t border-line pt-5">
          <input name="section" type="hidden" value="rules" />
          <SchemaField v2={v2} />
          {!v2 ? <p className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">ตอนนี้แก้ได้ 2 ข้อ กติกาที่เหลือใช้ได้หลังอัปเดตฐานข้อมูล</p> : null}
          {ruleGroups.map((group) => (
            <fieldset className="min-w-0" key={group.title}>
              <legend className="text-sm font-semibold text-ink">{group.title}</legend>
              <div className="mt-2 grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
                {group.fields.map((field) => {
                  const limits = lessonRuleLimits[field.key];
                  const enabled = v2 || v1Rules.has(field.key);
                  return (
                    <label className="block" key={field.key}>
                      <span className={fieldLabel}>{limits.label}</span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <input
                          className={`${fieldInputClass("md", { margin: false })} min-w-0 tabular-nums`}
                          defaultValue={rules[field.key]}
                          disabled={bypass || !enabled}
                          inputMode="numeric"
                          max={limits.max}
                          min={limits.min}
                          name={field.key}
                          required={enabled}
                          step={1}
                          type="number"
                        />
                        {limits.unit ? <span className="shrink-0 text-sm text-ink-muted">{limits.unit}</span> : null}
                      </span>
                      {field.hint ? <span className={fieldHint}>{field.hint}</span> : null}
                    </label>
                  );
                })}
              </div>
              {group.title === "ขาดเรียน" ? (
                <label className="mt-3 flex items-start gap-3 rounded-lg border border-line px-3 py-3 text-sm font-medium text-ink">
                  <input className={`${checkboxClass} mt-1`} defaultChecked={rules.auto_no_show} disabled={bypass || !v2} name="auto_no_show" type="checkbox" />
                  <span>
                    ไม่เช็กชื่อภายใน 30 นาทีหลังเลิกเรียน นับเป็นขาดเรียน
                    <span className="block text-xs font-normal text-ink-subtle">ตรวจวันละครั้งตอน 18:00 น.</span>
                  </span>
                </label>
              ) : null}
            </fieldset>
          ))}
          <button className={`${buttonPrimary} w-full @md:w-fit`} disabled={bypass} type="submit">
            <SaveIcon className="size-4" aria-hidden="true" />
            บันทึกกติกา
          </button>
        </form>
      </section>
    </>
  );
}

export function LessonsAdminAnnouncement({ acks, bypass, rules }: { acks: number | null; bypass: boolean; rules: LessonRules }) {
  const SaveIcon = appIcons.save;
  return (
    <section className={`mt-6 ${card}`}>
      <h2 className={`${sectionTitle} flex items-center gap-2`}>
        <Megaphone className="size-4 text-ink-subtle" aria-hidden="true" />
        ประกาศก่อนจอง
      </h2>
      <p className="mt-1 text-sm text-ink-muted">สมาชิกต้องกดรับทราบประกาศก่อนจองรอบเรียน</p>
      {rules.announcement_version ? (
        <p className="mt-2 text-sm text-ink">
          ตอนนี้เป็นฉบับที่ <span className="font-semibold tabular-nums">{rules.announcement_version}</span>
          {acks !== null ? (
            <>
              {" "}· รับทราบแล้ว <span className="font-semibold tabular-nums">{acks}</span> คน
            </>
          ) : null}
        </p>
      ) : null}
      <form action={saveLessonBookingSettings} className="mt-4 grid gap-4">
        <input name="section" type="hidden" value="announcement" />
        <label className="block">
          <span className={fieldLabel}>หัวข้อประกาศ</span>
          <input className={fieldInput} defaultValue={rules.announcement_title} disabled={bypass} name="announcementTitle" placeholder="เช่น เงื่อนไขการเข้าเรียนรอบ ธ.ค. 2569" />
        </label>
        <label className="block">
          <span className={fieldLabel}>เนื้อหาประกาศ</span>
          <textarea className={fieldTextarea} defaultValue={rules.announcement_body} disabled={bypass} name="announcementBody" placeholder="กติกา การแต่งกาย อุปกรณ์ จุดนัดพบ การมาสาย การงดสิทธิ์" rows={7} />
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-3 text-sm font-medium text-ink">
          <input className={`${checkboxClass} mt-1`} defaultChecked={rules.announcement_version === 0} disabled={bypass} name="announcementNewVersion" type="checkbox" />
          <span>
            ออกเป็นฉบับใหม่ (สมาชิกต้องกดรับทราบอีกครั้ง)
            <span className="block text-xs font-normal text-ink-subtle">ไม่ติ๊ก = แก้คำผิดในฉบับเดิม สมาชิกที่รับทราบแล้วไม่ต้องกดใหม่</span>
          </span>
        </label>
        <button className={`${buttonPrimary} w-full sm:w-fit`} disabled={bypass} type="submit">
          <SaveIcon className="size-4" aria-hidden="true" />
          บันทึกประกาศ
        </button>
      </form>
    </section>
  );
}
