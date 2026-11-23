import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, MapPin, MessageSquareText, Phone, Undo2, UserX } from "lucide-react";

import { addLessonCoachNote, markLessonAttendance } from "@/app/coach/actions";
import { coachProblemText, resolveCoachPortal } from "@/app/coach/portal";
import { CoachHeader } from "@/components/coach-header";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { MemberAvatar } from "@/components/member-avatar";
import { StatusBanner, type BannerTone } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { QrCode } from "@/components/ui/qr-code";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, fieldHint, fieldInputClass, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { publicOrigin } from "@/lib/auth/recovery";
import { formatPhone, formatThaiDateLong, formatThaiDateShort, formatThaiDateTime, formatThaiTime, phoneHref } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { bangkokDate } from "@/lib/lessons/booking";
import { slotFill } from "@/lib/lessons/calendar";
import { attendanceOpensAt, canMarkAttendance, groupRoster, learnerName } from "@/lib/lessons/coach-view";
import { rpcErrorMessage } from "@/lib/lessons/errors";
import { lessonBookingStatusLabel, skillLevelLabels } from "@/lib/lessons/labels";
import { lessonSampleData } from "@/lib/lessons/sample-data";
import type { LessonRosterRow, LessonSlotRow, SkillLevel } from "@/lib/lessons/types";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";

type PageProps = {
  params: Promise<{ slotId: string }>;
  searchParams: Promise<{ bypass?: string; coach?: string; error?: string; qr?: string; status?: string }>;
};

type SlotDetail = LessonSlotRow & { program_name: string | null };

const CheckInIcon = appIcons.checkIn;
const WaitlistIcon = appIcons.waitlist;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const statusMessages: Record<string, { text: string; tone: BannerTone }> = {
  "attendance-attended": { text: "บันทึกว่ามาเรียนแล้ว", tone: "success" },
  "attendance-no_show": { text: "บันทึกว่าขาดเรียนแล้ว", tone: "success" },
  "attendance-undo": { text: "ล้างการเช็กชื่อแล้ว", tone: "info" },
  "note-saved": { text: "บันทึกโน้ตแล้ว ผู้เรียนเห็นโน้ตในหน้าประวัติการเรียน", tone: "success" },
};

const extraErrors: Record<string, string> = {
  failed: "บันทึกไม่สำเร็จ ลองอีกครั้ง",
  "note-too-long": "โน้ตยาวเกิน 2,000 ตัวอักษร",
  outdated: "ฐานข้อมูลยังไม่ได้อัปเดตให้ตรงกับระบบ กรุณาแจ้งผู้ดูแลระบบ",
};

/** One timestamp per request (server component), so every rule on the page uses the same "now". */
function requestTime() {
  return Date.now();
}

function attendanceButton(pressed: boolean, tone: "success" | "danger") {
  const base = "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-lg border px-4 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
  if (pressed) return `${base} ${tone === "success" ? "border-success bg-success text-white" : "border-danger bg-danger text-white"}`;
  return `${base} ${tone === "success" ? "border-success/40 bg-white text-success hover:bg-success-bg" : "border-danger/30 bg-white text-danger hover:bg-danger-bg"}`;
}

