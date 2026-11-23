// Row shapes of the lessons v2 schema (supabase/migrations/20261123093000_lessons_v2.sql).
// Pure types: shared by admin pages, the coach portal, member screens and sample data.

export const lessonBookingStatuses = [
  "booked",
  "waitlist",
  "offered",
  "attended",
  "no_show",
  "cancelled",
  "late_cancelled",
  "closed",
] as const;

export type LessonBookingStatus = (typeof lessonBookingStatuses)[number];

export type LessonEnrollmentStatus = "pending_payment" | "active" | "expired" | "cancelled";

export type LessonCreditReason = "purchase" | "booking" | "refund" | "late_cancel" | "closure" | "expired" | "adjust";

export type SkillLevel = "beginner" | "intermediate" | "advanced";

export type LessonCoach = {
  archived_at: string | null;
  bio: string | null;
  club_id: string;
  full_name: string;
  id: string;
  member_id: string | null;
  nickname: string | null;
  phone: string | null;
  status: "active" | "inactive";
  /** auth user of the coach login (role 'coach' in user_roles). */
  user_id: string | null;
};

export type LessonVenue = {
  address: string | null;
  archived_at: string | null;
  bay_count: number;
  capacity_per_bay: number;
  club_id: string;
  id: string;
  name: string;
  note: string | null;
  status: "active" | "inactive";
};

export type LessonPackage = {
  archived_at: string | null;
  club_id: string;
  credits: number;
  description: string | null;
  id: string;
  max_per_member: number | null;
  name: string;
  price: number;
  /** null = any course */
  program_id: string | null;
  sort_order: number;
  status: "active" | "inactive";
  valid_days: number;
};

/** Row of the lesson_enrollment_balances view (lesson_enrollments + remaining credits). */
export type LessonEnrollmentBalance = {
  club_id: string;
  created_at: string;
  credits_remaining: number;
  credits_total: number;
  credits_used: number;
  enrollment_id: string;
  expires_at: string | null;
  member_id: string;
  package_id: string | null;
  package_name: string;
  payment_record_id: string | null;
  price: number;
  /** null = any course */
  program_id: string | null;
  source: "purchase" | "free" | "admin_grant";
  starts_at: string | null;
  status: LessonEnrollmentStatus;
  usable: boolean;
};

export type LessonCreditTxn = {
  booking_id: string | null;
  club_id: string;
  created_at: string;
  created_by: string | null;
  delta: number;
  enrollment_id: string;
  id: string;
  member_id: string;
  note: string | null;
  reason: LessonCreditReason;
};

export type LessonClosure = {
  bookings_closed: number;
  closure_date: string;
  club_id: string;
  created_at: string;
  created_by: string | null;
  credits_refunded: number;
  id: string;
  members_notified: number;
  reason: string;
  slots_cancelled: number;
  venue_id: string | null;
};

export type LessonCoachNote = {
  booking_id: string | null;
  club_id: string;
  coach_id: string | null;
  created_at: string;
  id: string;
  member_id: string;
  note: string;
  skill_level: SkillLevel | null;
  video_url: string | null;
  visible_to_member: boolean;
};

/** lesson_slots columns the calendar / planner need (v2 adds coach_id … waitlist_count). */
export type LessonSlotRow = {
  bay_label?: string | null;
  booked_count?: number | null;
  capacity: number;
  closure_id?: string | null;
  coach_id?: string | null;
  coach_name?: string | null;
  end_time: string;
  id: string;
  lesson_date: string;
  program_id?: string | null;
  seats_taken?: number | null;
  start_time: string;
  status: string;
  title?: string | null;
  venue?: string | null;
  venue_id?: string | null;
  waitlist_capacity?: number | null;
  waitlist_count?: number | null;
};

/** Row returned by rpc("lesson_slot_roster", { p_slot_id }). */
export type LessonRosterRow = {
  attendance_note: string | null;
  avatar_url: string | null;
  booked_at: string;
  booking_id: string;
  booking_status: LessonBookingStatus;
  checked_in_at: string | null;
  credit_used: boolean;
  employee_code: string | null;
  full_name: string;
  last_note: string | null;
  last_note_at: string | null;
  member_code: string | null;
  member_id: string;
  nickname: string | null;
  offer_expires_at: string | null;
  phone: string | null;
  /** seat holders 1..capacity, waitlist capacity+1.., null for cancelled/closed */
  queue_position: number | null;
  skill_level: string | null;
};

/** Row returned by rpc("my_lesson_bookings"). */
export type MyLessonBookingRow = {
  booking_id: string;
  capacity: number;
  credit_enrollment_id: string | null;
  offer_expires_at: string | null;
  queue_position: number | null;
  slot_id: string;
  status: LessonBookingStatus;
  waitlist_capacity: number;
};

/** rpc("my_lesson_overview") result. */
export type MyLessonOverview = {
  active_bookings: number;
  blocked_until: string | null;
  booking_close_at: string | null;
  /** booking start for this member (employees get the priority days) */
  booking_open_at: string | null;
  club_id: string;
  credits_available: number;
  is_employee: boolean;
  max_active_bookings: number;
  member_id: string;
  next_credit_expiry: string | null;
  pending_packages: number;
  public_booking_open_at: string | null;
  recent_no_shows: number;
};

/** Row returned by rpc("lesson_slot_conflicts", …). */
export type LessonSlotConflictRow = {
  conflict_bay_label: string | null;
  conflict_coach_id: string | null;
  conflict_end: string;
  conflict_kind: "coach" | "venue";
  conflict_slot_id: string;
  conflict_start: string;
  conflict_title: string;
  conflict_venue_id: string | null;
  item_date: string;
  item_end: string;
  item_index: number;
  item_start: string;
};
