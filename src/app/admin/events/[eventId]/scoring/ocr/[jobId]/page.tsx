import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ExternalLink } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { OcrRowEditor } from "@/components/events-ocr-row-editor";
import { StatusBanner } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, buttonDanger, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { getStaffClub } from "@/lib/auth/staff";
import { formatThaiDateTime } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import type { InterpretedCell } from "@/lib/ocr/notation";
import { loadScoringData, scoringRoles } from "@/lib/scoring/data";
import { HOLES, defaultRules } from "@/lib/scoring/engine";
import { dbFailureMessages } from "@/lib/supabase/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import { confirmOcrJob, discardOcrJob } from "../../actions";

export const maxDuration = 60;

type PageProps = {
  params: Promise<{ eventId: string; jobId: string }>;
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

type ReviewRow = {
  cells: InterpretedCell[];
  match?: { id: string | null; score: number };
  name: string;
  nameConfidence: "high" | "medium" | "low";
  needsReview: boolean;
  printedTotals?: { in: string; out: string; total: string } | null;
};

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "check-failed": "ยังมีช่องสีส้มที่ไม่ผ่านการตรวจ แก้ให้ตรงกับการ์ด หรือติ๊ก “บันทึกทั้งที่ยังไม่ผ่านการตรวจ”",
  "duplicate-player": "เลือกผู้เล่นซ้ำกันในการ์ดใบนี้",
  "entry-failed": "บันทึกไม่สำเร็จ",
  "invalid-strokes": "สกอร์ต้องเป็น 1-20 หรือ X",
  "job-closed": "รายการนี้บันทึกหรือยกเลิกไปแล้ว",
  "missing-player": "ไม่พบผู้เล่นที่เลือก",
  "no-rows": "เลือกผู้เล่นอย่างน้อย 1 แถว",
};

const errorLabels: Record<string, string> = {
  OCR_NOT_CONFIGURED: "ยังไม่ได้ตั้งค่าการอ่านการ์ดอัตโนมัติ (ANTHROPIC_API_KEY) กรอกสกอร์เทียบกับภาพได้เลย",
  OCR_REFUSED: "ตัวอ่านอัตโนมัติไม่รับภาพนี้ กรอกสกอร์เทียบกับภาพได้เลย",
  OCR_UNREADABLE: "อ่านการ์ดไม่สำเร็จ (ภาพไม่ชัดหรือไม่ใช่สกอร์การ์ด) กรอกสกอร์เทียบกับภาพได้เลย",
};

const ocrStatusLabels: Record<string, string> = {
  confirmed: "บันทึกแล้ว",
  discarded: "ยกเลิก",
  failed: "อ่านไม่สำเร็จ",
  needs_review: "รอตรวจ",
  processing: "กำลังอ่าน",
};

const confidenceLabel = { high: "อ่านชัด", low: "อ่านไม่ชัด", medium: "ควรตรวจ" } as const;

function cellValue(cell: InterpretedCell | undefined) {
  if (!cell) return "";
  if (cell.pickup) return "X";
  return cell.strokes === null ? "" : String(cell.strokes);
}

