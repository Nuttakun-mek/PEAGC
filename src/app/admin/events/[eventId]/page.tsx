import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, Clock, Layers, MapPin, Printer, Shuffle, UserX } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EventsCopyLinkButton } from "@/components/events-copy-link-button";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buttonClass,
  buttonPrimary,
  buttonSecondary,
  card,
  fieldInput,
  fieldInputClass,
  fieldLabel,
} from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import {
  UNSET,
  formatFee,
  formatPhone,
  formatThaiDateLong,
  formatThaiDateTime,
  formatThaiTime,
  phoneHref,
} from "@/lib/display";
import { selectWithOptional } from "@/lib/events/db";
import {
  holdsSeat,
  isConfirmed,
  registrationStatusLabels,
  summarizeRegistrations,
} from "@/lib/events/pairing";
import { appIcons } from "@/lib/icons";
import { eventStatusLabels } from "@/lib/labels";
import { loadClubHandicaps } from "@/lib/scoring/club-handicap";
import { formatHandicap } from "@/lib/scoring/handicap";
import { dbFailureMessages } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

import {
  assignPlayerToGroup,
  autoAssignPairings,
  autoFlightPairings,
  clearPairings,
  deletePairingGroup,
  generatePairingGroups,
  updateAttendance,
  updatePairingGroup,
} from "./actions";
import { PrizesSection } from "./prizes-section";

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ bypass?: string; q?: string; status?: string; view?: string }>;
};

type Group = {
  capacity: number;
  flight?: string | null;
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
  member_id: string | null;
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
  ...dbFailureMessages,
  "assign-failed": "จัดผู้เล่นเข้าก๊วนไม่สำเร็จ",
  "flights-generated": "จัดไฟลท์และก๊วนตามแต้มต่อแล้ว ย้ายผู้เล่นได้ในแต่ละก๊วน",
  "no-flight-ranges": "กติกาการแข่งขันยังไม่มีช่วงไฟลท์ เลือก “แบ่ง 3 ไฟลท์ A/B/C” หรือกำหนดไฟลท์ในหน้าสกอร์ก่อน",
  "prize-deleted": "ลบรางวัลแล้ว",
  "prize-duplicate": "มีรางวัลประเภทและอันดับนี้แล้ว",
  "prize-failed": "บันทึกรางวัลไม่สำเร็จ",
  "prize-invalid": "ประเภทรางวัลไม่ถูกต้อง",
  "prize-no-competition": "ตั้งกติกาการแข่งขันในหน้าสกอร์ก่อน",
  "prize-no-flight": "ใส่ชื่อไฟลท์สำหรับรางวัลชนะเลิศไฟลท์",
  "prize-no-winner": "เลือกผู้เล่นหรือใส่ชื่อแขกที่ได้รางวัล",
  "prize-nothing-verified": "ยังไม่มีการ์ดที่ยืนยันแล้ว จึงยังเติมผู้ชนะไม่ได้",
  "prize-saved": "บันทึกรางวัลแล้ว",
  "prize-winner-mismatch": "ผู้ได้รางวัลไม่ได้อยู่ในกิจกรรมนี้",
  "prizes-suggested": "เติมผู้ชนะจากตารางคะแนนแล้ว",
  "text-corrupted": "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) พิมพ์ใหม่ก่อนบันทึก",
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
  "invalid-tee-time": "เวลาไม่ถูกต้อง ใส่แบบ 07:30",
  "missing-registration": "ไม่พบรายการสมัคร",
  "no-groups": "ยังไม่มีก๊วน สร้างก๊วนก่อนจัดผู้เล่นอัตโนมัติ",
  "no-players": "ยังไม่มีผู้สมัครที่มีสิทธิ์ลงเล่น",
  "no-show-marked": "บันทึกว่าไม่มาแล้ว",
  "no-show-undone": "ยกเลิกสถานะไม่มาแล้ว",
  "not-pairable": "รายการนี้อยู่ในสถานะที่ทำรายการไม่ได้",
  "pairings-cleared": "นำผู้เล่นออกจากทุกก๊วนแล้ว",
  "player-moved": "ย้ายผู้เล่นแล้ว",
  "players-assigned": "จัดผู้เล่นเข้าก๊วนแล้ว",
  "players-assigned-partial": "จัดผู้เล่นได้บางส่วน ที่ว่างในก๊วนไม่พอ เพิ่มก๊วนแล้วจัดอีกครั้ง",
  "registration-cancelled": "ยกเลิกการสมัครแล้ว ถ้ามีคิวสำรอง คนถัดไปได้ที่นั่งแทน",
  "too-many-groups": "จำนวนก๊วนเกินกำหนด (สูงสุด 60 ก๊วน หรือ 36 ก๊วนสำหรับ Shotgun)",
};

