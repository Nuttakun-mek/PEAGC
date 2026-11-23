import Link from "next/link";
import { ChevronDown, RotateCcw } from "lucide-react";

import { archiveLessonProgram, restoreLessonProgram, updateLessonProgram } from "@/app/admin/lessons/actions";
import { adjustLessonCredits, saveLessonPackage, setLessonPackageArchived } from "@/app/admin/lessons/catalog-actions";
import type { CourseExtras } from "@/app/admin/lessons/data";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CreatePanel } from "@/components/create-panel";
import { ProgramForm, Required, UnitInput, cardFlat, lessonLevelLabels, lessonSlotStatusLabels, sectionTitle } from "@/components/lessons-admin-fields";
import { type PickerCoach, type PickerVenue } from "@/components/lessons-admin-pickers";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, buttonDanger, buttonPrimary, buttonSecondary, fieldHint, fieldInput, fieldInputClass, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { UNSET, formatFee, formatPhone, formatThaiDate, formatThaiDateShort, orUnset } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { type AdminLessonProgram, coachLabel, packageScopeLabel } from "@/lib/lessons/admin";
import { expiryLabel } from "@/lib/lessons/credits";
import { formatCredits, lessonEnrollmentStatusLabels, lessonPackageStatusLabels } from "@/lib/lessons/labels";
import type { LessonPackage } from "@/lib/lessons/types";

// แท็บ "คอร์สและแพ็กเกจ": courses (+ credit switch, usual coach / venue), packages per course or any
// course, enrollments waiting for payment, and the credit adjustment for one member.

type CoursesProps = {
  bypass: boolean;
  coaches: PickerCoach[];
  createFailed: boolean;
  extras: CourseExtras;
  memberQuery: string;
  programs: AdminLessonProgram[];
  v2: boolean;
  venues: PickerVenue[];
};

