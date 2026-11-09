import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, ClipboardList, Medal, Settings2, Trophy } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { resolveAccess } from "@/lib/auth/access";
import { getStaffClub } from "@/lib/auth/staff";
import { formatBangkokDateTime } from "@/lib/lessons/booking";
import { isOcrConfigured } from "@/lib/ocr/claude";
import { loadScoringData, scoringRoles, verifiedPlayerInputs } from "@/lib/scoring/data";
import { HOLES, computeLeaderboard, defaultRules, formatLabels } from "@/lib/scoring/engine";
import { createAdminClient } from "@/lib/supabase/admin";

import { awardPrizes, publishLeaderboard, saveCompetitionRules, saveScoreEntry, uploadScorecard, verifyScoreEntry } from "./actions";

// Reading a scorecard photo with Claude can take a while; give server actions room.
export const maxDuration = 120;

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

const statusMessages: Record<string, string> = {
  "awards-failed": "บันทึกรางวัลไม่สำเร็จ",
  "awards-saved": "มอบรางวัลให้ผู้ชนะแล้ว สมาชิกเห็นในหน้ารางวัลของตน",
  "empty-card": "ยังไม่ได้กรอกคะแนน",
  "entry-failed": "บันทึกคะแนนไม่สำเร็จ",
  "entry-saved": "บันทึกคะแนนแล้ว (รอยืนยัน)",
  "entry-verified": "บันทึกและยืนยันคะแนนแล้ว",
  "invalid-flights": "รูปแบบไฟลท์ไม่ถูกต้อง ใช้บรรทัดละ ชื่อ: ต่ำสุด-สูงสุด เช่น A: 0-12",
  "invalid-rules": "กติกาไม่ถูกต้อง ตรวจพาร์ (3-6), Stroke index (1-18 ไม่ซ้ำ) และไฟลท์",
  "invalid-strokes": "คะแนนต้องเป็นตัวเลข 1-20 หรือ X (เก็บลูก)",
  "missing-entry": "ไม่พบรายการคะแนน",
  "missing-player": "ไม่พบผู้เล่นในกิจกรรมนี้",
  "no-competition": "ตั้งค่าการแข่งขันก่อน",
  "nothing-verified": "ยังไม่มีคะแนนที่ยืนยันแล้ว",
  "ocr-confirmed": "บันทึกผลจากการ์ดแล้ว (รอยืนยัน)",
  "ocr-confirmed-verified": "บันทึกและยืนยันผลจากการ์ดแล้ว",
  "ocr-discarded": "ยกเลิกรายการสแกนแล้ว ภาพยังเก็บไว้ในประวัติ",
  "photo-invalid": "รองรับเฉพาะ JPG, PNG หรือ WebP",
  "photo-missing": "เลือกภาพการ์ดคะแนน",
  "photo-too-large": "ภาพใหญ่เกิน 10 MB",
  "photo-upload-failed": "อัปโหลดภาพไม่สำเร็จ",
  "publish-failed": "ประกาศผลไม่สำเร็จ",
  "publish-first": "ประกาศผลก่อนมอบรางวัล",
  published: "ประกาศผลแล้ว สมาชิกเห็นคะแนนและอันดับของตน",
  "rules-failed": "บันทึกกติกาไม่สำเร็จ",
  "rules-saved": "บันทึกกติกาแล้ว (เก็บประวัติทุกเวอร์ชัน)",
  "verify-failed": "ยืนยันคะแนนไม่สำเร็จ",
};

const ocrStatusLabels: Record<string, string> = {
  confirmed: "บันทึกแล้ว",
  discarded: "ยกเลิก",
  failed: "อ่านไม่สำเร็จ",
  needs_review: "รอตรวจ",
  processing: "กำลังอ่าน",
};

const cardClass = "rounded-lg border border-[#e6e2ee] bg-white p-5 shadow-[0_12px_30px_rgba(114,34,87,0.06)]";
const inputClass = "h-10 w-full rounded-md border border-[#d9d3e6] bg-white px-3 text-sm outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10";
const primary = "flex h-10 items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white hover:bg-[#8b2d6b] disabled:bg-[#9a94a6]";
const cell = "h-8 w-9 rounded border border-[#d9d3e6] text-center text-sm tabular-nums outline-none focus:border-[#722257]";