const views = [
  { key: "seated", label: "ผู้เล่น" },
  { key: "unchecked", label: "ยังไม่เช็กอิน" },
  { key: "unpaid", label: "ค้างชำระ" },
  { key: "waitlist", label: "คิวสำรอง" },
  { key: "all", label: "ทั้งหมด" },
] as const;

/** Registration list columns from xl up (below that each row stacks with small labels). */
const rowGrid = "xl:grid-cols-[minmax(0,1.7fr)_8.5rem_minmax(0,1.4fr)_minmax(0,1.3fr)_auto]";

/** 15-minute steps unless the stored time is off the quarter hour (the browser would refuse to submit it). */
function teeTimeStep(value: string | null | undefined) {
  const match = value ? /^(\d{1,2}):(\d{2})/.exec(value) : null;
  return !match || Number(match[2]) % 15 === 0 ? 900 : 60;
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

function PhoneLink({ phone }: { phone: string | null | undefined }) {
  const href = phoneHref(phone);
  return href ? (
    <a className="text-brand-600 hover:underline" href={href}>
      {formatPhone(phone)}
    </a>
  ) : (
    <span className="text-ink-muted">{formatPhone(phone)}</span>
  );
}

export default async function EventOperationsPage({ params, searchParams }: PageProps) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: `/admin/events/${eventId}`,
    requiredRole: "admin",
    searchParams: query,
  });
  await requireAdminArea("events", access);

  if (access.isBypass || !access.clubId) {
    return (
      <main className="px-4 py-6 sm:px-6">
        <section className="mx-auto max-w-3xl">
          <StatusBanner tone="warning">
            หน้าผู้สมัคร จัดก๊วน และเช็กอิน ต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลจริง
          </StatusBanner>
          <Link className={`${buttonSecondary} mt-4 w-fit`} href="/admin/events?bypass=admin">
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับไปกิจกรรมออกรอบ
          </Link>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  const clubId = access.clubId;
  const [{ data: event }, { data: groupData }, { data: registrationData }] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, venue, event_date, tee_off_time, capacity, member_price, status")
      .eq("club_id", clubId)
      .eq("id", eventId)
      .maybeSingle(),
    selectWithOptional<Group[]>(
      (columns) => supabase.from("event_pairing_groups").select(columns).eq("event_id", eventId).order("group_no"),
      "id, group_no, tee_time, start_hole, capacity, note, flight",
      "id, group_no, tee_time, start_hole, capacity, note",
      "admin.event groups",
    ),
    supabase
      .from("event_registrations")
      .select(
        "id, status, guest_name, created_at, checked_in_at, pairing_group_id, promoted_at, member_id, members(full_name, nickname, member_code, phone, handicap)",
      )
      .eq("club_id", clubId)
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
      .limit(2000),
  ]);

  if (!event) {
    notFound();
  }

  const groups = (groupData ?? []) as Group[];
  const registrations = (registrationData ?? []) as unknown as Registration[];
  // แต้มต่อชมรม as of this event (falls back to the handicap the club entered).
  const clubHandicaps = await loadClubHandicaps(
    supabase,
    clubId,
    registrations.flatMap((row) => (row.member_id && holdsSeat(row.status) ? [{ id: row.member_id, manual: row.members?.handicap ?? null }] : [])),
    { before: event.event_date },
  );
  const handicapOf = (row: Registration) => {
    const club = row.member_id ? clubHandicaps.get(row.member_id)?.index : null;
    return club ?? row.members?.handicap ?? null;
  };
  const handicapText = (row: Registration) => formatHandicap(handicapOf(row), UNSET);
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
  const freeSeats = openGroups.reduce((sum, group) => sum + group.capacity - (playersByGroup.get(group.id)?.length ?? 0), 0);
  const visible = registrations.filter((row) => {
    if (!matchesView(row, view)) return false;
    if (!q) return true;
    return [row.members?.full_name, row.members?.nickname, row.members?.member_code, row.members?.phone, row.guest_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const viewCounts: Record<string, number> = {
    all: registrations.length,
    seated: summary.seats,
    unchecked: summary.seats - summary.checkedIn,
    unpaid: summary.unpaid,
    waitlist: summary.waitlist,
  };

  const stats = [
    { label: "ผู้เล่น", value: event.capacity ? `${summary.seats}/${event.capacity}` : String(summary.seats) },
    { label: "ยืนยันแล้ว", value: String(summary.confirmed) },
    { label: "ค้างชำระ", value: String(summary.unpaid) },
    { label: "คิวสำรอง", value: String(summary.waitlist) },
    { label: "เช็กอิน", value: `${summary.checkedIn}/${summary.seats}` },
    { label: "ยังไม่จัดก๊วน", value: String(summary.unpaired) },
  ];

  const ScoresIcon = appIcons.scores;
  const CheckInIcon = appIcons.checkIn;
  const DownloadIcon = appIcons.download;
  const MembersIcon = appIcons.members;
  const AddIcon = appIcons.add;
  const EditIcon = appIcons.edit;
  const SaveIcon = appIcons.save;
  const DeleteIcon = appIcons.delete;
  const SearchIcon = appIcons.search;
  const exportHref = (type: string) => `/admin/events/${event.id}/export?type=${type}`;
  const eventStatus = eventStatusLabels[event.status] ?? event.status;

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <section className="mx-auto w-full max-w-7xl">
        <Link
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-brand-600"
          href={`/admin/events?event=${event.id}#event-${event.id}`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          กิจกรรมออกรอบ
        </Link>
        <div className="mt-2">
          <PageHeader
            actions={
              <>
                <EventsCopyLinkButton path={`/events/${event.id}`} title={event.name} />
                <Link className={buttonPrimary} href={`/admin/events/${event.id}/scoring`}>
                  <ScoresIcon className="size-4" aria-hidden="true" />
                  สกอร์และสกอร์การ์ด
                </Link>
              </>
            }
            description={
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-ink-muted">
                <StatusBadge kind="event" status={event.status}>{eventStatus}</StatusBadge>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-4 text-ink-subtle" aria-hidden="true" />
                  {formatThaiDateLong(event.event_date)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4 text-ink-subtle" aria-hidden="true" />
                  ออกรอบ <span className="tabular-nums">{formatThaiTime(event.tee_off_time)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4 text-ink-subtle" aria-hidden="true" />
                  {event.venue?.trim() || "รอแจ้งสนาม"}
                </span>
                <span className="tabular-nums">ค่าสมัคร {formatFee(event.member_price)}</span>
                <span className="tabular-nums">{event.capacity ? `รับ ${event.capacity} คน` : "ไม่จำกัดจำนวน"}</span>
              </span>
            }
            title={event.name}
          />
        </div>

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={toneForStatus(query.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((item) => (
            <article className="rounded-xl border border-line bg-white p-4 shadow-card" key={item.label}>
              <p className="text-sm font-medium text-ink-muted">{item.label}</p>
              <p className="mt-1 text-kpi font-semibold tabular-nums text-ink">{item.value}</p>
            </article>
          ))}
        </div>

        {/* ---------- participants & check-in ---------- */}
        <section className="mt-6 scroll-mt-20 rounded-xl border border-line bg-white shadow-card" id="participants">
          <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink">
              <CheckInIcon className="size-5 text-ink-subtle" aria-hidden="true" />
              ผู้สมัครและเช็กอิน
            </h2>
            <div className="flex flex-wrap gap-2">
              <a className={buttonClass("secondary", "sm")} href={exportHref("participants")}>
                <DownloadIcon className="size-4" aria-hidden="true" />
                รายชื่อทั้งหมด
              </a>
              <a className={buttonClass("secondary", "sm")} href={exportHref("unpaid")}>
                <DownloadIcon className="size-4" aria-hidden="true" />
                รายชื่อค้างชำระ
              </a>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
            <nav aria-label="มุมมองรายชื่อ" className="flex gap-2 overflow-x-auto">
              {views.map((item) => (
                <Link
                  aria-current={view === item.key ? "page" : undefined}
                  className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition ${view === item.key ? "bg-brand-600 text-white" : "bg-canvas text-ink-muted hover:bg-brand-50 hover:text-brand-600"}`}
                  href={`/admin/events/${event.id}?view=${item.key}${q ? `&q=${encodeURIComponent(q)}` : ""}#participants`}
                  key={item.key}
                >
                  {item.label}
                  <span className={`tabular-nums ${view === item.key ? "text-white/80" : "text-ink-subtle"}`}>{viewCounts[item.key]}</span>
                </Link>
              ))}
            </nav>
            <form action={`/admin/events/${event.id}#participants`} className="flex items-end gap-2">
              <input name="view" type="hidden" value={view} />
              <label className="block min-w-0 flex-1 lg:w-72 lg:flex-none">
                <span className={fieldLabel}>ค้นหาผู้สมัคร</span>
                <input
                  className={fieldInputClass("sm")}
                  defaultValue={query.q ?? ""}
                  name="q"
                  placeholder="ชื่อ เลขสมาชิก หรือเบอร์โทร"
                  type="search"
                />
              </label>
              <button className={buttonSecondary} type="submit">
                <SearchIcon className="size-4" aria-hidden="true" />
                ค้นหา
              </button>
            </form>
          </div>

          {visible.length ? (
            <div aria-hidden="true" className={`hidden gap-4 border-b border-line bg-canvas px-5 py-2 text-xs font-medium text-ink-subtle xl:grid ${rowGrid}`}>
              <span>ผู้สมัคร</span>
              <span>โทร</span>
              <span>สถานะ</span>
              <span>ก๊วน</span>
              <span className="text-right">ทำรายการ</span>
            </div>
          ) : null}

          <ul className="divide-y divide-line">
            {visible.length ? (
              visible.map((row) => {
                const group = row.pairing_group_id ? groupById.get(row.pairing_group_id) : null;
                const seated = holdsSeat(row.status);

                return (
                  <li className={`grid scroll-mt-20 gap-2 px-5 py-3 xl:items-center xl:gap-4 ${rowGrid}`} id={`reg-${row.id}`} key={row.id}>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{playerName(row)}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        เลขสมาชิก <span className="tabular-nums">{row.members?.member_code ?? UNSET}</span> · แต้มต่อ{" "}
                        <span className="tabular-nums">{handicapText(row)}</span>
                      </p>
                    </div>

                    {/* Phone, status and group: one wrapped line under the name; from xl up each is its own column. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm xl:contents">
                      <div className="tabular-nums">
                        <span className="text-xs text-ink-subtle xl:hidden">โทร </span>
                        <PhoneLink phone={row.members?.phone} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <StatusBadge kind="registration" status={row.status}>
                          {registrationStatusLabels[row.status] ?? row.status}
                          {row.status === "waitlist" ? <span className="tabular-nums"> ลำดับ {waitlistOrder.get(row.id)}</span> : null}
                        </StatusBadge>
                        {row.promoted_at ? <StatusBadge tone="info">เลื่อนจากคิวสำรอง</StatusBadge> : null}
                        {row.checked_in_at ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                            เช็กอิน <span className="tabular-nums">{formatThaiDateTime(row.checked_in_at)}</span>
                          </span>
                        ) : null}
                      </div>
                      <div className="tabular-nums text-ink-muted">
                        {group ? (
                          <>
                            ก๊วน {group.group_no} · {formatThaiTime(group.tee_time, "ยังไม่กำหนดเวลา")} · หลุม {group.start_hole}
                          </>
                        ) : seated ? (
                          <span className="text-warning">ยังไม่จัดก๊วน</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 xl:justify-end">
                      {seated && !row.checked_in_at ? (
                        <form action={updateAttendance}>
                          <input name="eventId" type="hidden" value={event.id} />
                          <input name="registrationId" type="hidden" value={row.id} />
                          <input name="attendance" type="hidden" value="check_in" />
                          <SubmitButton className={`${buttonClass("primary", "sm")} min-w-28`} pendingText="กำลังเช็กอิน...">
                            <CheckInIcon className="size-4" aria-hidden="true" />
                            เช็กอิน
                          </SubmitButton>
                        </form>
                      ) : null}
                      {row.checked_in_at ? (
                        <form action={updateAttendance}>
                          <input name="eventId" type="hidden" value={event.id} />
                          <input name="registrationId" type="hidden" value={row.id} />
                          <input name="attendance" type="hidden" value="undo_check_in" />
                          <SubmitButton className={buttonClass("secondary", "sm")}>ยกเลิกเช็กอิน</SubmitButton>
                        </form>
                      ) : null}
                      {seated && !row.checked_in_at ? (
                        <form action={updateAttendance}>
                          <input name="eventId" type="hidden" value={event.id} />
                          <input name="registrationId" type="hidden" value={row.id} />
                          <input name="attendance" type="hidden" value="no_show" />
                          <ConfirmSubmitButton
                            className={buttonClass("secondary", "sm")}
                            confirmLabel="บันทึกว่าไม่มา"
                            message={`บันทึกว่า ${playerName(row)} ไม่มา?`}
                          >
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
                          <SubmitButton className={buttonClass("secondary", "sm")}>คืนสถานะ</SubmitButton>
                        </form>
                      ) : null}
                      {!["cancelled", "no_show", "checked_in"].includes(row.status) && !row.checked_in_at ? (
                        <form action={updateAttendance}>
                          <input name="eventId" type="hidden" value={event.id} />
                          <input name="registrationId" type="hidden" value={row.id} />
                          <input name="attendance" type="hidden" value="cancel" />
                          <ConfirmSubmitButton
                            className={buttonClass("danger", "sm")}
                            confirmLabel="ยกเลิกการสมัคร"
                            message={`ยกเลิกการสมัครของ ${playerName(row)}? ที่นั่งจะไปที่คิวสำรองคนถัดไป`}
                          >
                            ยกเลิกการสมัคร
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <p className="text-sm text-ink-muted">
                  {q
                    ? `ไม่พบผู้สมัครที่ตรงกับ “${query.q?.trim()}”`
                    : registrations.length
                      ? "ไม่มีรายชื่อในมุมมองนี้"
                      : "ยังไม่มีคนสมัครกิจกรรมนี้"}
                </p>
                {q || (registrations.length && view !== "all") ? (
                  <Link className={buttonClass("secondary", "sm")} href={`/admin/events/${event.id}?view=all#participants`}>
                    ดูรายชื่อทั้งหมด
                  </Link>
                ) : null}
              </li>
            )}
          </ul>
        </section>

        {/* ---------- pairing ---------- */}
        <section className="mt-8 grid scroll-mt-20 gap-4" id="pairing">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink">
              <MembersIcon className="size-5 text-ink-subtle" aria-hidden="true" />
              จัดก๊วนและเวลาออกตัว
            </h2>
            <div className="flex flex-wrap gap-2">
              <Link className={buttonClass("secondary", "sm")} href={`/admin/events/${event.id}/tee-sheet`}>
                <Printer className="size-4" aria-hidden="true" />
                พิมพ์ใบออกตัว
              </Link>
              <a className={buttonClass("secondary", "sm")} href={exportHref("pairing")}>
                <DownloadIcon className="size-4" aria-hidden="true" />
                ใบจัดก๊วน (CSV)
              </a>
            </div>
          </div>

          <form action={autoFlightPairings} className={`${card} grid gap-4`}>
            <input name="eventId" type="hidden" value={event.id} />
            <div>
              <h3 className="flex items-center gap-2 text-h3 font-semibold text-ink">
                <Layers className="size-4 text-ink-subtle" aria-hidden="true" />
                จัดกลุ่มอัตโนมัติตามแต้มต่อ
              </h3>
              <p className="mt-1 text-sm text-ink-muted">
                เรียงผู้เล่น <span className="font-semibold tabular-nums text-ink">{summary.seats}</span> คนตามแต้มต่อ แบ่งไฟลท์ แล้วจัดก๊วนละไม่เกินจำนวนที่กำหนดพร้อมเวลาออกตัว ก๊วนเดิมจะถูกแทนที่ ย้ายผู้เล่นได้ภายหลัง
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <label className="block sm:col-span-1 lg:col-span-2">
                <span className={fieldLabel}>แบ่งไฟลท์</span>
                <select className={fieldInput} defaultValue="thirds" name="flightMode">
                  <option value="thirds">3 ไฟลท์ A/B/C เท่าๆ กัน</option>
                  <option value="ranges">ตามช่วงไฟลท์ในกติกา</option>
                  <option value="single">ไม่แบ่งไฟลท์</option>
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>รูปแบบ</span>
                <select className={fieldInput} defaultValue="tee_times" name="mode">
                  <option value="tee_times">ทีออฟเรียงเวลา</option>
                  <option value="shotgun">Shotgun</option>
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>
                  เวลาแรก
                  <span aria-hidden="true" className="ml-0.5 text-danger">*</span>
                </span>
                <input
                  className={fieldInput}
                  defaultValue={event.tee_off_time?.slice(0, 5) ?? "07:00"}
                  name="firstTeeTime"
                  required
                  step={teeTimeStep(event.tee_off_time)}
                  type="time"
                />
              </label>
              <label className="block">
                <span className={fieldLabel}>ห่างกัน (นาที)</span>
                <input className={`${fieldInput} tabular-nums`} defaultValue={8} inputMode="numeric" max={60} min={1} name="intervalMinutes" type="number" />
              </label>
              <label className="block">
                <span className={fieldLabel}>คนต่อก๊วน</span>
                <input className={`${fieldInput} tabular-nums`} defaultValue={4} inputMode="numeric" max={8} min={1} name="groupSize" type="number" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink">
              <label className="inline-flex items-center gap-2">
                <input name="splitTee" type="checkbox" />
                ออกตัวพร้อมกันหลุม 1 และ 10
              </label>
              <label className="inline-flex items-center gap-2">
                <input name="confirmedOnly" type="checkbox" />
                เฉพาะคนที่ยืนยันหรือชำระเงินแล้ว
              </label>
              <ConfirmSubmitButton
                className={`${buttonPrimary} sm:ml-auto`}
                confirmLabel="จัดกลุ่มใหม่"
                message={`จัดไฟลท์และก๊วนใหม่ทั้งหมดตามแต้มต่อ? ก๊วนเดิม ${groups.length} ก๊วนจะถูกแทนที่`}
                title="จัดกลุ่มอัตโนมัติตามแต้มต่อ"
                tone="primary"
              >
                <Layers className="size-4" aria-hidden="true" />
                จัดกลุ่มตามแต้มต่อ
              </ConfirmSubmitButton>
            </div>
          </form>

          <div className="grid gap-4 lg:grid-cols-2">
            <form action={generatePairingGroups} className={`${card} grid content-start gap-4`}>
              <input name="eventId" type="hidden" value={event.id} />
              <h3 className="flex items-center gap-2 text-h3 font-semibold text-ink">
                <AddIcon className="size-4 text-ink-subtle" aria-hidden="true" />
                สร้างก๊วน
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="block">
                  <span className={fieldLabel}>รูปแบบ</span>
                  <select className={fieldInput} defaultValue="tee_times" name="mode">
                    <option value="tee_times">ทีออฟเรียงเวลา</option>
                    <option value="shotgun">Shotgun</option>
                  </select>
                </label>
                <label className="block">
                  <span className={fieldLabel}>
                    เวลาแรก
                    <span aria-hidden="true" className="ml-0.5 text-danger">*</span>
                  </span>
                  <input
                    className={fieldInput}
                    defaultValue={event.tee_off_time?.slice(0, 5) ?? "07:00"}
                    name="firstTeeTime"
                    required
                    step={teeTimeStep(event.tee_off_time)}
                    type="time"
                  />
                </label>
                <label className="block">
                  <span className={fieldLabel}>ห่างกัน (นาที)</span>
                  <input className={`${fieldInput} tabular-nums`} defaultValue={8} inputMode="numeric" max={60} min={1} name="intervalMinutes" type="number" />
                </label>
                <label className="block">
                  <span className={fieldLabel}>คนต่อก๊วน</span>
                  <input className={`${fieldInput} tabular-nums`} defaultValue={4} inputMode="numeric" max={8} min={1} name="groupSize" type="number" />
                </label>
              </div>
              <label className="block">
                <span className={fieldLabel}>จำนวนผู้เล่นที่จะรองรับ</span>
                <input
                  className={`${fieldInput} tabular-nums`}
                  inputMode="numeric"
                  min={1}
                  name="playerCount"
                  placeholder={`เว้นว่าง = ผู้เล่นตอนนี้ ${summary.seats} คน`}
                  type="number"
                />
              </label>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink">
                <label className="inline-flex items-center gap-2">
                  <input name="splitTee" type="checkbox" />
                  ออกตัวพร้อมกันหลุม 1 และ 10
                </label>
                <label className="inline-flex items-center gap-2">
                  <input name="replace" type="checkbox" />
                  ลบก๊วนเดิมทั้งหมดก่อนสร้าง
                </label>
              </div>
              <SubmitButton className={`${buttonPrimary} w-fit`} pendingText="กำลังสร้าง...">
                <AddIcon className="size-4" aria-hidden="true" />
                สร้างก๊วน
              </SubmitButton>
            </form>

            <div className={`${card} grid content-start gap-4`}>
              <h3 className="flex items-center gap-2 text-h3 font-semibold text-ink">
                <Shuffle className="size-4 text-ink-subtle" aria-hidden="true" />
                จัดผู้เล่นอัตโนมัติ
              </h3>
              <p className="text-sm text-ink-muted">
                จัดเฉพาะคนที่ยังไม่มีก๊วน <span className="font-semibold tabular-nums text-ink">{unpaired.length}</span> คน ลงที่ว่าง{" "}
                <span className="font-semibold tabular-nums text-ink">{freeSeats}</span> ที่ คนที่จัดไว้แล้วไม่ถูกย้าย
              </p>
              <form action={autoAssignPairings} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <input name="eventId" type="hidden" value={event.id} />
                <label className="block">
                  <span className={fieldLabel}>วิธีจัด</span>
                  <select className={fieldInput} defaultValue="balanced" name="strategy">
                    <option value="balanced">คละฝีมือ (แต้มต่อเฉลี่ยใกล้กัน)</option>
                    <option value="handicap">ฝีมือใกล้กันอยู่ก๊วนเดียวกัน</option>
                    <option value="registration">ตามลำดับการสมัคร</option>
                  </select>
                </label>
                <SubmitButton className={buttonPrimary} pendingText="กำลังจัด...">
                  <Shuffle className="size-4" aria-hidden="true" />
                  จัดอัตโนมัติ
                </SubmitButton>
                <label className="inline-flex items-center gap-2 text-sm text-ink sm:col-span-2">
                  <input name="confirmedOnly" type="checkbox" />
                  เฉพาะคนที่ยืนยันหรือชำระเงินแล้ว
                </label>
              </form>
              <form action={clearPairings} className="border-t border-line pt-4">
                <input name="eventId" type="hidden" value={event.id} />
                <ConfirmSubmitButton
                  className={`${buttonClass("danger", "sm")} w-fit`}
                  confirmLabel="ล้างการจัดก๊วน"
                  message="นำผู้เล่นออกจากทุกก๊วน? ก๊วนและเวลาออกตัวยังอยู่"
                >
                  ล้างการจัดก๊วนทั้งหมด
                </ConfirmSubmitButton>
              </form>
            </div>
          </div>

          {unpaired.length ? (
            <div className="rounded-xl border border-warning/20 bg-warning-bg p-4">
              <p className="text-sm font-semibold text-warning">
                ยังไม่จัดก๊วน <span className="tabular-nums">{unpaired.length}</span> คน
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {unpaired.map((row) => (
                  <li className="rounded-md bg-white px-2.5 py-1 text-sm text-ink" key={row.id}>
                    {playerName(row)} <span className="text-ink-subtle">· แต้มต่อ <span className="tabular-nums">{handicapText(row)}</span></span>
                    {!isConfirmed(row.status) ? <span className="text-warning"> · ค้างชำระ</span> : null}
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
                const handicaps = players.map((p) => handicapOf(p)).filter((h): h is number => typeof h === "number");
                const average = handicaps.length ? (handicaps.reduce((a, b) => a + b, 0) / handicaps.length).toFixed(1) : UNSET;

                return (
                  <article className="flex scroll-mt-20 flex-col rounded-xl border border-line bg-white shadow-card" id={`group-${group.id}`} key={group.id}>
                    <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                      <div>
                        <p className="flex items-center gap-2 font-semibold text-ink">
                          ก๊วน {group.group_no}
                          {group.flight ? <span className="rounded-md bg-brand-50 px-1.5 text-xs font-medium text-brand-600">ไฟลท์ {group.flight}</span> : null}
                        </p>
                        <p className="text-xs text-ink-subtle">
                          <span className="tabular-nums">{formatThaiTime(group.tee_time, "ยังไม่กำหนดเวลา")}</span> · หลุม{" "}
                          <span className="tabular-nums">{group.start_hole}</span> · แต้มต่อเฉลี่ย <span className="tabular-nums">{average}</span>
                        </p>
                      </div>
                      <StatusBadge tone={full ? "success" : "neutral"}>
                        <span className="tabular-nums">
                          {players.length}/{group.capacity}
                        </span>{" "}
                        คน
                      </StatusBadge>
                    </header>

                    <ul className="flex-1 divide-y divide-line px-4">
                      {players.map((row) => (
                        <li className="flex items-center justify-between gap-2 py-2" key={row.id}>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1 truncate text-sm font-semibold text-ink">
                              {row.checked_in_at ? (
                                <>
                                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                                  <span className="sr-only">เช็กอินแล้ว: </span>
                                </>
                              ) : null}
                              <span className="truncate">{playerName(row)}</span>
                            </p>
                            <p className="text-xs text-ink-subtle">
                              แต้มต่อ <span className="tabular-nums">{handicapText(row)}</span>
                              {!isConfirmed(row.status) ? <span className="text-warning"> · ค้างชำระ</span> : null}
                            </p>
                          </div>
                          <form action={assignPlayerToGroup} className="flex shrink-0 items-center gap-1">
                            <input name="eventId" type="hidden" value={event.id} />
                            <input name="registrationId" type="hidden" value={row.id} />
                            <label className="sr-only" htmlFor={`move-${row.id}`}>ย้าย {playerName(row)} ไปก๊วน</label>
                            <select className="h-9 rounded-lg border border-line bg-white px-2 text-ink outline-none focus:border-brand-600" defaultValue="" id={`move-${row.id}`} name="groupId">
                              <option value="">นำออก</option>
                              {openGroups
                                .filter((target) => target.id !== group.id)
                                .map((target) => (
                                  <option key={target.id} value={target.id}>
                                    ก๊วน {target.group_no}
                                  </option>
                                ))}
                            </select>
                            <button className={buttonClass("secondary", "sm")} type="submit">
                              ย้าย
                            </button>
                          </form>
                        </li>
                      ))}
                      {!players.length ? <li className="py-4 text-center text-sm text-ink-subtle">ยังไม่มีผู้เล่น</li> : null}
                    </ul>

                    {!full && unpaired.length ? (
                      <form action={assignPlayerToGroup} className="border-t border-line px-4 py-3">
                        <input name="eventId" type="hidden" value={event.id} />
                        <input name="groupId" type="hidden" value={group.id} />
                        <label className={fieldLabel} htmlFor={`add-${group.id}`}>เพิ่มผู้เล่นที่ยังไม่มีก๊วน</label>
                        <div className="mt-1.5 flex gap-2">
                          <select className={`${fieldInputClass("sm", { margin: false })} min-w-0`} id={`add-${group.id}`} name="registrationId" required>
                            {unpaired.map((row) => (
                              <option key={row.id} value={row.id}>
                                {playerName(row)} · แต้มต่อ {handicapText(row)}
                              </option>
                            ))}
                          </select>
                          <button className={`${buttonPrimary} shrink-0`} type="submit">
                            <AddIcon className="size-4" aria-hidden="true" />
                            เพิ่ม
                          </button>
                        </div>
                      </form>
                    ) : null}

                    <details className="group/edit border-t border-line px-4 py-3">
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-brand-600">
                        <EditIcon className="size-4" aria-hidden="true" />
                        แก้ไขเวลา หลุม จำนวนคน
                        <ChevronDown className="size-4 transition group-open/edit:rotate-180" aria-hidden="true" />
                      </summary>
                      <form action={updatePairingGroup} className="mt-3 grid grid-cols-3 gap-2">
                        <input name="eventId" type="hidden" value={event.id} />
                        <input name="groupId" type="hidden" value={group.id} />
                        <label className="block">
                          <span className={fieldLabel}>เวลา</span>
                          {/* No 15-minute step here: generated tee times run every few minutes (07:08, 07:16 …). */}
                          <input className={fieldInputClass("sm")} defaultValue={group.tee_time?.slice(0, 5) ?? ""} name="teeTime" type="time" />
                        </label>
                        <label className="block">
                          <span className={fieldLabel}>หลุมเริ่ม</span>
                          <input className={`${fieldInputClass("sm")} tabular-nums`} defaultValue={group.start_hole} inputMode="numeric" max={18} min={1} name="startHole" type="number" />
                        </label>
                        <label className="block">
                          <span className={fieldLabel}>จำนวนคน</span>
                          <input
                            className={`${fieldInputClass("sm")} tabular-nums`}
                            defaultValue={group.capacity}
                            inputMode="numeric"
                            max={8}
                            min={Math.max(1, players.length)}
                            name="capacity"
                            type="number"
                          />
                        </label>
                        <label className="col-span-3 block">
                          <span className={fieldLabel}>หมายเหตุ</span>
                          <input className={fieldInputClass("sm")} defaultValue={group.note ?? ""} name="note" placeholder="เช่น แคดดี้ / รถกอล์ฟ" />
                        </label>
                        <button className={`${buttonClass("primary", "sm")} col-span-3 w-fit`} type="submit">
                          <SaveIcon className="size-4" aria-hidden="true" />
                          บันทึก
                        </button>
                      </form>
                      <form action={deletePairingGroup} className="mt-3 border-t border-line pt-3">
                        <input name="eventId" type="hidden" value={event.id} />
                        <input name="groupId" type="hidden" value={group.id} />
                        <ConfirmSubmitButton
                          className={buttonClass("danger", "sm")}
                          confirmLabel="ลบก๊วน"
                          message={`ลบก๊วน ${group.group_no}? ผู้เล่นจะกลับไปอยู่ในรายชื่อที่ยังไม่จัด`}
                        >
                          <DeleteIcon className="size-4" aria-hidden="true" />
                          ลบก๊วนนี้
                        </ConfirmSubmitButton>
                      </form>
                    </details>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-ink-muted shadow-card">
              ยังไม่มีก๊วน กด “จัดกลุ่มตามแต้มต่อ” หรือกรอก “สร้างก๊วน” ด้านบน
            </p>
          )}
        </section>

        <PrizesSection
          eventId={event.id}
          flights={[...new Set(groups.map((group) => group.flight).filter((flight): flight is string => Boolean(flight)))]}
          players={registrations.filter((row) => holdsSeat(row.status)).map((row) => ({ id: row.id, name: playerName(row) }))}
          supabase={supabase}
        />
      </section>
    </main>
  );
}
