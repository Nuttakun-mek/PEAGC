import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  Flag,
  MapPin,
  Search,
  Shuffle,
  Trash2,
  UserCheck,
  UserX,
  UsersRound,
} from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { resolveAccess } from "@/lib/auth/access";
import {
  holdsSeat,
  isConfirmed,
  registrationStatusLabels,
  summarizeRegistrations,
} from "@/lib/events/pairing";
import { formatBangkokDateTime, formatBangkokDay } from "@/lib/lessons/booking";
import { createClient } from "@/lib/supabase/server";

import {
  assignPlayerToGroup,
  autoAssignPairings,
  clearPairings,
  deletePairingGroup,
  generatePairingGroups,
  updateAttendance,
  updatePairingGroup,
} from "./actions";
import { UNSET, formatPhone, orUnset } from "@/lib/display";

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ bypass?: string; q?: string; status?: string; view?: string }>;
};

type Group = {
  capacity: number;
  group_no: number;
  id: string;
  note: string | null;
  start_hole: number;
  tee_time: string | null;
};

type Registration = {
  checked_in_at: string | null;
  created_at: string;
  guest_name: string | null;
  id: string;
  members: {
    full_name: string;
    handicap: number | null;
    member_code: string | null;
    nickname: string | null;
    phone: string | null;
  } | null;
  pairing_group_id: string | null;
  promoted_at: string | null;
  status: string;
};

const statusMessages: Record<string, string> = {
  "assign-failed": "จัดผู้เล่นเข้าก๊วนไม่สำเร็จ",
  "attendance-failed": "บันทึกการเช็กอินไม่สำเร็จ",
  "check-in-undone": "ยกเลิกการเช็กอินแล้ว",
  "checked-in": "เช็กอินแล้ว",
  "group-deleted": "ลบก๊วนแล้ว ผู้เล่นในก๊วนกลับไปอยู่ในรายชื่อที่ยังไม่จัด",
  "group-full": "ก๊วนนี้เต็มแล้ว",
  "group-mismatch": "ก๊วนนี้ไม่ได้อยู่ในกิจกรรมนี้",
  "group-update-failed": "บันทึกข้อมูลก๊วนไม่สำเร็จ",
  "group-updated": "บันทึกข้อมูลก๊วนแล้ว",
  "groups-failed": "สร้างก๊วนไม่สำเร็จ",
  "groups-generated": "สร้างก๊วนและเวลาออกตัวแล้ว",
  "invalid-group-size": "จำนวนผู้เล่นต่อก๊วนต้องอยู่ระหว่าง 1-8 คน",
  "invalid-interval": "ระยะห่างเวลาออกตัวต้องอยู่ระหว่าง 1-60 นาที",
  "invalid-status": "คำสั่งไม่ถูกต้อง",
  "invalid-tee-time": "รูปแบบเวลาไม่ถูกต้อง ใช้ HH:MM",
  "missing-registration": "ไม่พบรายการสมัคร",
  "no-groups": "ยังไม่มีก๊วน สร้างก๊วนก่อนจัดผู้เล่นอัตโนมัติ",
  "no-players": "ยังไม่มีผู้สมัครที่มีสิทธิ์ลงเล่น",
  "no-show-marked": "บันทึกว่าไม่มาแสดงตัวแล้ว",
  "no-show-undone": "ยกเลิกสถานะไม่มาแสดงตัวแล้ว",
  "not-pairable": "รายการนี้อยู่ในสถานะที่ทำรายการไม่ได้",
  "pairings-cleared": "นำผู้เล่นออกจากทุกก๊วนแล้ว",
  "player-moved": "ย้ายผู้เล่นแล้ว",
  "players-assigned": "จัดผู้เล่นเข้าก๊วนอัตโนมัติแล้ว",
  "players-assigned-partial": "จัดผู้เล่นแล้วบางส่วน ที่ว่างในก๊วนไม่พอ เพิ่มก๊วนแล้วจัดอีกครั้ง",
  "registration-cancelled": "ยกเลิกการสมัครแล้ว ระบบเลื่อนรายชื่อสำรองคนถัดไปให้อัตโนมัติ",
  "too-many-groups": "จำนวนก๊วนเกินกำหนด (สูงสุด 60 ก๊วน หรือ 36 ก๊วนสำหรับ Shotgun)",
};

