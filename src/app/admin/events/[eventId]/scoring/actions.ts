"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { requireStaffClub } from "@/lib/auth/staff";
import { isOcrConfigured, readScorecard } from "@/lib/ocr/claude";
import { interpretRow, matchRows } from "@/lib/ocr/notation";
import { loadScoringData, parseCardInputs, scoringRoles, verifiedPlayerInputs } from "@/lib/scoring/data";
import { type CompetitionRules, type Flight, type ScoringFormat, HOLES, computeLeaderboard, validateRules } from "@/lib/scoring/engine";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function base(eventId: string) {
  return `/admin/events/${eventId}/scoring`;
}

function back(eventId: string, status: string, anchor = ""): never {
  redirect(`${base(eventId)}?status=${status}${anchor ? `#${anchor}` : ""}`);
}

async function requireScorer(eventId: string) {
  if (!eventId) redirect("/admin/events");
  const staff = await requireStaffClub(scoringRoles, base(eventId));
  const data = await loadScoringData(staff.supabase, staff.clubId, eventId);
  if (!data.event) redirect("/admin/events?status=missing-event");
  return { ...staff, data };
}

type Scorer = Awaited<ReturnType<typeof requireScorer>>;

async function audit(scorer: Scorer, action: string, entityType: string, entityId: string | null, payload: Record<string, unknown>) {
  await scorer.supabase.from("audit_logs").insert({
    action,
    actor_user_id: scorer.userId,
    after_data: payload,
    club_id: scorer.clubId,
    entity_id: entityId,
    entity_type: entityType,
    metadata: { event_id: scorer.data.event!.id, source: "admin.scoring" },
  });
}

function requireCompetition(scorer: Scorer, eventId: string) {
  if (!scorer.data.competition || !scorer.data.rules) back(eventId, "no-competition", "setup");
  return { competition: scorer.data.competition, rules: scorer.data.rules };
}

// ---------- rules ----------

function parseFlights(text: string): Flight[] | null {
  const flights: Flight[] = [];
  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const match = line.match(/^(.+?)\s*[:,]\s*(-?\d+(?:\.\d+)?)\s*[-–,]\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) return null;
    flights.push({ maxHandicap: Number(match[3]), minHandicap: Number(match[2]), name: match[1].trim() });
  }
  return flights;
}

export async function saveCompetitionRules(formData: FormData) {
  const eventId = str(formData, "eventId");
  const scorer = await requireScorer(eventId);
  const flights = parseFlights(str(formData, "flights"));
  if (!flights) back(eventId, "invalid-flights", "setup");

  const format = str(formData, "format") as ScoringFormat;
  const rules: CompetitionRules = {
    countback: formData.get("countback") === "on",
    flights,
    format,
    handicapAllowance: Number(str(formData, "allowance") || 100),
    pars: Array.from({ length: HOLES }, (_, i) => Number(str(formData, `par${i + 1}`))),
    strokeIndex: Array.from({ length: HOLES }, (_, i) => Number(str(formData, `si${i + 1}`))),
  };
  const errors = validateRules(rules);
  if (errors.length) back(eventId, "invalid-rules", "setup");

  const existing = scorer.data.competition;
  const name = str(formData, "name") || scorer.data.event!.name;
  const result = existing
    ? await scorer.supabase
        .from("competitions")
        .update({ name, rules, updated_by: scorer.userId })
        .eq("id", existing.id)
        .select("id")
        .single()
    : await scorer.supabase
        .from("competitions")
        .insert({
          club_id: scorer.clubId,
          created_by: scorer.userId,
          event_id: eventId,
          name,
          rules,
          status: "scoring",
          updated_by: scorer.userId,
        })
        .select("id")
        .single();

  if (result.error || !result.data) back(eventId, "rules-failed", "setup");
  await audit(scorer, existing ? "competition.rules_updated" : "competition.created", "competitions", result.data.id, { rules });
  back(eventId, "rules-saved", "setup");
}