function PackageForm({ disabled, pkg, programs }: { disabled: boolean; pkg?: LessonPackage; programs: AdminLessonProgram[] }) {
  const SaveIcon = appIcons.save;
  return (
    <form action={saveLessonPackage} className="@container grid gap-4">
      {pkg ? <input name="packageId" type="hidden" value={pkg.id} /> : null}
      <div className="grid gap-4 @xl:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <label className="block">
          <span className={fieldLabel}>ชื่อแพ็กเกจ<Required /></span>
          <input className={fieldInput} defaultValue={pkg?.name ?? ""} disabled={disabled} name="name" placeholder="เช่น แพ็กเกจ 8 ครั้ง" required />
        </label>
        <label className="block">
          <span className={fieldLabel}>ใช้กับคอร์ส</span>
          <select className={fieldInput} defaultValue={pkg?.program_id ?? ""} disabled={disabled} name="programId">
            <option value="">ทุกคอร์ส</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>{program.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>สถานะ</span>
          <select className={fieldInput} defaultValue={pkg?.status ?? "active"} disabled={disabled} name="status">
            <option value="active">เปิดขาย</option>
            <option value="inactive">ปิดขาย</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-4">
        <UnitInput defaultValue={pkg?.credits ?? 8} disabled={disabled} label={<>จำนวนครั้ง<Required /></>} max="1000" min="1" name="credits" required unit="ครั้ง" />
        <UnitInput defaultValue={pkg?.valid_days ?? 60} disabled={disabled} hint="นับจากวันที่ชำระเงินผ่าน" label={<>ใช้ได้ภายใน<Required /></>} max="3650" min="1" name="validDays" required unit="วัน" />
        <UnitInput defaultValue={pkg && pkg.price > 0 ? pkg.price : undefined} disabled={disabled} label="ราคา" name="price" placeholder="0 = ฟรี" step="0.01" unit="บาท" />
        <UnitInput defaultValue={pkg?.max_per_member ?? undefined} disabled={disabled} hint="เว้นว่าง = ไม่จำกัด (เช่น ทดลองเรียนฟรีคนละ 1 ครั้ง)" label="ซื้อได้คนละไม่เกิน" min="1" name="maxPerMember" unit="ครั้ง" />
      </div>
      <label className="block">
        <span className={fieldLabel}>รายละเอียด</span>
        <textarea className={fieldTextarea} defaultValue={pkg?.description ?? ""} disabled={disabled} name="description" placeholder="เช่น เรียนได้ 8 ครั้ง ภายใน 60 วัน จองรอบไหนก็ได้" rows={2} />
      </label>
      <button className={`${buttonPrimary} w-full @md:w-fit`} disabled={disabled} type="submit">
        <SaveIcon className="size-4" aria-hidden="true" />
        {pkg ? "บันทึกการแก้ไข" : "บันทึกแพ็กเกจ"}
      </button>
    </form>
  );
}

function ProgramList({ props }: { props: CoursesProps }) {
  const { coaches, programs, venues } = props;
  const EditIcon = appIcons.edit;
  const DeleteIcon = appIcons.delete;
  const columns = "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem]";
  return (
    <section className={`mt-6 ${cardFlat}`}>
      <div className="border-b border-line px-5 py-4">
        <h2 className={sectionTitle}>คอร์สเรียน {programs.length} คอร์ส</h2>
      </div>
      {programs.length ? (
        <>
          <div className={`hidden gap-4 border-b border-line bg-canvas px-5 py-2 text-xs font-medium text-ink-subtle md:grid ${columns}`} aria-hidden="true">
            <span>คอร์ส</span>
            <span>ระดับ</span>
            <span>ราคา</span>
            <span />
          </div>
          <div className="divide-y divide-line">
            {programs.map((program) => {
              const coach = coaches.find((item) => item.id === program.default_coach_id);
              const venue = venues.find((item) => item.id === program.default_venue_id);
              return (
                <details className="group scroll-mt-24" id={`program-${program.id}`} key={program.id}>
                  <summary className={`grid cursor-pointer list-none gap-2 px-5 py-4 transition hover:bg-canvas md:items-center md:gap-4 ${columns}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{program.name}</p>
                        <StatusBadge kind="lesson" status={program.status}>{lessonSlotStatusLabels[program.status] ?? program.status}</StatusBadge>
                        {program.requires_package ? <StatusBadge tone="info">ต้องใช้แพ็กเกจ/เครดิต</StatusBadge> : null}
                      </div>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        ผู้สอน {coach ? coachLabel(coach) : orUnset(program.coach_name)}
                        {props.v2 ? ` · สถานที่ ${venue?.name ?? UNSET}` : ""}
                      </p>
                    </div>
                    <p className="text-sm text-ink">
                      <span className="text-ink-subtle md:hidden">ระดับ </span>
                      {lessonLevelLabels[program.level] ?? program.level}
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      <span className="font-normal text-ink-subtle md:hidden">ราคา </span>
                      {formatFee(program.price)}
                    </p>
                    <span className={`${buttonClass("secondary", "sm")} w-fit`}>
                      <EditIcon className="size-4" aria-hidden="true" />
                      แก้ไข
                    </span>
                  </summary>
                  <div className="border-t border-line bg-canvas/60 px-5 py-4">
                    <div className="rounded-lg border border-line bg-white p-4">
                      <ProgramForm action={updateLessonProgram} coaches={coaches} disabled={props.bypass} program={program} v2={props.v2} venues={venues} />
                    </div>
                    {props.bypass ? null : (
                      <form action={archiveLessonProgram} className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-danger/20 bg-white p-4">
                        <input name="programId" type="hidden" value={program.id} />
                        <p className="min-w-0 flex-1 text-sm text-ink-muted">
                          ลบคอร์สนี้ (เก็บถาวร กู้คืนได้) รอบที่กำลังจะมาถึงและยังไม่มีคนจองจะถูกลบไปด้วย ประวัติการเรียนยังอยู่ครบ
                        </p>
                        <ConfirmSubmitButton className={buttonDanger} confirmLabel="ลบคอร์ส" message={`ลบคอร์ส "${program.name}"? (เก็บถาวร กู้คืนได้ภายหลัง)`}>
                          <DeleteIcon className="size-4" aria-hidden="true" />
                          ลบคอร์ส
                        </ConfirmSubmitButton>
                      </form>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">ยังไม่มีคอร์สเรียน เพิ่มคอร์สแรกในช่อง &quot;เพิ่มคอร์สเรียน&quot; ด้านบน แล้วจึงสร้างรอบเรียน</p>
      )}
      {props.extras.archivedPrograms.length ? (
        <details className="group/archived scroll-mt-24 border-t border-line px-5 py-4" id="archived-programs">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-muted">
            คอร์สที่เก็บถาวร ({props.extras.archivedPrograms.length})
            <ChevronDown className="size-4 transition group-open/archived:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {props.extras.archivedPrograms.map((program) => (
              <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" key={program.id}>
                <span className="text-sm">
                  <span className="font-semibold text-ink">{program.name}</span>
                  <span className="ml-2 text-xs text-ink-subtle">เก็บถาวรเมื่อ {formatThaiDate(program.archived_at)}</span>
                </span>
                <form action={restoreLessonProgram}>
                  <input name="programId" type="hidden" value={program.id} />
                  <button className={buttonClass("secondary", "sm")} disabled={props.bypass} type="submit">
                    <RotateCcw className="size-4" aria-hidden="true" />
                    กู้คืน
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function PackageSection({ props }: { props: CoursesProps }) {
  const { extras, programs } = props;
  const EditIcon = appIcons.edit;
  const DeleteIcon = appIcons.delete;
  const PaymentsIcon = appIcons.payments;
  const pending = extras.pendingEnrollments;
  const columns = "lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem]";
  const paymentsHref = "/admin/payments?purpose=lesson_package";

  return (
    <>
      <CreatePanel hint="จำนวนครั้ง อายุการใช้ ราคา ใช้กับคอร์สไหน" title="เพิ่มแพ็กเกจ">
        <PackageForm disabled={props.bypass} programs={programs} />
      </CreatePanel>

      <section className={`mt-6 scroll-mt-24 ${cardFlat}`} id="packages">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className={sectionTitle}>แพ็กเกจ {extras.packages.length} แบบ</h2>
            <p className="mt-1 text-sm text-ink-muted">
              ใช้งานอยู่ <span className="font-semibold tabular-nums text-ink">{extras.activeEnrollments}</span> รายการ · รอชำระเงิน{" "}
              <span className="font-semibold tabular-nums text-ink">{[...extras.packageStats.values()].reduce((sum, item) => sum + item.pending, 0)}</span> รายการ
            </p>
          </div>
          <Link className={`${buttonSecondary} w-fit`} href={paymentsHref}>
            <PaymentsIcon className="size-4" aria-hidden="true" />
            ตรวจสลิปค่าแพ็กเกจ
          </Link>
        </div>
        {extras.packages.length ? (
          <>
            <div className={`hidden gap-4 border-b border-line bg-canvas px-5 py-2 text-xs font-medium text-ink-subtle lg:grid ${columns}`} aria-hidden="true">
              <span>แพ็กเกจ</span>
              <span>ใช้กับ</span>
              <span>ราคา</span>
              <span>ผู้ซื้อ</span>
              <span />
            </div>
            <div className="divide-y divide-line">
              {extras.packages.map((pkg) => {
                const stats = extras.packageStats.get(pkg.id) ?? { active: 0, pending: 0 };
                return (
                  <details className="group scroll-mt-24" id={`package-${pkg.id}`} key={pkg.id}>
                    <summary className={`grid cursor-pointer list-none gap-2 px-5 py-4 transition hover:bg-canvas lg:items-center lg:gap-4 ${columns}`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-ink">{pkg.name}</p>
                          <StatusBadge tone={pkg.status === "active" ? "success" : "neutral"}>{lessonPackageStatusLabels[pkg.status] ?? pkg.status}</StatusBadge>
                        </div>
                        <p className="mt-0.5 text-sm tabular-nums text-ink-muted">
                          {formatCredits(pkg.credits)} · ใช้ได้ {pkg.valid_days} วัน{pkg.max_per_member ? ` · คนละไม่เกิน ${pkg.max_per_member} ครั้ง` : ""}
                        </p>
                      </div>
                      <p className="text-sm text-ink">
                        <span className="text-ink-subtle lg:hidden">ใช้กับ </span>
                        {packageScopeLabel(pkg.program_id, programs)}
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-ink">
                        <span className="font-normal text-ink-subtle lg:hidden">ราคา </span>
                        {formatFee(pkg.price)}
                      </p>
                      <p className="text-sm tabular-nums text-ink-muted">
                        ใช้อยู่ {stats.active}
                        {stats.pending ? <span className="text-warning"> · รอชำระ {stats.pending}</span> : null}
                      </p>
                      <span className={`${buttonClass("secondary", "sm")} w-fit`}>
                        <EditIcon className="size-4" aria-hidden="true" />
                        แก้ไข
                      </span>
                    </summary>
                    <div className="border-t border-line bg-canvas/60 px-5 py-4">
                      <div className="rounded-lg border border-line bg-white p-4">
                        <PackageForm disabled={props.bypass} pkg={pkg} programs={programs} />
                      </div>
                      {props.bypass ? null : (
                        <form action={setLessonPackageArchived} className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-danger/20 bg-white p-4">
                          <input name="packageId" type="hidden" value={pkg.id} />
                          <input name="archive" type="hidden" value="1" />
                          <p className="min-w-0 flex-1 text-sm text-ink-muted">เก็บถาวร = เลิกขายและซ่อนจากสมาชิก คนที่ซื้อไปแล้วยังใช้เครดิตได้จนหมดอายุ</p>
                          <ConfirmSubmitButton className={buttonDanger} confirmLabel="เก็บถาวร" message={`เก็บแพ็กเกจ "${pkg.name}" ถาวร?`}>
                            <DeleteIcon className="size-4" aria-hidden="true" />
                            เก็บถาวร
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">ยังไม่มีแพ็กเกจ เพิ่มแพ็กเกจในช่อง &quot;เพิ่มแพ็กเกจ&quot; ด้านบน แล้วติ๊ก &quot;ต้องใช้แพ็กเกจ/เครดิต&quot; ที่คอร์ส</p>
        )}
        {extras.archivedPackages.length ? (
          <details className="group/archived border-t border-line px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-muted">
              แพ็กเกจที่เก็บถาวร ({extras.archivedPackages.length})
              <ChevronDown className="size-4 transition group-open/archived:rotate-180" aria-hidden="true" />
            </summary>
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {extras.archivedPackages.map((pkg) => (
                <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" key={pkg.id}>
                  <span className="text-sm font-semibold text-ink">{pkg.name}</span>
                  <form action={setLessonPackageArchived}>
                    <input name="packageId" type="hidden" value={pkg.id} />
                    <input name="archive" type="hidden" value="0" />
                    <button className={buttonClass("secondary", "sm")} disabled={props.bypass} type="submit">
                      <RotateCcw className="size-4" aria-hidden="true" />
                      กู้คืน (ปิดขาย)
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className={`mt-6 ${cardFlat}`} id="pending-packages">
        <div className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className={sectionTitle}>รอชำระเงิน {pending.length} รายการ</h2>
          {pending.length ? (
            <Link className="text-sm font-semibold text-brand-600 underline-offset-4 hover:underline" href={paymentsHref}>
              ไปที่หน้าชำระเงิน
            </Link>
          ) : null}
        </div>
        {pending.length ? (
          <ul className="divide-y divide-line">
            {pending.map((row) => (
              <li className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4" key={row.enrollment_id}>
                <span className="font-semibold text-ink">{orUnset(row.member_name)}</span>
                <span className="text-ink-muted">{row.package_name}</span>
                <span className="tabular-nums text-ink">{formatFee(row.price)}</span>
                <span className="text-xs text-ink-subtle">ขอซื้อ {formatThaiDateShort(row.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-muted">ไม่มีแพ็กเกจที่รอชำระเงิน</p>
        )}
      </section>

      <CreditAdjustment props={props} />
    </>
  );
}

function CreditAdjustment({ props }: { props: CoursesProps }) {
  const SearchIcon = appIcons.search;
  const SaveIcon = appIcons.save;
  const results = props.extras.memberResults;
  return (
    <section className={`mt-6 scroll-mt-24 ${cardFlat}`} id="credits">
      <div className="border-b border-line px-5 py-4">
        <h2 className={sectionTitle}>ปรับเครดิตสมาชิก</h2>
        <p className="mt-1 text-sm text-ink-muted">เติมเครดิตชดเชยหรือหักเครดิต ต้องใส่เหตุผลทุกครั้ง สมาชิกได้รับแจ้งเตือนในแอป</p>
      </div>
      <form action="/admin/lessons#credits" className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-end" method="get">
        <input name="tab" type="hidden" value="courses" />
        {props.bypass ? <input name="bypass" type="hidden" value="admin" /> : null}
        <label className="block min-w-0 flex-1">
          <span className={fieldLabel}>ค้นหาสมาชิก</span>
          <input className={fieldInput} defaultValue={props.memberQuery} name="member" placeholder="ชื่อ ชื่อเล่น รหัสสมาชิก หรือเบอร์โทร" type="search" />
        </label>
        <button className={`${buttonSecondary} w-full sm:w-auto`} type="submit">
          <SearchIcon className="size-4" aria-hidden="true" />
          ค้นหา
        </button>
      </form>
      {props.memberQuery && !results.length ? <p className="px-5 pb-5 text-sm text-ink-muted">ไม่พบสมาชิกที่ตรงกับ &quot;{props.memberQuery}&quot;</p> : null}
      {results.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {results.map((member) => {
            const usable = member.enrollments.filter((row) => row.usable);
            const available = usable.reduce((sum, row) => sum + row.credits_remaining, 0);
            const adjustable = member.enrollments.filter((row) => row.status === "active" || row.status === "expired");
            return (
              <li className="grid gap-3 px-5 py-4" key={member.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-ink">
                    {member.full_name}
                    {member.nickname ? <span className="font-normal text-ink-muted"> ({member.nickname})</span> : null}
                    <span className="ml-2 text-sm font-normal text-ink-subtle">{member.member_code ?? member.employee_code ?? ""}</span>
                  </p>
                  <p className="text-sm text-ink-muted">
                    ใช้ได้ <span className="font-semibold tabular-nums text-ink">{formatCredits(available)}</span>
                    {member.phone ? ` · ${formatPhone(member.phone)}` : ""}
                  </p>
                </div>
                {member.enrollments.length ? (
                  <ul className="grid gap-1 text-sm">
                    {member.enrollments.map((row) => (
                      <li className="flex flex-wrap items-center gap-x-3 gap-y-1" key={row.enrollment_id}>
                        <StatusBadge kind="enrollment" status={row.status}>{lessonEnrollmentStatusLabels[row.status] ?? row.status}</StatusBadge>
                        <span className="text-ink">{row.package_name}</span>
                        <span className="tabular-nums text-ink-muted">เหลือ {row.credits_remaining}/{row.credits_total}</span>
                        <span className="text-ink-subtle">{expiryLabel(row.expires_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-muted">ยังไม่มีแพ็กเกจ</p>
                )}
                <form action={adjustLessonCredits} className="@container grid gap-3 rounded-lg border border-line bg-canvas/60 p-3">
                  <input name="memberId" type="hidden" value={member.id} />
                  <input name="returnTo" type="hidden" value={`/admin/lessons?tab=courses&member=${encodeURIComponent(props.memberQuery)}#credits`} />
                  <div className="grid gap-3 @lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <label className="block">
                      <span className={fieldLabel}>ปรับที่</span>
                      <select className={fieldInput} defaultValue="" disabled={props.bypass} name="enrollmentId">
                        <option value="">เครดิตชดเชยใหม่ (ทุกคอร์ส) / หักจากที่ใกล้หมดอายุ</option>
                        {adjustable.map((row) => (
                          <option key={row.enrollment_id} value={row.enrollment_id}>
                            {row.package_name} (เหลือ {row.credits_remaining})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className={fieldLabel}>จำนวน<Required /></span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <input className={`${fieldInputClass("md", { margin: false })} min-w-0 tabular-nums`} disabled={props.bypass} inputMode="numeric" name="delta" pattern="[+\-−]?[0-9]+" placeholder="เช่น 2 หรือ -1" required />
                        <span className="shrink-0 text-sm text-ink-muted">ครั้ง</span>
                      </span>
                      <span className={fieldHint}>บวก = เติม · ลบ = หัก</span>
                    </label>
                    <UnitInput disabled={props.bypass} hint="เครดิตใหม่: ค่าเริ่ม 60 วัน" label="ใช้ได้อีก" max="3650" min="1" name="validDays" placeholder="ไม่เปลี่ยน" unit="วัน" />
                  </div>
                  <label className="block">
                    <span className={fieldLabel}>เหตุผล<Required /></span>
                    <input className={fieldInput} disabled={props.bypass} name="note" placeholder="เช่น ชดเชยรอบที่ผู้สอนป่วย 3 ธ.ค." required />
                  </label>
                  <button className={`${buttonPrimary} w-full @md:w-fit`} disabled={props.bypass} type="submit">
                    <SaveIcon className="size-4" aria-hidden="true" />
                    บันทึกการปรับเครดิต
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export function LessonsAdminCourses(props: CoursesProps) {
  return (
    <>
      <CreatePanel defaultOpen={!props.programs.length || props.createFailed} hint="ชื่อคอร์ส ระดับ ผู้สอน ราคา" title="เพิ่มคอร์สเรียน">
        <ProgramForm coaches={props.coaches} disabled={props.bypass} v2={props.v2} venues={props.venues} />
      </CreatePanel>
      <ProgramList props={props} />
      {props.v2 ? (
        <PackageSection props={props} />
      ) : (
        <section className={`mt-6 p-5 ${cardFlat}`}>
          <h2 className={sectionTitle}>แพ็กเกจและเครดิตเรียน</h2>
          <p className="mt-1 text-sm text-ink-muted">ใช้ได้หลังอัปเดตฐานข้อมูล (lessons v2) ตอนนี้ราคายังอยู่ที่คอร์ส</p>
        </section>
      )}
    </>
  );
}
