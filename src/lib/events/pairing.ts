// Pure helpers for event operations: seat accounting, pairing (tee sheet) planning,
// automatic player assignment, and check-in summaries. No I/O here.

export type RegistrationStatus =
  | "draft"
  | "registered"
  | "pending_payment"
  | "payment_review"
  | "paid"
  | "cancelled"
  | "waitlist"
  | "checked_in"
  | "no_show";

export const registrationStatusLabels: Record<string, string> = {
  cancelled: "ยกเลิก",
  checked_in: "เช็กอินแล้ว",
  draft: "ร่าง",
  no_show: "ไม่มาแสดงตัว",
  paid: "ชำระเงินแล้ว",
  payment_review: "รอตรวจหลักฐาน",
  pending_payment: "รอชำระเงิน",
  registered: "ยืนยันแล้ว",
  waitlist: "รายชื่อสำรอง",
};

/** Mirrors SQL `_event_seat_status`: statuses that count against event capacity. */
export function holdsSeat(status: string) {
  return !["cancelled", "no_show", "waitlist", "draft"].includes(status);
}

/** Statuses that may be placed in a pairing group or checked in. */
export function isPairable(status: string) {
  return holdsSeat(status);
}

export function isConfirmed(status: string) {
  return status === "paid" || status === "registered" || status === "checked_in";
}

/** Status to restore when an admin undoes a no-show. */
export function restoredStatus(input: { memberPrice: number; paymentApproved: boolean }) {
  if (input.paymentApproved) return "paid";
  return input.memberPrice > 0 ? "pending_payment" : "registered";
}

export type RegistrationSummary = {
  cancelled: number;
  checkedIn: number;
  confirmed: number;
  noShow: number;
  seats: number;
  unpaid: number;
  unpaired: number;
  waitlist: number;
};

export function summarizeRegistrations(
  rows: { checked_in_at: string | null; pairing_group_id: string | null; status: string }[],
): RegistrationSummary {
  const summary: RegistrationSummary = {
    cancelled: 0,
    checkedIn: 0,
    confirmed: 0,
    noShow: 0,
    seats: 0,
    unpaid: 0,
    unpaired: 0,
    waitlist: 0,
  };

  for (const row of rows) {
    if (row.status === "cancelled") summary.cancelled += 1;
    if (row.status === "waitlist") summary.waitlist += 1;
    if (row.status === "no_show") summary.noShow += 1;
    if (!holdsSeat(row.status)) continue;
    summary.seats += 1;
    if (isConfirmed(row.status)) summary.confirmed += 1;
    if (row.status === "pending_payment" || row.status === "payment_review") summary.unpaid += 1;
    if (row.checked_in_at) summary.checkedIn += 1;
    if (!row.pairing_group_id) summary.unpaired += 1;
  }

  return summary;
}

// ---------- time ----------

const timePattern = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export function isValidTime(value: string) {
  return timePattern.test(value);
}