// ---------- manual entry & verification ----------

async function insertEntry(
  scorer: Scorer,
  competitionId: string,
  registrationId: string,
  card: { pickups: boolean[]; strokes: (number | null)[] },
  source: "manual" | "ocr",
  extra: { note?: string | null; ocrJobId?: string | null } = {},
) {
  return scorer.supabase
    .from("score_entries")
    .insert({
      club_id: scorer.clubId,
      competition_id: competitionId,
      created_by: scorer.userId,
      event_registration_id: registrationId,
      note: extra.note ?? null,
      ocr_job_id: extra.ocrJobId ?? null,
      pickups: card.pickups,
      source,
      strokes: card.strokes,
    })
    .select("id")
    .single();
}

async function markVerified(scorer: Scorer, competitionId: string, registrationId: string, entryId: string) {
  return scorer.supabase.from("verified_scores").upsert(
    {
      club_id: scorer.clubId,
      competition_id: competitionId,
      event_registration_id: registrationId,
      score_entry_id: entryId,
      verified_at: new Date().toISOString(),
      verified_by: scorer.userId,
    },
    { onConflict: "competition_id,event_registration_id" },
  );
}

export async function saveScoreEntry(formData: FormData) {
  const eventId = str(formData, "eventId");
  const registrationId = str(formData, "registrationId");
  const scorer = await requireScorer(eventId);
  const { competition } = requireCompetition(scorer, eventId);
  if (!scorer.data.players.some((player) => player.registrationId === registrationId)) back(eventId, "missing-player", "cards");

  const card = parseCardInputs(Array.from({ length: HOLES }, (_, i) => str(formData, `h${i + 1}`)));
  if (card.invalid) back(eventId, "invalid-strokes", `card-${registrationId}`);
  if (card.strokes.every((value) => value === null) && !card.pickups.some(Boolean)) back(eventId, "empty-card", `card-${registrationId}`);

  const { data: entry, error } = await insertEntry(scorer, competition.id, registrationId, card, "manual", { note: str(formData, "note") || null });
  if (error || !entry) back(eventId, "entry-failed", `card-${registrationId}`);

  const verifyNow = formData.get("verifyNow") === "on";
  if (verifyNow) {
    const { error: verifyError } = await markVerified(scorer, competition.id, registrationId, entry.id);
    if (verifyError) back(eventId, "verify-failed", `card-${registrationId}`);
  }

  await audit(scorer, verifyNow ? "score.entered_and_verified" : "score.entered", "score_entries", entry.id, {
    registration_id: registrationId,
    source: "manual",
    strokes: card.strokes,
  });
  back(eventId, verifyNow ? "entry-verified" : "entry-saved", `card-${registrationId}`);
}

export async function verifyScoreEntry(formData: FormData) {
  const eventId = str(formData, "eventId");
  const entryId = str(formData, "entryId");
  const scorer = await requireScorer(eventId);
  const { competition } = requireCompetition(scorer, eventId);
  const entry = scorer.data.entryById.get(entryId);
  if (!entry) back(eventId, "missing-entry", "cards");

  const previous = scorer.data.verified.get(entry.event_registration_id) ?? null;
  const { error } = await markVerified(scorer, competition.id, entry.event_registration_id, entry.id);
  if (error) back(eventId, "verify-failed", `card-${entry.event_registration_id}`);

  await audit(scorer, "score.verified", "verified_scores", entry.id, {
    previous_entry_id: previous,
    registration_id: entry.event_registration_id,
  });
  back(eventId, "entry-verified", `card-${entry.event_registration_id}`);
}

// ---------- OCR ----------