const views = [
  { key: "seated", label: "ผู้เล่น" },
  { key: "unchecked", label: "ยังไม่เช็กอิน" },
  { key: "unpaid", label: "ค้างชำระ" },
  { key: "waitlist", label: "สำรอง" },
  { key: "all", label: "ทั้งหมด" },
] as const;

const inputClass =
  "h-10 w-full rounded-md border border-[#d9d3e6] bg-white px-3 text-sm outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10";
const primaryButton =
  "flex h-10 items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white transition hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6]";
const outlineButton =
  "flex h-10 items-center justify-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-3 text-sm font-semibold text-[#722257] transition hover:bg-[#f8edf4]";

function chipClass(status: string) {
  if (status === "paid" || status === "registered" || status === "checked_in") return "bg-[#edf9f3] text-[#16794b]";
  if (status === "pending_payment" || status === "payment_review") return "bg-[#fff5d8] text-[#805300]";
  if (status === "waitlist") return "bg-[#eef2ff] text-[#3538cd]";
  if (status === "cancelled" || status === "no_show") return "bg-[#fdecec] text-[#9f1d1d]";
  return "bg-[#f1f3ef] text-[#6b6475]";
}

function playerName(row: Registration) {
  const member = row.members;
  if (!member) return row.guest_name ?? "ผู้สมัคร";
  return member.nickname ? `${member.full_name} (${member.nickname})` : member.full_name;
}

function matchesView(row: Registration, view: string) {
  switch (view) {
    case "seated":
      return holdsSeat(row.status);
    case "unchecked":
      return holdsSeat(row.status) && !row.checked_in_at;
    case "unpaid":
      return row.status === "pending_payment" || row.status === "payment_review";
    case "waitlist":
      return row.status === "waitlist";
    default:
      return true;
  }
}

