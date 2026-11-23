
import {
  archiveLessonCoach,
  archiveLessonVenue,
  linkLessonCoachLogin,
  saveLessonCoach,
  saveLessonVenue,
  unlinkLessonCoachLogin,
} from "@/app/admin/lessons/catalog-actions";
import type { StaffName } from "@/app/admin/lessons/data";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CreatePanel } from "@/components/create-panel";
import { Required, UnitInput, cardFlat, sectionTitle } from "@/components/lessons-admin-fields";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, buttonDanger, buttonPrimary, fieldHint, fieldInput, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { formatPhone, orUnset, phoneHref } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { formatHours } from "@/lib/lessons/admin";
import { lessonCoachStatusLabels, lessonVenueStatusLabels } from "@/lib/lessons/labels";
import type { LessonCoach, LessonVenue } from "@/lib/lessons/types";

// แท็บ "ผู้สอนและสถานที่": coaches (+ their own login for /coach, teaching hours this month) and
// venues with bays and seats per bay.

type CoachesProps = {
  bypass: boolean;
  coaches: LessonCoach[];
  hours: Map<string, { hours: number; rounds: number }>;
  monthLabel: string;
  staffNames: Map<string, StaffName>;
  v2: boolean;
  venues: LessonVenue[];
};

function CoachForm({ coach, disabled }: { coach?: LessonCoach; disabled: boolean }) {
  const SaveIcon = appIcons.save;
  return (
    <form action={saveLessonCoach} className="@container grid gap-4">
      {coach ? <input name="coachId" type="hidden" value={coach.id} /> : null}
      <div className="grid gap-4 @xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <label className="block">
          <span className={fieldLabel}>ชื่อ-นามสกุล<Required /></span>
          <input className={fieldInput} defaultValue={coach?.full_name ?? ""} disabled={disabled} name="fullName" required />
        </label>
        <label className="block">
          <span className={fieldLabel}>ชื่อเล่น</span>
          <input className={fieldInput} defaultValue={coach?.nickname ?? ""} disabled={disabled} name="nickname" placeholder="เช่น โปรต้น" />
        </label>
        <label className="block">
          <span className={fieldLabel}>เบอร์โทร</span>
          <input className={fieldInput} defaultValue={coach?.phone ?? ""} disabled={disabled} inputMode="tel" name="phone" placeholder="08x-xxx-xxxx" type="tel" />
        </label>
        <label className="block">
          <span className={fieldLabel}>สถานะ</span>
          <select className={fieldInput} defaultValue={coach?.status ?? "active"} disabled={disabled} name="status">
            <option value="active">สอนอยู่</option>
            <option value="inactive">พักการสอน</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>ประวัติย่อ</span>
        <textarea className={fieldTextarea} defaultValue={coach?.bio ?? ""} disabled={disabled} name="bio" placeholder="ประสบการณ์ ความถนัด (สมาชิกเห็นข้อความนี้)" rows={2} />
      </label>
      <button className={`${buttonPrimary} w-full @md:w-fit`} disabled={disabled} type="submit">
        <SaveIcon className="size-4" aria-hidden="true" />
        {coach ? "บันทึกการแก้ไข" : "บันทึกผู้สอน"}
      </button>
    </form>
  );
}

function CoachLogin({ coach, disabled, staff }: { coach: LessonCoach; disabled: boolean; staff: StaffName | undefined }) {
  const CoachIcon = appIcons.coach;
  if (coach.user_id) {
    const hasRole = staff ? staff.role_keys.includes("coach") : null;
    return (
      <div className="grid gap-3 rounded-lg border border-line bg-white p-4">
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
          <CoachIcon className="size-4 text-success" aria-hidden="true" />
          มีบัญชีเข้าใช้งานแล้ว{staff?.display_name ? `: ${staff.display_name}` : ""}
          {hasRole === false ? <StatusBadge tone="warning">ยังไม่มีสิทธิ์ผู้สอน เชื่อมใหม่อีกครั้ง</StatusBadge> : null}
        </p>
        <p className="text-sm text-ink-muted">ผู้สอนเข้าสู่ระบบด้วยบัญชีนี้แล้วจะเห็นตารางสอนและรายชื่อผู้เรียนเฉพาะรอบของตัวเอง</p>
        <form action={unlinkLessonCoachLogin}>
          <input name="coachId" type="hidden" value={coach.id} />
          <ConfirmSubmitButton className={buttonClass("danger", "sm")} confirmLabel="ยกเลิกการเชื่อม" disabled={disabled} message={`ยกเลิกบัญชีเข้าใช้งานของ ${coach.full_name}? บัญชีนั้นจะเปิดหน้าตารางสอนไม่ได้อีก`}>
            ยกเลิกการเชื่อมบัญชี
          </ConfirmSubmitButton>
        </form>
      </div>
    );
  }
  return (
    <form action={linkLessonCoachLogin} className="@container grid gap-3 rounded-lg border border-line bg-white p-4">
      <input name="coachId" type="hidden" value={coach.id} />
      <p className="text-sm text-ink-muted">ให้ผู้สอนสมัครบัญชีด้วยอีเมลของตัวเองก่อน แล้วใส่อีเมลนั้นที่นี่ ผู้สอนจะได้สิทธิ์ &quot;ผู้สอน&quot; ของชมรมนี้อย่างเดียว</p>
      <div className="flex flex-col gap-2 @md:flex-row @md:items-end">
        <label className="block min-w-0 flex-1">
          <span className={fieldLabel}>อีเมลบัญชีของผู้สอน<Required /></span>
          <input autoComplete="off" className={fieldInput} disabled={disabled} name="email" placeholder="name@example.com" required type="email" />
        </label>
        <button className={buttonClass("secondary")} disabled={disabled} type="submit">
          <CoachIcon className="size-4" aria-hidden="true" />
          เชื่อมบัญชี
        </button>
      </div>
    </form>
  );
}

