import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown, ExternalLink, ListOrdered } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { HoleGrid } from "@/components/events-hole-grid";
import { ScoreKeypad } from "@/components/events-score-keypad";
import { ImageCaptureInput } from "@/components/image-capture-input";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buttonClass,
  buttonPrimary,
  buttonSecondary,
  card,
  fieldHint,
  fieldInput,
  fieldInputClass,
  fieldLabel,
  fieldTextarea,
} from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { getStaffClub } from "@/lib/auth/staff";
import { formatThaiDateShort, formatThaiDateTime } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { isOcrConfigured } from "@/lib/ocr/claude";
import { teeDescription } from "@/lib/scoring/courses";
import { type ScoringPlayer, loadScoringData, scoringRoles, verifiedPlayerInputs } from "@/lib/scoring/data";
import {
  HOLES,
  computeLeaderboard,
  defaultRules,
  formatLabels,
  handicapSourceLabels,
  handicapSources,
  selectableFormats,
  usesDoublePeoria,
  usesSystem36,
} from "@/lib/scoring/engine";
import { formatHandicap } from "@/lib/scoring/handicap";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbFailureMessages } from "@/lib/supabase/errors";

import {
  confirmEntryAsStaff,
  publishLeaderboard,
  saveCompetitionRules,
  saveScoreEntry,
  setOfficialHandicap,
  uploadScorecard,
  verifyScoreEntry,
} from "./actions";

// Reading a scorecard photo with Claude can take a while; give server actions room.
export const maxDuration = 120;

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "awards-failed": "บันทึกรางวัลไม่สำเร็จ",
  "awards-saved": "มอบรางวัลให้ผู้ชนะแล้ว สมาชิกเห็นในหน้ารางวัลของตน",
  "competition-locked": "การแข่งขันนี้ปิดแล้ว ยืนยันการ์ดเพิ่มไม่ได้",
  "confirm-failed": "บันทึกการยืนยันไม่สำเร็จ",
  "empty-card": "ยังไม่ได้กรอกสกอร์",
  "entry-failed": "บันทึกสกอร์ไม่สำเร็จ",
  "entry-saved": "บันทึกสกอร์แล้ว (รอยืนยัน)",
  "entry-superseded": "มีการ์ดใหม่กว่าของผู้เล่นคนนี้แล้ว ยืนยันการ์ดล่าสุดแทน",
  "entry-verified": "ยืนยันสกอร์แล้ว นำไปจัดอันดับแล้ว",
  "invalid-flights": "รูปแบบไฟลท์ไม่ถูกต้อง ใส่บรรทัดละ 1 ไฟลท์ เช่น A: 0-12",
  "invalid-official-index": "Handicap Index ทางการต้องอยู่ระหว่าง +10 ถึง 54",
  "invalid-peoria": "Double Peoria ต้องเลือกหลุมซ่อน 12 หลุม ไม่ซ้ำกัน และแต้มต่อสูงสุด 1-54",
  "invalid-rating": "Course rating ต้องอยู่ระหว่าง 50-90 และ Slope 55-155 ใส่คู่กันหรือเว้นว่างทั้งคู่",
  "invalid-rules": "กติกาไม่ถูกต้อง ตรวจพาร์ (3-6), ลำดับความยาก (SI 1-18 ไม่ซ้ำ) และไฟลท์",
  "invalid-strokes": "สกอร์ต้องเป็นตัวเลข 1-20 หรือ X (เก็บลูก)",
  "marker-confirmed": "บันทึกว่า marker ยืนยันแล้ว",
  "missing-entry": "ไม่พบรายการสกอร์",
  "missing-player": "ไม่พบผู้เล่นในกิจกรรมนี้",
  "no-competition": "ตั้งค่ากติกาการแข่งขันก่อน",
  "nothing-verified": "ยังไม่มีสกอร์ที่ยืนยันแล้ว",
  "ocr-confirm-partial": "บันทึกผลจากสกอร์การ์ดแล้ว แต่บันทึกการยืนยันบางแถวไม่สำเร็จ ยืนยันในตารางด้านล่าง",
  "ocr-confirmed": "บันทึกผลจากสกอร์การ์ดแล้ว",
  "ocr-confirmed-verified": "บันทึกและยืนยันผลจากสกอร์การ์ดแล้ว",
  "ocr-discarded": "ยกเลิกรายการสแกนแล้ว ภาพยังเก็บไว้ในประวัติ",
  "official-index-failed": "บันทึก Handicap Index ทางการไม่สำเร็จ",
  "official-index-saved": "บันทึก Handicap Index ทางการแล้ว",
  "photo-invalid": "รองรับเฉพาะ JPG, PNG หรือ WebP",
  "photo-missing": "เลือกภาพสกอร์การ์ดก่อน",
  "photo-too-large": "ภาพใหญ่เกิน 10 MB",
  "photo-upload-failed": "อัปโหลดภาพไม่สำเร็จ",
  "player-confirmed": "บันทึกว่าผู้เล่นยืนยันแล้ว ต่อไปให้ marker ยืนยัน",
  "player-first": "ให้ผู้เล่นยืนยันก่อน แล้ว marker จึงยืนยัน",
  "publish-failed": "ประกาศผลไม่สำเร็จ",
  "publish-first": "ประกาศผลก่อนมอบรางวัล",
  published: "ประกาศผลแล้ว สมาชิกเห็นสกอร์และอันดับของตน",
  "rules-failed": "บันทึกกติกาไม่สำเร็จ",
  "rules-saved": "บันทึกกติกาแล้ว (เก็บไว้ทุกฉบับ)",
  "tee-missing": "ไม่พบทีที่เลือก เลือกใหม่หรือกรอกพาร์เอง",
  "verify-failed": "ยืนยันสกอร์ไม่สำเร็จ",
};