export default async function OcrReviewPage({ params, searchParams }: PageProps) {
  const [{ eventId, jobId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: `/admin/events/${eventId}/scoring/ocr/${jobId}`, requiredRole: "admin", searchParams: query });
  await requireAdminArea("events", access);
  if (access.isBypass || !access.clubId) notFound();

  const staff = await getStaffClub(scoringRoles);
  if (staff.status !== "ok") notFound();

  const data = await loadScoringData(staff.supabase, staff.clubId, eventId);
  if (!data.event || !data.competition) notFound();

  const { data: job } = await staff.supabase
    .from("scorecard_ocr_jobs")
    .select("id, status, error, notation, model, extracted, created_at, confirmed_at, files(object_path)")
    .eq("id", jobId)
    .eq("competition_id", data.competition.id)
    .maybeSingle();
  if (!job) notFound();

  const objectPath = (job.files as unknown as { object_path: string } | null)?.object_path;
  const photoUrl = objectPath
    ? (await createAdminClient().storage.from("scorecards").createSignedUrl(objectPath, 1800)).data?.signedUrl ?? null
    : null;

  const extracted = (job.extracted ?? null) as { notes?: string; printedPars?: string[]; rows?: ReviewRow[] } | null;
  const rows: ReviewRow[] = extracted?.rows?.length
    ? extracted.rows
    : Array.from({ length: 4 }, () => ({ cells: [], name: "", nameConfidence: "low" as const, needsReview: true }));
  const pars = (data.rules ?? defaultRules).pars;
  const closed = job.status === "confirmed" || job.status === "discarded";
  const flaggedCells = rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.flags.length).length, 0);
  const printedMismatch =
    extracted?.printedPars?.length === HOLES && extracted.printedPars.some((par, i) => Number(par) !== pars[i]);

  const SaveIcon = appIcons.save;
  const DeleteIcon = appIcons.delete;
  const description = [
    `อัปโหลด ${formatThaiDateTime(job.created_at)}`,
    job.notation ? `การ์ดเขียนแบบ${job.notation === "relative" ? "เทียบพาร์ (+1, E, -1)" : "นับสโตรก"}` : null,
    job.model ? `อ่านโดย ${job.model}` : null,
    job.confirmed_at ? `บันทึกแล้ว ${formatThaiDateTime(job.confirmed_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <section className="mx-auto w-full max-w-[1600px]">
        <Link
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-brand-600"
          href={`/admin/events/${eventId}/scoring#ocr`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          สกอร์ · {data.event.name}
        </Link>
        <div className="mt-2">
          <PageHeader
            description={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-ink-muted">
                <StatusBadge kind="ocr" status={job.status}>{ocrStatusLabels[job.status] ?? job.status}</StatusBadge>
                <span>{description}</span>
              </span>
            }
            title="ตรวจผลสแกนสกอร์การ์ด"
          />
        </div>

        {query.status && statusMessages[query.status] ? (
          <StatusBanner className="mt-4" tone="error">{statusMessages[query.status]}</StatusBanner>
        ) : null}
        {job.error ? (
          <StatusBanner className="mt-4" tone="warning">{errorLabels[job.error] ?? `อ่านไม่สำเร็จ: ${job.error}`}</StatusBanner>
        ) : null}
        {closed ? (
          <StatusBanner className="mt-4" tone="info">
            รายการนี้{job.status === "confirmed" ? "บันทึกแล้ว" : "ถูกยกเลิก"} ภาพยังเก็บไว้เป็นประวัติ
          </StatusBanner>
        ) : null}
        {printedMismatch ? (
          <StatusBanner className="mt-4" tone="warning">
            พาร์ที่พิมพ์บนการ์ดไม่ตรงกับกติกาการแข่งขัน ตรวจว่าใช้การ์ดของสนามนี้ คะแนนจะแปลงตามพาร์ในกติกา
          </StatusBanner>
        ) : null}
        {extracted?.notes ? (
          <StatusBanner className="mt-4" tone="info">หมายเหตุจากการอ่าน: {extracted.notes}</StatusBanner>
        ) : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="xl:sticky xl:top-20 xl:self-start">
            {photoUrl ? (
              <a className="group block overflow-hidden rounded-xl border border-line bg-white shadow-card" href={photoUrl} rel="noopener noreferrer" target="_blank">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage */}
                <img alt="ภาพสกอร์การ์ด" className="w-full" src={photoUrl} />
                <span className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-brand-600 group-hover:underline">
                  <ExternalLink className="size-4" aria-hidden="true" /> เปิดภาพขนาดเต็ม
                </span>
              </a>
            ) : (
              <p className="rounded-xl border border-line bg-white p-8 text-center text-sm text-ink-muted">ไม่พบภาพของรายการนี้</p>
            )}
          </div>

          <form action={confirmOcrJob} className="grid content-start gap-4">
            <input name="eventId" type="hidden" value={eventId} />
            <input name="jobId" type="hidden" value={jobId} />
            <input name="rowCount" type="hidden" value={rows.length} />

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-3.5 rounded border border-warning bg-warning-bg" /> สีส้ม = ควรตรวจ (อ่านไม่ชัด
                หรือไม่ผ่านกฎ){" "}
                <span className="tabular-nums">{flaggedCells}</span> ช่อง
              </span>
              <span>ตัวเล็กใต้ช่อง = สิ่งที่เขียนบนการ์ด</span>
              <span>X = เก็บลูก/ไม่จบหลุม</span>
            </div>
            <ol className="list-decimal pl-5 text-sm text-ink-muted">
              <li>เลือกผู้เล่นของแต่ละแถว แล้วแก้ช่องสีส้มให้ตรงกับภาพ (ทุกหลุม 1-15 ไม่มีช่องว่าง ผลรวมตรงกับ OUT / IN / TOTAL)</li>
              <li>ให้ผู้เล่นดูตัวเลขแล้วติ๊ก “ผู้เล่นตรวจแล้ว” จากนั้น marker ติ๊กยืนยันอีกคน ครบสองคนสกอร์จะนำไปจัดอันดับ</li>
            </ol>

            {rows.map((row, r) => (
              <fieldset className="rounded-xl border border-line bg-white p-4 shadow-card" disabled={closed} key={r}>
                <legend className="sr-only">แถวที่ {r + 1}</legend>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs text-ink-subtle">บนการ์ดเขียนว่า</p>
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                      {row.name || "(อ่านชื่อไม่ได้)"}
                      {row.name ? (
                        <StatusBadge tone={row.nameConfidence === "high" ? "success" : "warning"}>
                          {confidenceLabel[row.nameConfidence]}
                        </StatusBadge>
                      ) : null}
                    </p>
                  </div>
                  <label className="block sm:w-72">
                    <span className={fieldLabel}>ผู้เล่น</span>
                    <select className={fieldInputClass("sm")} defaultValue={row.match?.id ?? ""} name={`player${r}`}>
                      <option value="">ข้ามแถวนี้</option>
                      {data.players.map((player) => (
                        <option key={player.registrationId} value={player.registrationId}>
                          {player.name}{player.nickname ? ` (${player.nickname})` : ""}{player.groupNo ? ` · ก๊วน ${player.groupNo}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {row.match?.id && row.match.score < 0.8 ? (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-warning">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> จับคู่จากชื่อที่ใกล้เคียง ตรวจว่าเป็นคนเดียวกัน
                  </p>
                ) : null}

                <OcrRowEditor
                  cells={Array.from({ length: HOLES }, (_, i) => ({
                    flags: row.cells[i]?.flags ?? [],
                    raw: row.cells[i]?.raw ?? "",
                    value: cellValue(row.cells[i]),
                  }))}
                  disabled={closed}
                  pars={pars}
                  printedTotals={{
                    in: row.printedTotals?.in ?? "",
                    out: row.printedTotals?.out ?? "",
                    total: row.printedTotals?.total ?? "",
                  }}
                  rowIndex={r}
                  showConfirmations={data.confirmationsAvailable}
                />
              </fieldset>
            ))}

            {!closed ? (
              <div className="sticky bottom-3 flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
                <div className="grid gap-2 text-sm text-ink">
                  <label className="inline-flex items-center gap-2">
                    <input name="acceptIssues" type="checkbox" /> บันทึกทั้งที่ยังไม่ผ่านการตรวจ (การ์ดเขียนผิดเอง)
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input name="verifyNow" type="checkbox" /> เจ้าหน้าที่ยืนยันทันที (ไม่ต้องรอผู้เล่นและ marker)
                  </label>
                </div>
                <SubmitButton className={buttonClass("primary", "lg")} pendingText="กำลังบันทึก...">
                  <SaveIcon className="size-4" aria-hidden="true" /> บันทึกผลการ์ดใบนี้
                </SubmitButton>
              </div>
            ) : null}
          </form>
        </div>

        {!closed ? (
          <form action={discardOcrJob} className="mt-4">
            <input name="eventId" type="hidden" value={eventId} />
            <input name="jobId" type="hidden" value={jobId} />
            <ConfirmSubmitButton
              className={buttonDanger}
              confirmLabel="ยกเลิกรายการนี้"
              message="ยกเลิกรายการสแกนนี้? ภาพยังเก็บไว้ในประวัติ"
            >
              <DeleteIcon className="size-4" aria-hidden="true" />
              ยกเลิกรายการนี้
            </ConfirmSubmitButton>
          </form>
        ) : null}
      </section>
    </main>
  );
}
