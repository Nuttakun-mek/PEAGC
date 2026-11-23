/**
 * One colour meaning per status across every list (UX/UI audit, Nov 2026). Brand plum is for
 * buttons and the club mark only, never for status.
 *
 *   success  done / approved / active          warning  waiting on someone (review, waitlist)
 *   danger   rejected / cancelled / absent     info     open for sign-up or booking
 *   neutral  draft / closed / not yet checked
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export type StatusKind =
  | "announcement"
  | "booking"
  | "directory"
  | "employeeMatch"
  | "enrollment"
  | "event"
  | "lesson"
  | "member"
  | "memberLifecycle"
  | "membershipTerm"
  | "module"
  | "ocr"
  | "payment"
  | "redemption"
  | "registration"
  | "score";

const tones: Record<StatusKind, Record<string, StatusTone>> = {
  announcement: { archived: "neutral", draft: "neutral", published: "success" },
  // lesson_bookings.status (lessons v2): offered = a seat is waiting for the member's confirmation
  booking: {
    attended: "success",
    booked: "success",
    cancelled: "neutral",
    closed: "neutral",
    late_cancelled: "danger",
    no_show: "danger",
    offered: "info",
    waitlist: "warning",
  },
  directory: { active: "success", archived: "neutral", inactive: "neutral", left: "danger" },
  employeeMatch: { matched: "success", mismatch: "warning", not_checked: "neutral", not_found: "danger" },
  // lesson_enrollments.status (lesson packages / credits)
  enrollment: { active: "success", cancelled: "neutral", expired: "danger", pending_payment: "warning" },
  event: { archived: "neutral", cancelled: "danger", closed: "neutral", completed: "neutral", draft: "neutral", open: "info" },
  lesson: { active: "success", archived: "neutral", cancelled: "danger", closed: "neutral", completed: "neutral", draft: "neutral", full: "warning", inactive: "neutral", open: "info" },
  member: {
    active: "success",
    archived: "neutral",
    expired: "danger",
    guest: "info",
    inactive: "neutral",
    pending_verification: "warning",
    resigned: "neutral",
    suspended: "danger",
  },
  // Derived lifecycle (src/lib/membership/lifecycle.ts): "expiring" = active, ends within the notice window.
  memberLifecycle: {
    active: "success",
    archived: "neutral",
    expired: "danger",
    expiring: "warning",
    guest: "info",
    inactive: "neutral",
    pending: "warning",
    resigned: "neutral",
    suspended: "danger",
  },
  membershipTerm: { active: "success", cancelled: "danger", pending_payment: "warning" },
  module: { off: "neutral", on: "success" },
  ocr: { confirmed: "success", discarded: "neutral", failed: "danger", needs_review: "warning", processing: "info" },
  payment: { approved: "success", pending: "neutral", refunded: "neutral", rejected: "danger", review: "warning" },
  redemption: { cancelled: "danger", fulfilled: "success", requested: "warning" },
  registration: {
    cancelled: "danger",
    checked_in: "success",
    no_show: "danger",
    paid: "success",
    payment_review: "warning",
    pending_payment: "warning",
    registered: "success",
    waitlist: "warning",
  },
  score: { draft: "neutral", not_entered: "neutral", published: "success", submitted: "warning", verified: "info" },
};

export function statusTone(kind: StatusKind, value: string | null | undefined): StatusTone {
  return (value && tones[kind][value]) || "neutral";
}