const ocrStatusLabels: Record<string, string> = {
  confirmed: "บันทึกแล้ว",
  discarded: "ยกเลิก",
  failed: "อ่านไม่สำเร็จ",
  needs_review: "รอตรวจ",
  processing: "กำลังอ่าน",
};

type TeeOption = {
  course_rating: number | null;
  golf_courses: { archived_at: string | null; name: string } | null;
  id: string;
  name: string;
  par: number[];
  slope_rating: number | null;
};

/** Tiny 18-hole grid cells: `input-compact` opts out of the global 16px input size. */
const cell =
  "input-compact h-8 w-9 rounded border border-line bg-white text-center text-sm tabular-nums text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15";

function displayName(player: ScoringPlayer) {
  return player.nickname ? `${player.name} (${player.nickname})` : player.name;
}

/** "แต้มต่อชมรม 14.2 · 8 รอบ" / "ตั้งต้น 18.0" */
function clubHandicapText(player: ScoringPlayer) {
  if (player.clubHandicap !== null) return `${formatHandicap(player.clubHandicap)} · ${player.clubRounds} รอบ`;
  if (player.handicap !== null) return `ตั้งต้น ${formatHandicap(player.handicap)}${player.clubRounds ? ` · ${player.clubRounds} รอบ` : ""}`;
  return player.clubRounds ? `ยังไม่มี · ${player.clubRounds} รอบ` : "ยังไม่มี";
}

function cardValues(entry: { pickups: boolean[]; strokes: (number | null)[] } | undefined) {
  return Array.from({ length: HOLES }, (_, i) => (entry ? String(entry.strokes[i] ?? (entry.pickups[i] ? "X" : "")) : ""));
}