function VenueForm({ disabled, venue }: { disabled: boolean; venue?: LessonVenue }) {
  const SaveIcon = appIcons.save;
  return (
    <form action={saveLessonVenue} className="@container grid gap-4">
      {venue ? <input name="venueId" type="hidden" value={venue.id} /> : null}
      <div className="grid gap-4 @xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="block">
          <span className={fieldLabel}>ชื่อสถานที่<Required /></span>
          <input className={fieldInput} defaultValue={venue?.name ?? ""} disabled={disabled} name="name" placeholder="เช่น สนามไดร์ฟ กฟภ." required />
        </label>
        <UnitInput defaultValue={venue?.bay_count ?? 1} disabled={disabled} hint="1 = ใช้ทั้งสถานที่" label={<>จำนวนช่องซ้อม<Required /></>} max="500" min="1" name="bayCount" required unit="ช่อง" />
        <UnitInput defaultValue={venue?.capacity_per_bay ?? 1} disabled={disabled} label={<>รับได้ต่อช่อง<Required /></>} max="100" min="1" name="capacityPerBay" required unit="คน" />
        <label className="block">
          <span className={fieldLabel}>สถานะ</span>
          <select className={fieldInput} defaultValue={venue?.status ?? "active"} disabled={disabled} name="status">
            <option value="active">ใช้งาน</option>
            <option value="inactive">ปิดใช้งาน</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 @xl:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>ที่อยู่ / จุดนัดพบ</span>
          <input className={fieldInput} defaultValue={venue?.address ?? ""} disabled={disabled} name="address" />
        </label>
        <label className="block">
          <span className={fieldLabel}>หมายเหตุ</span>
          <input className={fieldInput} defaultValue={venue?.note ?? ""} disabled={disabled} name="note" placeholder="เช่น ปิดวันจันทร์" />
          <span className={fieldHint}>สมาชิกเห็นหมายเหตุนี้</span>
        </label>
      </div>
      <button className={`${buttonPrimary} w-full @md:w-fit`} disabled={disabled} type="submit">
        <SaveIcon className="size-4" aria-hidden="true" />
        {venue ? "บันทึกการแก้ไข" : "บันทึกสถานที่"}
      </button>
    </form>
  );
}

