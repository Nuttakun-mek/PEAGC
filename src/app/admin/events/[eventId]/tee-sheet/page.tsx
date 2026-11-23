import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CLUB_NAME } from "@/components/brand";
import { EventsPrintButton } from "@/components/events-print-button";
import { StatusBanner } from "@/components/status-banner";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { eventOperationRoles, getStaffClub } from "@/lib/auth/staff";
import { UNSET, formatPhone, formatThaiDateLong, formatThaiTime } from "@/lib/display";
import { selectWithOptional } from "@/lib/events/db";
import { holdsSeat } from "@/lib/events/pairing";
import { loadClubHandicaps } from "@/lib/scoring/club-handicap";
import { scoringRoles } from "@/lib/scoring/data";
import { parseRules } from "@/lib/scoring/engine";
import { chooseHandicap, formatHandicap } from "@/lib/scoring/handicap";

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ bypass?: string }>;
};

type SheetRow = {
  flight: string | null;
  groupNo: number | null;
  handicap: number | null;
  name: string;
  phone: string | null;
  startHole: number | null;
  teeTime: string | null;
};

type SheetEvent = { event_date: string; name: string; tee_off_time: string | null; venue: string | null };

const sampleEvent: SheetEvent = { event_date: "2026-12-20", name: "ออกรอบประจำเดือน ธันวาคม", tee_off_time: "07:00", venue: "สนามกอล์ฟรอยัล" };

const sampleRows: SheetRow[] = [
  ["07:00", 1, "A", ["สมชาย ใจดี (ชาย)", 6.4, "0891000001"], ["วิชัย ทองดี", 8.1, "0891000002"], ["ประเสริฐ ศรีสุข (เสริฐ)", 9.0, "0891000003"], ["อนันต์ แก้วมณี", 10.2, null]],
  ["07:08", 2, "B", ["สุรชัย บุญมา", 14.5, "0891000005"], ["กิตติ พรหมมา (กิต)", 15.8, "0891000006"], ["ธนา วงศ์ใหญ่", 16.0, "0891000007"]],
  ["07:16", 3, "C", ["มานพ ใจงาม", 22.4, "0891000008"], ["สมศักดิ์ รุ่งเรือง", 24.0, "0891000009"], ["ไพโรจน์ สายทอง", null, "0891000010"]],
].flatMap(([teeTime, groupNo, flight, ...players]) =>
  (players as [string, number | null, string | null][]).map(([name, handicap, phone]) => ({
    flight: flight as string,
    groupNo: groupNo as number,
    handicap,
    name,
    phone,
    startHole: 1,
    teeTime: teeTime as string,
  })),
);

