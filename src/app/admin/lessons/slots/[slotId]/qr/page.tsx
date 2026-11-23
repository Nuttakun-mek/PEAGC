import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { rotateLessonCheckinToken } from "@/app/admin/lessons/calendar-actions";
import { loadSlot } from "@/app/admin/lessons/data";
import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EventsPrintButton } from "@/components/events-print-button";
import { LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { QrCode } from "@/components/ui/qr-code";
import { buttonClass } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { publicOrigin } from "@/lib/auth/recovery";
import { formatThaiDateLong, orUnset } from "@/lib/display";
import { type AdminLessonSlot, isUuid, lessonCheckInPath, lessonsAdminHref } from "@/lib/lessons/admin";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/lessons/errors";
import { lessonSampleData } from "@/lib/lessons/sample-data";
import { bangkokDate } from "@/lib/lessons/booking";
import { classifyDbError, dbFailureMessages, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "QR เช็กชื่อรอบเรียน",
};

type PageProps = {
  params: Promise<{ slotId: string }>;
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

/** Print only the sheet: the admin menu and header stay on screen but not on paper. */
const printCss = `
@media print {
  @page { size: A4 portrait; margin: 14mm; }
  body * { visibility: hidden !important; }
  #qr-sheet, #qr-sheet * { visibility: visible !important; }
  #qr-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0 !important; box-shadow: none !important; }
}`;

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "qr-rotate-failed": "สร้าง QR ใหม่ไม่สำเร็จ",
  "qr-rotated": "สร้าง QR ใหม่แล้ว QR เดิมที่พิมพ์ไว้ใช้เช็กชื่อไม่ได้แล้ว",
  "slot-not-found": "ไม่พบรอบเรียนนี้",
};

export default async function LessonSlotQrPage({ params, searchParams }: PageProps) {
  const [{ slotId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: `/admin/lessons/slots/${slotId}/qr`,
    requiredRole: "admin",
    searchParams: query,
  });
  await requireAdminArea("lessons", access);

  let slot: AdminLessonSlot | null = null;
  let token: string | null = null;
  let tokenError: string | null = null;
  let outdated = false;

  if (access.isBypass) {
    const sample = lessonSampleData(bangkokDate());
    const row = sample.slots.find((item) => item.id === slotId) ?? sample.slots[0];
    const program = sample.programs.find((item) => item.id === row.program_id);
    slot = { ...row, program_id: row.program_id ?? "", program_name: program?.name ?? null, title: row.title ?? "รอบเรียน" };
    token = "0123456789abcdef0123456789abcdef";
  } else if (access.clubId && isUuid(slotId)) {
    const supabase = await createClient();
    const loaded = await loadSlot(supabase, access.clubId, slotId, true);
    if (loaded.error) logDbError("admin.lessons.qr slot", loaded.error);
    slot = loaded.slot;
    if (slot) {
      const { data, error } = await supabase.rpc("lesson_checkin_token", { p_slot_id: slot.id });
      if (error) {
        logDbError("admin.lessons.qr token", error);
        outdated = classifyDbError(error) === "schema-outdated";
        tokenError = outdated ? null : rpcErrorCode(error.message) ? rpcErrorMessage(error.message) : "สร้าง QR ไม่สำเร็จ ลองโหลดหน้าใหม่";
      } else {
        token = typeof data === "string" ? data : null;
      }
    }
  }

  if (!slot) {
    notFound();
  }

  const requestHeaders = await headers();
  const origin = publicOrigin(requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"), requestHeaders.get("x-forwarded-proto"));
  const checkInUrl = token ? `${origin}${lessonCheckInPath(token)}` : null;
  const backHref = lessonsAdminHref({ bypass: access.isBypass, date: slot.lesson_date, slot: slot.id });
  const statusMessage = query.status ? (statusMessages[query.status] ?? (query.status.startsWith("rpc:") ? rpcErrorMessage(query.status.slice(4)) : null)) : null;

  return (
    <main className="px-4 py-6 text-ink sm:px-6 lg:px-8">
      <style>{printCss}</style>
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className={buttonClass("secondary", "sm")} href={backHref}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับไปที่รอบเรียน
          </Link>
          {checkInUrl ? <EventsPrintButton label="พิมพ์ QR" /> : null}
        </div>

        {statusMessage ? (
          <StatusBanner className="mt-4" floating tone={toneForStatus(query.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}
        <LoadErrorBanner className="mt-4" error={outdated ? { labels: ["QR เช็กชื่อ"], outdated: true } : null} />
        {tokenError ? (
          <StatusBanner className="mt-4" tone="error">
            {tokenError}
          </StatusBanner>
        ) : null}
        {access.isBypass ? (
          <StatusBanner className="mt-4" tone="warning">
            โหมดทดลอง: QR ตัวอย่าง ใช้เช็กชื่อจริงไม่ได้
          </StatusBanner>
        ) : null}

        <section className="mt-5 rounded-xl border border-line bg-white p-6 text-center shadow-card sm:p-10" id="qr-sheet">
          <div className="flex items-center justify-center gap-3">
            <ClubCrest size={48} />
            <p className="text-left text-sm font-semibold text-ink-muted">{CLUB_NAME}</p>
          </div>
          <h1 className="mt-6 text-display font-semibold text-brand-600">เช็กชื่อเข้าเรียน</h1>
          <p className="mt-2 text-h2 font-semibold text-ink">{slot.title}</p>
          <p className="mt-1 text-base text-ink">
            {formatThaiDateLong(slot.lesson_date)} · <span className="tabular-nums">{formatTimeRange(slot.start_time, slot.end_time)}</span>
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            ผู้สอน {orUnset(slot.coach_name)} · {orUnset(slot.venue)}
          </p>
          {checkInUrl ? (
            <div className="mt-6 flex justify-center">
              <QrCode label={`QR เช็กชื่อ ${slot.title}`} size={320} value={checkInUrl} />
            </div>
          ) : (
            <p className="mt-6 rounded-lg bg-canvas px-4 py-10 text-sm text-ink-muted">ยังสร้าง QR ไม่ได้</p>
          )}
          <ol className="mx-auto mt-6 grid max-w-md gap-1.5 text-left text-base text-ink">
            <li>1. สแกน QR ด้วยกล้องมือถือ</li>
            <li>2. เข้าสู่ระบบสมาชิก (ถ้ายังไม่ได้เข้า)</li>
            <li>3. กด &quot;เช็กชื่อ&quot; เห็นชื่อตัวเองขึ้นว่าเข้าเรียนแล้ว = เรียบร้อย</li>
          </ol>
          <p className="mt-4 text-sm text-ink-muted">เช็กชื่อได้ตั้งแต่ 30 นาทีก่อนเริ่มเรียนจนถึงเวลาเลิกเรียน เฉพาะคนที่จองรอบนี้</p>
        </section>

        {token && !access.isBypass ? (
          <form action={rotateLessonCheckinToken} className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-4 shadow-card print:hidden">
            <input name="slotId" type="hidden" value={slot.id} />
            <input name="returnTo" type="hidden" value={`/admin/lessons/slots/${slot.id}/qr`} />
            <p className="min-w-0 flex-1 text-sm text-ink-muted">QR หลุดไปนอกกลุ่ม? สร้างใหม่ได้ QR เดิมจะใช้ไม่ได้ทันที</p>
            <ConfirmSubmitButton className={buttonClass("secondary", "sm")} confirmLabel="สร้าง QR ใหม่" message="QR เดิมที่พิมพ์หรือส่งไปแล้วจะใช้เช็กชื่อไม่ได้อีก" tone="primary">
              <RefreshCw className="size-4" aria-hidden="true" />
              สร้าง QR ใหม่
            </ConfirmSubmitButton>
          </form>
        ) : null}
      </div>
    </main>
  );
}