export default async function ScoringPage({ params, searchParams }: PageProps) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: `/admin/events/${eventId}/scoring`, requiredRole: "admin", searchParams: query });
  await requireAdminArea("events", access);

  if (access.isBypass || !access.clubId) {
    return (
      <main className="px-4 py-6 sm:px-6">
        <StatusBanner className="mx-auto max-w-3xl" tone="warning">หน้าสกอร์ต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลจริง</StatusBanner>
      </main>
    );
  }

  const staff = await getStaffClub(scoringRoles);
  if (staff.status !== "ok") {
    return (
      <main className="px-4 py-6 sm:px-6">
        <StatusBanner className="mx-auto max-w-3xl" tone="error">หน้านี้เฉพาะกรรมการ ผู้อำนวยการการแข่งขัน หรือทีมงานกิจกรรม</StatusBanner>
      </main>
    );
  }

  const [data, teeResult] = await Promise.all([
    loadScoringData(staff.supabase, staff.clubId, eventId),
    staff.supabase
      .from("golf_course_tees")
      .select("id, name, course_rating, slope_rating, par, golf_courses(name, archived_at)")
      .eq("club_id", staff.clubId)
      .is("archived_at", null)
      .limit(300),
  ]);
  if (!data.event) notFound();

  const teeOptions = ((teeResult.data ?? []) as unknown as TeeOption[])
    .filter((tee) => tee.golf_courses && !tee.golf_courses.archived_at)
    .sort((a, b) => (a.golf_courses?.name ?? "").localeCompare(b.golf_courses?.name ?? "", "th") || a.name.localeCompare(b.name, "th"));
  const rules = data.rules ?? defaultRules;
  const competition = data.competition;
  const board = competition && data.rules ? computeLeaderboard(data.rules, verifiedPlayerInputs(data)) : null;
  const verifiedCount = data.verified.size;
  const statusMessage = query.status ? statusMessages[query.status] : null;
  const ocrReady = isOcrConfigured();
  const selectedTee = rules.courseTeeId ?? (competition ? null : (data.event.course_tee_id ?? null));
  const liveBoard = competition && ["scoring", "published"].includes(competition.status);

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

  const ScoresIcon = appIcons.scores;
  const UploadIcon = appIcons.upload;
  const SaveIcon = appIcons.save;
  const AwardsIcon = appIcons.awards;
  const MembersIcon = appIcons.members;
  const system36 = usesSystem36(rules);
  const peoria = usesDoublePeoria(rules);
  const showPoints = rules.format === "stableford" || system36;
  const showCardHandicap = system36 || peoria;
  const showNet = rules.format === "stroke_net" || system36 || peoria;
  const pointsLabel = system36 ? "แต้ม S36" : "สเตเบิลฟอร์ด";

  const description = competition
    ? [
        formatLabels[rules.format],
        handicapSourceLabels[rules.handicapSource],
        rules.teeName ? `${rules.courseName ?? ""} ${rules.teeName}`.trim() : null,
        !showCardHandicap && rules.handicapSource !== "none" ? `ใช้แต้มต่อ ${rules.handicapAllowance}%` : null,
        `กติกาฉบับที่ ${competition.rule_version}`,
        `ยืนยันแล้ว ${verifiedCount}/${data.players.length} คน`,
        competition.published_at
          ? `ประกาศผลล่าสุด ${formatThaiDateTime(competition.published_at)} (ฉบับที่ ${competition.published_version})`
          : "ยังไม่ประกาศผล",
      ]
        .filter(Boolean)
        .join(" · ")
    : "ยังไม่ได้ตั้งกติกาการแข่งขัน เริ่มจากกรอกกติกาด้านล่าง";

  const confirmationState = (entryId: string | undefined) => (entryId ? data.confirmations.get(entryId) : undefined) ?? { marker: false, player: false };

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <section className="mx-auto w-full max-w-7xl">
        <Link
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-brand-600"
          href={`/admin/events/${eventId}`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {data.event.name} · {formatThaiDateShort(data.event.event_date)}
        </Link>
        <div className="mt-2">
          <PageHeader
            actions={
              liveBoard ? (
                <Link className={buttonSecondary} href={`/events/${eventId}/leaderboard`} target="_blank">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  ตารางคะแนนสด
                </Link>
              ) : null
            }
            description={description}
            title="สกอร์การแข่งขัน"
          />
        </div>

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={toneForStatus(query.status)}>{statusMessage}</StatusBanner>
        ) : null}
        {data.schemaOutdated ? (
          <StatusBanner className="mt-5" title="ฐานข้อมูลยังไม่ได้อัปเดต" tone="warning">
            สนาม แต้มต่อชมรม และการยืนยันของผู้เล่น/marker ยังใช้ไม่ได้จนกว่าจะอัปเดตฐานข้อมูล (migration ค้างอยู่) กรอกและยืนยันสกอร์แบบเดิมได้ตามปกติ
          </StatusBanner>
        ) : null}

        {/* ---------- setup ---------- */}
        <details className={`${card} group/setup mt-6 scroll-mt-20`} id="setup" open={!competition}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="text-h2 font-semibold text-ink">กติกาการแข่งขัน</span>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-600">
              {competition ? "แก้ไข" : "ตั้งค่า"}
              <ChevronDown className="size-4 transition group-open/setup:rotate-180" aria-hidden="true" />
            </span>
          </summary>
          <form action={saveCompetitionRules} className="mt-4 grid gap-4">
            <input name="eventId" type="hidden" value={eventId} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block sm:col-span-2">
                <span className={fieldLabel}>ชื่อการแข่งขัน</span>
                <input className={fieldInput} defaultValue={competition?.name ?? data.event.name} name="name" />
              </label>
              <label className="block">
                <span className={fieldLabel}>รูปแบบการนับ</span>
                <select className={fieldInput} defaultValue={rules.format === "system36" ? "stroke_net" : rules.format} name="format">
                  {selectableFormats.map((value) => <option key={value} value={value}>{formatLabels[value]}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>แต้มต่อที่ใช้</span>
                <select className={fieldInput} defaultValue={rules.handicapSource} name="handicapSource">
                  {handicapSources.map((value) => <option key={value} value={value}>{handicapSourceLabels[value]}</option>)}
                </select>
              </label>
            </div>
            <p className={`${fieldHint} -mt-2`}>
              System 36 และ Double Peoria คิดแต้มต่อจากสกอร์วันแข่ง และนับแบบสกอร์สุทธิ (Net) เสมอ · แต้มต่อชมรมใช้ค่าที่ชมรมตั้งไว้จนกว่าผู้เล่นมีรอบที่นับได้ครบ 3 รอบ
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block sm:col-span-2">
                <span className={fieldLabel}>สนามและที</span>
                <select className={fieldInput} defaultValue={selectedTee ?? ""} name="courseTeeId">
                  <option value="">กรอกพาร์และ SI เอง</option>
                  {teeOptions.map((tee) => (
                    <option key={tee.id} value={tee.id}>
                      {tee.golf_courses?.name} · {teeDescription(tee)}
                    </option>
                  ))}
                </select>
                <span className={fieldHint}>
                  เลือกทีแล้วใช้พาร์ SI Course rating และ Slope ของทีนั้น ·{" "}
                  <Link className="font-medium text-brand-600 hover:underline" href="/admin/events/courses">
                    จัดการสนาม
                  </Link>
                </span>
              </label>
              <label className="block">
                <span className={fieldLabel}>ใช้แต้มต่อ (%)</span>
                <input className={`${fieldInput} tabular-nums`} defaultValue={rules.handicapAllowance} inputMode="numeric" max={100} min={0} name="allowance" type="number" />
              </label>
              <label className="inline-flex items-center gap-2 self-end pb-3 text-sm text-ink">
                <input defaultChecked={rules.countback} name="countback" type="checkbox" /> ตัดสินเสมอด้วย Countback
              </label>
            </div>

            <details className="group/manual rounded-lg border border-line" open={!selectedTee}>
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-brand-600">
                พาร์ ลำดับความยาก (SI) และ rating กรอกเอง
                <ChevronDown className="ml-auto size-4 transition group-open/manual:rotate-180" aria-hidden="true" />
              </summary>
              <div className="grid gap-4 border-t border-line p-4">
                <p className="text-sm text-ink-muted">ใช้เมื่อไม่ได้เลือกทีด้านบน ถ้าเลือกทีไว้ ค่าที่กรอกที่นี่จะไม่ถูกใช้</p>
                <HoleGrid idPrefix="rules" pars={rules.pars} strokeIndex={rules.strokeIndex} />
                <div className="grid max-w-md grid-cols-2 gap-3">
                  <label className="block">
                    <span className={fieldLabel}>Course rating</span>
                    <input className={`${fieldInput} tabular-nums`} defaultValue={rules.courseTeeId ? "" : (rules.courseRating ?? "")} inputMode="decimal" name="courseRating" step="0.1" type="number" />
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Slope rating</span>
                    <input className={`${fieldInput} tabular-nums`} defaultValue={rules.courseTeeId ? "" : (rules.slopeRating ?? "")} inputMode="numeric" name="slopeRating" type="number" />
                  </label>
                  <span className={`${fieldHint} col-span-2`}>ไม่มี rating = รอบนี้ไม่นับแต้มต่อชมรม</span>
                </div>
              </div>
            </details>

            <details className="group/peoria rounded-lg border border-line" open={peoria}>
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-brand-600">
                Double Peoria: หลุมซ่อน
                <ChevronDown className="ml-auto size-4 transition group-open/peoria:rotate-180" aria-hidden="true" />
              </summary>
              <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <label className="block">
                  <span className={fieldLabel}>หลุมซ่อน 12 หลุม</span>
                  <input className={`${fieldInput} tabular-nums`} defaultValue={rules.peoriaHoles.join(", ")} name="peoriaHoles" />
                  <span className={fieldHint}>คั่นด้วยจุลภาค · แต้มต่อ = (สกอร์ 12 หลุม × 1.5 − พาร์สนาม) × 0.8 · หลุมละไม่เกิน 2 เท่าพาร์ · ผู้เล่นไม่เห็นหลุมซ่อน</span>
                </label>
                <label className="block">
                  <span className={fieldLabel}>แต้มต่อสูงสุด</span>
                  <input className={`${fieldInput} tabular-nums`} defaultValue={rules.peoriaMaxHandicap} inputMode="numeric" max={54} min={1} name="peoriaMax" type="number" />
                </label>
              </div>
            </details>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="block">
                <span className={fieldLabel}>ไฟลท์</span>
                <textarea
                  className={fieldTextarea}
                  defaultValue={rules.flights.map((f) => `${f.name}: ${f.minHandicap}-${f.maxHandicap}`).join("\n")}
                  name="flights"
                  placeholder={"A: 0-12\nB: 12.1-20\nC: 20.1-36"}
                  rows={3}
                />
                <span className={fieldHint}>บรรทัดละ 1 ไฟลท์: ชื่อ: แต้มต่อต่ำสุด-สูงสุด · เว้นว่าง = ไม่แบ่งไฟลท์</span>
              </label>
              <SubmitButton className={buttonPrimary}>
                <SaveIcon className="size-4" aria-hidden="true" />
                บันทึกกติกา
              </SubmitButton>
            </div>
            <p className="text-sm text-ink-subtle">แก้กติกาได้ตลอด ทุกครั้งเก็บเป็นฉบับใหม่ และคิดสกอร์ใหม่จากการ์ดเดิม</p>
          </form>
        </details>

        {competition ? (
          <>
            {/* ---------- handicaps ---------- */}
            <details className={`${card} group/hc mt-6 scroll-mt-20`} id="handicaps" open={query.status?.includes("official-index")}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-h2 font-semibold text-ink">
                  <MembersIcon className="size-5 text-ink-subtle" aria-hidden="true" /> แต้มต่อผู้เล่น
                </span>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-600">
                  ดู <span className="tabular-nums">{data.players.length}</span> คน
                  <ChevronDown className="size-4 transition group-open/hc:rotate-180" aria-hidden="true" />
                </span>
              </summary>
              <p className="mt-2 text-sm text-ink-muted">
                แต้มต่อชมรม = เฉลี่ย 8 รอบที่ดีที่สุดจาก 20 รอบล่าสุดก่อนวันแข่ง (นับเฉพาะรอบที่มี Course rating และ Slope) ·
                รายการนี้ใช้ <span className="font-semibold text-ink">{handicapSourceLabels[rules.handicapSource]}</span>
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-subtle">
                      <th className="py-2 pr-3 font-medium" scope="col">ผู้เล่น</th>
                      <th className="py-2 pr-3 font-medium" scope="col">แต้มต่อชมรม</th>
                      <th className="py-2 pr-3 font-medium" scope="col">Handicap Index ทางการ</th>
                      <th className="py-2 pr-3 text-right font-medium" scope="col">ใช้ในรายการนี้</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.players.map((player) => (
                      <tr key={player.registrationId}>
                        <td className="py-2 pr-3 font-semibold text-ink">{displayName(player)}</td>
                        <td className="py-2 pr-3 tabular-nums text-ink-muted">{player.memberId ? clubHandicapText(player) : "แขก"}</td>
                        <td className="py-2 pr-3">
                          {player.memberId ? (
                            <form action={setOfficialHandicap} className="flex items-center gap-2">
                              <input name="eventId" type="hidden" value={eventId} />
                              <input name="memberId" type="hidden" value={player.memberId} />
                              <label className="sr-only" htmlFor={`hi-${player.registrationId}`}>Handicap Index ทางการของ {player.name}</label>
                              <input
                                className={`${fieldInputClass("sm", { margin: false })} w-24 tabular-nums`}
                                defaultValue={player.officialHandicap === null ? "" : formatHandicap(player.officialHandicap)}
                                id={`hi-${player.registrationId}`}
                                inputMode="decimal"
                                name="officialIndex"
                                placeholder="ไม่มี"
                              />
                              <button className={buttonClass("secondary", "sm")} type="submit">
                                <SaveIcon className="size-4" aria-hidden="true" />
                                บันทึก
                              </button>
                            </form>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums text-ink">
                          {showCardHandicap ? "คิดจากการ์ด" : formatHandicap(player.handicapUsed.value, "ไม่มี")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            {/* ---------- OCR ---------- */}
            <section className={`${card} mt-6 scroll-mt-20`} id="ocr">
              <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink">
                <UploadIcon className="size-5 text-ink-subtle" aria-hidden="true" /> สแกนสกอร์การ์ด
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                ถ่ายภาพสกอร์การ์ดทั้งใบ แล้วตรวจตัวเลขเทียบกับภาพก่อนบันทึก อ่านได้ทั้งแบบนับสโตรกและแบบเทียบพาร์ (+1, E, /, B, DB, X) ภาพทุกใบเก็บเป็นประวัติ
              </p>
              {!ocrReady ? (
                <StatusBanner className="mt-3" tone="warning">
                  ยังไม่ได้ตั้งค่าการอ่านการ์ดอัตโนมัติ (ANTHROPIC_API_KEY) อัปโหลดภาพได้ตามปกติ แล้วกรอกสกอร์เทียบกับภาพ
                </StatusBanner>
              ) : null}
              <form action={uploadScorecard} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <input name="eventId" type="hidden" value={eventId} />
                <div className="min-w-0 flex-1">
                  <ImageCaptureInput hint="ถ่ายทั้งใบให้เห็นทุกช่อง ย่อขนาดบนเครื่องก่อนส่ง" label="ภาพสกอร์การ์ด" name="photo" preset="scorecard" required />
                </div>
                <SubmitButton className={buttonPrimary} pendingText="กำลังอ่านการ์ด... (อาจใช้เวลาสักครู่)">
                  <UploadIcon className="size-4" aria-hidden="true" /> อัปโหลดและอ่าน
                </SubmitButton>
              </form>
              {jobs.length ? (
                <>
                  <h3 className="mt-5 text-sm font-medium text-ink-muted">การ์ดที่สแกนล่าสุด</h3>
                  <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    {jobs.map((job) => (
                      <li key={job.id}>
                        <Link
                          className="block overflow-hidden rounded-lg border border-line bg-white transition hover:border-brand-600"
                          href={`/admin/events/${eventId}/scoring/ocr/${job.id}`}
                        >
                          {job.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
                            <img alt="สกอร์การ์ด" className="aspect-[4/3] w-full object-cover" src={job.thumb} />
                          ) : (
                            <div className="aspect-[4/3] bg-canvas" />
                          )}
                          <div className="grid gap-1 px-2 py-2">
                            <StatusBadge className="w-fit" kind="ocr" status={job.status}>
                              {ocrStatusLabels[job.status] ?? job.status}
                            </StatusBadge>
                            <p className="text-xs text-ink-subtle">{formatThaiDateTime(job.created_at)}</p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>

            {/* ---------- cards ---------- */}
            <section className={`${card} mt-6 scroll-mt-20`} id="cards">
              <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink">
                <ScoresIcon className="size-5 text-ink-subtle" aria-hidden="true" /> กรอกและยืนยันสกอร์
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                บันทึกทุกครั้งเป็นการ์ดใหม่ (ไม่แก้ทับ) · พิมพ์ X ถ้าเก็บลูก · ผู้เล่นยืนยันก่อน แล้ว marker ยืนยัน (หรือเจ้าหน้าที่ยืนยันแทน) · เฉพาะการ์ดที่ยืนยันแล้วนำไปจัดอันดับ
              </p>
              {data.players.length ? (
                <>
                  {/* Phones: one row per player, the keypad does the typing. */}
                  <ul className="mt-4 divide-y divide-line md:hidden">
                    {data.players.map((player) => {
                      const latest = data.latestEntry.get(player.registrationId);
                      const verifiedId = data.verified.get(player.registrationId);
                      const latestVerified = latest && latest.id === verifiedId;
                      const total = latest?.strokes.every((value) => value !== null)
                        ? latest.strokes.reduce<number>((sum, value) => sum + (value ?? 0), 0)
                        : null;
                      return (
                        <li className="grid gap-2 py-3" id={`card-m-${player.registrationId}`} key={player.registrationId}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-ink">{displayName(player)}</p>
                              <p className="text-xs text-ink-subtle">
                                {player.groupNo ? <>ก๊วน <span className="tabular-nums">{player.groupNo}</span> · </> : null}
                                แต้มต่อ (HC) <span className="tabular-nums">{formatHandicap(player.handicapUsed.value, "ไม่มี")}</span>
                                {total !== null ? <> · สกอร์รวม <span className="font-semibold tabular-nums text-ink">{total}</span></> : null}
                              </p>
                            </div>
                            {latestVerified ? (
                              <StatusBadge kind="score" status="verified">ยืนยันแล้ว</StatusBadge>
                            ) : latest ? (
                              <StatusBadge kind="score" status="submitted">รอยืนยัน</StatusBadge>
                            ) : (
                              <StatusBadge kind="score" status="not_entered">ยังไม่มีสกอร์</StatusBadge>
                            )}
                          </div>
                          <ScoreKeypad
                            action={saveScoreEntry}
                            // A saved card remounts the keypad (closed, with the stored values).
                            key={latest?.id ?? "new"}
                            eventId={eventId}
                            initialValues={cardValues(latest)}
                            pars={rules.pars}
                            playerName={displayName(player)}
                            registrationId={player.registrationId}
                            startHole={player.groupStartHole}
                            strokeIndex={rules.strokeIndex}
                            triggerClassName={`${buttonClass(latest ? "secondary" : "primary", "md")} w-full`}
                            triggerLabel={latest ? "แก้สกอร์ทีละหลุม" : "กรอกสกอร์ทีละหลุม"}
                          />
                        </li>
                      );
                    })}
                  </ul>

                  <div className="mt-4 hidden overflow-x-auto md:block">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-xs text-ink-subtle">
                          <th className="sticky left-0 z-10 bg-white py-2 pr-3 text-left font-medium" scope="col">ผู้เล่น</th>
                          {Array.from({ length: HOLES }, (_, i) => <th className="w-9 text-center font-semibold tabular-nums text-ink-muted" key={i} scope="col">{i + 1}</th>)}
                          <th className="px-2 text-center font-medium" scope="col">สกอร์รวม</th>
                          <th className="px-2 text-left font-medium" scope="col">สถานะ</th>
                          <th className="px-2 text-left font-medium" scope="col">บันทึก</th>
                        </tr>
                        <tr className="text-xs text-ink-subtle">
                          <th className="sticky left-0 z-10 bg-white pb-2 pr-3 text-left font-medium" scope="row">พาร์</th>
                          {rules.pars.map((par, i) => <th className="pb-2 text-center font-normal tabular-nums" key={i}>{par}</th>)}
                          <th className="pb-2 text-center font-normal tabular-nums">{rules.pars.reduce((a, b) => a + b, 0)}</th>
                          <th />
                          <th />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {data.players.map((player) => {
                          const latest = data.latestEntry.get(player.registrationId);
                          const verifiedId = data.verified.get(player.registrationId);
                          const latestVerified = latest && latest.id === verifiedId;
                          const formId = `card-form-${player.registrationId}`;
                          const total = latest?.strokes.every((value) => value !== null)
                            ? latest.strokes.reduce<number>((sum, value) => sum + (value ?? 0), 0)
                            : null;
                          const cardCount = data.entryCount(player.registrationId);
                          const confirmed = confirmationState(latest?.id);

                          return (
                            <tr className="scroll-mt-20" id={`card-${player.registrationId}`} key={player.registrationId}>
                              <td className="sticky left-0 z-10 bg-white py-2 pr-3">
                                <p className="whitespace-nowrap font-semibold text-ink">{displayName(player)}</p>
                                <p className="whitespace-nowrap text-xs text-ink-subtle">
                                  {player.groupNo ? <>ก๊วน <span className="tabular-nums">{player.groupNo}</span> · </> : null}
                                  <abbr className="no-underline" title={`แต้มต่อชมรม ${clubHandicapText(player)}`}>แต้มต่อ (HC)</abbr>{" "}
                                  <span className="tabular-nums">{showCardHandicap ? "จากการ์ด" : formatHandicap(player.handicapUsed.value, "ไม่มี")}</span>
                                  {cardCount > 1 ? <> · <span className="tabular-nums">{cardCount}</span> การ์ด</> : null}
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
                              <td className="px-2 text-center font-semibold tabular-nums text-ink">
                                {total ?? <span className="sr-only">ยังไม่ครบ 18 หลุม</span>}
                              </td>
                              <td className="px-2">
                                {latestVerified ? (
                                  <StatusBadge kind="score" status="verified">ยืนยันแล้ว</StatusBadge>
                                ) : latest ? (
                                  <StatusBadge kind="score" status="submitted">{verifiedId ? "การ์ดใหม่รอยืนยัน" : "รอยืนยัน"}</StatusBadge>
                                ) : (
                                  <StatusBadge kind="score" status="not_entered">ยังไม่มีสกอร์</StatusBadge>
                                )}
                                {latest && !latestVerified && data.confirmationsAvailable ? (
                                  <p className="mt-1 whitespace-nowrap text-xs text-ink-subtle">
                                    ผู้เล่น {confirmed.player ? "✓" : "–"} · marker {confirmed.marker ? "✓" : "–"}
                                  </p>
                                ) : null}
                              </td>
                              <td className="min-w-64 px-2 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <form action={saveScoreEntry} className="flex items-center gap-2" id={formId}>
                                    <input name="eventId" type="hidden" value={eventId} />
                                    <input name="registrationId" type="hidden" value={player.registrationId} />
                                    <label className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-muted">
                                      <input name="verifyNow" type="checkbox" /> ยืนยันทันที
                                    </label>
                                    <button className={buttonClass("primary", "sm")} type="submit">
                                      <SaveIcon className="size-4" aria-hidden="true" />
                                      บันทึก
                                    </button>
                                  </form>
                                  {latest && !latestVerified && data.confirmationsAvailable && !confirmed.marker ? (
                                    <form action={confirmEntryAsStaff}>
                                      <input name="eventId" type="hidden" value={eventId} />
                                      <input name="entryId" type="hidden" value={latest.id} />
                                      <input name="role" type="hidden" value={confirmed.player ? "marker" : "player"} />
                                      <button className={buttonClass("secondary", "sm")} type="submit">
                                        {confirmed.player ? "marker ยืนยัน" : "ผู้เล่นยืนยัน"}
                                      </button>
                                    </form>
                                  ) : null}
                                  {latest && !latestVerified ? (
                                    <form action={verifyScoreEntry}>
                                      <input name="eventId" type="hidden" value={eventId} />
                                      <input name="entryId" type="hidden" value={latest.id} />
                                      <button className={buttonClass("ghost", "sm")} title="ยืนยันโดยเจ้าหน้าที่โดยไม่ต้องรอผู้เล่นและ marker" type="submit">
                                        {verifiedId ? "ยืนยันการ์ดล่าสุด" : "ยืนยันการ์ดนี้"}
                                      </button>
                                    </form>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-canvas px-4 py-3">
                  <p className="text-sm text-ink-muted">ยังไม่มีผู้เล่นในกิจกรรมนี้</p>
                  <Link className={buttonClass("secondary", "sm")} href={`/admin/events/${eventId}#participants`}>
                    ดูผู้สมัคร
                  </Link>
                </div>
              )}
            </section>

            {/* ---------- leaderboard ---------- */}
            <section className={`${card} mt-6 scroll-mt-20`} id="leaderboard">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink">
                    <ListOrdered className="size-5 text-ink-subtle" aria-hidden="true" /> ตารางคะแนน
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-muted">คิดจากการ์ดที่ยืนยันแล้วเท่านั้น</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <form action={publishLeaderboard}>
                    <input name="eventId" type="hidden" value={eventId} />
                    <ConfirmSubmitButton
                      className={buttonPrimary}
                      confirmLabel="ประกาศผล"
                      message="ประกาศผลให้สมาชิกเห็น? ผลฉบับนี้จะเก็บไว้เป็นประวัติ"
                      title="ประกาศผล"
                      tone="primary"
                    >
                      ประกาศผล
                    </ConfirmSubmitButton>
                  </form>
                  <Link className={buttonSecondary} href={`/admin/events/${eventId}#prizes`}>
                    <AwardsIcon className="size-4" aria-hidden="true" /> รางวัล
                  </Link>
                </div>
              </div>
              {board && board.overall.length ? (
                <div className="mt-4 grid gap-6">
                  {[{ name: "รวมทุกไฟลท์", players: board.overall, useFlightRank: false }, ...board.flights.map((f) => ({ ...f, useFlightRank: true }))].map((table) => (
                    <div className="overflow-x-auto" key={table.name}>
                      <h3 className="mb-2 text-h3 font-semibold text-ink">{table.name}</h3>
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-line text-left text-xs text-ink-subtle">
                            <th className="py-2 pr-3 font-medium" scope="col">อันดับ</th>
                            <th className="pr-3 font-medium" scope="col">ผู้เล่น</th>
                            {!showCardHandicap ? <th className="pr-3 text-right font-medium" scope="col">แต้มต่อ (HC)</th> : null}
                            <th className="pr-3 text-right font-medium" scope="col">สกอร์รวม (Gross)</th>
                            {showPoints ? <th className="pr-3 text-right font-medium" scope="col">{pointsLabel}</th> : null}
                            {showCardHandicap ? <th className="pr-3 text-right font-medium" scope="col">แต้มต่อจากการ์ด</th> : null}
                            {showNet ? <th className="pr-3 text-right font-medium" scope="col">สกอร์สุทธิ (Net)</th> : null}
                            <th className="pr-3 font-medium" scope="col">หมายเหตุ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {table.players.map((row) => {
                            const rank = table.useFlightRank ? row.flightRank : row.rank;
                            return (
                              <tr key={row.id}>
                                <td className="py-2 pr-3 font-semibold tabular-nums text-ink">{rank ?? ""}</td>
                                <td className="pr-3 text-ink">{row.name}</td>
                                {!showCardHandicap ? (
                                  <td className="pr-3 text-right tabular-nums">
                                    {row.handicapIndex === null ? "" : formatHandicap(row.handicapIndex)}
                                    {row.playingHandicap !== (row.handicapIndex ?? 0) ? ` (${row.playingHandicap})` : ""}
                                  </td>
                                ) : null}
                                <td className="pr-3 text-right tabular-nums">{row.gross ?? ""}</td>
                                {showPoints ? <td className="pr-3 text-right font-semibold tabular-nums">{row.points ?? ""}</td> : null}
                                {showCardHandicap ? <td className="pr-3 text-right tabular-nums">{row.cardHandicap ?? row.s36Handicap ?? ""}</td> : null}
                                {showNet ? <td className="pr-3 text-right font-semibold tabular-nums">{row.net ?? ""}</td> : null}
                                <td className="pr-3 text-xs text-ink-muted">
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
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-canvas px-4 py-3">
                  <p className="text-sm text-ink-muted">ยังไม่มีการ์ดที่ยืนยันแล้ว ยืนยันการ์ดในตารางด้านบนก่อน</p>
                  <a className={buttonClass("secondary", "sm")} href="#cards">
                    ไปที่กรอกสกอร์
                  </a>
                </div>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
