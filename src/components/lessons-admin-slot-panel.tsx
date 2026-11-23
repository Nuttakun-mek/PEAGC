import Link from "next/link";
import { ChevronDown, CircleOff, X } from "lucide-react";

import { archiveLessonSlot, removeLessonBooking, updateLessonSlot } from "@/app/admin/lessons/actions";
import { cancelLessonSlot, markLessonAttendance, moveLessonBooking } from "@/app/admin/lessons/calendar-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SlotForm, lessonSlotStatusLabels } from "@/components/lessons-admin-fields";
import type { PickerCoach, PickerVenue } from "@/components/lessons-admin-pickers";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { MemberAvatar } from "@/components/member-avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { formatPhone, formatThaiDateLong, formatThaiDateTime, formatThaiTime, orUnset, phoneHref } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { type AdminLessonProgram, type AdminLessonSlot, type MoveTarget, rosterGroups } from "@/lib/lessons/admin";
import { slotFill } from "@/lib/lessons/calendar";
import { lessonBookingStatusDescriptions, lessonBookingStatusLabel } from "@/lib/lessons/labels";
import type { LessonBookingStatus, LessonRosterRow } from "@/lib/lessons/types";

// Side panel of one round (opened from the calendar): roster with phone numbers, check-in ticks,
// คิวสำรอง with the current offer, move to another round, cancel / edit the round, QR for check-in.

export type SlotPanelProps = {
  bypass: boolean;
  closeHref: string;
  coaches: PickerCoach[];
  cutoffHours: number;
  moveTargets: MoveTarget[];
  programs: AdminLessonProgram[];
  qrHref: string | null;
  returnTo: string;
  roster: LessonRosterRow[];
  rosterFailed: boolean;
  slot: AdminLessonSlot;
  v2: boolean;
  venues: PickerVenue[];
};

function Hidden({ returnTo }: { returnTo: string }) {
  return <input name="returnTo" type="hidden" value={returnTo} />;
}