export default async function EventOperationsPage({ params, searchParams }: PageProps) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: `/admin/events/${eventId}`,
    requiredRole: "admin",
    searchParams: query,
  });

  if (access.isBypass || !access.clubId) {
    return (
      <main className="px-4 py-6">
        <section className="mx-auto max-w-3xl">
          <StatusBanner tone="warning">
            หน้าจัดการผู้สมัคร จัดก๊วน และเช็กอิน ต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลจริง
          </StatusBanner>
          <Link className={`${outlineButton} mt-4 w-fit`} href="/admin/events?bypass=admin">
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับหน้ากิจกรรม
          </Link>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  const [{ data: event }, { data: groupData }, { data: registrationData }] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, venue, event_date, tee_off_time, capacity, member_price, status")
      .eq("club_id", access.clubId)
      .eq("id", eventId)
      .maybeSingle(),
    supabase
      .from("event_pairing_groups")
      .select("id, group_no, tee_time, start_hole, capacity, note")
      .eq("event_id", eventId)
      .order("group_no"),
    supabase
      .from("event_registrations")
      .select(
        "id, status, guest_name, created_at, checked_in_at, pairing_group_id, promoted_at, members(full_name, nickname, member_code, phone, handicap)",
      )
      .eq("club_id", access.clubId)
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
      .limit(2000),
  ]);

  if (!event) {
    notFound();
  }

  const groups = (groupData ?? []) as Group[];
  const registrations = (registrationData ?? []) as unknown as Registration[];
  const summary = summarizeRegistrations(registrations);
  const view = views.some((item) => item.key === query.view) ? query.view! : "seated";
  const q = query.q?.trim().toLowerCase() ?? "";
  const statusMessage = query.status ? statusMessages[query.status] : null;

  const waitlistOrder = new Map(
    registrations.filter((row) => row.status === "waitlist").map((row, index) => [row.id, index + 1]),
  );
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const playersByGroup = new Map<string, Registration[]>();
  for (const row of registrations) {
    if (row.pairing_group_id && holdsSeat(row.status)) {
      playersByGroup.set(row.pairing_group_id, [...(playersByGroup.get(row.pairing_group_id) ?? []), row]);
    }
  }
  const unpaired = registrations.filter((row) => holdsSeat(row.status) && !row.pairing_group_id);
  const openGroups = groups.filter((group) => (playersByGroup.get(group.id)?.length ?? 0) < group.capacity);
  const visible = registrations.filter((row) => {
    if (!matchesView(row, view)) return false;
    if (!q) return true;
    return [row.members?.full_name, row.members?.nickname, row.members?.member_code, row.members?.phone, row.guest_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const stats = [
    { label: "ผู้เล่น", value: event.capacity ? `${summary.seats}/${event.capacity}` : String(summary.seats) },
    { label: "ยืนยันแล้ว", value: String(summary.confirmed) },
    { label: "ค้างชำระ", value: String(summary.unpaid) },
    { label: "สำรอง", value: String(summary.waitlist) },
    { label: "เช็กอิน", value: `${summary.checkedIn}/${summary.seats}` },
    { label: "ยังไม่จัดก๊วน", value: String(summary.unpaired) },
  ];

  return (
    <main className="min-h-screen px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link className="inline-flex items-center gap-1 text-sm font-semibold text-[#8b5b7a] hover:text-[#722257]" href={`/admin/events?event=${event.id}`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              กิจกรรมทั้งหมด
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-[#722257] sm:text-3xl">{event.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#6b6475]">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-4" aria-hidden="true" />
                {formatBangkokDay(event.event_date)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-4" aria-hidden="true" />
                {event.tee_off_time ? `${event.tee_off_time.slice(0, 5)} น.` : UNSET}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-4" aria-hidden="true" />
                {event.venue ?? "ยังไม่ระบุสนาม"}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={primaryButton} href={`/admin/events/${event.id}/scoring`}>
              <Flag className="size-4" aria-hidden="true" />
              คะแนนและสแกนการ์ด
            </Link>
            {[
              { href: "participants", label: "รายชื่อทั้งหมด" },
              { href: "unpaid", label: "ค้างชำระ" },
              { href: "pairing", label: "ใบจัดก๊วน" },
            ].map((item) => (
              <a className={outlineButton} href={`/admin/events/${event.id}/export?type=${item.href}`} key={item.href}>
                <Download className="size-4" aria-hidden="true" />
                {item.label}
              </a>
            ))}
          </div>
        </div>

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={toneForStatus(query.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((item) => (
            <article className="rounded-lg border border-[#e6e2ee] bg-white p-4 shadow-[0_12px_30px_rgba(114,34,87,0.06)]" key={item.label}>
              <p className="text-xs font-semibold text-[#6b6475]">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold text-[#722257]">{item.value}</p>
            </article>
          ))}
        </div>

        {/* ---------- participants & check-in ---------- */}
        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white shadow-[0_18px_45px_rgba(114,34,87,0.08)]" id="participants">
          <div className="flex flex-col gap-3 border-b border-[#e6e2ee] p-4 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[#722257]">
              <UserCheck className="size-5" aria-hidden="true" />
              ผู้สมัครและเช็กอิน
            </h2>
            <form className="flex flex-col gap-2 sm:flex-row" action={`/admin/events/${event.id}#participants`}>
              <input name="view" type="hidden" value={view} />
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-3 size-4 text-[#6b6475]" aria-hidden="true" />
                <input className={`${inputClass} pl-9 sm:w-72`} defaultValue={query.q ?? ""} name="q" placeholder="ค้นหาชื่อ เลขสมาชิก หรือเบอร์โทร" />
              </label>
              <button className={primaryButton} type="submit">ค้นหา</button>
            </form>
          </div>

          <nav aria-label="มุมมองรายชื่อ" className="flex gap-2 overflow-x-auto border-b border-[#e6e2ee] px-4 py-3">
            {views.map((item) => (
              <Link
                aria-current={view === item.key ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${view === item.key ? "bg-[#722257] text-white" : "bg-[#f8f7fa] text-[#6b6475] hover:text-[#722257]"}`}
                href={`/admin/events/${event.id}?view=${item.key}${q ? `&q=${encodeURIComponent(q)}` : ""}#participants`}
                key={item.key}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <ul className="divide-y divide-[#efebf3]">
            {visible.length ? (
              visible.map((row) => {
                const group = row.pairing_group_id ? groupById.get(row.pairing_group_id) : null;
                const seated = holdsSeat(row.status);

                return (
                  <li className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between" id={`reg-${row.id}`} key={row.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#3f3a48]">{playerName(row)}</p>
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${chipClass(row.status)}`}>
                          {registrationStatusLabels[row.status] ?? row.status}
                          {row.status === "waitlist" ? ` #${waitlistOrder.get(row.id)}` : ""}
                        </span>
                        {row.checked_in_at ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[#edf9f3] px-2 py-0.5 text-xs font-semibold text-[#16794b]">
                            <CheckCircle2 className="size-3" aria-hidden="true" />
                            เช็กอิน {formatBangkokDateTime(row.checked_in_at)}
                          </span>
                        ) : null}
                        {row.promoted_at ? (
                          <span className="rounded-md bg-[#eef2ff] px-2 py-0.5 text-xs font-semibold text-[#3538cd]">เลื่อนจากสำรอง</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-[#6b6475]">
                        {row.members?.member_code ?? "ไม่มีเลขสมาชิก"} · HC {orUnset(row.members?.handicap)} · {formatPhone(row.members?.phone)}
                        {group ? ` · ก๊วน ${group.group_no} (${group.tee_time ? `${group.tee_time.slice(0, 5)} น.` : "ยังไม่ระบุเวลา"} หลุม ${group.start_hole})` : seated ? " · ยังไม่จัดก๊วน" : ""}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {seated && !row.checked_in_at ? (
                        <form action={updateAttendance}>
                          <input name="eventId" type="hidden" value={event.id} />
                          <input name="registrationId" type="hidden" value={row.id} />
                          <input name="attendance" type="hidden" value="check_in" />
                          <SubmitButton className={`${primaryButton} min-w-28`} pendingText="กำลังเช็กอิน...">
                            <UserCheck className="size-4" aria-hidden="true" />
                            เช็กอิน
                          </SubmitButton>
                        </form>
                      ) : null}
                      {row.checked_in_at ? (
                        <form action={updateAttendance}>
                          <input name="eventId" type="hidden" value={event.id} />
                          <input name="registrationId" type="hidden" value={row.id} />
                          <input name="attendance" type="hidden" value="undo_check_in" />
                          <SubmitButton className={outlineButton}>ยกเลิกเช็กอิน</SubmitButton>
                        </form>
                      ) : null}
                      {seated && !row.checked_in_at ? (
                        <form action={updateAttendance}>
                          <input name="eventId" type="hidden" value={event.id} />
                          <input name="registrationId" type="hidden" value={row.id} />
                          <input name="attendance" type="hidden" value="no_show" />
                          <ConfirmSubmitButton className={outlineButton} message={`บันทึกว่า ${playerName(row)} ไม่มาแสดงตัว?`}>
                            <UserX className="size-4" aria-hidden="true" />
                            ไม่มา
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                      {row.status === "no_show" ? (
                        <form action={updateAttendance}>
                          <input name="eventId" type="hidden" value={event.id} />
                          <input name="registrationId" type="hidden" value={row.id} />
                          <input name="attendance" type="hidden" value="undo_no_show" />
                          <SubmitButton className={outlineButton}>คืนสถานะ</SubmitButton>
                        </form>
                      ) : null}
                      {!["cancelled", "no_show", "checked_in"].includes(row.status) && !row.checked_in_at ? (
                        <form action={updateAttendance}>
                          <input name="eventId" type="hidden" value={event.id} />
                          <input name="registrationId" type="hidden" value={row.id} />
                          <input name="attendance" type="hidden" value="cancel" />
                          <ConfirmSubmitButton
                            className="flex h-10 items-center justify-center rounded-md px-3 text-sm font-semibold text-[#9f1d1d] hover:bg-[#fdecec]"
                            message={`ยกเลิกการสมัครของ ${playerName(row)}? ที่นั่งจะถูกมอบให้รายชื่อสำรองคนถัดไป`}
                          >
                            ยกเลิก
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="px-4 py-10 text-center text-sm text-[#6b6475]">ไม่มีรายชื่อในมุมมองนี้</li>
            )}
          </ul>
        </section>

        {/* ---------- pairing ---------- */}
        <section className="mt-6 grid gap-4" id="pairing">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[#722257]">
            <UsersRound className="size-5" aria-hidden="true" />
            จัดก๊วนและเวลาออกตัว
          </h2>

          <div className="grid gap-4 lg:grid-cols-2">
            <form action={generatePairingGroups} className="grid gap-3 rounded-lg border border-[#e6e2ee] bg-white p-4">
              <input name="eventId" type="hidden" value={event.id} />
              <h3 className="flex items-center gap-2 font-semibold text-[#3f3a48]">
                <Flag className="size-4 text-[#722257]" aria-hidden="true" />
                สร้างก๊วน
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="block text-sm">
                  <span className="font-semibold text-[#3f3a48]">รูปแบบ</span>
                  <select className={`${inputClass} mt-1`} defaultValue="tee_times" name="mode">
                    <option value="tee_times">ทีออฟเรียงเวลา</option>
                    <option value="shotgun">Shotgun</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-[#3f3a48]">เวลาแรก</span>
                  <input className={`${inputClass} mt-1`} defaultValue={event.tee_off_time?.slice(0, 5) ?? "07:00"} name="firstTeeTime" required type="time" />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-[#3f3a48]">ห่างกัน (นาที)</span>
                  <input className={`${inputClass} mt-1`} defaultValue={8} max={60} min={1} name="intervalMinutes" type="number" />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-[#3f3a48]">คน/ก๊วน</span>
                  <input className={`${inputClass} mt-1`} defaultValue={4} max={8} min={1} name="groupSize" type="number" />
                </label>
              </div>
              <label className="block text-sm">
                <span className="font-semibold text-[#3f3a48]">จำนวนผู้เล่นที่จะรองรับ</span>
                <input className={`${inputClass} mt-1`} min={1} name="playerCount" placeholder={`เว้นว่าง = ผู้เล่นปัจจุบัน ${summary.seats} คน`} type="number" />
              </label>
              <div className="flex flex-wrap gap-4 text-sm text-[#3f3a48]">
                <label className="inline-flex items-center gap-2">
                  <input name="splitTee" type="checkbox" />
                  ออกตัวพร้อมกันหลุม 1 และ 10
                </label>
                <label className="inline-flex items-center gap-2">
                  <input name="replace" type="checkbox" />
                  ลบก๊วนเดิมทั้งหมดก่อนสร้าง
                </label>
              </div>
              <SubmitButton className={`${primaryButton} w-fit`} pendingText="กำลังสร้าง...">สร้างก๊วน</SubmitButton>
            </form>

            <div className="grid content-start gap-3 rounded-lg border border-[#e6e2ee] bg-white p-4">
              <h3 className="flex items-center gap-2 font-semibold text-[#3f3a48]">
                <Shuffle className="size-4 text-[#722257]" aria-hidden="true" />
                จัดผู้เล่นอัตโนมัติ
              </h3>
              <p className="text-sm text-[#6b6475]">
                จัดเฉพาะผู้เล่นที่ยังไม่มีก๊วน {unpaired.length} คน ลงที่ว่าง {openGroups.reduce((sum, group) => sum + group.capacity - (playersByGroup.get(group.id)?.length ?? 0), 0)} ที่ ผู้เล่นที่จัดไว้แล้วจะไม่ถูกย้าย
              </p>
              <form action={autoAssignPairings} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <input name="eventId" type="hidden" value={event.id} />
                <label className="block text-sm">
                  <span className="font-semibold text-[#3f3a48]">วิธีจัด</span>
                  <select className={`${inputClass} mt-1`} defaultValue="balanced" name="strategy">
                    <option value="balanced">คละฝีมือ (แฮนดิแคปเฉลี่ยใกล้กัน)</option>
                    <option value="handicap">ฝีมือใกล้เคียงกันอยู่ก๊วนเดียวกัน</option>
                    <option value="registration">ตามลำดับการสมัคร</option>
                  </select>
                </label>
                <SubmitButton className={primaryButton} pendingText="กำลังจัด...">จัดอัตโนมัติ</SubmitButton>
                <label className="inline-flex items-center gap-2 text-sm text-[#3f3a48] sm:col-span-2">
                  <input name="confirmedOnly" type="checkbox" />
                  เฉพาะผู้ที่ยืนยัน/ชำระเงินแล้ว
                </label>
              </form>
              <form action={clearPairings}>
                <input name="eventId" type="hidden" value={event.id} />
                <ConfirmSubmitButton className={`${outlineButton} w-fit`} message="นำผู้เล่นออกจากทุกก๊วน? (ก๊วนและเวลาออกตัวยังอยู่)">
                  ล้างการจัดก๊วนทั้งหมด
                </ConfirmSubmitButton>
              </form>
            </div>
          </div>

          {unpaired.length ? (
            <div className="rounded-lg border border-[#efd9a6] bg-[#fff9ed] p-4">
              <p className="text-sm font-semibold text-[#805300]">ยังไม่จัดก๊วน {unpaired.length} คน</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {unpaired.map((row) => (
                  <li className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-[#3f3a48]" key={row.id}>
                    {playerName(row)} · HC {orUnset(row.members?.handicap)}
                    {!isConfirmed(row.status) ? " · ค้างชำระ" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {groups.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {groups.map((group) => {
                const players = playersByGroup.get(group.id) ?? [];
                const full = players.length >= group.capacity;
                const handicaps = players.map((p) => p.members?.handicap).filter((h): h is number => typeof h === "number");
                const average = handicaps.length ? (handicaps.reduce((a, b) => a + b, 0) / handicaps.length).toFixed(1) : UNSET;

                return (
                  <article className="flex flex-col rounded-lg border border-[#e6e2ee] bg-white" id={`group-${group.id}`} key={group.id}>
                    <header className="flex items-center justify-between gap-2 border-b border-[#efebf3] px-4 py-3">
                      <div>
                        <p className="font-semibold text-[#722257]">ก๊วน {group.group_no}</p>
                        <p className="text-xs text-[#6b6475]">
                          {group.tee_time?.slice(0, 5) ?? "ยังไม่กำหนดเวลา"} · หลุม {group.start_hole} · HC เฉลี่ย {average}
                        </p>
                      </div>
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${full ? "bg-[#edf9f3] text-[#16794b]" : "bg-[#f8f7fa] text-[#6b6475]"}`}>
                        {players.length}/{group.capacity}
                      </span>
                    </header>

                    <ul className="flex-1 divide-y divide-[#f3f0f6] px-4">
                      {players.map((row) => (
                        <li className="flex items-center justify-between gap-2 py-2" key={row.id}>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#3f3a48]">
                              {row.checked_in_at ? <CheckCircle2 className="mr-1 inline size-3.5 text-[#16794b]" aria-label="เช็กอินแล้ว" /> : null}
                              {playerName(row)}
                            </p>
                            <p className="text-xs text-[#6b6475]">
                              HC {orUnset(row.members?.handicap)}
                              {!isConfirmed(row.status) ? " · ค้างชำระ" : ""}
                            </p>
                          </div>
                          <form action={assignPlayerToGroup} className="flex shrink-0 items-center gap-1">
                            <input name="eventId" type="hidden" value={event.id} />
                            <input name="registrationId" type="hidden" value={row.id} />
                            <label className="sr-only" htmlFor={`move-${row.id}`}>ย้ายไปก๊วน</label>
                            <select className="h-8 rounded-md border border-[#d9d3e6] bg-white px-1 text-xs" defaultValue="" id={`move-${row.id}`} name="groupId">
                              <option value="">นำออก</option>
                              {openGroups
                                .filter((target) => target.id !== group.id)
                                .map((target) => (
                                  <option key={target.id} value={target.id}>
                                    ก๊วน {target.group_no}
                                  </option>
                                ))}
                            </select>
                            <button className="h-8 rounded-md border border-[#d9d3e6] px-2 text-xs font-semibold text-[#722257] hover:bg-[#f8edf4]" type="submit">
                              ย้าย
                            </button>
                          </form>
                        </li>
                      ))}
                      {!players.length ? <li className="py-4 text-center text-xs text-[#98a2b3]">ยังไม่มีผู้เล่น</li> : null}
                    </ul>

                    {!full && unpaired.length ? (
                      <form action={assignPlayerToGroup} className="flex gap-2 border-t border-[#efebf3] px-4 py-3">
                        <input name="eventId" type="hidden" value={event.id} />
                        <input name="groupId" type="hidden" value={group.id} />
                        <label className="sr-only" htmlFor={`add-${group.id}`}>เพิ่มผู้เล่น</label>
                        <select className={`${inputClass} h-9`} id={`add-${group.id}`} name="registrationId" required>
                          {unpaired.map((row) => (
                            <option key={row.id} value={row.id}>
                              {playerName(row)} · HC {orUnset(row.members?.handicap)}
                            </option>
                          ))}
                        </select>
                        <button className={`${primaryButton} h-9`} type="submit">เพิ่ม</button>
                      </form>
                    ) : null}

                    <details className="border-t border-[#efebf3] px-4 py-3">
                      <summary className="cursor-pointer text-xs font-semibold text-[#8b5b7a]">แก้ไขเวลา / หลุม / จำนวนคน</summary>
                      <form action={updatePairingGroup} className="mt-3 grid grid-cols-3 gap-2">
                        <input name="eventId" type="hidden" value={event.id} />
                        <input name="groupId" type="hidden" value={group.id} />
                        <label className="text-xs">
                          เวลา
                          <input className={`${inputClass} mt-1 h-9`} defaultValue={group.tee_time?.slice(0, 5) ?? ""} name="teeTime" type="time" />
                        </label>
                        <label className="text-xs">
                          หลุมเริ่ม
                          <input className={`${inputClass} mt-1 h-9`} defaultValue={group.start_hole} max={18} min={1} name="startHole" type="number" />
                        </label>
                        <label className="text-xs">
                          จำนวนคน
                          <input className={`${inputClass} mt-1 h-9`} defaultValue={group.capacity} max={8} min={Math.max(1, players.length)} name="capacity" type="number" />
                        </label>
                        <label className="col-span-3 text-xs">
                          หมายเหตุ
                          <input className={`${inputClass} mt-1 h-9`} defaultValue={group.note ?? ""} name="note" placeholder="เช่น แคดดี้ / รถกอล์ฟ" />
                        </label>
                        <button className={`${primaryButton} col-span-2 h-9`} type="submit">บันทึก</button>
                      </form>
                      <form action={deletePairingGroup} className="mt-2">
                        <input name="eventId" type="hidden" value={event.id} />
                        <input name="groupId" type="hidden" value={group.id} />
                        <ConfirmSubmitButton
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#9f1d1d]"
                          message={`ลบก๊วน ${group.group_no}? ผู้เล่นจะกลับไปอยู่ในรายชื่อที่ยังไม่จัด`}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          ลบก๊วนนี้
                        </ConfirmSubmitButton>
                      </form>
                    </details>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-[#d9d3e6] bg-white px-4 py-8 text-center text-sm text-[#6b6475]">
              ยังไม่มีก๊วน ใช้แบบฟอร์ม “สร้างก๊วน” ด้านบนเพื่อสร้างก๊วนและเวลาออกตัว
            </p>
          )}
        </section>
      </section>
    </main>
  );
}
