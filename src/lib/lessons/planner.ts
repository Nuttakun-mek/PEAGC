// Recurring-slot wizard (lessons v2): plan the rounds with planSlots(), then mark the ones that
// clash with existing rounds (same coach, same venue + bay, same course at the same start) or with
// each other, and summarise: "จะสร้าง 24 รอบ ข้าม 2 รอบที่ชนผู้สอน".
// The same check runs in SQL (rpc lesson_slot_conflicts) when the existing rounds are not loaded.
import { planSlots, type SlotPlanInput, type SlotPlanItem } from "./booking";
import type { LessonSlotConflictRow, LessonSlotRow, LessonVenue } from "./types";

export type PlannerConflictKind = "duplicate" | "overlap" | "coach" | "venue";

export type PlannerConflict = {
  end_time?: string;
  kind: PlannerConflictKind;
  slotId?: string;
  start_time?: string;
  title?: string | null;
};

export type PlannedSlot = SlotPlanItem & { conflicts: PlannerConflict[]; skip: boolean };

export type PlannerExistingSlot = Pick<LessonSlotRow, "end_time" | "id" | "lesson_date" | "start_time" | "status"> & {
  archived_at?: string | null;
  bay_label?: string | null;
  coach_id?: string | null;
  program_id?: string | null;
  title?: string | null;
  venue_id?: string | null;
};

export type PlannerInput = SlotPlanInput & {
  bayLabel?: string | null;
  coachId?: string | null;
  /** existing rounds around the planned dates (any course) */
  existing?: readonly PlannerExistingSlot[];
  programId?: string | null;
  venueId?: string | null;
};

export type PlanCounts = Record<PlannerConflictKind, number> & { create: number; skipped: number; total: number };

/** Most important reason first: one round is counted once, under its first kind. */
const KIND_ORDER: PlannerConflictKind[] = ["duplicate", "overlap", "coach", "venue"];

const KIND_TEXT: Record<PlannerConflictKind, string> = {
  coach: "ชนผู้สอน",
  duplicate: "มีอยู่แล้ว",
  overlap: "เวลาซ้อนกันเอง",
  venue: "ชนสถานที่",
};

export const plannerConflictLabels = KIND_TEXT;

const hhmm = (time: string) => time.slice(0, 5);
const bay = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const overlaps = (a: { end_time: string; start_time: string }, b: { end_time: string; start_time: string }) =>
  hhmm(a.start_time) < hhmm(b.end_time) && hhmm(b.start_time) < hhmm(a.end_time);

function primaryKind(item: PlannedSlot) {
  return KIND_ORDER.find((kind) => item.conflicts.some((conflict) => conflict.kind === kind)) ?? null;
}

export function countPlan(items: readonly PlannedSlot[]): PlanCounts {
  const counts: PlanCounts = { coach: 0, create: 0, duplicate: 0, overlap: 0, skipped: 0, total: items.length, venue: 0 };
  for (const item of items) {
    const kind = primaryKind(item);
    if (kind) {
      counts[kind] += 1;
      counts.skipped += 1;
    } else {
      counts.create += 1;
    }
  }
  return counts;
}

/** "จะสร้าง 24 รอบ ข้าม 2 รอบที่ชนผู้สอน และ 1 รอบที่ชนสถานที่" (3+ kinds: "a, b และ c") */
export function planSummary(counts: PlanCounts) {
  const skipped = KIND_ORDER.filter((kind) => counts[kind] > 0).map((kind) => `${counts[kind]} รอบที่${KIND_TEXT[kind]}`);
  const list = skipped.length > 1 ? `${skipped.slice(0, -1).join(", ")} และ ${skipped[skipped.length - 1]}` : skipped[0];
  const skippedText = list ? ` ข้าม ${list}` : "";
  return counts.create > 0 ? `จะสร้าง ${counts.create} รอบ${skippedText}` : `ไม่มีรอบใหม่ให้สร้าง${skippedText}`;
}

function finish(items: PlannedSlot[]) {
  for (const item of items) {
    item.skip = item.conflicts.length > 0;
  }
  const counts = countPlan(items);
  return {
    counts,
    items,
    summary: planSummary(counts),
    toCreate: items.filter((item) => !item.skip).map(({ end_time, lesson_date, start_time }) => ({ end_time, lesson_date, start_time })),
  };
}

export function planSlotsWithConflicts(input: PlannerInput) {
  const plan = planSlots(input);
  if ("error" in plan) {
    return plan;
  }

  const existing = (input.existing ?? []).filter(
    (slot) => !slot.archived_at && slot.status !== "cancelled" && slot.status !== "archived",
  );
  const items: PlannedSlot[] = plan.items.map((item) => ({ ...item, conflicts: [], skip: false }));

  items.forEach((item, index) => {
    for (const slot of existing) {
      if (slot.lesson_date !== item.lesson_date) continue;
      const ref = { end_time: hhmm(slot.end_time), slotId: slot.id, start_time: hhmm(slot.start_time), title: slot.title ?? null };
      if (input.programId && slot.program_id === input.programId && hhmm(slot.start_time) === item.start_time) {
        item.conflicts.push({ kind: "duplicate", ...ref });
      }
      if (!overlaps(item, slot)) continue;
      if (input.coachId && slot.coach_id === input.coachId) {
        item.conflicts.push({ kind: "coach", ...ref });
      }
      if (input.venueId && slot.venue_id === input.venueId && bay(slot.bay_label) === bay(input.bayLabel)) {
        item.conflicts.push({ kind: "venue", ...ref });
      }
    }
    // two typed time ranges that overlap on the same day: keep the first, skip the later one
    for (const earlier of items.slice(0, index)) {
      if (earlier.lesson_date === item.lesson_date && overlaps(earlier, item)) {
        item.conflicts.push({ end_time: earlier.end_time, kind: "overlap", start_time: earlier.start_time });
        break;
      }
    }
  });

  return finish(items);
}

/** Merge rows of rpc("lesson_slot_conflicts") (item_index = position in the planned list). */
export function applyConflictRows(items: readonly PlannedSlot[], rows: readonly LessonSlotConflictRow[]) {
  const next: PlannedSlot[] = items.map((item) => ({ ...item, conflicts: [...item.conflicts] }));
  for (const row of rows) {
    const item = next[row.item_index];
    if (!item || item.conflicts.some((conflict) => conflict.kind === row.conflict_kind && conflict.slotId === row.conflict_slot_id)) {
      continue;
    }
    item.conflicts.push({
      end_time: hhmm(row.conflict_end),
      kind: row.conflict_kind,
      slotId: row.conflict_slot_id,
      start_time: hhmm(row.conflict_start),
      title: row.conflict_title,
    });
  }
  return finish(next);
}

/** Warning when a round takes more people than the venue (or one bay) holds. */
export function venueCapacityWarning(
  capacity: number,
  venue: Pick<LessonVenue, "bay_count" | "capacity_per_bay" | "name"> | null | undefined,
  bayLabel?: string | null,
) {
  if (!venue) return null;
  const limit = bay(bayLabel) ? venue.capacity_per_bay : venue.bay_count * venue.capacity_per_bay;
  return capacity > limit ? `${venue.name}${bay(bayLabel) ? ` ช่อง ${bayLabel?.trim()}` : ""} รับได้ ${limit} คนต่อรอบ` : null;
}