export default async function ScoringPage({ params, searchParams }: PageProps) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: `/admin/events/${eventId}/scoring`, requiredRole: "admin", searchParams: query });

  if (access.isBypass || !access.clubId) {
    return (
      <main className="px-4 py-6">
        <StatusBanner className="mx-auto max-w-3xl" tone="warning">ระบบคะแนนต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลจริง</StatusBanner>
      </main>
    );
  }

  const staff = await getStaffClub(scoringRoles);
  if (staff.status !== "ok") {
    return (
      <main className="px-4 py-6">
        <StatusBanner className="mx-auto max-w-3xl" tone="error">เฉพาะกรรมการ ผู้อำนวยการการแข่งขัน หรือเจ้าหน้าที่คะแนน</StatusBanner>
      </main>
    );
  }

  const data = await loadScoringData(staff.supabase, staff.clubId, eventId);
  if (!data.event) notFound();

  const rules = data.rules ?? defaultRules;
  const competition = data.competition;
  const board = competition && data.rules ? computeLeaderboard(data.rules, verifiedPlayerInputs(data)) : null;
  const verifiedCount = data.verified.size;
  const statusMessage = query.status ? statusMessages[query.status] : null;
  const ocrReady = isOcrConfigured();

  // OCR history with thumbnails (private bucket -> short-lived signed URLs)
  let jobs: { created_at: string; error: string | null; id: string; status: string; thumb: string | null }[] = [];
  if (competition) {
    const { data: jobRows } = await staff.supabase
      .from("scorecard_ocr_jobs")
      .select("id, status, error, created_at, files(object_path)")
      .eq("competition_id", competition.id)
      .order("created_at", { ascending: false })
      .limit(24);
    const rows = (jobRows ?? []) as unknown as { created_at: string; error: string | null; files: { object_path: string } | null; id: string; status: string }[];
    const paths = rows.map((row) => row.files?.object_path).filter((path): path is string => Boolean(path));
    const signed = paths.length ? (await createAdminClient().storage.from("scorecards").createSignedUrls(paths, 600)).data ?? [] : [];
    const urlByPath = new Map(signed.map((item) => [item.path, item.signedUrl]));
    jobs = rows.map((row) => ({ ...row, thumb: row.files ? (urlByPath.get(row.files.object_path) ?? null) : null }));
  }

  return (
    <main className="min-h-screen px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-3 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link className="inline-flex items-center gap-1 text-sm font-semibold text-[#8b5b7a] hover:text-[#722257]" href={`/admin/events/${eventId}`}>
              <ArrowLeft className="size-4" aria-hidden="true" /> ผู้สมัครและจัดก๊วน
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-[#722257] sm:text-3xl">คะแนนการแข่งขัน · {data.event.name}</h1>
            <p className="mt-1 text-sm text-[#6b6475]">
              {competition
                ? `${formatLabels[rules.format]} · แฮนดิแคป ${rules.handicapAllowance}% · กติกาเวอร์ชัน ${competition.rule_version} · ยืนยันแล้ว ${verifiedCount}/${data.players.length} คน`
                : "ยังไม่ได้ตั้งค่าการแข่งขัน"}
              {competition?.published_at ? ` · ประกาศผลล่าสุด ${formatBangkokDateTime(competition.published_at)} (ฉบับที่ ${competition.published_version})` : ""}
            </p>
          </div>
        </div>

        {statusMessage ? (
          <StatusBanner className="mt-5" tone={toneForStatus(query.status)}>{statusMessage}</StatusBanner>
        ) : null}

        {/* ---------- setup ---------- */}
        <details className={`${cardClass} mt-6`} id="setup" open={!competition}>
          <summary className="flex cursor-pointer items-center gap-2 font-semibold text-[#722257]">
            <Settings2 className="size-5" aria-hidden="true" /> ตั้งค่ากติกาการแข่งขัน
          </summary>
          <form action={saveCompetitionRules} className="mt-4 grid gap-4">
            <input name="eventId" type="hidden" value={eventId} />
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="text-sm sm:col-span-2">
                <span className="font-semibold">ชื่อการแข่งขัน</span>
                <input className={`${inputClass} mt-1`} defaultValue={competition?.name ?? data.event.name} name="name" />
              </label>
              <label className="text-sm">
                <span className="font-semibold">รูปแบบ</span>
                <select className={`${inputClass} mt-1`} defaultValue={rules.format} name="format">
                  {Object.entries(formatLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="font-semibold">ใช้แฮนดิแคป (%)</span>
                <input className={`${inputClass} mt-1`} defaultValue={rules.handicapAllowance} max={100} min={0} name="allowance" type="number" />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="text-center text-xs">
                <tbody>
                  <tr>
                    <th className="pr-2 text-left font-semibold">หลุม</th>
                    {Array.from({ length: HOLES }, (_, i) => <td className="w-10 font-semibold" key={i}>{i + 1}</td>)}
                  </tr>
                  <tr>
                    <th className="pr-2 text-left font-semibold">พาร์</th>
                    {rules.pars.map((par, i) => (
                      <td key={i}><input aria-label={`พาร์หลุม ${i + 1}`} className={cell} defaultValue={par} max={6} min={3} name={`par${i + 1}`} type="number" /></td>
                    ))}
                  </tr>
                  <tr>
                    <th className="pr-2 text-left font-semibold">SI</th>
                    {rules.strokeIndex.map((si, i) => (
                      <td key={i}><input aria-label={`Stroke index หลุม ${i + 1}`} className={cell} defaultValue={si} max={18} min={1} name={`si${i + 1}`} type="number" /></td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="text-sm">
                <span className="font-semibold">ไฟลท์ (บรรทัดละ ชื่อ: แฮนดิแคปต่ำสุด-สูงสุด, เว้นว่าง = ไม่แบ่ง)</span>
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-[#d9d3e6] p-3 text-sm"
                  defaultValue={rules.flights.map((f) => `${f.name}: ${f.minHandicap}-${f.maxHandicap}`).join("\n")}
                  name="flights"
                  placeholder={"A: 0-12\nB: 12.1-20\nC: 20.1-36"}
                />
              </label>
              <div className="grid gap-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input defaultChecked={rules.countback} name="countback" type="checkbox" /> ตัดสินเสมอด้วย Countback
                </label>
                <SubmitButton className={primary}>บันทึกกติกา</SubmitButton>
              </div>
            </div>
            <p className="text-xs text-[#6b6475]">แก้กติกาได้ตลอด ทุกครั้งจะถูกเก็บเป็นเวอร์ชันใหม่ และคะแนนคำนวณใหม่จากการ์ดเดิมโดยไม่แก้ทับข้อมูล</p>
          </form>
        </details>

        {competition ? (
          <>
            {/* ---------- OCR ---------- */}
            <section className={`${cardClass} mt-6`} id="ocr">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-[#722257]">
                <Camera className="size-5" aria-hidden="true" /> สแกนการ์ดคะแนน (Smart Score OCR)
              </h2>
              <p className="mt-1 text-sm text-[#6b6475]">
                ถ่ายภาพการ์ดทั้งใบ ระบบอ่านตัวเลข ตัวอักษร และสัญลักษณ์ (+1, E, /, B, DB, X, วงกลม/สี่เหลี่ยม) แล้วเปิดกระดานให้ตรวจแก้ก่อนบันทึก ภาพทุกใบเก็บเป็นประวัติ
              </p>
              {!ocrReady ? (
                <StatusBanner className="mt-3" tone="warning">
                  ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ระบบจะเก็บภาพและเปิดกระดานให้กรอกคะแนนเทียบกับภาพแทนการอ่านอัตโนมัติ
                </StatusBanner>
              ) : null}
              <form action={uploadScorecard} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input name="eventId" type="hidden" value={eventId} />
                <input accept="image/jpeg,image/png,image/webp" capture="environment" className="text-sm" name="photo" required type="file" />
                <SubmitButton className={primary} pendingText="กำลังอ่านการ์ด... (อาจใช้เวลาสักครู่)">
                  <Camera className="size-4" aria-hidden="true" /> อัปโหลดและอ่าน
                </SubmitButton>
              </form>
              {jobs.length ? (
                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <Link className="block overflow-hidden rounded-md border border-[#e6e2ee] hover:border-[#722257]" href={`/admin/events/${eventId}/scoring/ocr/${job.id}`}>
                        {job.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
                          <img alt="การ์ดคะแนน" className="aspect-[4/3] w-full object-cover" src={job.thumb} />
                        ) : (
                          <div className="aspect-[4/3] bg-[#f8f7fa]" />
                        )}
                        <div className="px-2 py-1.5 text-[11px]">
                          <p className="font-semibold text-[#3f3a48]">{ocrStatusLabels[job.status] ?? job.status}</p>
                          <p className="text-[#98a2b3]">{formatBangkokDateTime(job.created_at)}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {/* ---------- cards ---------- */}
            <section className={`${cardClass} mt-6`} id="cards">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-[#722257]">
                <ClipboardList className="size-5" aria-hidden="true" /> กรอกและยืนยันคะแนน
              </h2>
              <p className="mt-1 text-sm text-[#6b6475]">
                ทุกการบันทึกสร้างการ์ดใหม่ (ไม่แก้ทับ) · พิมพ์ X สำหรับหลุมที่เก็บลูก · เฉพาะการ์ดที่ “ยืนยันแล้ว” เท่านั้นที่นำไปจัดอันดับ
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs text-[#6b6475]">
                      <th className="sticky left-0 bg-white py-2 pr-3 text-left">ผู้เล่น</th>
                      {Array.from({ length: HOLES }, (_, i) => <th className="w-9 text-center" key={i}>{i + 1}</th>)}
                      <th className="px-2 text-center">รวม</th>
                      <th className="px-2 text-left">สถานะ</th>
                    </tr>
                    <tr className="text-[11px] text-[#98a2b3]">
                      <th className="sticky left-0 bg-white pr-3 text-left">พาร์</th>
                      {rules.pars.map((par, i) => <th className="text-center font-normal" key={i}>{par}</th>)}
                      <th className="text-center font-normal">{rules.pars.reduce((a, b) => a + b, 0)}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f3f0f6]">
                    {data.players.map((player) => {
                      const latest = data.latestEntry.get(player.registrationId);
                      const verifiedId = data.verified.get(player.registrationId);
                      const latestVerified = latest && latest.id === verifiedId;
                      const formId = `card-form-${player.registrationId}`;
                      const total = latest?.strokes.every((value) => value !== null)
                        ? latest.strokes.reduce<number>((sum, value) => sum + (value ?? 0), 0)
                        : null;

                      return (
                        <tr id={`card-${player.registrationId}`} key={player.registrationId}>
                          <td className="sticky left-0 bg-white py-2 pr-3">
                            <p className="font-semibold text-[#3f3a48]">{player.name}{player.nickname ? ` (${player.nickname})` : ""}</p>
                            <p className="text-[11px] text-[#98a2b3]">
                              {player.groupNo ? `ก๊วน ${player.groupNo} · ` : ""}HC {player.handicap ?? "-"}
                              {data.entryCount(player.registrationId) > 1 ? ` · ${data.entryCount(player.registrationId)} การ์ด` : ""}
                              {latest?.source === "ocr" ? " · จากสแกน" : ""}
                            </p>
                          </td>
                          {Array.from({ length: HOLES }, (_, i) => (
                            <td className="px-0.5" key={i}>
                              <input
                                aria-label={`${player.name} หลุม ${i + 1}`}
                                className={cell}
                                defaultValue={latest ? (latest.strokes[i] ?? (latest.pickups[i] ? "X" : "")) : ""}
                                form={formId}
                                inputMode="numeric"
                                name={`h${i + 1}`}
                              />
                            </td>
                          ))}
                          <td className="px-2 text-center font-semibold tabular-nums">{total ?? "-"}</td>
                          <td className="min-w-56 px-2">
                            <form action={saveScoreEntry} className="flex flex-wrap items-center gap-2" id={formId}>
                              <input name="eventId" type="hidden" value={eventId} />
                              <input name="registrationId" type="hidden" value={player.registrationId} />
                              <label className="inline-flex items-center gap-1 text-xs"><input name="verifyNow" type="checkbox" /> ยืนยันทันที</label>
                              <button className="h-8 rounded-md bg-[#722257] px-3 text-xs font-semibold text-white" type="submit">บันทึก</button>
                            </form>
                            {latestVerified ? (
                              <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#16794b]">
                                <CheckCircle2 className="size-3.5" aria-hidden="true" /> ยืนยันแล้ว
                              </span>
                            ) : latest ? (
                              <form action={verifyScoreEntry} className="mt-1">
                                <input name="eventId" type="hidden" value={eventId} />
                                <input name="entryId" type="hidden" value={latest.id} />
                                <button className="text-xs font-semibold text-[#805300] underline" type="submit">
                                  {verifiedId ? "การ์ดล่าสุดยังไม่ยืนยัน · ยืนยันการ์ดนี้" : "ยืนยันการ์ดนี้"}
                                </button>
                              </form>
                            ) : (
                              <span className="mt-1 block text-xs text-[#98a2b3]">ยังไม่มีคะแนน</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ---------- leaderboard ---------- */}
            <section className={`${cardClass} mt-6`} id="leaderboard">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-[#722257]">
                  <Trophy className="size-5" aria-hidden="true" /> ตารางคะแนน (คำนวณจากการ์ดที่ยืนยันแล้ว)
                </h2>
                <div className="flex flex-wrap gap-2">
                  <form action={publishLeaderboard}>
                    <input name="eventId" type="hidden" value={eventId} />
                    <ConfirmSubmitButton className={primary} message="ประกาศผลให้สมาชิกเห็น? ระบบจะเก็บผลฉบับนี้ไว้เป็นประวัติ">
                      ประกาศผล
                    </ConfirmSubmitButton>
                  </form>
                  <form action={awardPrizes} className="flex items-center gap-2">
                    <input name="eventId" type="hidden" value={eventId} />
                    <label className="text-xs">อันดับ 1-<input className="ml-1 h-8 w-12 rounded border border-[#d9d3e6] text-center" defaultValue={3} max={10} min={1} name="topN" type="number" /></label>
                    <button className="flex h-10 items-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-3 text-sm font-semibold text-[#722257]" type="submit">
                      <Medal className="size-4" aria-hidden="true" /> มอบรางวัล
                    </button>
                  </form>
                </div>
              </div>
              {board && board.overall.length ? (
                <div className="mt-4 grid gap-6">
                  {[{ name: "รวมทุกไฟลท์", players: board.overall, useFlightRank: false }, ...board.flights.map((f) => ({ ...f, useFlightRank: true }))].map((table) => (
                    <div className="overflow-x-auto" key={table.name}>
                      <h3 className="mb-2 font-semibold text-[#3f3a48]">{table.name}</h3>
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-[#6b6475]">
                            <th className="py-1 pr-3">อันดับ</th><th className="pr-3">ผู้เล่น</th><th className="pr-3">HC</th>
                            <th className="pr-3">Gross</th>
                            {rules.format === "stableford" || rules.format === "system36" ? <th className="pr-3">แต้ม</th> : null}
                            {rules.format === "system36" ? <th className="pr-3">HC S36</th> : null}
                            {rules.format === "stroke_net" || rules.format === "system36" ? <th className="pr-3">Net</th> : null}
                            <th className="pr-3">หมายเหตุ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f3f0f6]">
                          {table.players.map((row) => {
                            const rank = table.useFlightRank ? row.flightRank : row.rank;
                            return (
                              <tr key={row.id}>
                                <td className="py-1.5 pr-3 font-semibold text-[#722257]">{rank ?? "-"}</td>
                                <td className="pr-3">{row.name}</td>
                                <td className="pr-3 tabular-nums">{row.handicapIndex ?? "-"}{row.playingHandicap !== (row.handicapIndex ?? 0) ? ` (${row.playingHandicap})` : ""}</td>
                                <td className="pr-3 tabular-nums">{row.gross ?? "-"}</td>
                                {rules.format === "stableford" || rules.format === "system36" ? <td className="pr-3 tabular-nums">{row.points ?? "-"}</td> : null}
                                {rules.format === "system36" ? <td className="pr-3 tabular-nums">{row.s36Handicap ?? "-"}</td> : null}
                                {rules.format === "stroke_net" || rules.format === "system36" ? <td className="pr-3 tabular-nums">{row.net ?? "-"}</td> : null}
                                <td className="pr-3 text-xs text-[#6b6475]">
                                  {!row.complete ? `ไม่ครบ (${row.holesPlayed}/18)` : row.tieBreak ? `ชนะ Countback ${row.tieBreak}` : ""}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-[#6b6475]">ยังไม่มีการ์ดที่ยืนยันแล้ว</p>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
