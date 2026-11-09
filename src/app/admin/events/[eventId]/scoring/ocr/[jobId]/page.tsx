import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, ExternalLink } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { StatusBanner } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { resolveAccess } from "@/lib/auth/access";
import { getStaffClub } from "@/lib/auth/staff";
import { formatBangkokDateTime } from "@/lib/lessons/booking";
import type { InterpretedCell } from "@/lib/ocr/notation";
import { loadScoringData, scoringRoles } from "@/lib/scoring/data";
import { HOLES, defaultRules } from "@/lib/scoring/engine";
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
};

const statusMessages: Record<string, string> = {
  "duplicate-player": "เลือกผู้เล่นซ้ำกันในการ์ดใบนี้",
  "entry-failed": "บันทึกไม่สำเร็จ",
  "invalid-strokes": "คะแนนต้องเป็น 1-20 หรือ X",
  "job-closed": "รายการนี้บันทึกหรือยกเลิกไปแล้ว",
  "missing-player": "ไม่พบผู้เล่นที่เลือก",
  "no-rows": "เลือกผู้เล่นอย่างน้อย 1 แถว",
};

const errorLabels: Record<string, string> = {
  OCR_NOT_CONFIGURED: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY จึงไม่ได้อ่านอัตโนมัติ กรอกคะแนนเทียบกับภาพได้เลย",
  OCR_REFUSED: "ระบบอ่านปฏิเสธภาพนี้ กรอกคะแนนเทียบกับภาพได้เลย",
  OCR_UNREADABLE: "อ่านการ์ดไม่สำเร็จ (ภาพไม่ชัดหรือไม่ใช่การ์ดคะแนน) กรอกคะแนนเทียบกับภาพได้เลย",
};

const confidenceLabel = { high: "ชัดเจน", low: "ไม่ชัด", medium: "ควรตรวจ" } as const;

function cellValue(cell: InterpretedCell | undefined) {
  if (!cell) return "";
  if (cell.pickup) return "X";
  return cell.strokes === null ? "" : String(cell.strokes);
}

