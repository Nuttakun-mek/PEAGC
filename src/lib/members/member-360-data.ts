// View model of the admin member 360 page and the sample shown in bypass preview mode.

import type { AuditChange } from "../audit-diff";
import type { MembershipState, PreviewItem } from "./member-360";

export type Member360Member = {
  affiliation: string | null;
  avatar_url: string | null;
  department: string | null;
  email: string | null;
  employee_code: string | null;
  employee_directory_id: string | null;
  employee_match_detail: { reason?: string } | null;
  employee_match_status: string | null;
  full_name: string;
  handicap: number | null;
  id: string;
  joined_at: string | null;
  line_id: string | null;
  member_code: string | null;
  member_type: string | null;
  nickname: string | null;
  organization: string | null;
  phone: string | null;
  status: string;
  user_id: string | null;
};

export type Member360Directory = {
  affiliation: string | null;
  archived_at: string | null;
  association_member_code: string | null;
  department: string | null;
  employee_code: string;
  employment_status: string | null;
  full_name: string;
  id: string;
  member_type: string | null;
  membership_status: string | null;
  position: string | null;
};

export type Member360Booking = {
  checkedInAt: string | null;
  coach: string | null;
  date: string;
  endTime: string | null;
  id: string;
  program: string | null;
  startTime: string | null;
  /** booking status, or "waitlist" when the booking is past the slot capacity */
  status: string;
  title: string;
  venue: string | null;
};

export type Member360Package = {
  creditsLeft: number | null;
  creditsTotal: number | null;
  expiresOn: string | null;
  id: string;
  name: string;
  status: string | null;
};

export type Member360Registration = {
  checkedInAt: string | null;
  date: string;
  eventId: string;
  eventStatus: string | null;
  fee: number | null;
  id: string;
  name: string;
  score: { gross: number | null; net: number | null; points: number | null; rank: number | null; status: string | null } | null;
  status: string;
  venue: string | null;
};

export type Member360Payment = {
  amount: number;
  createdAt: string;
  hasSlip: boolean;
  id: string;
  label: string;
  purpose: string;
  reviewedAt: string | null;
  status: string;
};

export type Member360Notification = {
  channel: string;
  createdAt: string;
  id: string;
  readAt: string | null;
  sentAt: string | null;
  status: string;
  subject: string;
  type: string;
};

export type Member360Audit = {
  action: string;
  actorName: string;
  changes: AuditChange[];
  createdAt: string;
  entityType: string;
  id: string;
};

export type Member360PointRow = { amount: number; date: string | null; id: string; reason: string | null };

export type Member360Term = { endsOn: string | null; fee: number | null; id: string; startsOn: string | null; status: string | null };

export type Member360Data = {
  audit: Member360Audit[];
  credits: { available: boolean; balance: number | null };
  directory: Member360Directory | null;
  events: { past: Member360Registration[]; upcoming: Member360Registration[] };
  lessons: { past: Member360Booking[]; upcoming: Member360Booking[] };
  loadError: { labels: string[]; outdated: boolean } | null;
  member: Member360Member;
  membership: {
    available: boolean;
    daysLeft: number | null;
    endsOn: string | null;
    hasPending: boolean;
    state: MembershipState;
    terms: Member360Term[];
  };
  notifications: { rows: Member360Notification[]; unread: number };
  packages: { available: boolean; rows: Member360Package[] };
  payments: { access: boolean; rows: Member360Payment[] };
  points: { available: boolean; balance: number; recent: Member360PointRow[] };
  preview: PreviewItem[];
};