/** "07:00" + 8 -> "07:08". Wraps past midnight. Returns null for bad input. */
export function addMinutes(time: string, minutes: number) {
  const match = time.match(timePattern);
  if (!match) return null;
  const total = (((Number(match[1]) * 60 + Number(match[2]) + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ---------- tee sheet planning ----------

export type PairingMode = "tee_times" | "shotgun";

export type GroupPlanInput = {
  firstTeeTime: string;
  groupSize: number;
  intervalMinutes: number;
  mode: PairingMode;
  playerCount: number;
  /** Two-tee start: alternate groups between hole 1 and hole 10 (tee_times mode). */
  splitTee?: boolean;
  startingGroupNo?: number;
};

export type GroupPlanItem = {
  capacity: number;
  group_no: number;
  start_hole: number;
  tee_time: string;
};

export const MAX_PAIRING_GROUPS = 60;

/**
 * Build pairing groups for a field.
 * - tee_times: groups go off hole 1 every `intervalMinutes` (or alternate 1/10 when splitTee).
 * - shotgun: every group starts at `firstTeeTime` on its own hole; past 18 groups, holes
 *   double up (1A/1B style) in order.
 */
export function planPairingGroups(input: GroupPlanInput): { error: string } | { items: GroupPlanItem[] } {
  const groupSize = Math.trunc(input.groupSize);
  const playerCount = Math.trunc(input.playerCount);
  if (!Number.isFinite(groupSize) || groupSize < 1 || groupSize > 8) {
    return { error: "invalid-group-size" };
  }
  if (!Number.isFinite(playerCount) || playerCount < 1) {
    return { error: "no-players" };
  }
  if (!isValidTime(input.firstTeeTime)) {
    return { error: "invalid-tee-time" };
  }
  const interval = Math.trunc(input.intervalMinutes);
  if (input.mode === "tee_times" && (!Number.isFinite(interval) || interval < 1 || interval > 60)) {
    return { error: "invalid-interval" };
  }

  const groupCount = Math.ceil(playerCount / groupSize);
  if (groupCount > MAX_PAIRING_GROUPS) {
    return { error: "too-many-groups" };
  }
  if (input.mode === "shotgun" && groupCount > 36) {
    return { error: "too-many-groups" };
  }

  const startNo = Math.max(1, Math.trunc(input.startingGroupNo ?? 1));
  const items: GroupPlanItem[] = [];

  for (let index = 0; index < groupCount; index += 1) {
    if (input.mode === "shotgun") {
      items.push({
        capacity: groupSize,
        group_no: startNo + index,
        start_hole: (index % 18) + 1,
        tee_time: addMinutes(input.firstTeeTime, 0)!,
      });
      continue;
    }

    const wave = input.splitTee ? Math.floor(index / 2) : index;
    items.push({
      capacity: groupSize,
      group_no: startNo + index,
      start_hole: input.splitTee && index % 2 === 1 ? 10 : 1,
      tee_time: addMinutes(input.firstTeeTime, wave * interval)!,
    });
  }

  return { items };
}

// ---------- auto assignment ----------

export type AssignStrategy = "registration" | "handicap" | "balanced";

export type AssignPlayer = { createdAt: string; handicap: number | null; id: string };
export type AssignGroup = { capacity: number; groupNo: number; id: string; occupied: number };
export type Assignment = { groupId: string; registrationId: string };

function byHandicap(a: AssignPlayer, b: AssignPlayer) {
  const ah = a.handicap ?? Number.POSITIVE_INFINITY;
  const bh = b.handicap ?? Number.POSITIVE_INFINITY;
  if (ah !== bh) return ah - bh;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function byRegistration(a: AssignPlayer, b: AssignPlayer) {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Place unassigned players into groups with free seats, never exceeding capacity.
 * - registration: first come, first grouped (fill group 1, then 2, ...)
 * - handicap: similar handicaps play together (sorted low -> high, filled in order)
 * - balanced: snake draft by handicap so each group gets a mix of low and high players
 * Players that do not fit are returned in `overflow`.
 */
export function autoAssignPlayers(
  players: AssignPlayer[],
  groups: AssignGroup[],
  strategy: AssignStrategy,
): { assignments: Assignment[]; overflow: string[] } {
  const open = [...groups]
    .sort((a, b) => a.groupNo - b.groupNo)
    .map((group) => ({ ...group, free: Math.max(0, group.capacity - group.occupied) }))
    .filter((group) => group.free > 0);
  const ordered = [...players].sort(strategy === "registration" ? byRegistration : byHandicap);
  const assignments: Assignment[] = [];
  const overflow: string[] = [];

  if (strategy !== "balanced") {
    let cursor = 0;
    for (const player of ordered) {
      while (cursor < open.length && open[cursor].free === 0) cursor += 1;
      if (cursor >= open.length) {
        overflow.push(player.id);
        continue;
      }
      open[cursor].free -= 1;
      assignments.push({ groupId: open[cursor].id, registrationId: player.id });
    }
    return { assignments, overflow };
  }

  // Snake draft: forward pass, backward pass, ... skipping full groups.
  let forward = true;
  let queue = ordered;
  while (queue.length) {
    const pass = forward ? open : [...open].reverse();
    const candidates = pass.filter((group) => group.free > 0);
    if (!candidates.length) {
      overflow.push(...queue.map((player) => player.id));
      break;
    }
    const take = queue.slice(0, candidates.length);
    queue = queue.slice(candidates.length);
    take.forEach((player, index) => {
      candidates[index].free -= 1;
      assignments.push({ groupId: candidates[index].id, registrationId: player.id });
    });
    forward = !forward;
  }

  return { assignments, overflow };
}

// ---------- error mapping ----------

export const eventRpcStatus: Record<string, string> = {
  ALREADY_REGISTERED: "already-registered",
  EVENT_CLOSED: "registration-closed",
  EVENT_NOT_FOUND: "registration-closed",
  MEMBER_NOT_APPROVED: "member-not-approved",
  MODULE_DISABLED: "module-disabled",
  PAIRING_GROUP_FULL: "group-full",
  PAIRING_GROUP_MISMATCH: "group-mismatch",
};

export function eventErrorToStatus(message: string | null | undefined, fallback: string) {
  const code = (message ?? "").match(/[A-Z_]{6,}/)?.[0];
  return (code && eventRpcStatus[code]) || fallback;
}