/** Print only the sheet: the admin menu and header stay on screen but not on paper. */
const printCss = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body * { visibility: hidden !important; }
  #tee-sheet, #tee-sheet * { visibility: visible !important; }
  #tee-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0; }
  #tee-sheet .no-print { display: none !important; }
  #tee-sheet tr { break-inside: avoid; }
}`;

export default async function TeeSheetPage({ params, searchParams }: PageProps) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: `/admin/events/${eventId}/tee-sheet`, requiredRole: "admin", searchParams: query });
  await requireAdminArea("events", access);

  let event: SheetEvent = sampleEvent;
  let rows: SheetRow[] = sampleRows;
  let unpaired = 0;

  if (!access.isBypass) {
    const staff = await getStaffClub([...new Set([...eventOperationRoles, ...scoringRoles])]);
    if (staff.status !== "ok") {
      return (
        <main className="px-4 py-6 sm:px-6">
          <StatusBanner className="mx-auto max-w-3xl" tone="error">หน้านี้เฉพาะกรรมการ ผู้อำนวยการการแข่งขัน หรือทีมงานกิจกรรม</StatusBanner>
        </main>
      );
    }
    const [{ data: eventData }, groupResult, registrationResult, { data: competition }] = await Promise.all([
      staff.supabase.from("events").select("name, event_date, tee_off_time, venue").eq("club_id", staff.clubId).eq("id", eventId).maybeSingle(),
      selectWithOptional<{ flight?: string | null; group_no: number; id: string; start_hole: number; tee_time: string | null }[]>(
        (columns) => staff.supabase.from("event_pairing_groups").select(columns).eq("event_id", eventId),
        "id, group_no, tee_time, start_hole, flight",
        "id, group_no, tee_time, start_hole",
        "tee_sheet.groups",
      ),
      selectWithOptional<unknown[]>(
        (columns) => staff.supabase.from("event_registrations").select(columns).eq("club_id", staff.clubId).eq("event_id", eventId).limit(1000),
        "id, status, guest_name, member_id, pairing_group_id, members(full_name, nickname, phone, handicap, official_handicap_index)",
        "id, status, guest_name, member_id, pairing_group_id, members(full_name, nickname, phone, handicap)",
        "tee_sheet.registrations",
      ),
      staff.supabase.from("competitions").select("rules").eq("event_id", eventId).maybeSingle(),
    ]);
    if (!eventData) notFound();
    event = eventData as SheetEvent;

    type Reg = {
      guest_name: string | null;
      id: string;
      member_id: string | null;
      members: { full_name: string; handicap: number | null; nickname: string | null; official_handicap_index?: number | null; phone: string | null } | null;
      pairing_group_id: string | null;
      status: string;
    };
    const registrations = ((registrationResult.data ?? []) as unknown as Reg[]).filter((row) => holdsSeat(row.status));
    const groups = new Map((groupResult.data ?? []).map((group) => [group.id, group]));
    const rules = parseRules(competition?.rules ?? null);
    const handicaps = await loadClubHandicaps(
      staff.supabase,
      staff.clubId,
      registrations.flatMap((row) => (row.member_id ? [{ id: row.member_id, manual: row.members?.handicap ?? null }] : [])),
      { before: event.event_date },
    );
    unpaired = registrations.filter((row) => !row.pairing_group_id || !groups.has(row.pairing_group_id)).length;
    rows = registrations
      .filter((row) => row.pairing_group_id && groups.has(row.pairing_group_id))
      .map((row) => {
        const group = groups.get(row.pairing_group_id!)!;
        const member = row.members;
        return {
          flight: group.flight ?? null,
          groupNo: group.group_no,
          handicap: chooseHandicap(rules.handicapSource === "official" ? "official" : "club", {
            club: row.member_id ? (handicaps.get(row.member_id)?.index ?? null) : null,
            manual: member?.handicap ?? null,
            official: member?.official_handicap_index ?? null,
          }).value,
          name: member ? (member.nickname ? `${member.full_name} (${member.nickname})` : member.full_name) : (row.guest_name ?? "แขก"),
          phone: member?.phone ?? null,
          startHole: group.start_hole,
          teeTime: group.tee_time,
        };
      });
  }

  rows.sort(
    (a, b) =>
      (a.teeTime ?? "99").localeCompare(b.teeTime ?? "99") ||
      (a.startHole ?? 0) - (b.startHole ?? 0) ||
      (a.groupNo ?? 0) - (b.groupNo ?? 0) ||
      (a.handicap ?? 99) - (b.handicap ?? 99),
  );
  const groupsInOrder = [...new Set(rows.map((row) => row.groupNo))];
  const backHref = access.isBypass ? "/admin/events?bypass=admin" : `/admin/events/${eventId}#pairing`;

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <style>{printCss}</style>
      <section className="mx-auto w-full max-w-5xl" id="tee-sheet">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Link className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-brand-600" href={backHref}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            จัดก๊วนและเวลาออกตัว
          </Link>
          <EventsPrintButton label="พิมพ์ใบออกตัว" />
        </div>
        {access.isBypass ? (
          <StatusBanner className="no-print mt-4" tone="warning">โหมดทดลอง: ข้อมูลตัวอย่าง</StatusBanner>
        ) : null}
        {unpaired ? (
          <StatusBanner className="no-print mt-4" tone="warning">
            ยังไม่จัดก๊วน <span className="tabular-nums">{unpaired}</span> คน ไม่อยู่ในใบนี้
          </StatusBanner>
        ) : null}

        <header className="mt-5 border-b-2 border-ink pb-3">
          <p className="text-sm font-medium text-ink-muted">{CLUB_NAME} · ใบออกตัว (Tee sheet)</p>
          <h1 className="text-h2 font-semibold text-ink">{event.name}</h1>
          <p className="text-sm text-ink-muted">
            {formatThaiDateLong(event.event_date)} · {event.venue?.trim() || "รอแจ้งสนาม"} · ผู้เล่น{" "}
            <span className="tabular-nums">{rows.length}</span> คน <span className="tabular-nums">{groupsInOrder.length}</span> ก๊วน
          </p>
        </header>

        {rows.length ? (
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink text-left text-xs text-ink-muted">
                <th className="py-1.5 pr-2 font-medium" scope="col">เวลา</th>
                <th className="py-1.5 pr-2 font-medium" scope="col">หลุมเริ่ม</th>
                <th className="py-1.5 pr-2 font-medium" scope="col">ก๊วน</th>
                <th className="py-1.5 pr-2 font-medium" scope="col">ไฟลท์</th>
                <th className="py-1.5 pr-2 font-medium" scope="col">ชื่อ</th>
                <th className="py-1.5 pr-2 text-right font-medium" scope="col">แต้มต่อ (HC)</th>
                <th className="py-1.5 font-medium" scope="col">โทร</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const firstOfGroup = index === 0 || rows[index - 1].groupNo !== row.groupNo;
                return (
                  <tr className={firstOfGroup && index ? "border-t-2 border-ink/50" : "border-t border-line"} key={`${row.groupNo}-${row.name}-${index}`}>
                    <td className="py-1.5 pr-2 font-semibold tabular-nums">{firstOfGroup ? formatThaiTime(row.teeTime, UNSET) : ""}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{firstOfGroup ? row.startHole : ""}</td>
                    <td className="py-1.5 pr-2 font-semibold tabular-nums">{firstOfGroup ? row.groupNo : ""}</td>
                    <td className="py-1.5 pr-2">{firstOfGroup ? (row.flight ?? "") : ""}</td>
                    <td className="py-1.5 pr-2 font-medium">{row.name}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{formatHandicap(row.handicap, "–")}</td>
                    <td className="py-1.5 tabular-nums">{row.phone ? formatPhone(row.phone) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="mt-6 rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-ink-muted">
            ยังไม่มีผู้เล่นในก๊วน จัดก๊วนในหน้ากิจกรรมก่อน
          </p>
        )}
      </section>
    </main>
  );
}