/** Bypass preview (`?bypass=admin`): one realistic member with something in every section. */
export function sampleMember360(memberId: string): Member360Data {
  const member: Member360Member = {
    affiliation: "สายงานจำหน่ายและบริการลูกค้า / สำนักงานใหญ่",
    avatar_url: null,
    department: "กองบริการลูกค้า",
    email: "somchai.j@example.com",
    employee_code: "497901",
    employee_directory_id: "sample-directory-1",
    employee_match_detail: {},
    employee_match_status: "matched",
    full_name: "สมชาย ใจดี",
    handicap: 18.4,
    id: memberId,
    joined_at: "2025-02-01",
    line_id: "somchai.golf",
    member_code: "PEAGC-0006",
    member_type: "สมาชิกสามัญ",
    nickname: "ชาย",
    organization: "การไฟฟ้าส่วนภูมิภาค",
    phone: "0891000004",
    status: "active",
    user_id: "sample-user-6",
  };
  const upcomingLessons: Member360Booking[] = [
    { checkedInAt: null, coach: "โค้ชเอ", date: "2026-11-28", endTime: "18:30:00", id: "sb-1", program: "พื้นฐานวงสวิง", startTime: "17:30:00", status: "booked", title: "วงสวิงเหล็ก 7", venue: "สนามไดรฟ์ กฟภ." },
    { checkedInAt: null, coach: "โค้ชบี", date: "2026-12-05", endTime: "18:30:00", id: "sb-2", program: "การพัตต์", startTime: "17:30:00", status: "waitlist", title: "พัตต์ระยะสั้น", venue: "สนามไดรฟ์ กฟภ." },
  ];
  const upcomingEvents: Member360Registration[] = [
    { checkedInAt: null, date: "2026-12-20", eventId: "se-1", eventStatus: "open", fee: 1000, id: "sr-1", name: "ออกรอบประจำเดือน ธ.ค.", score: null, status: "pending_payment", venue: "สนามกอล์ฟ ธนาธร" },
  ];
  return {
    audit: [
      {
        action: "member.updated",
        actorName: "ผู้ดูแลชมรม",
        changes: [{ after: "089-100-0004", before: "081-234-5678", key: "phone", kind: "changed", label: "เบอร์โทร" }],
        createdAt: "2026-11-20T03:21:00Z",
        entityType: "members",
        id: "sa-1",
      },
      {
        action: "lesson_booking.created_by_member",
        actorName: "สมชาย ใจดี",
        changes: [],
        createdAt: "2026-11-18T12:05:00Z",
        entityType: "lesson_bookings",
        id: "sa-2",
      },
      {
        action: "payment.reviewed",
        actorName: "เจ้าหน้าที่การเงิน",
        changes: [{ after: "อนุมัติแล้ว", before: "รอตรวจ", key: "status", kind: "changed", label: "สถานะ" }],
        createdAt: "2026-10-27T02:40:00Z",
        entityType: "payment_records",
        id: "sa-3",
      },
      {
        action: "member.approved",
        actorName: "ผู้ดูแลชมรม",
        changes: [{ after: "ใช้งาน", before: "รอตรวจสอบ", key: "status", kind: "changed", label: "สถานะ" }],
        createdAt: "2025-02-01T04:00:00Z",
        entityType: "members",
        id: "sa-4",
      },
    ],
    credits: { available: true, balance: 6 },
    directory: {
      affiliation: "สายงานจำหน่ายและบริการลูกค้า / สำนักงานใหญ่",
      archived_at: null,
      association_member_code: "PEA-GC-0001",
      department: "กองบริการลูกค้า",
      employee_code: "497901",
      employment_status: "active",
      full_name: "นาย สมชาย ใจดี",
      id: "sample-directory-1",
      member_type: "สามัญ",
      membership_status: "active",
      position: "วิศวกร 7",
    },
    events: {
      past: [
        {
          checkedInAt: "2026-10-25T23:40:00Z",
          date: "2026-10-26",
          eventId: "se-0",
          eventStatus: "completed",
          fee: 1000,
          id: "sr-0",
          name: "ออกรอบประจำเดือน ต.ค.",
          score: { gross: 92, net: 74, points: 34, rank: 5, status: "published" },
          status: "checked_in",
          venue: "สนามกอล์ฟ ธนาธร",
        },
      ],
      upcoming: upcomingEvents,
    },
    lessons: {
      past: [
        { checkedInAt: "2026-11-14T10:32:00Z", coach: "โค้ชเอ", date: "2026-11-14", endTime: "18:30:00", id: "sb-0", program: "พื้นฐานวงสวิง", startTime: "17:30:00", status: "attended", title: "การจับไม้และท่ายืน", venue: "สนามไดรฟ์ กฟภ." },
        { checkedInAt: null, coach: "โค้ชเอ", date: "2026-11-07", endTime: "18:30:00", id: "sb-00", program: "พื้นฐานวงสวิง", startTime: "17:30:00", status: "no_show", title: "วงสวิงเหล็ก 7", venue: "สนามไดรฟ์ กฟภ." },
      ],
      upcoming: upcomingLessons,
    },
    loadError: null,
    member,
    membership: {
      available: true,
      daysLeft: 38,
      endsOn: "2026-12-31",
      hasPending: false,
      state: "active",
      terms: [{ endsOn: "2026-12-31", fee: 500, id: "st-1", startsOn: "2026-01-01", status: "active" }],
    },
    notifications: {
      rows: [
        { channel: "system", createdAt: "2026-11-21T01:00:00Z", id: "sn-1", readAt: null, sentAt: "2026-11-21T01:00:00Z", status: "sent", subject: "อีก 7 วันมีเรียน วงสวิงเหล็ก 7", type: "lesson_reminder" },
        { channel: "line", createdAt: "2026-10-27T02:41:00Z", id: "sn-2", readAt: "2026-10-27T05:00:00Z", sentAt: "2026-10-27T02:41:00Z", status: "sent", subject: "อนุมัติการชำระเงินค่าออกรอบแล้ว", type: "payment_update" },
      ],
      unread: 1,
    },
    packages: {
      available: true,
      rows: [{ creditsLeft: 6, creditsTotal: 10, expiresOn: "2027-03-31", id: "sp-1", name: "แพ็กเกจ 10 ครั้ง", status: "active" }],
    },
    payments: {
      access: true,
      rows: [
        { amount: 1000, createdAt: "2026-11-22T09:00:00Z", hasSlip: false, id: "spay-2", label: "ออกรอบประจำเดือน ธ.ค.", purpose: "event", reviewedAt: null, status: "pending" },
        { amount: 3500, createdAt: "2026-10-01T03:00:00Z", hasSlip: true, id: "spay-1", label: "แพ็กเกจ 10 ครั้ง", purpose: "lesson_package", reviewedAt: "2026-10-02T02:00:00Z", status: "approved" },
        { amount: 500, createdAt: "2026-01-05T03:00:00Z", hasSlip: true, id: "spay-0", label: "ค่าบำรุงปี 2569", purpose: "membership_fee", reviewedAt: "2026-01-06T02:00:00Z", status: "approved" },
      ],
    },
    points: {
      available: true,
      balance: 120,
      recent: [
        { amount: 10, date: "2026-11-14T10:32:00Z", id: "spt-2", reason: "มาเรียน 14 พ.ย." },
        { amount: -10, date: "2026-11-07T12:00:00Z", id: "spt-1", reason: "ขาดเรียน 7 พ.ย." },
        { amount: 30, date: "2026-10-25T23:40:00Z", id: "spt-0", reason: "เช็กอินออกรอบ ต.ค." },
      ],
    },
    preview: [
      { date: "2026-11-28", detail: "จองแล้ว", key: "lesson-sb-1", kind: "lesson", title: "วงสวิงเหล็ก 7", tone: "success" },
      { date: "2026-12-05", detail: "อยู่ในคิวสำรอง", key: "lesson-sb-2", kind: "lesson", title: "พัตต์ระยะสั้น", tone: "warning" },
      { date: "2026-12-20", detail: "รอชำระเงิน", key: "event-sr-1", kind: "event", title: "ออกรอบประจำเดือน ธ.ค.", tone: "warning" },
      { detail: "ต้องแนบสลิป", key: "payment-spay-2", kind: "payment", title: "ออกรอบประจำเดือน ธ.ค. 1,000 บาท", tone: "warning" },
      { detail: "ยังไม่ได้เปิดอ่าน", key: "notifications", kind: "notification", title: "แจ้งเตือนใหม่ 1 รายการ", tone: "info" },
    ],
  };
}
