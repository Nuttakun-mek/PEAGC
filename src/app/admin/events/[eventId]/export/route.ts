import { NextResponse } from "next/server";

import { eventOperationRoles, getStaffClub } from "@/lib/auth/staff";
import { csvResponseInit, toCsv } from "@/lib/csv";
import { holdsSeat, registrationStatusLabels } from "@/lib/events/pairing";
import { formatBangkokDateTime } from "@/lib/lessons/booking";

const exportRoles = [...eventOperationRoles, "finance_officer", "auditor"];

type Member = {
  department: string | null;
  email: string | null;
  employee_code: string | null;
  full_name: string;
  handicap: number | null;
  member_code: string | null;
  nickname: string | null;
  phone: string | null;
};

type Row = {
  checked_in_at: string | null;
  created_at: string;
  event_pairing_groups: { group_no: number; start_hole: number; tee_time: string | null } | null;
  guest_name: string | null;
  id: string;
  members: Member | null;
  payment_records: { amount: number; status: string; updated_at: string }[] | null;
  status: string;
};

const paymentLabels: Record<string, string> = {
  approved: "อนุมัติ",
  pending: "รอตรวจ",
  refunded: "คืนเงิน",
  rejected: "ไม่อนุมัติ",
  review: "กำลังตรวจ",
};

function latestPayment(row: Row) {
  return [...(row.payment_records ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

function paymentLabel(row: Row, payment: ReturnType<typeof latestPayment>, memberPrice: number) {
  if (payment) return paymentLabels[payment.status] ?? payment.status;
  if (row.status === "paid") return paymentLabels.approved;
  if (row.status === "payment_review") return paymentLabels.review;
  return memberPrice > 0 ? "ยังไม่แนบหลักฐาน" : "ไม่มีค่าใช้จ่าย";
}

/**
 * CSV exports for one event. `?type=`
 *   participants (default) - everyone, including waitlist/cancelled, with payment state
 *   unpaid                 - seat holders whose payment is not approved yet (follow-up list)
 *   pairing                - tee sheet ordered by group, for the starter / caddie master
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const type = new URL(request.url).searchParams.get("type") ?? "participants";
  const staff = await getStaffClub(exportRoles);

  if (staff.status === "anonymous") {
    return NextResponse.redirect(new URL(`/login?next=/admin/events/${eventId}`, request.url));
  }
  if (staff.status === "forbidden") {
    return new NextResponse("ไม่มีสิทธิ์เข้าถึง", { status: 403 });
  }

  const [{ data: event }, { data, error }] = await Promise.all([
    staff.supabase
      .from("events")
      .select("name, event_date, member_price")
      .eq("club_id", staff.clubId)
      .eq("id", eventId)
      .maybeSingle(),
    staff.supabase
      .from("event_registrations")
      .select(
        "id, status, guest_name, created_at, checked_in_at, members(full_name, nickname, member_code, employee_code, department, phone, email, handicap), event_pairing_groups(group_no, tee_time, start_hole), payment_records(amount, status, updated_at)",
      )
      .eq("club_id", staff.clubId)
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
      .limit(2000),
  ]);

  if (!event) {
    return new NextResponse("ไม่พบกิจกรรม", { status: 404 });
  }
  if (error) {
    return new NextResponse("ดึงข้อมูลไม่สำเร็จ", { status: 500 });
  }

  const rows = (data ?? []) as unknown as Row[];
  const name = (row: Row) => row.members?.full_name ?? row.guest_name ?? "";
  const stamp = event.event_date;

  if (type === "pairing") {
    const seated = rows
      .filter((row) => holdsSeat(row.status))
      .sort((a, b) => {
        const ga = a.event_pairing_groups?.group_no ?? Number.MAX_SAFE_INTEGER;
        const gb = b.event_pairing_groups?.group_no ?? Number.MAX_SAFE_INTEGER;
        return ga - gb || a.created_at.localeCompare(b.created_at);
      });
    const body = toCsv(
      ["ก๊วน", "เวลาออกตัว", "หลุมเริ่ม", "ชื่อ-นามสกุล", "ชื่อเล่น", "เลขสมาชิก", "แฮนดิแคป", "โทร", "เช็กอิน"],
      seated.map((row) => [
        row.event_pairing_groups?.group_no ?? "ยังไม่จัด",
        row.event_pairing_groups?.tee_time?.slice(0, 5) ?? "",
        row.event_pairing_groups?.start_hole ?? "",
        name(row),
        row.members?.nickname ?? "",
        row.members?.member_code ?? "",
        row.members?.handicap ?? "",
        row.members?.phone ?? "",
        row.checked_in_at ? formatBangkokDateTime(row.checked_in_at) : "",
      ]),
    );
    return new NextResponse(body, csvResponseInit(`pairing-${stamp}.csv`));
  }

  const selected =
    type === "unpaid"
      ? // registration status mirrors payment review, and stays readable for staff without payment RLS access
        rows.filter((row) => row.status === "pending_payment" || row.status === "payment_review")
      : rows;

  const body = toCsv(
    [
      "ลำดับ", "ชื่อ-นามสกุล", "ชื่อเล่น", "เลขสมาชิก", "รหัสพนักงาน", "หน่วยงาน", "โทร", "อีเมล", "แฮนดิแคป",
      "สถานะการสมัคร", "สถานะการชำระ", "ยอดชำระ", "ก๊วน", "เวลาออกตัว", "เช็กอิน", "วันที่สมัคร",
    ],
    selected.map((row, index) => {
      const payment = latestPayment(row);
      return [
        index + 1,
        name(row),
        row.members?.nickname ?? "",
        row.members?.member_code ?? "",
        row.members?.employee_code ?? "",
        row.members?.department ?? "",
        row.members?.phone ?? "",
        row.members?.email ?? "",
        row.members?.handicap ?? "",
        registrationStatusLabels[row.status] ?? row.status,
        paymentLabel(row, payment, Number(event.member_price)),
        payment?.amount ?? "",
        row.event_pairing_groups?.group_no ?? "",
        row.event_pairing_groups?.tee_time?.slice(0, 5) ?? "",
        row.checked_in_at ? formatBangkokDateTime(row.checked_in_at) : "",
        formatBangkokDateTime(row.created_at),
      ];
    }),
  );

  return new NextResponse(body, csvResponseInit(`${type === "unpaid" ? "unpaid" : "participants"}-${stamp}.csv`));
}