export default async function CoachSlotPage({ params, searchParams }: PageProps) {
  const [{ slotId }, query] = await Promise.all([params, searchParams]);
  const portal = await resolveCoachPortal(query, `/coach/slots/${slotId}`);
  if (!UUID.test(slotId)) notFound();
  const now = requestTime();
  const demo = portal.isBypass;
  const pickedCoach = portal.isStaff && query.coach && UUID.test(query.coach) ? query.coach : null;
  const backQuery = demo ? "?bypass=admin" : pickedCoach ? `?coach=${pickedCoach}` : "";
  const showQr = query.qr === "1";

  let slot: SlotDetail | null = null;
  let roster: LessonRosterRow[] = [];
  let rosterError: string | null = null;
  let token: string | null = null;

  if (demo) {
    const sample = lessonSampleData(bangkokDate(now));
    const found = sample.slots.find((item) => item.id === slotId);
    if (!found) notFound();
    slot = { ...found, program_name: sample.programs.find((program) => program.id === found.program_id)?.name ?? null };
    roster = sample.roster;
    token = "0123456789abcdef0123456789abcdef";
  } else if (portal.supabase && (portal.coach || portal.isStaff) && portal.problem !== "schema-outdated") {
    const { data, error } = await portal.supabase
      .from("lesson_slots")
      .select(
        "id, title, lesson_date, start_time, end_time, capacity, waitlist_capacity, status, booked_count, seats_taken, waitlist_count, venue, bay_label, coach_id, coach_name, program_id, lesson_programs(name)",
      )
      .eq("id", slotId)
      .maybeSingle();
    if (error && classifyDbError(error) !== "schema-outdated") logDbError("coach.slot load", error);
    const row = data as (LessonSlotRow & { lesson_programs?: { name: string | null } | { name: string | null }[] | null }) | null;
    // Coaches only see their own rounds; staff may open any round of the club.
    if (!row || (!portal.isStaff && row.coach_id !== portal.coach?.id)) notFound();
    const { lesson_programs, ...rest } = row;
    slot = { ...rest, program_name: (Array.isArray(lesson_programs) ? lesson_programs[0]?.name : lesson_programs?.name) ?? null };

    const [rosterResult, tokenResult] = await Promise.all([
      portal.supabase.rpc("lesson_slot_roster", { p_slot_id: slotId }),
      showQr ? portal.supabase.rpc("lesson_checkin_token", { p_slot_id: slotId }) : Promise.resolve({ data: null, error: null }),
    ]);
    if (rosterResult.error) {
      rosterError = classifyDbError(rosterResult.error) === "schema-outdated" ? extraErrors.outdated : rpcErrorMessage(rosterResult.error.message);
      if (classifyDbError(rosterResult.error) !== "schema-outdated") logDbError("coach.slot roster", rosterResult.error);
    }
    roster = (rosterResult.data ?? []) as LessonRosterRow[];
    if (tokenResult.error) logDbError("coach.slot token", tokenResult.error);
    token = typeof tokenResult.data === "string" ? tokenResult.data : null;
  }

  if (!slot) {
    return (
      <main className="min-h-screen bg-canvas px-4 pb-10 pt-5 text-ink sm:px-6">
        <div className="mx-auto grid w-full max-w-3xl gap-5">
          <CoachHeader hasMemberRow={portal.hasMemberRow} isBypass={demo} isStaff={portal.isStaff} name={portal.displayName} />
          {portal.problem ? (
            <StatusBanner title={coachProblemText[portal.problem].title} tone="info">
              {coachProblemText[portal.problem].body}
            </StatusBanner>
          ) : null}
          <Link className={`${buttonClass("secondary", "lg")} w-fit`} href={`/coach${backQuery}`}>
            ตารางสอน
          </Link>
        </div>
      </main>
    );
  }

  const groups = groupRoster(roster);
  const fill = slotFill(slot);
  const cancelled = slot.status === "cancelled";
  const canMark = !cancelled && canMarkAttendance({ date: slot.lesson_date, startTime: slot.start_time }, { isStaff: portal.isStaff, now });
  const opensAt = attendanceOpensAt(slot.lesson_date, slot.start_time);
  const message = query.status ? statusMessages[query.status] : undefined;
  const errorText = query.error ? (extraErrors[query.error] ?? rpcErrorMessage(query.error)) : null;
  const requestHeaders = token ? await headers() : null;
  const qrUrl = token ? `${publicOrigin(requestHeaders?.get("host"), requestHeaders?.get("x-forwarded-proto"))}/member/check-in?token=${token}` : null;
  const selfQuery = backQuery ? `${backQuery}&` : "?";
  const coachField = pickedCoach ? <input name="coach" type="hidden" value={pickedCoach} /> : null;

  return (
    <main className="min-h-screen bg-canvas px-4 pb-10 pt-5 text-ink sm:px-6">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <CoachHeader hasMemberRow={portal.hasMemberRow} isBypass={demo} isStaff={portal.isStaff} name={portal.displayName} />
        <span className="sr-only" id="coach-content" tabIndex={-1} />
        <Link className="inline-flex h-11 w-fit items-center gap-1.5 text-base font-semibold text-brand-600 hover:underline" href={`/coach${backQuery}`}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          ตารางสอน
        </Link>

        {message ? (
          <StatusBanner floating tone={message.tone}>
            {message.text}
          </StatusBanner>
        ) : null}
        {errorText ? (
          <StatusBanner floating tone="error">
            {errorText}
          </StatusBanner>
        ) : null}
        {demo ? <StatusBanner tone="warning">โหมดทดลอง ข้อมูลในหน้านี้เป็นตัวอย่าง บันทึกจริงไม่ได้</StatusBanner> : null}

        <section className="rounded-xl border border-line bg-white p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="min-w-0 text-h2 font-semibold text-ink">{slot.title}</h1>
            {cancelled ? (
              <StatusBadge kind="lesson" status="cancelled">
                ยกเลิกรอบ
              </StatusBadge>
            ) : null}
          </div>
          {slot.program_name && slot.program_name !== slot.title ? <p className="text-base text-ink-muted">{slot.program_name}</p> : null}
          <p className="mt-2 text-h3 font-semibold text-ink">{formatThaiDateLong(slot.lesson_date)}</p>
          <p className="text-h3 font-semibold tabular-nums text-brand-600">{formatTimeRange(slot.start_time, slot.end_time)}</p>
          <p className="mt-2 flex items-start gap-2 text-base text-ink-muted">
            <MapPin className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            {slot.venue || "รอแจ้งสนาม"}
          </p>
          {portal.isStaff && slot.coach_name ? <p className="text-base text-ink-muted">ผู้สอน {slot.coach_name}</p> : null}
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["ที่นั่ง", `${fill.taken}/${fill.capacity}`],
              ["มาเรียน", String(groups.counts.attended)],
              ["ขาด", String(groups.counts.noShow)],
              ["คิวสำรอง", String(groups.counts.waitlist)],
            ].map(([label, value]) => (
              <div className="rounded-lg bg-canvas px-3 py-2" key={label}>
                <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
                <dd className="text-h3 font-semibold tabular-nums text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {!cancelled ? (
            <div className="mt-4">
              {showQr ? (
                <Link className={`${buttonClass("secondary", "lg")} w-full sm:w-fit`} href={`/coach/slots/${slot.id}${backQuery}`}>
                  ซ่อน QR
                </Link>
              ) : (
                <Link className={`${buttonClass("primary", "lg")} w-full sm:w-fit`} href={`/coach/slots/${slot.id}${selfQuery}qr=1#checkin-qr`}>
                  <CheckInIcon className="size-5" aria-hidden="true" />
                  แสดง QR เช็กชื่อ
                </Link>
              )}
            </div>
          ) : null}
        </section>

        {showQr && !cancelled ? (
          <section aria-labelledby="checkin-qr-title" className="scroll-mt-4 rounded-xl border border-line bg-white p-5 text-center shadow-card" id="checkin-qr">
            <h2 className="text-h2 font-semibold text-ink" id="checkin-qr-title">
              สแกนเพื่อเช็กชื่อ
            </h2>
            <p className="mt-1 text-base text-ink-muted">
              ให้ผู้เรียนสแกนด้วยกล้องมือถือ เช็กชื่อได้ตั้งแต่ {formatThaiTime(opensAt.toISOString())} จนจบรอบ
            </p>
            {qrUrl ? (
              <div className="mt-4 flex justify-center">
                <QrCode label={`QR เช็กชื่อ ${slot.title} ${formatThaiDateShort(slot.lesson_date)}`} size={288} value={qrUrl} />
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-danger-bg px-3 py-2.5 text-base text-danger">สร้าง QR ไม่สำเร็จ ลองโหลดหน้าใหม่ หรือเช็กชื่อด้วยปุ่มด้านล่าง</p>
            )}
          </section>
        ) : null}

        {rosterError ? <StatusBanner tone="error">{rosterError}</StatusBanner> : null}

        <section aria-labelledby="roster-title" className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-h2 font-semibold text-ink" id="roster-title">
              ผู้เรียน {groups.seats.length} คน
            </h2>
            {!cancelled && !canMark ? (
              <p className="text-sm text-ink-muted">เช็กชื่อได้ตั้งแต่ {formatThaiDateTime(opensAt.toISOString())}</p>
            ) : null}
          </div>
          {groups.seats.length ? (
            <ul className="grid gap-3">
              {groups.seats.map((row) => (
                <LearnerCard
                  canMark={canMark}
                  coachField={coachField}
                  demo={demo}
                  key={row.booking_id}
                  row={row}
                  slotId={slot.id}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-line bg-white px-4 py-4 text-base text-ink-muted">ยังไม่มีผู้จองรอบนี้</p>
          )}
        </section>

        {groups.waitlist.length ? (
          <section aria-labelledby="waitlist-title" className="rounded-xl border border-line bg-white p-4 shadow-card">
            <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="waitlist-title">
              <WaitlistIcon className="size-5 text-warning" aria-hidden="true" />
              คิวสำรอง {groups.waitlist.length} คน
            </h2>
            <ul className="mt-2 divide-y divide-line">
              {groups.waitlist.map((row, index) => {
                const tel = phoneHref(row.phone);
                return (
                  <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={row.booking_id}>
                    <p className="min-w-0 text-base text-ink">
                      <span className="mr-2 font-semibold tabular-nums text-ink-muted">{index + 1}.</span>
                      {learnerName(row)}
                    </p>
                    {tel ? (
                      <a className={buttonClass("secondary", "sm")} href={tel}>
                        <Phone className="size-4" aria-hidden="true" />
                        {formatPhone(row.phone)}
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {groups.inactive.length ? (
          <details className="rounded-xl border border-line bg-white px-4 py-2">
            <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold text-brand-600">
              ยกเลิกแล้ว ({groups.inactive.length})
            </summary>
            <ul className="divide-y divide-line pb-2">
              {groups.inactive.map((row) => (
                <li className="flex flex-wrap items-center justify-between gap-2 py-2.5" key={row.booking_id}>
                  <span className="text-base text-ink">{learnerName(row)}</span>
                  <StatusBadge kind="booking" status={row.booking_status}>
                    {lessonBookingStatusLabel(row.booking_status)}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </main>
  );
}

function LearnerCard({
  canMark,
  coachField,
  demo,
  row,
  slotId,
}: {
  canMark: boolean;
  coachField: React.ReactNode;
  demo: boolean;
  row: LessonRosterRow;
  slotId: string;
}) {
  const tel = phoneHref(row.phone);
  const level = row.skill_level && row.skill_level in skillLevelLabels ? skillLevelLabels[row.skill_level as SkillLevel] : null;
  const markable = row.booking_status === "booked" || row.booking_status === "attended" || row.booking_status === "no_show";
  const attended = row.booking_status === "attended";
  const absent = row.booking_status === "no_show";
  const hidden = (
    <>
      <input name="bookingId" type="hidden" value={row.booking_id} />
      <input name="slotId" type="hidden" value={slotId} />
      {coachField}
    </>
  );

  return (
    <li className="scroll-mt-4 rounded-xl border border-line bg-white p-4 shadow-card" id={`learner-${row.booking_id}`}>
      <div className="flex items-start gap-3">
        <MemberAvatar avatarUrl={row.avatar_url} displayName={row.full_name} seed={row.member_code ?? row.member_id} size="xs" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">{learnerName(row)}</p>
          <p className="text-sm text-ink-muted">
            {level ? `ระดับ ${level}` : "ยังไม่ประเมินระดับ"}
            {row.credit_used ? " · ใช้เครดิตแล้ว" : ""}
          </p>
        </div>
        <StatusBadge className="shrink-0" kind="booking" status={row.booking_status}>
          {lessonBookingStatusLabel(row.booking_status)}
          {attended && row.checked_in_at ? ` ${formatThaiTime(row.checked_in_at)}` : ""}
        </StatusBadge>
      </div>

      {tel ? (
        <a className={`${buttonClass("secondary", "md")} mt-3 w-full sm:w-fit`} href={tel}>
          <Phone className="size-4" aria-hidden="true" />
          โทร {formatPhone(row.phone)}
        </a>
      ) : null}

      {row.booking_status === "offered" ? (
        <p className="mt-3 rounded-lg bg-info-bg px-3 py-2.5 text-sm text-info">
          ได้ที่จากคิวสำรอง รอผู้เรียนยืนยัน{row.offer_expires_at ? ` ถึง ${formatThaiDateTime(row.offer_expires_at)}` : ""}
        </p>
      ) : null}

      {markable && canMark ? (
        <div className="mt-3">
          <div className="flex gap-2">
            <form action={markLessonAttendance} className="flex flex-1">
              {hidden}
              <input name="mark" type="hidden" value="attended" />
              <SubmitButton className={attendanceButton(attended, "success")} disabled={demo || attended} pendingText="กำลังบันทึก...">
                <Check className="size-5" aria-hidden="true" />
                มาเรียน
              </SubmitButton>
            </form>
            <form action={markLessonAttendance} className="flex flex-1">
              {hidden}
              <input name="mark" type="hidden" value="no_show" />
              <SubmitButton className={attendanceButton(absent, "danger")} disabled={demo || absent} pendingText="กำลังบันทึก...">
                <UserX className="size-5" aria-hidden="true" />
                ขาด
              </SubmitButton>
            </form>
          </div>
          {attended || absent ? (
            <form action={markLessonAttendance} className="mt-2">
              {hidden}
              <input name="mark" type="hidden" value="undo" />
              <SubmitButton className={buttonClass("ghost", "sm")} disabled={demo} pendingText="กำลังบันทึก...">
                <Undo2 className="size-4" aria-hidden="true" />
                ล้างการเช็กชื่อ
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}

      {row.last_note ? (
        <div className="mt-3 rounded-lg bg-canvas px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-subtle">
            <MessageSquareText className="size-4" aria-hidden="true" />
            โน้ตล่าสุด{row.last_note_at ? ` · ${formatThaiDateShort(row.last_note_at)}` : ""}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-base text-ink">{row.last_note}</p>
        </div>
      ) : null}

      {markable ? (
        <details className="mt-3 rounded-lg border border-line px-3 py-1">
          <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold text-brand-600">จดโน้ต / ปรับระดับ</summary>
          <form action={addLessonCoachNote} className="grid gap-3 pb-3">
            {hidden}
            <div>
              <label className={fieldLabel} htmlFor={`note-${row.booking_id}`}>
                โน้ตหลังเรียน<span aria-hidden="true"> *</span>
              </label>
              <textarea className={fieldTextarea} id={`note-${row.booking_id}`} maxLength={2000} name="note" required />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel} htmlFor={`skill-${row.booking_id}`}>
                  ระดับฝีมือ
                </label>
                <select className={fieldInputClass("lg")} defaultValue="" id={`skill-${row.booking_id}`} name="skillLevel">
                  <option value="">ไม่เปลี่ยน{level ? ` (ตอนนี้ ${level})` : ""}</option>
                  {(Object.keys(skillLevelLabels) as SkillLevel[]).map((key) => (
                    <option key={key} value={key}>
                      {skillLevelLabels[key]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabel} htmlFor={`video-${row.booking_id}`}>
                  ลิงก์คลิปวงสวิง
                </label>
                <input
                  className={fieldInputClass("lg")}
                  id={`video-${row.booking_id}`}
                  inputMode="url"
                  name="videoUrl"
                  placeholder="https://"
                  type="url"
                />
                <span className={fieldHint}>ไม่บังคับ เช่น ลิงก์ YouTube หรือ Google Drive</span>
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-base text-ink">
              <input className="size-5 accent-brand-600" defaultChecked name="visibleToMember" type="checkbox" />
              ให้ผู้เรียนเห็นโน้ตนี้
            </label>
            <SubmitButton className={`${buttonClass("primary", "lg")} w-full sm:w-fit`} disabled={demo}>
              <Check className="size-4" aria-hidden="true" />
              บันทึกโน้ต
            </SubmitButton>
          </form>
        </details>
      ) : null}
    </li>
  );
}