export async function uploadScorecard(formData: FormData) {
  const eventId = str(formData, "eventId");
  const scorer = await requireScorer(eventId);
  const { competition, rules } = requireCompetition(scorer, eventId);
  const file = formData.get("photo");

  if (!(file instanceof File) || file.size === 0) back(eventId, "photo-missing", "ocr");
  const mediaType = file.type as keyof typeof PHOTO_TYPES;
  if (!(mediaType in PHOTO_TYPES)) back(eventId, "photo-invalid", "ocr");
  if (file.size > MAX_PHOTO_BYTES) back(eventId, "photo-too-large", "ocr");

  // 1) keep the photo first, so it is preserved even if reading fails
  const admin = createAdminClient();
  const bytes = Buffer.from(await file.arrayBuffer());
  const objectPath = `${scorer.clubId}/${competition.id}/${randomUUID()}.${PHOTO_TYPES[mediaType]}`;
  const { error: uploadError } = await admin.storage.from("scorecards").upload(objectPath, bytes, { contentType: mediaType });
  if (uploadError) back(eventId, "photo-upload-failed", "ocr");

  const { data: fileRow, error: fileError } = await admin
    .from("files")
    .insert({
      bucket: "scorecards",
      category: "scorecard_photo",
      club_id: scorer.clubId,
      created_by: scorer.userId,
      mime_type: mediaType,
      object_path: objectPath,
      size_bytes: file.size,
    })
    .select("id")
    .single();
  if (fileError || !fileRow) back(eventId, "photo-upload-failed", "ocr");

  const { data: job, error: jobError } = await admin
    .from("scorecard_ocr_jobs")
    .insert({
      club_id: scorer.clubId,
      competition_id: competition.id,
      created_by: scorer.userId,
      file_id: fileRow.id,
      status: isOcrConfigured() ? "processing" : "needs_review",
      error: isOcrConfigured() ? null : "OCR_NOT_CONFIGURED",
    })
    .select("id")
    .single();
  if (jobError || !job) back(eventId, "photo-upload-failed", "ocr");

  await audit(scorer, "scorecard.uploaded", "scorecard_ocr_jobs", job.id, { file_id: fileRow.id, object_path: objectPath });

  // 2) read it (skipped when no API key: the review board still shows the photo for manual entry)
  if (isOcrConfigured()) {
    try {
      const { model, reading, usage } = await readScorecard({ base64: bytes.toString("base64"), mediaType });
      const interpreted = reading.players.map((row) => ({
        name: row.name,
        nameConfidence: row.nameConfidence,
        ...interpretRow(row, rules.pars, reading.notation),
      }));
      const matches = matchRows(
        reading.players.map((row) => row.name),
        scorer.data.players.map((player) => ({
          id: player.registrationId,
          names: [player.name, player.nickname, player.memberCode].filter((value): value is string => Boolean(value)),
        })),
      );
      await admin
        .from("scorecard_ocr_jobs")
        .update({
          extracted: {
            notes: reading.notes,
            printedPars: reading.printedPars,
            raw: reading.players,
            rows: interpreted.map((row, index) => ({ ...row, match: matches[index] })),
          },
          model,
          notation: reading.notation,
          status: "needs_review",
          usage,
        })
        .eq("id", job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OCR_FAILED";
      console.error("[ocr] scorecard read failed:", message);
      await admin
        .from("scorecard_ocr_jobs")
        .update({ error: message.slice(0, 500), status: "failed" })
        .eq("id", job.id);
    }
  }

  redirect(`${base(eventId)}/ocr/${job.id}`);
}

export async function confirmOcrJob(formData: FormData) {
  const eventId = str(formData, "eventId");
  const jobId = str(formData, "jobId");
  const rowCount = Math.min(12, Math.max(0, Number(str(formData, "rowCount")) || 0));
  const scorer = await requireScorer(eventId);
  const { competition } = requireCompetition(scorer, eventId);
  const verifyNow = formData.get("verifyNow") === "on";
  const reviewPath = `${base(eventId)}/ocr/${jobId}`;

  const { data: job } = await scorer.supabase
    .from("scorecard_ocr_jobs")
    .select("id, status, extracted")
    .eq("id", jobId)
    .eq("competition_id", competition.id)
    .maybeSingle();
  if (!job || job.status === "confirmed" || job.status === "discarded") redirect(`${reviewPath}?status=job-closed`);

  const suggested = ((job.extracted as { rows?: { cells: { strokes: number | null }[] }[] } | null)?.rows ?? []);
  const seen = new Set<string>();
  const rows: { card: ReturnType<typeof parseCardInputs>; corrected: number; registrationId: string }[] = [];

  for (let r = 0; r < rowCount; r += 1) {
    const registrationId = str(formData, `player${r}`);
    if (!registrationId) continue; // row skipped by the reviewer
    if (seen.has(registrationId)) redirect(`${reviewPath}?status=duplicate-player`);
    if (!scorer.data.players.some((player) => player.registrationId === registrationId)) redirect(`${reviewPath}?status=missing-player`);
    seen.add(registrationId);
    const card = parseCardInputs(Array.from({ length: HOLES }, (_, i) => str(formData, `r${r}h${i + 1}`)));
    if (card.invalid) redirect(`${reviewPath}?status=invalid-strokes`);
    const corrected = card.strokes.filter((value, i) => value !== (suggested[r]?.cells[i]?.strokes ?? null)).length;
    rows.push({ card, corrected, registrationId });
  }
  if (!rows.length) redirect(`${reviewPath}?status=no-rows`);

  for (const row of rows) {
    const { data: entry, error } = await insertEntry(scorer, competition.id, row.registrationId, row.card, "ocr", { ocrJobId: jobId });
    if (error || !entry) redirect(`${reviewPath}?status=entry-failed`);
    if (verifyNow) await markVerified(scorer, competition.id, row.registrationId, entry.id);
  }

  await scorer.supabase
    .from("scorecard_ocr_jobs")
    .update({ confirmed_at: new Date().toISOString(), confirmed_by: scorer.userId, status: "confirmed" })
    .eq("id", jobId);

  // corrections = cells the reviewer changed vs. what OCR suggested (OCR accuracy history)
  await audit(scorer, "scorecard.confirmed", "scorecard_ocr_jobs", jobId, {
    corrected_cells: rows.reduce((sum, row) => sum + row.corrected, 0),
    players: rows.map((row) => row.registrationId),
    verified: verifyNow,
  });
  back(eventId, verifyNow ? "ocr-confirmed-verified" : "ocr-confirmed", "cards");
}

export async function discardOcrJob(formData: FormData) {
  const eventId = str(formData, "eventId");
  const jobId = str(formData, "jobId");
  const scorer = await requireScorer(eventId);
  const { competition } = requireCompetition(scorer, eventId);
  await scorer.supabase
    .from("scorecard_ocr_jobs")
    .update({ status: "discarded" })
    .eq("id", jobId)
    .eq("competition_id", competition.id)
    .neq("status", "confirmed");
  await audit(scorer, "scorecard.discarded", "scorecard_ocr_jobs", jobId, {});
  back(eventId, "ocr-discarded", "ocr");
}

// ---------- publish & prizes ----------

export async function publishLeaderboard(formData: FormData) {
  const eventId = str(formData, "eventId");
  const scorer = await requireScorer(eventId);
  const { competition, rules } = requireCompetition(scorer, eventId);
  const inputs = verifiedPlayerInputs(scorer.data);
  if (!inputs.length) back(eventId, "nothing-verified", "leaderboard");

  const board = computeLeaderboard(rules, inputs);
  const version = (competition.published_version ?? 0) + 1;
  const { error: snapshotError } = await scorer.supabase.from("leaderboard_snapshots").insert({
    club_id: scorer.clubId,
    competition_id: competition.id,
    published_by: scorer.userId,
    rows: board,
    rule_version: competition.rule_version,
    version,
  });
  if (snapshotError) back(eventId, "publish-failed", "leaderboard");

  // Denormalise the published result onto registrations + hole scores for the member portal.
  // Service role: scoring officers have no write access to registrations by design.
  const admin = createAdminClient();
  const memberByRegistration = new Map(scorer.data.players.map((player) => [player.registrationId, player.memberId]));
  for (const row of board.overall) {
    await admin
      .from("event_registrations")
      .update({
        flight: row.flight || null,
        gross_score: row.gross,
        handicap_used: row.handicapIndex,
        net_score: row.net,
        overall_rank: row.rank,
        score_status: "published",
        scored_at: new Date().toISOString(),
        scored_by: scorer.userId,
        stableford_points: row.points,
      })
      .eq("id", row.id)
      .eq("club_id", scorer.clubId);

    const memberId = memberByRegistration.get(row.id);
    const holes = row.strokes.flatMap((strokes, i) =>
      strokes === null || !memberId
        ? []
        : [{
            club_id: scorer.clubId,
            created_by: scorer.userId,
            event_registration_id: row.id,
            hole_number: i + 1,
            member_id: memberId,
            par: rules.pars[i],
            strokes,
            updated_by: scorer.userId,
          }],
    );
    if (holes.length) await admin.from("golf_hole_scores").upsert(holes, { onConflict: "event_registration_id,hole_number" });
  }

  await scorer.supabase
    .from("competitions")
    .update({ published_at: new Date().toISOString(), published_by: scorer.userId, published_version: version, status: "published", updated_by: scorer.userId })
    .eq("id", competition.id);
  await audit(scorer, "leaderboard.published", "competitions", competition.id, { players: inputs.length, rule_version: competition.rule_version, version });
  back(eventId, "published", "leaderboard");
}

export async function awardPrizes(formData: FormData) {
  const eventId = str(formData, "eventId");
  const topN = Math.min(10, Math.max(1, Number(str(formData, "topN")) || 3));
  const scorer = await requireScorer(eventId);
  const { competition, rules } = requireCompetition(scorer, eventId);
  if (competition.status !== "published") back(eventId, "publish-first", "leaderboard");

  const board = computeLeaderboard(rules, verifiedPlayerInputs(scorer.data));
  const memberByRegistration = new Map(scorer.data.players.map((player) => [player.registrationId, player.memberId]));
  const awards: { member_id: string; title: string }[] = [];
  const add = (registrationId: string, title: string) => {
    const memberId = memberByRegistration.get(registrationId);
    if (memberId) awards.push({ member_id: memberId, title });
  };

  board.overall.filter((row) => row.rank !== null && row.rank <= topN).forEach((row) => add(row.id, `อันดับ ${row.rank} ${competition.name}`));
  board.flights.forEach((flight) =>
    flight.players
      .filter((row) => row.flightRank !== null && row.flightRank <= topN)
      .forEach((row) => add(row.id, `ไฟลท์ ${flight.name} อันดับ ${row.flightRank} ${competition.name}`)),
  );

  const admin = createAdminClient();
  const { data: existing } = await admin.from("member_awards").select("member_id, title").eq("event_id", eventId);
  const have = new Set((existing ?? []).map((row) => `${row.member_id}|${row.title}`));
  const fresh = awards.filter((award) => !have.has(`${award.member_id}|${award.title}`));
  const awardedAt = (scorer.data.event as { event_date: string }).event_date;

  if (fresh.length) {
    const { error } = await admin.from("member_awards").insert(
      fresh.map((award) => ({
        ...award,
        award_type: "competition",
        awarded_at: awardedAt,
        club_id: scorer.clubId,
        created_by: scorer.userId,
        event_id: eventId,
      })),
    );
    if (error) back(eventId, "awards-failed", "leaderboard");
  }

  await audit(scorer, "competition.prizes_awarded", "competitions", competition.id, { count: fresh.length, top_n: topN });
  back(eventId, "awards-saved", "leaderboard");
}