export function LessonsAdminCoaches(props: CoachesProps) {
  const EditIcon = appIcons.edit;
  const DeleteIcon = appIcons.delete;
  if (!props.v2) {
    return (
      <section className={`mt-6 p-5 ${cardFlat}`}>
        <h2 className={sectionTitle}>ผู้สอนและสถานที่</h2>
        <p className="mt-1 text-sm text-ink-muted">ใช้ได้หลังอัปเดตฐานข้อมูล (lessons v2) ตอนนี้ยังพิมพ์ชื่อผู้สอนและสถานที่ในแต่ละรอบได้ตามเดิม</p>
      </section>
    );
  }

  return (
    <>
      <CreatePanel hint="ชื่อ ชื่อเล่น เบอร์โทร" title="เพิ่มผู้สอน">
        <CoachForm disabled={props.bypass} />
      </CreatePanel>

      <section className={`mt-6 scroll-mt-24 ${cardFlat}`} id="coaches">
        <div className="border-b border-line px-5 py-4">
          <h2 className={sectionTitle}>ผู้สอน {props.coaches.length} คน</h2>
          <p className="mt-1 text-sm text-ink-muted">ชั่วโมงสอน{props.monthLabel}</p>
        </div>
        {props.coaches.length ? (
          <div className="divide-y divide-line">
            {props.coaches.map((coach) => {
              const hours = props.hours.get(coach.id) ?? { hours: 0, rounds: 0 };
              const phone = phoneHref(coach.phone);
              return (
                <details className="group scroll-mt-24" id={`coach-${coach.id}`} key={coach.id}>
                  <summary className="grid cursor-pointer list-none gap-2 px-5 py-4 transition hover:bg-canvas md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem] md:items-center md:gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">
                          {coach.full_name}
                          {coach.nickname ? <span className="font-normal text-ink-muted"> ({coach.nickname})</span> : null}
                        </p>
                        <StatusBadge tone={coach.status === "active" ? "success" : "neutral"}>{lessonCoachStatusLabels[coach.status] ?? coach.status}</StatusBadge>
                      </div>
                      <p className="mt-0.5 text-sm text-ink-muted">{coach.user_id ? "มีบัญชีเข้าใช้งาน" : "ยังไม่มีบัญชีเข้าใช้งาน"}</p>
                    </div>
                    <p className="text-sm text-ink">
                      <span className="text-ink-subtle md:hidden">โทร </span>
                      {coach.phone ? phone ? <a className="text-brand-600 underline-offset-4 hover:underline" href={phone}>{formatPhone(coach.phone)}</a> : formatPhone(coach.phone) : orUnset(null)}
                    </p>
                    <p className="text-sm tabular-nums text-ink">
                      <span className="text-ink-subtle md:hidden">เดือนนี้ </span>
                      {formatHours(hours.hours)}
                      {hours.rounds ? <span className="text-ink-muted"> ({hours.rounds} รอบ)</span> : null}
                    </p>
                    <span className={`${buttonClass("secondary", "sm")} w-fit`}>
                      <EditIcon className="size-4" aria-hidden="true" />
                      แก้ไข
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-line bg-canvas/60 px-5 py-4">
                    <div className="rounded-lg border border-line bg-white p-4">
                      <CoachForm coach={coach} disabled={props.bypass} />
                    </div>
                    <CoachLogin coach={coach} disabled={props.bypass} staff={coach.user_id ? props.staffNames.get(coach.user_id) : undefined} />
                    {props.bypass ? null : (
                      <form action={archiveLessonCoach} className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/20 bg-white p-4">
                        <input name="coachId" type="hidden" value={coach.id} />
                        <p className="min-w-0 flex-1 text-sm text-ink-muted">เก็บถาวร = ไม่แสดงในรายชื่อแล้ว รอบเรียนเดิมยังแสดงชื่อผู้สอนคนนี้ บัญชีเข้าใช้งานถูกยกเลิก</p>
                        <ConfirmSubmitButton className={buttonDanger} confirmLabel="เก็บถาวร" message={`เก็บผู้สอน "${coach.full_name}" ถาวร?`}>
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
        ) : (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">ยังไม่มีรายชื่อผู้สอน เพิ่มในช่อง &quot;เพิ่มผู้สอน&quot; ด้านบน แล้วเลือกผู้สอนตอนสร้างรอบเรียน</p>
        )}
      </section>

      <CreatePanel hint="ชื่อ จำนวนช่องซ้อม คนต่อช่อง" title="เพิ่มสถานที่">
        <VenueForm disabled={props.bypass} />
      </CreatePanel>

      <section className={`mt-6 scroll-mt-24 ${cardFlat}`} id="venues">
        <div className="border-b border-line px-5 py-4">
          <h2 className={sectionTitle}>สถานที่ {props.venues.length} แห่ง</h2>
        </div>
        {props.venues.length ? (
          <div className="divide-y divide-line">
            {props.venues.map((venue) => (
              <details className="group scroll-mt-24" id={`venue-${venue.id}`} key={venue.id}>
                <summary className="grid cursor-pointer list-none gap-2 px-5 py-4 transition hover:bg-canvas md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_6.5rem] md:items-center md:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">{venue.name}</p>
                      <StatusBadge tone={venue.status === "active" ? "success" : "neutral"}>{lessonVenueStatusLabels[venue.status] ?? venue.status}</StatusBadge>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-muted">{[venue.address, venue.note].filter(Boolean).join(" · ") || "ไม่มีหมายเหตุ"}</p>
                  </div>
                  <p className="text-sm tabular-nums text-ink">
                    {venue.bay_count > 1 ? `${venue.bay_count} ช่อง × ${venue.capacity_per_bay} คน = ${venue.bay_count * venue.capacity_per_bay} คน` : `รับได้ ${venue.capacity_per_bay} คน`}
                  </p>
                  <span className={`${buttonClass("secondary", "sm")} w-fit`}>
                    <EditIcon className="size-4" aria-hidden="true" />
                    แก้ไข
                  </span>
                </summary>
                <div className="grid gap-3 border-t border-line bg-canvas/60 px-5 py-4">
                  <div className="rounded-lg border border-line bg-white p-4">
                    <VenueForm disabled={props.bypass} venue={venue} />
                  </div>
                  {props.bypass ? null : (
                    <form action={archiveLessonVenue} className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/20 bg-white p-4">
                      <input name="venueId" type="hidden" value={venue.id} />
                      <p className="min-w-0 flex-1 text-sm text-ink-muted">เก็บถาวร = เลือกสถานที่นี้ตอนสร้างรอบไม่ได้แล้ว รอบเดิมยังแสดงชื่อสถานที่</p>
                      <ConfirmSubmitButton className={buttonDanger} confirmLabel="เก็บถาวร" message={`เก็บสถานที่ "${venue.name}" ถาวร?`}>
                        <DeleteIcon className="size-4" aria-hidden="true" />
                        เก็บถาวร
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">ยังไม่มีสถานที่ เพิ่มในช่อง &quot;เพิ่มสถานที่&quot; ด้านบน ระบุจำนวนช่องซ้อมเพื่อให้เตือนเมื่อจองช่องซ้ำ</p>
        )}
      </section>
    </>
  );
}