function AttendanceButtons({ disabled, returnTo, row }: { disabled: boolean; returnTo: string; row: LessonRosterRow }) {
  const status = row.booking_status;
  if (status !== "booked" && status !== "attended" && status !== "no_show") return null;
  const CheckInIcon = appIcons.checkIn;
  const options: Array<{ label: string; value: "true" | "false" | "clear"; active: boolean }> = [
    { active: status === "attended", label: "มาเรียน", value: "true" },
    { active: status === "no_show", label: "ขาดเรียน", value: "false" },
  ];
  return (
    <form action={markLessonAttendance} className="flex flex-wrap items-center gap-1.5">
      <Hidden returnTo={returnTo} />
      <input name="bookingId" type="hidden" value={row.booking_id} />
      {options.map((option) => (
        <button
          aria-label={`${option.label} ${row.full_name}`}
          aria-pressed={option.active}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            option.active
              ? option.value === "true"
                ? "border-success bg-success-bg text-success"
                : "border-danger bg-danger-bg text-danger"
              : "border-line bg-white text-ink-muted hover:border-brand-600 hover:text-brand-600"
          }`}
          disabled={disabled || option.active}
          key={option.value}
          name="attended"
          type="submit"
          value={option.value}
        >
          {option.value === "true" ? <CheckInIcon className="size-4" aria-hidden="true" /> : null}
          {option.label}
        </button>
      ))}
      {status !== "booked" ? (
        <button className={buttonClass("ghost", "sm")} disabled={disabled} name="attended" type="submit" value="clear">
          ล้าง
        </button>
      ) : null}
    </form>
  );
}

function MoveForm({ disabled, returnTo, row, targets }: { disabled: boolean; returnTo: string; row: LessonRosterRow; targets: MoveTarget[] }) {
  const RescheduleIcon = appIcons.reschedule;
  if (!targets.length) {
    return <p className="text-sm text-ink-muted">ไม่มีรอบอื่นที่ย้ายไปได้ในช่วงนี้</p>;
  }
  const same = targets.filter((target) => target.sameCourse);
  const other = targets.filter((target) => !target.sameCourse);
  const option = (target: MoveTarget) => (
    <option key={target.id} value={target.id}>
      {target.label}
    </option>
  );
  return (
    <form action={moveLessonBooking} className="grid gap-2">
      <Hidden returnTo={returnTo} />
      <input name="bookingId" type="hidden" value={row.booking_id} />
      <label className="block">
        <span className={fieldLabel}>ย้ายไปรอบ</span>
        <select className={fieldInputClass("sm")} defaultValue="" disabled={disabled} name="targetSlotId" required>
          <option disabled value="">เลือกรอบ</option>
          {same.length ? <optgroup label="คอร์สเดียวกัน">{same.map(option)}</optgroup> : null}
          {other.length ? <optgroup label="คอร์สอื่น">{other.map(option)}</optgroup> : null}
        </select>
      </label>
      <label className="block">
        <span className={fieldLabel}>หมายเหตุถึงสมาชิก</span>
        <input className={fieldInputClass("sm")} disabled={disabled} name="note" placeholder="เช่น ย้ายตามที่ขอทางโทรศัพท์" />
      </label>
      <button className={`${buttonClass("secondary", "sm")} w-fit`} disabled={disabled} type="submit">
        <RescheduleIcon className="size-4" aria-hidden="true" />
        ย้ายไปรอบนี้
      </button>
    </form>
  );
}

function RosterRow({ props, row, waitlistRank }: { props: SlotPanelProps; row: LessonRosterRow; waitlistRank?: number }) {
  const disabled = props.bypass;
  const phone = phoneHref(row.phone);
  const status = row.booking_status as LessonBookingStatus;
  const canMove = props.v2 && (status === "booked" || status === "waitlist" || status === "offered");
  const canRemove = status === "booked" || status === "waitlist" || status === "offered";
  const DeleteIcon = appIcons.delete;
  const RescheduleIcon = appIcons.reschedule;
  const label = waitlistRank ? `คิวสำรองลำดับ ${waitlistRank}` : lessonBookingStatusLabel(status);

  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <MemberAvatar avatarUrl={row.avatar_url} displayName={row.full_name || "?"} seed={row.member_code ?? row.member_id} size="xs" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">
            {orUnset(row.full_name)}
            {row.nickname ? <span className="font-normal text-ink-muted"> ({row.nickname})</span> : null}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-muted">
            {row.phone ? (
              phone ? (
                <a className="font-medium text-brand-600 underline-offset-4 hover:underline" href={phone}>{formatPhone(row.phone)}</a>
              ) : (
                <span>{formatPhone(row.phone)}</span>
              )
            ) : (
              <span>ไม่มีเบอร์โทร</span>
            )}
            {row.member_code || row.employee_code ? <span>รหัส {row.member_code ?? row.employee_code}</span> : null}
          </p>
        </div>
        <span className="shrink-0" title={lessonBookingStatusDescriptions[status]}>
          <StatusBadge kind="booking" status={status}>{label}</StatusBadge>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-xs text-ink-muted">
        {status === "offered" && row.offer_expires_at ? (
          <span className="font-medium text-info">รอยืนยันที่ว่างถึง {formatThaiDateTime(row.offer_expires_at)}</span>
        ) : null}
        {row.checked_in_at && status === "attended" ? <span>เช็กชื่อ {formatThaiTime(row.checked_in_at)}</span> : null}
        {props.v2 && (status === "booked" || status === "attended" || status === "no_show" || status === "late_cancelled") ? (
          <span>{row.credit_used ? "ใช้เครดิต 1 ครั้ง" : "ไม่ใช้เครดิต"}</span>
        ) : null}
        {row.booked_at ? <span>จองเมื่อ {formatThaiDateTime(row.booked_at)}</span> : null}
        {row.attendance_note ? <span>หมายเหตุ: {row.attendance_note}</span> : null}
        {row.last_note ? <span className="w-full">โน้ตผู้สอนล่าสุด: {row.last_note}</span> : null}
      </div>
      <div className="flex flex-wrap items-start gap-2 pl-11">
        <AttendanceButtons disabled={disabled} returnTo={props.returnTo} row={row} />
        {canMove || canRemove ? (
          <details className="group/more w-full">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">
              <RescheduleIcon className="size-4" aria-hidden="true" />
              {canMove ? "ย้ายไปรอบอื่น / นำออก" : "นำออก"}
              <ChevronDown className="size-4 transition group-open/more:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-2 grid gap-3 rounded-lg border border-line bg-white p-3">
              {canMove ? <MoveForm disabled={disabled} returnTo={props.returnTo} row={row} targets={props.moveTargets} /> : null}
              {canRemove ? (
                <form action={removeLessonBooking} className="flex flex-wrap items-center gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
                  <Hidden returnTo={props.returnTo} />
                  <input name="bookingId" type="hidden" value={row.booking_id} />
                  <p className="min-w-0 flex-1 text-sm text-ink-muted">นำออกจากรอบนี้ คืนเครดิต แล้วคนในคิวสำรองลำดับถัดไปได้ที่นั่ง</p>
                  <ConfirmSubmitButton
                    className={buttonClass("danger", "sm")}
                    confirmLabel="นำออก"
                    disabled={disabled}
                    message={`นำ ${row.full_name || "ผู้เรียน"} ออกจากรอบนี้?`}
                  >
                    <DeleteIcon className="size-4" aria-hidden="true" />
                    นำออก
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </li>
  );
}

export function LessonsAdminSlotPanel(props: SlotPanelProps) {
  const { slot } = props;
  const fill = slotFill(slot);
  const groups = rosterGroups(props.roster);
  const checkedIn = groups.seats.filter((row) => row.booking_status === "attended").length;
  const offers = groups.seats.filter((row) => row.booking_status === "offered");
  const active = groups.seats.length + groups.waitlist.length;
  const cancelled = slot.status === "cancelled";
  const CheckInIcon = appIcons.checkIn;
  const EditIcon = appIcons.edit;
  const WaitlistIcon = appIcons.waitlist;
  const MembersIcon = appIcons.members;
  const DeleteIcon = appIcons.delete;

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-muted">{formatThaiDateLong(slot.lesson_date)}</p>
            <h2 className="text-h2 font-semibold text-ink">{slot.title}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm tabular-nums text-ink">
              {formatTimeRange(slot.start_time, slot.end_time)}
              <StatusBadge kind="lesson" status={slot.status === "open" && fill.level === "full" ? "full" : slot.status}>
                {slot.status === "open" && fill.level === "full" ? "เต็มแล้ว" : (lessonSlotStatusLabels[slot.status] ?? slot.status)}
              </StatusBadge>
            </p>
          </div>
          <Link aria-label="ปิดแผง" className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-neutral-bg hover:text-ink" href={props.closeHref} scroll={false}>
            <X className="size-5" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="grid gap-4 p-5">
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-xl border border-line bg-white p-4 text-sm">
          <dt className="text-ink-subtle">คอร์ส</dt>
          <dd className="text-ink">{orUnset(slot.program_name)}</dd>
          <dt className="text-ink-subtle">ผู้สอน</dt>
          <dd className="text-ink">{orUnset(slot.coach_name)}</dd>
          <dt className="text-ink-subtle">สถานที่</dt>
          <dd className="text-ink">{orUnset(slot.venue)}</dd>
          <dt className="text-ink-subtle">ที่นั่ง</dt>
          <dd className="tabular-nums text-ink">
            {fill.label}
            {slot.waitlist_capacity ? <span className="text-ink-muted"> (รับคิวสำรอง {slot.waitlist_capacity} คน)</span> : null}
          </dd>
          {slot.note ? (
            <>
              <dt className="text-ink-subtle">หมายเหตุ</dt>
              <dd className="text-ink">{slot.note}</dd>
            </>
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-2">
          {props.qrHref ? (
            <a className={buttonClass("secondary", "sm")} href={props.qrHref} rel="noopener" target="_blank">
              <CheckInIcon className="size-4" aria-hidden="true" />
              แสดง QR เช็กชื่อ
            </a>
          ) : null}
          <a className={buttonClass("secondary", "sm")} href="#slot-edit">
            <EditIcon className="size-4" aria-hidden="true" />
            แก้ไขรอบ
          </a>
          {!cancelled ? (
            <form action={cancelLessonSlot}>
              <Hidden returnTo={props.returnTo} />
              <input name="slotId" type="hidden" value={slot.id} />
              <ConfirmSubmitButton
                className={buttonClass("danger", "sm")}
                confirmLabel="ยกเลิกรอบ"
                disabled={props.bypass}
                message={active ? `ยกเลิกรอบนี้? ผู้จองและคิวสำรอง ${active} คนจะถูกยกเลิก คืนเครดิต และได้รับแจ้งเตือน` : "ยกเลิกรอบนี้?"}
                title="ยกเลิกรอบเรียน"
              >
                <CircleOff className="size-4" aria-hidden="true" />
                ยกเลิกรอบ
              </ConfirmSubmitButton>
            </form>
          ) : null}
          {!active ? (
            <form action={archiveLessonSlot}>
              <Hidden returnTo={props.returnTo} />
              <input name="slotId" type="hidden" value={slot.id} />
              <ConfirmSubmitButton className={buttonClass("danger", "sm")} confirmLabel="ลบรอบเรียน" disabled={props.bypass} message={`ลบรอบ "${slot.title}" ออกจากตาราง?`}>
                <DeleteIcon className="size-4" aria-hidden="true" />
                ลบรอบ
              </ConfirmSubmitButton>
            </form>
          ) : null}
        </div>

        {props.rosterFailed ? <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">โหลดรายชื่อผู้จองไม่สำเร็จ ลองเปิดใหม่อีกครั้ง</p> : null}

        <section className="rounded-xl border border-line bg-white">
          <h3 className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 font-semibold text-ink">
            <MembersIcon className="size-4 text-ink-subtle" aria-hidden="true" />
            ผู้เรียน <span className="tabular-nums">{groups.seats.length}/{slot.capacity}</span> คน
            {groups.seats.length ? <span className="text-sm font-normal text-ink-muted">· เช็กชื่อแล้ว {checkedIn} คน</span> : null}
          </h3>
          {groups.seats.length ? (
            <ul className="divide-y divide-line">
              {groups.seats.map((row) => (
                <RosterRow key={row.booking_id} props={props} row={row} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-ink-muted">ยังไม่มีคนจองรอบนี้</p>
          )}
        </section>

        {groups.waitlist.length || offers.length || slot.waitlist_capacity ? (
          <section className="rounded-xl border border-line bg-white">
            <h3 className="flex items-center gap-2 border-b border-line px-4 py-3 font-semibold text-ink">
              <WaitlistIcon className="size-4 text-ink-subtle" aria-hidden="true" />
              คิวสำรอง <span className="tabular-nums">{groups.waitlist.length}</span> คน
            </h3>
            {offers.length ? (
              <ul className="grid gap-1 border-b border-line bg-info-bg px-4 py-3 text-sm text-info">
                {offers.map((row) => (
                  <li key={row.booking_id}>
                    เสนอที่ว่างให้ <span className="font-semibold">{row.full_name}{row.nickname ? ` (${row.nickname})` : ""}</span>
                    {row.offer_expires_at ? ` · ต้องยืนยันภายใน ${formatThaiDateTime(row.offer_expires_at)}` : ""}
                    {" "}ไม่ยืนยันทันเวลา ที่ว่างไปที่คนถัดไป
                  </li>
                ))}
              </ul>
            ) : null}
            {groups.waitlist.length ? (
              <ul className="divide-y divide-line">
                {groups.waitlist.map((row, index) => (
                  <RosterRow key={row.booking_id} props={props} row={row} waitlistRank={index + 1} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-sm text-ink-muted">ยังไม่มีคนในคิวสำรอง</p>
            )}
          </section>
        ) : null}

        {groups.inactive.length ? (
          <details className="group/inactive rounded-xl border border-line bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink-muted">
              ยกเลิก / งดเรียน {groups.inactive.length} รายการ
              <ChevronDown className="size-4 transition group-open/inactive:rotate-180" aria-hidden="true" />
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {groups.inactive.map((row) => (
                <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm" key={row.booking_id}>
                  <span className="text-ink-muted">{orUnset(row.full_name)}{row.nickname ? ` (${row.nickname})` : ""}</span>
                  <StatusBadge kind="booking" status={row.booking_status}>{lessonBookingStatusLabel(row.booking_status)}</StatusBadge>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <details className="group/edit scroll-mt-24 rounded-xl border border-line bg-white" id="slot-edit">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold text-brand-600">
            <span className="flex items-center gap-2">
              <EditIcon className="size-4" aria-hidden="true" />
              แก้ไขรอบนี้
            </span>
            <ChevronDown className="size-4 shrink-0 transition group-open/edit:rotate-180" aria-hidden="true" />
          </summary>
          <div className="border-t border-line p-4">
            <SlotForm
              action={updateLessonSlot}
              coaches={props.coaches}
              cutoffHours={props.cutoffHours}
              disabled={props.bypass}
              programs={props.programs}
              returnTo={props.returnTo}
              slot={slot}
              v2={props.v2}
              venues={props.venues}
            />
          </div>
        </details>
      </div>
    </>
  );
}
