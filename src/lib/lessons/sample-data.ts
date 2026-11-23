// Sample lesson v2 data for bypass preview (?bypass=admin / ?bypass=member / coach portal).
// Dates are relative to `today` so the calendar always shows something this week.
import { addDays, bangkokDate, lessonStartAt } from "./booking";
import { defaultLessonRules, type LessonRules } from "./rules";
import type {
  LessonClosure,
  LessonCoach,
  LessonCoachNote,
  LessonCreditTxn,
  LessonEnrollmentBalance,
  LessonPackage,
  LessonRosterRow,
  LessonSlotRow,
  LessonVenue,
  MyLessonBookingRow,
  MyLessonOverview,
} from "./types";

const CLUB = "00000000-0000-4000-8000-00000000c1ab";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const sampleLessonIds = {
  club: CLUB,
  coachA: id(101),
  coachB: id(102),
  member: id(301),
  programBasic: id(201),
  programShort: id(202),
  venueRange: id(151),
  venueCourse: id(152),
};

export type SampleLessonProgram = {
  coach_name: string | null;
  default_coach_id: string | null;
  default_venue_id: string | null;
  description: string | null;
  id: string;
  level: string;
  name: string;
  price: number;
  requires_package: boolean;
  status: string;
};

export function lessonSampleData(today: string = bangkokDate()) {
  const at = (days: number, time: string) => lessonStartAt(addDays(today, days), time).toISOString();

  const coaches: LessonCoach[] = [
    { archived_at: null, bio: "โปรสอนกอล์ฟ 12 ปี ถนัดวงสวิงพื้นฐาน", club_id: CLUB, full_name: "ธนพล ใจดี", id: sampleLessonIds.coachA, member_id: null, nickname: "โปรต้น", phone: "0812345601", status: "active", user_id: id(901) },
    { archived_at: null, bio: "เน้นลูกสั้นและพัตต์", club_id: CLUB, full_name: "สุภาวดี แสงทอง", id: sampleLessonIds.coachB, member_id: null, nickname: "โปรแนน", phone: "0812345602", status: "active", user_id: null },
  ];

  const venues: LessonVenue[] = [
    { address: "สนามไดร์ฟ กฟภ. สำนักงานใหญ่", archived_at: null, bay_count: 6, capacity_per_bay: 2, club_id: CLUB, id: sampleLessonIds.venueRange, name: "สนามไดร์ฟ กฟภ.", note: null, status: "active" },
    { address: "ถนนวิภาวดีรังสิต", archived_at: null, bay_count: 1, capacity_per_bay: 8, club_id: CLUB, id: sampleLessonIds.venueCourse, name: "กรีนซ้อมพัตต์", note: "ปิดวันจันทร์", status: "active" },
  ];

  const programs: SampleLessonProgram[] = [
    { coach_name: "ธนพล ใจดี (โปรต้น)", default_coach_id: sampleLessonIds.coachA, default_venue_id: sampleLessonIds.venueRange, description: "วงสวิงพื้นฐานสำหรับผู้เริ่มต้น", id: sampleLessonIds.programBasic, level: "beginner", name: "กอล์ฟพื้นฐาน", price: 0, requires_package: true, status: "active" },
    { coach_name: "สุภาวดี แสงทอง (โปรแนน)", default_coach_id: sampleLessonIds.coachB, default_venue_id: sampleLessonIds.venueCourse, description: "ลูกชิพและพัตต์", id: sampleLessonIds.programShort, level: "intermediate", name: "ลูกสั้นและพัตต์", price: 0, requires_package: false, status: "active" },
  ];

  const packages: LessonPackage[] = [
    { archived_at: null, club_id: CLUB, credits: 8, description: "เรียนได้ 8 ครั้ง ภายใน 60 วัน", id: id(401), max_per_member: null, name: "แพ็กเกจ 8 ครั้ง", price: 2400, program_id: sampleLessonIds.programBasic, sort_order: 1, status: "active", valid_days: 60 },
    { archived_at: null, club_id: CLUB, credits: 4, description: "ทุกคอร์ส ภายใน 30 วัน", id: id(402), max_per_member: null, name: "แพ็กเกจ 4 ครั้ง ทุกคอร์ส", price: 1400, program_id: null, sort_order: 2, status: "active", valid_days: 30 },
    { archived_at: null, club_id: CLUB, credits: 1, description: "ทดลองเรียนฟรี 1 ครั้ง", id: id(403), max_per_member: 1, name: "ทดลองเรียน", price: 0, program_id: null, sort_order: 3, status: "active", valid_days: 14 },
  ];

  const slot = (n: number, days: number, start: string, end: string, extra: Partial<LessonSlotRow>): LessonSlotRow => ({
    bay_label: null,
    booked_count: 0,
    capacity: 4,
    closure_id: null,
    coach_id: sampleLessonIds.coachA,
    coach_name: "ธนพล ใจดี (โปรต้น)",
    end_time: `${end}:00`,
    id: id(500 + n),
    lesson_date: addDays(today, days),
    program_id: sampleLessonIds.programBasic,
    seats_taken: 0,
    start_time: `${start}:00`,
    status: "open",
    title: "กอล์ฟพื้นฐาน",
    venue: "สนามไดร์ฟ กฟภ. · ช่อง 1",
    venue_id: sampleLessonIds.venueRange,
    waitlist_capacity: 2,
    waitlist_count: 0,
    ...extra,
  });

  const slots: LessonSlotRow[] = [
    slot(1, 0, "16:30", "17:30", { bay_label: "1", booked_count: 4, seats_taken: 4 }),
    slot(2, 0, "17:30", "18:30", { bay_label: "1", booked_count: 6, seats_taken: 4, waitlist_count: 2 }),
    slot(3, 1, "16:30", "17:30", { bay_label: "2", booked_count: 3, seats_taken: 3 }),
    slot(4, 2, "09:00", "10:30", { capacity: 8, coach_id: sampleLessonIds.coachB, coach_name: "สุภาวดี แสงทอง (โปรแนน)", program_id: sampleLessonIds.programShort, seats_taken: 2, booked_count: 2, title: "ลูกสั้นและพัตต์", venue: "กรีนซ้อมพัตต์", venue_id: sampleLessonIds.venueCourse }),
    slot(5, 3, "16:30", "17:30", { bay_label: "1", booked_count: 1, seats_taken: 1 }),
    slot(6, 4, "16:30", "17:30", { bay_label: "1", status: "cancelled" }),
    slot(7, 6, "08:00", "09:00", { bay_label: "3" }),
    slot(8, 9, "16:30", "17:30", { bay_label: "1", booked_count: 2, seats_taken: 2 }),
  ];

  const enrollments: LessonEnrollmentBalance[] = [
    { club_id: CLUB, created_at: at(-20, "10:00"), credits_remaining: 5, credits_total: 8, credits_used: 3, enrollment_id: id(601), expires_at: lessonStartAt(addDays(today, 40), "23:59:59").toISOString(), member_id: sampleLessonIds.member, package_id: id(401), package_name: "แพ็กเกจ 8 ครั้ง", payment_record_id: id(701), price: 2400, program_id: sampleLessonIds.programBasic, source: "purchase", starts_at: at(-20, "10:00"), status: "active", usable: true },
    { club_id: CLUB, created_at: at(-25, "10:00"), credits_remaining: 1, credits_total: 1, credits_used: 0, enrollment_id: id(602), expires_at: lessonStartAt(addDays(today, 5), "23:59:59").toISOString(), member_id: sampleLessonIds.member, package_id: id(403), package_name: "ทดลองเรียน", payment_record_id: null, price: 0, program_id: null, source: "free", starts_at: at(-9, "10:00"), status: "active", usable: true },
    { club_id: CLUB, created_at: at(-1, "20:00"), credits_remaining: 0, credits_total: 4, credits_used: 0, enrollment_id: id(603), expires_at: null, member_id: sampleLessonIds.member, package_id: id(402), package_name: "แพ็กเกจ 4 ครั้ง ทุกคอร์ส", payment_record_id: id(702), price: 1400, program_id: null, source: "purchase", starts_at: null, status: "pending_payment", usable: false },
  ];

  const txns: LessonCreditTxn[] = [
    { booking_id: null, club_id: CLUB, created_at: at(-20, "10:05"), created_by: id(900), delta: 8, enrollment_id: id(601), id: id(801), member_id: sampleLessonIds.member, note: "แพ็กเกจ 8 ครั้ง", reason: "purchase" },
    { booking_id: id(1001), club_id: CLUB, created_at: at(-14, "08:00"), created_by: null, delta: -1, enrollment_id: id(601), id: id(802), member_id: sampleLessonIds.member, note: null, reason: "booking" },
    { booking_id: id(1002), club_id: CLUB, created_at: at(-10, "08:00"), created_by: null, delta: -1, enrollment_id: id(601), id: id(803), member_id: sampleLessonIds.member, note: null, reason: "booking" },
    { booking_id: id(1002), club_id: CLUB, created_at: at(-9, "08:00"), created_by: null, delta: 1, enrollment_id: id(601), id: id(804), member_id: sampleLessonIds.member, note: null, reason: "closure" },
    { booking_id: id(1003), club_id: CLUB, created_at: at(-5, "08:00"), created_by: null, delta: -1, enrollment_id: id(601), id: id(805), member_id: sampleLessonIds.member, note: null, reason: "booking" },
    { booking_id: id(1004), club_id: CLUB, created_at: at(-1, "08:00"), created_by: null, delta: -1, enrollment_id: id(601), id: id(806), member_id: sampleLessonIds.member, note: null, reason: "booking" },
  ];

  const roster: LessonRosterRow[] = [
    { attendance_note: null, avatar_url: null, booked_at: at(-3, "09:12"), booking_id: id(1101), booking_status: "attended", checked_in_at: at(0, "16:22"), credit_used: true, employee_code: "500123", full_name: "สมชาย ใจงาม", last_note: "จับไม้ดีขึ้น", last_note_at: at(-7, "18:00"), member_code: "PEAGC-0012", member_id: id(1201), nickname: "ชาย", offer_expires_at: null, phone: "0890000001", queue_position: 1, skill_level: "beginner" },
    { attendance_note: null, avatar_url: null, booked_at: at(-3, "09:15"), booking_id: id(1102), booking_status: "booked", checked_in_at: null, credit_used: true, employee_code: "500456", full_name: "วิภา ศรีสุข", last_note: null, last_note_at: null, member_code: "PEAGC-0034", member_id: id(1202), nickname: "วิ", offer_expires_at: null, phone: "0890000002", queue_position: 2, skill_level: "beginner" },
    { attendance_note: null, avatar_url: null, booked_at: at(-2, "12:40"), booking_id: id(1103), booking_status: "offered", checked_in_at: null, credit_used: false, employee_code: null, full_name: "ประเสริฐ มั่นคง", last_note: null, last_note_at: null, member_code: "PEAGC-0101", member_id: id(1203), nickname: null, offer_expires_at: lessonStartAt(today, "15:30").toISOString(), phone: "0890000003", queue_position: 3, skill_level: null },
    { attendance_note: null, avatar_url: null, booked_at: at(-2, "13:05"), booking_id: id(1104), booking_status: "booked", checked_in_at: null, credit_used: true, employee_code: "500789", full_name: "อรุณี ทองดี", last_note: "ต้องฝึกสะโพก", last_note_at: at(-14, "18:00"), member_code: "PEAGC-0077", member_id: id(1204), nickname: "อร", offer_expires_at: null, phone: "0890000004", queue_position: 4, skill_level: "intermediate" },
    { attendance_note: null, avatar_url: null, booked_at: at(-1, "07:30"), booking_id: id(1105), booking_status: "waitlist", checked_in_at: null, credit_used: false, employee_code: "500999", full_name: "กิตติ พรหมมา", last_note: null, last_note_at: null, member_code: "PEAGC-0150", member_id: id(1205), nickname: "กิต", offer_expires_at: null, phone: "0890000005", queue_position: 5, skill_level: null },
  ];

  const myBookings: MyLessonBookingRow[] = [
    { booking_id: id(1004), capacity: 4, credit_enrollment_id: id(601), offer_expires_at: null, queue_position: 2, slot_id: slots[2].id, status: "booked", waitlist_capacity: 2 },
    { booking_id: id(1005), capacity: 4, credit_enrollment_id: null, offer_expires_at: lessonStartAt(today, "20:00").toISOString(), queue_position: 4, slot_id: slots[4].id, status: "offered", waitlist_capacity: 2 },
    { booking_id: id(1006), capacity: 4, credit_enrollment_id: null, offer_expires_at: null, queue_position: 6, slot_id: slots[1].id, status: "waitlist", waitlist_capacity: 2 },
  ];

  const closures: LessonClosure[] = [
    { bookings_closed: 9, closure_date: addDays(today, -9), club_id: CLUB, created_at: at(-9, "07:00"), created_by: id(900), credits_refunded: 7, id: id(1301), members_notified: 8, reason: "ฝนตกหนัก สนามปิด", slots_cancelled: 3, venue_id: sampleLessonIds.venueRange },
  ];

  const coachNotes: LessonCoachNote[] = [
    { booking_id: id(1001), club_id: CLUB, coach_id: sampleLessonIds.coachA, created_at: at(-14, "18:00"), id: id(1401), member_id: sampleLessonIds.member, note: "จับไม้ถูกแล้ว รอบหน้าฝึกการถ่ายน้ำหนัก", skill_level: "beginner", video_url: "https://youtu.be/example", visible_to_member: true },
  ];

  const overview: MyLessonOverview = {
    active_bookings: 3,
    blocked_until: null,
    booking_close_at: null,
    booking_open_at: at(-30, "08:00"),
    club_id: CLUB,
    credits_available: 6,
    is_employee: true,
    max_active_bookings: 2,
    member_id: sampleLessonIds.member,
    next_credit_expiry: enrollments[1].expires_at,
    pending_packages: 1,
    public_booking_open_at: at(-28, "08:00"),
    recent_no_shows: 0,
  };

  const rules: LessonRules = { ...defaultLessonRules, booking_open_at: at(-28, "08:00") };

  return { closures, coachNotes, coaches, enrollments, myBookings, overview, packages, programs, roster, rules, slots, txns, venues };
}