export default async function OcrReviewPage({ params, searchParams }: PageProps) {
  const [{ eventId, jobId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: `/admin/events/${eventId}/scoring/ocr/${jobId}`, requiredRole: "admin", searchParams: query });
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

  return (
    <main className="min-h-screen px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-[1600px]">
        <Link className="inline-flex items-center gap-1 text-sm font-semibold text-[#8b5b7a] hover:text-[#722257]" href={`/admin/events/${eventId}/scoring#ocr`}>
          <ArrowLeft className="size-4" aria-hidden="true" /> กลับหน้าคะแนน
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[#722257]">ตรวจและแก้ไขผลสแกนการ์ด</h1>
        <p className="mt-1 text-sm text-[#6b6475]">
          อัปโหลด {formatBangkokDateTime(job.created_at)}
          {job.notation ? ` · การ์ดเขียนแบบ${job.notation === "relative" ? "เทียบพาร์ (+1, E, -1)" : "นับสโตรก"}` : ""}
          {job.model ? ` · อ่านโดย ${job.model}` : ""}
          {job.confirmed_at ? ` · บันทึกแล้ว ${formatBangkokDateTime(job.confirmed_at)}` : ""}
        </p>

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
            พาร์ที่พิมพ์บนการ์ดไม่ตรงกับกติกาการแข่งขัน ตรวจว่าใช้การ์ดของสนามนี้ ระบบแปลงคะแนนตามพาร์ในกติกา
          </StatusBanner>
        ) : null}
        {extracted?.notes ? (
          <StatusBanner className="mt-4" tone="info">หมายเหตุจากการอ่าน: {extracted.notes}</StatusBanner>
        ) : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="xl:sticky xl:top-20 xl:self-start">
            {photoUrl ? (
              <a className="group block overflow-hidden rounded-lg border border-[#e6e2ee] bg-white" href={photoUrl} rel="noopener noreferrer" target="_blank">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage */}
                <img alt="ภาพการ์ดคะแนน" className="w-full" src={photoUrl} />
                <span className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-[#722257]">
                  <ExternalLink className="size-3.5" aria-hidden="true" /> เปิดภาพขนาดเต็ม
                </span>
              </a>
            ) : (
              <p className="rounded-lg border border-dashed border-[#d9d3e6] p-8 text-center text-sm text-[#6b6475]">ไม่พบภาพ</p>
            )}
          </div>

          <form action={confirmOcrJob} className="grid content-start gap-4">
            <input name="eventId" type="hidden" value={eventId} />
            <input name="jobId" type="hidden" value={jobId} />
            <input name="rowCount" type="hidden" value={rows.length} />

            <div className="flex flex-wrap gap-3 text-xs text-[#6b6475]">
              <span className="inline-flex items-center gap-1"><i className="inline-block size-3 rounded border border-[#e0a100] bg-[#fff5d8]" /> ควรตรวจ ({flaggedCells} ช่อง)</span>
              <span>ตัวเล็กใต้ช่อง = สิ่งที่เขียนบนการ์ด</span>
              <span>X = เก็บลูก/ไม่จบหลุม · เว้นว่าง = ไม่ได้กรอก</span>
            </div>

            {rows.map((row, r) => (
              <fieldset className="rounded-lg border border-[#e6e2ee] bg-white p-4" disabled={closed} key={r}>
                <legend className="sr-only">แถวที่ {r + 1}</legend>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs text-[#6b6475]">บนการ์ดเขียนว่า</p>
                    <p className="font-semibold text-[#3f3a48]">
                      {row.name || "(ไม่ได้อ่านชื่อ)"}
                      {row.name ? (
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${row.nameConfidence === "high" ? "bg-[#edf9f3] text-[#16794b]" : "bg-[#fff5d8] text-[#805300]"}`}>
                          {confidenceLabel[row.nameConfidence]}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <label className="text-sm">
                    <span className="mr-2 font-semibold">ผู้เล่น</span>
                    <select className="h-10 min-w-56 rounded-md border border-[#d9d3e6] bg-white px-2 text-sm" defaultValue={row.match?.id ?? ""} name={`player${r}`}>
                      <option value="">— ข้ามแถวนี้ —</option>
                      {data.players.map((player) => (
                        <option key={player.registrationId} value={player.registrationId}>
                          {player.name}{player.nickname ? ` (${player.nickname})` : ""}{player.groupNo ? ` · ก๊วน ${player.groupNo}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {row.match?.id && row.match.score < 0.8 ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-[#805300]">
                    <AlertTriangle className="size-3.5" aria-hidden="true" /> จับคู่ชื่อแบบใกล้เคียง ตรวจว่าเป็นคนเดียวกัน
                  </p>
                ) : null}

                <div className="mt-3 overflow-x-auto">
                  <table className="text-center text-xs">
                    <thead>
                      <tr className="text-[#6b6475]">
                        <th className="pr-2 text-left">หลุม</th>
                        {Array.from({ length: HOLES }, (_, i) => <th className="w-10" key={i}>{i + 1}</th>)}
                      </tr>
                      <tr className="text-[#98a2b3]">
                        <th className="pr-2 text-left font-normal">พาร์</th>
                        {pars.map((par, i) => <th className="font-normal" key={i}>{par}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th className="pr-2 text-left font-semibold">สโตรก</th>
                        {Array.from({ length: HOLES }, (_, i) => {
                          const value = row.cells[i];
                          const flagged = Boolean(value?.flags.length);
                          return (
                            <td className="px-0.5 align-top" key={i}>
                              <input
                                aria-label={`แถว ${r + 1} หลุม ${i + 1}`}
                                className={`h-9 w-10 rounded border text-center text-sm tabular-nums outline-none focus:border-[#722257] ${flagged ? "border-[#e0a100] bg-[#fff5d8]" : "border-[#d9d3e6]"}`}
                                defaultValue={cellValue(value)}
                                inputMode="numeric"
                                name={`r${r}h${i + 1}`}
                                title={value ? `เขียนว่า "${value.raw}"${value.flags.length ? ` · ${value.flags.join(", ")}` : ""}` : undefined}
                              />
                              <span className="mt-0.5 block h-4 truncate text-[10px] text-[#98a2b3]">{value?.raw ?? ""}</span>
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </fieldset>
            ))}

            {!closed ? (
              <div className="sticky bottom-3 flex flex-col gap-3 rounded-lg border border-[#e6e2ee] bg-white/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input name="verifyNow" type="checkbox" /> ยืนยันคะแนนทันที (ตรวจกับภาพครบแล้ว)
                </label>
                <SubmitButton className="flex h-11 items-center gap-2 rounded-md bg-[#722257] px-5 text-sm font-semibold text-white" pendingText="กำลังบันทึก...">
                  <Check className="size-4" aria-hidden="true" /> บันทึกผลการ์ดใบนี้
                </SubmitButton>
              </div>
            ) : null}
          </form>
        </div>

        {!closed ? (
          <form action={discardOcrJob} className="mt-4">
            <input name="eventId" type="hidden" value={eventId} />
            <input name="jobId" type="hidden" value={jobId} />
            <ConfirmSubmitButton className="text-sm font-semibold text-[#9f1d1d]" message="ยกเลิกรายการสแกนนี้? ภาพยังเก็บไว้ในประวัติ">
              ยกเลิกรายการนี้
            </ConfirmSubmitButton>
          </form>
        ) : null}
      </section>
    </main>
  );
}
