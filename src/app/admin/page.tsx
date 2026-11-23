import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveAccess } from "@/lib/auth/access";
import { getSessionRoleKeys, requireAdminArea } from "@/lib/auth/admin-area";
import { type AdminArea, canAccessArea } from "@/lib/auth/roles";
import { formatThaiDateShort, formatThaiDateWithWeekday, formatThaiTime } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { addDays, bangkokDate, getBookingPhase } from "@/lib/lessons/booking";
import { defaultModuleState, moduleCatalog } from "@/lib/modules";
import { getClubModules } from "@/lib/modules-server";
import { logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

type AdminPageProps = {
  searchParams: Promise<{ bypass?: string }>;
};

type UpcomingItem = {
  date: string;
  detail: string;
  fill?: { booked: number; capacity: number };
  href: string;
  id: string;
  kind: "event" | "lesson";
  time: string | null;
  title: string;
};

type Overview = {
  awaitingPayment: number;
  awaitingSlipReview: number;
  bookingPhase: ReturnType<typeof getBookingPhase>;
  events: number;
  lessonBookings: number;
  members: number;
  pendingMembers: number;
  upcoming: UpcomingItem[];
  upcomingOpenSlots: number;
};

const sampleOverview: Overview = {
  awaitingPayment: 3,
  awaitingSlipReview: 2,
  bookingPhase: "open",
  events: 3,
  lessonBookings: 8,
  members: 24,
  pendingMembers: 1,
  upcoming: [
    { date: addDays(bangkokDate(), 2), detail: "สนามฝึกซ้อม เอ", fill: { booked: 4, capacity: 6 }, href: "/admin/lessons?bypass=admin", id: "s1", kind: "lesson", time: "17:00", title: "พื้นฐานกอล์ฟ" },
    { date: addDays(bangkokDate(), 5), detail: "สนามกอล์ฟรอยัล", fill: { booked: 58, capacity: 72 }, href: "/admin/events?bypass=admin", id: "e1", kind: "event", time: "11:30", title: "ออกรอบประจำเดือน" },
  ],
  upcomingOpenSlots: 6,
};

function firstRelated<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * Card numbers use the same scope as the pages they link to (this club, rows not archived), so the
 * dashboard can no longer say "6" while the page behind it lists nothing.
 */
async function getOverview(clubId: string): Promise<Overview> {
  const supabase = await createClient();
  const head = { count: "exact", head: true } as const;
  const today = bangkokDate();
  const weekEnd = addDays(today, 7);
  const [members, events, slips, bookings, pendingMembers, awaitingPayment, openSlots, settings, weekEvents, weekSlots] = await Promise.all([
    supabase.from("members").select("id", head).eq("club_id", clubId).is("archived_at", null),
    supabase.from("events").select("id", head).eq("club_id", clubId).is("archived_at", null).gte("event_date", today),
    supabase.from("payment_records").select("id", head).eq("club_id", clubId).in("status", ["pending", "review"]).not("slip_file_id", "is", null),
    supabase.from("lesson_bookings").select("id, lesson_slots!inner(lesson_date)", head).eq("club_id", clubId).eq("status", "booked").gte("lesson_slots.lesson_date", today),
    supabase.from("members").select("id", head).eq("club_id", clubId).eq("status", "pending_verification").is("archived_at", null),
    supabase.from("event_registrations").select("id", head).eq("club_id", clubId).eq("status", "pending_payment"),
    supabase.from("lesson_slots").select("id", head).eq("club_id", clubId).eq("status", "open").is("archived_at", null).gte("lesson_date", today),
    supabase.from("lesson_booking_settings").select("booking_open_at, booking_close_at").eq("club_id", clubId).maybeSingle(),
    supabase
      .from("events")
      .select("id, name, event_date, tee_off_time, venue, status")
      .eq("club_id", clubId)
      .is("archived_at", null)
      .not("status", "in", "(cancelled,draft)")
      .gte("event_date", today)
      .lte("event_date", weekEnd)
      .order("event_date")
      .limit(20),
    supabase
      .from("lesson_slots")
      .select("id, title, lesson_date, start_time, venue, capacity, booked_count, lesson_programs(name)")
      .eq("club_id", clubId)
      .is("archived_at", null)
      .in("status", ["open", "closed"])
      .gte("lesson_date", today)
      .lte("lesson_date", weekEnd)
      .order("lesson_date")
      .order("start_time")
      .limit(40),
  ]);

  const count = (result: { count: number | null; error: { code?: string; message?: string } | null }, label: string) => {
    if (result.error) logDbError(`admin.dashboard ${label}`, result.error);
    return result.count ?? 0;
  };
  if (weekEvents.error) logDbError("admin.dashboard week events", weekEvents.error);
  if (weekSlots.error) logDbError("admin.dashboard week slots", weekSlots.error);

  const upcoming: UpcomingItem[] = [
    ...(weekEvents.data ?? []).map((event) => ({
      date: event.event_date as string,
      detail: (event.venue as string | null)?.trim() || "รอแจ้งสนาม",
      href: `/admin/events/${event.id}`,
      id: `event-${event.id}`,
      kind: "event" as const,
      time: (event.tee_off_time as string | null) ?? null,
      title: event.name as string,
    })),
    ...(weekSlots.data ?? []).map((slot) => {
      const program = firstRelated(slot.lesson_programs as { name: string } | { name: string }[] | null);
      return {
        date: slot.lesson_date as string,
        detail: (slot.venue as string | null)?.trim() || "รอแจ้งสถานที่",
        fill: { booked: Number(slot.booked_count ?? 0), capacity: Number(slot.capacity ?? 0) },
        href: "/admin/lessons",
        id: `slot-${slot.id}`,
        kind: "lesson" as const,
        time: (slot.start_time as string | null) ?? null,
        title: program?.name ? `${program.name} · ${slot.title}` : (slot.title as string),
      };
    }),
  ].sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));

  return {
    awaitingPayment: count(awaitingPayment, "awaiting payment"),
    awaitingSlipReview: count(slips, "slips"),
    bookingPhase: getBookingPhase(settings.data),
    events: count(events, "events"),
    lessonBookings: count(bookings, "lesson bookings"),
    members: count(members, "members"),
    pendingMembers: count(pendingMembers, "pending members"),
    upcoming,
    upcomingOpenSlots: count(openSlots, "open slots"),
  };
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin",
    requiredRole: "admin",
    searchParams: params,
  });
  await requireAdminArea("dashboard", access);
  const overview = access.isBypass || !access.clubId ? sampleOverview : await getOverview(access.clubId);
  const moduleState = access.isBypass
    ? defaultModuleState
    : await getClubModules(await createClient(), access.clubId);
  // Cards and lists only link to pages this person's roles may open (e.g. finance sees slips, not members).
  const roleKeys = access.isBypass ? null : await getSessionRoleKeys(access.clubId);
  const allowed = (area: AdminArea) => !roleKeys || canAccessArea(roleKeys, area);
  const suffix = access.isBypass ? "?bypass=admin" : "";
  const join = (path: string, query: string) => `${path}?${query}${access.isBypass ? "&bypass=admin" : ""}`;

  const todo = [
    allowed("payments") && overview.awaitingSlipReview > 0 && {
      detail: "สมาชิกแนบสลิปแล้ว รอตรวจยอดและอนุมัติ",
      href: join("/admin/payments", "stage=awaiting_review"),
      icon: appIcons.payments,
      title: `สลิปรอตรวจ ${overview.awaitingSlipReview} รายการ`,
      tone: "warning",
    },
    allowed("members") && overview.pendingMembers > 0 && {
      detail: "ข้อมูลไม่ตรงฐานสมาชิกสมาคม ต้องตรวจและอนุมัติเอง",
      href: join("/admin/members", "filter=pending_verification"),
      icon: appIcons.coach,
      title: `สมาชิกรออนุมัติ ${overview.pendingMembers} คน`,
      tone: "warning",
    },
    allowed("lessons") && overview.upcomingOpenSlots > 0 && overview.bookingPhase !== "open" && {
      detail:
        overview.bookingPhase === "before"
          ? "ตั้งเวลาเปิดจองไว้ล่วงหน้า สมาชิกยังจองไม่ได้จนถึงเวลานั้น"
          : overview.bookingPhase === "after"
            ? "ช่วงเปิดจองหมดแล้ว สมาชิกจองรอบเรียนไม่ได้"
            : "ยังไม่ได้ตั้งช่วงเปิดจอง สมาชิกเห็นรอบเรียนเป็น \"ยังไม่เปิด\"",
      href: join("/admin/lessons", "tab=settings") + "#booking-window",
      icon: appIcons.lessons,
      title: `รอบเรียน ${overview.upcomingOpenSlots} รอบ ยังจองไม่ได้`,
      tone: "danger",
    },
  ].filter(Boolean) as Array<{ detail: string; href: string; icon: (typeof appIcons)[keyof typeof appIcons]; title: string; tone: "danger" | "warning" }>;

  const stats = [
    { area: "members", href: `/admin/members${suffix}`, icon: appIcons.members, label: "สมาชิก", unit: "คน", value: overview.members },
    { area: "events", href: `/admin/events${suffix}`, icon: appIcons.events, label: "กิจกรรมที่จะถึง", unit: "กิจกรรม", value: overview.events },
    { area: "lessons", href: `/admin/lessons${suffix}`, icon: appIcons.lessons, label: "ที่นั่งเรียนที่จองแล้ว", unit: "ที่นั่ง", value: overview.lessonBookings },
    { area: "payments", href: join("/admin/payments", "stage=awaiting_payment"), icon: appIcons.payments, label: "ผู้สมัครที่ยังไม่ชำระ", unit: "ราย", value: overview.awaitingPayment },
  ].filter((stat) => allowed(stat.area as AdminArea));

  const today = bangkokDate();
  const summary = [
    `วันนี้ ${formatThaiDateWithWeekday(today)}`,
    `สมาชิกรออนุมัติ ${overview.pendingMembers.toLocaleString("th-TH")}`,
    `สลิปรอตรวจ ${overview.awaitingSlipReview.toLocaleString("th-TH")}`,
  ].join(" · ");

  const upcomingItems = overview.upcoming.filter((item) => allowed(item.kind === "event" ? "events" : "lessons"));
  const upcomingByDate = [...new Set(upcomingItems.map((item) => item.date))].map((date) => ({
    date,
    items: upcomingItems.filter((item) => item.date === date),
  }));

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <section className="mx-auto w-full max-w-6xl">
        <PageHeader description={summary} title="ภาพรวมวันนี้" />

        {access.isBypass ? (
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-warning/20 bg-warning-bg px-4 py-3 text-sm text-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>โหมดทดลอง: ตัวเลขในหน้านี้เป็นข้อมูลตัวอย่าง ต้องปิดโหมดนี้ก่อนเปิดใช้งานจริง</span>
          </div>
        ) : null}

        <section aria-labelledby="todo-title" className="mt-6 rounded-xl border border-line bg-white p-5 shadow-card">
          <h2 className="text-h2 font-semibold text-ink" id="todo-title">งานที่ต้องทำ</h2>
          {todo.length ? (
            <ul className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {todo.map((item) => (
                <li key={item.title}>
                  <Link
                    className={`flex h-full items-start gap-3 rounded-lg border p-4 transition hover:shadow-md ${item.tone === "danger" ? "border-danger/20 bg-danger-bg" : "border-warning/20 bg-warning-bg"}`}
                    href={item.href}
                  >
                    <item.icon className={`mt-0.5 size-5 shrink-0 ${item.tone === "danger" ? "text-danger" : "text-warning"}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{item.title}</span>
                      <span className="mt-0.5 block text-sm text-ink-muted">{item.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-sm text-success">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              ไม่มีงานค้าง
            </p>
          )}
        </section>

        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {stats.map((item) => (
            <Link
              className="rounded-xl border border-line bg-white p-4 shadow-card transition hover:border-brand-600/40 hover:shadow-md sm:p-5"
              href={item.href}
              key={item.label}
            >
              <p className="flex items-center gap-2 text-sm font-medium text-ink-muted">
                <item.icon className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                {item.label}
              </p>
              <p className="mt-2 text-kpi font-semibold tabular-nums text-ink">
                {item.value.toLocaleString("th-TH")}
                <span className="ml-1.5 text-sm font-medium text-ink-subtle">{item.unit}</span>
              </p>
            </Link>
          ))}
        </div>

        <section aria-labelledby="week-title" className="mt-5 rounded-xl border border-line bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-h2 font-semibold text-ink" id="week-title">7 วันข้างหน้า</h2>
            <p className="text-sm text-ink-subtle">รอบเรียนและกิจกรรม {upcomingItems.length.toLocaleString("th-TH")} รายการ</p>
          </div>
          {upcomingByDate.length ? (
            <ol className="mt-3 divide-y divide-line">
              {upcomingByDate.map((day) => (
                <li className="grid gap-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]" key={day.date}>
                  <p className="text-sm font-semibold text-ink">{day.date === today ? "วันนี้" : formatThaiDateShort(day.date)}</p>
                  <ul className="grid gap-1.5">
                    {day.items.map((item) => {
                      const Icon = item.kind === "event" ? appIcons.events : appIcons.lessons;
                      const full = item.fill && item.fill.capacity > 0 && item.fill.booked >= item.fill.capacity;
                      return (
                        <li key={item.id}>
                          <Link className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 transition hover:bg-brand-50" href={`${item.href}${suffix}`}>
                            <span className="w-16 shrink-0 text-sm tabular-nums text-ink-muted">{item.time ? formatThaiTime(item.time) : "—"}</span>
                            <Icon className="size-4 shrink-0 text-ink-subtle" aria-label={item.kind === "event" ? "กิจกรรม" : "รอบเรียน"} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.title}</span>
                            <span className="hidden text-sm text-ink-subtle md:inline">{item.detail}</span>
                            {item.fill ? (
                              <StatusBadge tone={full ? "warning" : "neutral"}>
                                <span className="tabular-nums">{item.fill.booked}/{item.fill.capacity}</span> ที่นั่ง
                              </StatusBadge>
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-canvas px-4 py-3">
              <p className="text-sm text-ink-muted">ยังไม่มีรอบเรียนหรือกิจกรรมใน 7 วันนี้</p>
              <Link className="text-sm font-semibold text-brand-600 hover:underline" href={join("/admin/lessons", "tab=create")}>
                สร้างรอบเรียน
              </Link>
            </div>
          )}
        </section>

        <section aria-labelledby="modules-title" className="mt-5 flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-ink" id="modules-title">โมดูลที่เปิดให้สมาชิกใช้</h2>
          <div className="flex flex-wrap items-center gap-2">
            {moduleCatalog.map((item) => (
              <StatusBadge key={item.key} kind="module" status={moduleState[item.key] ? "on" : "off"}>
                {item.label}
                <span className="sr-only">{moduleState[item.key] ? " (เปิด)" : " (ปิด)"}</span>
              </StatusBadge>
            ))}
            <Link className="text-sm font-semibold text-brand-600 hover:underline" href={`/admin/settings${suffix}`}>
              ตั้งค่า
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
