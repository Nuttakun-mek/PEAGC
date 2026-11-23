import Link from "next/link";
import { GraduationCap } from "lucide-react";

import {
  type CourseExtras,
  type LessonsBase,
  type LoadIssue,
  type StaffName,
  countAnnouncementAcks,
  loadClosures,
  loadCourseExtras,
  loadLessonsBase,
  loadRoster,
  loadSlot,
  loadSlotList,
  loadSlotsBetween,
  loadStaffNames,
} from "@/app/admin/lessons/data";
import { LessonsAdminCalendar, LessonsAdminClosureList, LessonsAdminSlotList } from "@/components/lessons-admin-calendar";
import { LessonsAdminCoaches } from "@/components/lessons-admin-coaches";
import { LessonsAdminCourses } from "@/components/lessons-admin-courses";
import { LessonsAdminDrawer } from "@/components/lessons-admin-dialog";
import { SlotForm, phaseDetail, phaseInfo, sectionTitle } from "@/components/lessons-admin-fields";
import { LessonsAdminAnnouncement, LessonsAdminRules } from "@/components/lessons-admin-rules";
import { LessonsAdminSlotPanel } from "@/components/lessons-admin-slot-panel";
import { LessonsAdminWizard } from "@/components/lessons-admin-wizard";
import { LessonsOpenHash } from "@/components/lessons-open-hash";
import { CreatePanel } from "@/components/create-panel";
import { type BannerTone, LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonPrimary, card } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { appIcons } from "@/lib/icons";
import {
  type AdminLessonSlot,
  type CalendarQuery,
  type LessonsAdminTab,
  type MoveTarget,
  closureStatusMessage,
  coachHours,
  generatedStatusMessage,
  lessonsAdminHref,
  lessonsAdminTabs,
  moveTargets,
  parseCalendarQuery,
  parseLessonsTab,
} from "@/lib/lessons/admin";
import { MAX_GENERATED_SLOTS, addDays, bangkokDate, getBookingPhase } from "@/lib/lessons/booking";
import { formatMonthLabel, monthRange, weekRange } from "@/lib/lessons/calendar";
import { rpcErrorMessage } from "@/lib/lessons/errors";
import { defaultLessonRules } from "@/lib/lessons/rules";
import { lessonSampleData } from "@/lib/lessons/sample-data";
import type { LessonClosure, LessonRosterRow } from "@/lib/lessons/types";
import { collectLoadErrors, dbFailureMessages, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/** The list view starts this many days back (recent rounds still need attendance). */
const LIST_PAST_DAYS = 30;
const LIST_LIMIT = 300;
/** Rounds offered in "ย้ายไปรอบอื่น". */
const MOVE_WINDOW_DAYS = 60;

type AdminLessonsPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "announcement-saved": "บันทึกประกาศแล้ว",
  "attendance-missing": "กรุณาเลือกสถานะเข้าเรียน",
  "attendance-update-failed": "บันทึกการเช็กชื่อไม่สำเร็จ",
  "attendance-updated": "บันทึกการเช็กชื่อแล้ว",
  "booking-already-open": "ตอนนี้เปิดให้สมาชิกจองอยู่แล้ว",
  "booking-moved": "ย้ายผู้เรียนไปรอบใหม่แล้ว สมาชิกได้รับแจ้งเตือนในแอป",
  "booking-opened": "เปิดให้สมาชิกจองรอบเรียนแล้ว ตั้งแต่ตอนนี้",
  "booking-removed": "นำออกแล้ว คนในคิวสำรองลำดับถัดไปได้ที่นั่งแทน",
  "coach-archived": "เก็บผู้สอนถาวรแล้ว",
  "coach-created": "เพิ่มผู้สอนแล้ว",
  "coach-email-invalid": "อีเมลไม่ถูกต้อง",
  "coach-link-failed": "เชื่อมบัญชีผู้สอนไม่สำเร็จ",
  "coach-link-unavailable": "ยังไม่ได้ตั้งค่ากุญแจผู้ดูแลฐานข้อมูล (SUPABASE_SECRET_KEY) จึงเชื่อมบัญชีผู้สอนไม่ได้",
  "coach-login-linked": "เชื่อมบัญชีแล้ว ผู้สอนเข้าสู่ระบบแล้วเห็นตารางสอนของตัวเองได้เลย",
  "coach-login-not-found": "ไม่พบบัญชีที่ใช้อีเมลนี้ ให้ผู้สอนสมัครบัญชีด้วยอีเมลนี้ก่อน",
  "coach-login-taken": "บัญชีนี้เชื่อมกับผู้สอนคนอื่นอยู่แล้ว",
  "coach-login-unlinked": "ยกเลิกการเชื่อมบัญชีแล้ว",
  "coach-missing": "กรุณากรอกชื่อผู้สอน",
  "coach-not-found": "ไม่พบผู้สอนคนนี้",
  "coach-save-failed": "บันทึกผู้สอนไม่สำเร็จ",
  "coach-saved": "บันทึกผู้สอนแล้ว",
  "credits-adjust-failed": "ปรับเครดิตไม่สำเร็จ",
  "day-close-failed": "งดเรียนไม่สำเร็จ",
  "generate-nothing-new": "รอบในช่วงนี้มีอยู่แล้วทั้งหมด ไม่ได้สร้างรอบใหม่",
  "move-failed": "ย้ายรอบไม่สำเร็จ",
  "move-target-missing": "เลือกรอบที่จะย้ายไปก่อน",
  "package-archived": "เก็บแพ็กเกจถาวรแล้ว คนที่ซื้อไปแล้วยังใช้เครดิตได้",
  "package-created": "เพิ่มแพ็กเกจแล้ว",
  "package-credits-invalid": "จำนวนครั้งต้องเป็นจำนวนเต็ม 1–1,000",
  "package-days-invalid": "อายุการใช้ต้องเป็นจำนวนเต็ม 1–3,650 วัน",
  "package-limit-invalid": "จำนวนที่ซื้อได้ต่อคนต้องเป็นจำนวนเต็มตั้งแต่ 1 (หรือเว้นว่าง)",
  "package-missing": "กรุณากรอกชื่อแพ็กเกจ",
  "package-not-found": "ไม่พบแพ็กเกจนี้",
  "package-price-invalid": "ราคาไม่ถูกต้อง",
  "package-restored": "กู้คืนแพ็กเกจแล้ว สถานะ \"ปิดขาย\" เปลี่ยนเป็น \"เปิดขาย\" เมื่อพร้อม",
  "package-save-failed": "บันทึกแพ็กเกจไม่สำเร็จ",
  "package-saved": "บันทึกแพ็กเกจแล้ว",
  "program-archive-failed": "ลบคอร์สไม่สำเร็จ",
  "program-archived": "ลบคอร์สแล้ว (เก็บถาวร) รอบที่ยังไม่มีคนจองของคอร์สนี้ถูกลบไปด้วย กู้คืนได้ที่ \"คอร์สที่เก็บถาวร\"",
  "program-create-failed": "เพิ่มคอร์สเรียนไม่สำเร็จ",
  "program-created": "เพิ่มคอร์สเรียนแล้ว",
  "program-missing": "กรุณากรอกชื่อคอร์สเรียน",
  "program-not-found": "ไม่พบคอร์สเรียน",
  "program-restore-failed": "กู้คืนคอร์สไม่สำเร็จ",
  "program-restored": "กู้คืนคอร์สแล้ว สถานะเป็น \"ปิดใช้งาน\" เปลี่ยนเป็น \"ใช้งาน\" เมื่อพร้อมเปิดรับ",
  "program-update-failed": "บันทึกคอร์สเรียนไม่สำเร็จ",
  "program-updated": "บันทึกคอร์สเรียนแล้ว",
  "rules-saved": "บันทึกกติกาแล้ว",
  "settings-save-failed": "บันทึกไม่สำเร็จ",
  "settings-saved": "บันทึกช่วงเปิดจองแล้ว",
  "settings-window-invalid": "เวลาปิดจองต้องอยู่หลังเวลาเปิดจอง",
  "slot-already-cancelled": "รอบนี้ยกเลิกไปแล้ว",
  "slot-archive-failed": "ลบรอบเรียนไม่สำเร็จ",
  "slot-archive-has-bookings": "ลบรอบนี้ไม่ได้เพราะยังมีคนจองอยู่ ย้ายหรือนำผู้จองออกก่อน",
  "slot-archived": "ลบรอบเรียนออกจากตารางแล้ว",
  "slot-cancelled": "ยกเลิกรอบแล้ว ผู้จองได้คืนเครดิตและได้รับแจ้งเตือนในแอป",
  "slot-capacity-too-low": "ที่นั่งรวมคิวสำรองน้อยกว่าจำนวนคนที่จองอยู่",
  "slot-create-failed": "สร้างรอบเรียนไม่สำเร็จ",
  "slot-created": "สร้างรอบเรียนแล้ว",
  "slot-created-opened": "สร้างรอบเรียนแล้ว และเปิดให้สมาชิกจองได้เลย",
  "slot-missing": "กรุณากรอกข้อมูลรอบเรียนให้ครบ",
  "slot-not-found": "ไม่พบรอบเรียนนี้",
  "slot-time-invalid": "เวลาเลิกต้องหลังเวลาเริ่ม",
  "slot-update-failed": "บันทึกรอบเรียนไม่สำเร็จ",
  "slot-updated": "บันทึกรอบเรียนแล้ว",
  "text-corrupted": "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) กรุณาพิมพ์ใหม่ก่อนบันทึก",
  "venue-archived": "เก็บสถานที่ถาวรแล้ว",
  "venue-created": "เพิ่มสถานที่แล้ว",
  "venue-missing": "กรุณากรอกชื่อสถานที่",
  "venue-not-found": "ไม่พบสถานที่นี้",
  "venue-numbers-invalid": "จำนวนช่อง (1–500) และคนต่อช่อง (1–100) ต้องเป็นจำนวนเต็ม",
  "venue-save-failed": "บันทึกสถานที่ไม่สำเร็จ",
  "venue-saved": "บันทึกสถานที่แล้ว",
};

const conflictWords: Record<string, string> = { coach: "ผู้สอน", venue: "สถานที่" };

function statusText(status: string, notBookableYet: string) {
  if (status === "slot-created") return `${statusMessages[status]}${notBookableYet}`;
  if (statusMessages[status]) return statusMessages[status];
  const [key, ...rest] = status.split(":");
  const value = rest.join(":");
  switch (key) {
    case "generated":
      return generatedStatusMessage(status, notBookableYet);
    case "day-closed":
      return closureStatusMessage(status);
    case "generate-invalid":
    case "rules-invalid":
    case "credits-invalid":
      return value || null;
    case "rpc":
      return rpcErrorMessage(value);
    case "credits-adjusted": {
      const [delta, remaining] = rest.map(Number);
      return `${delta > 0 ? `เติมเครดิต ${delta}` : `หักเครดิต ${Math.abs(delta)}`} ครั้งแล้ว แพ็กเกจนั้นเหลือ ${remaining} ครั้ง สมาชิกได้รับแจ้งเตือนในแอป`;
    }
    case "program-archive-blocked":
      return `ยังลบคอร์สนี้ไม่ได้ เพราะมี ${value} รอบที่กำลังจะมาถึงและยังมีคนจองอยู่ ย้ายหรือนำผู้จองออกจากรอบเหล่านั้นก่อน`;
    case "slot-capacity-below-seats":
      return `ลดที่นั่งให้น้อยกว่า ${value} คนไม่ได้ เพราะมีคนได้ที่นั่งแล้ว ${value} คน ย้ายหรือนำผู้เรียนออกก่อน`;
    case "slot-waitlist-below-queue":
      return `ลดคิวสำรองให้น้อยกว่า ${value} คนไม่ได้ เพราะมีคนรออยู่ในคิว ${value} คน`;
    case "slot-saved-conflict":
      return `บันทึกแล้ว แต่เวลาชนกับรอบอื่นของ${value.split("+").map((kind) => conflictWords[kind] ?? kind).join("และ")}เดียวกัน ตรวจในปฏิทินอีกครั้ง`;
    default:
      return null;
  }
}

function bannerTone(status: string): BannerTone {
  const key = status.split(":")[0];
  if (["day-closed", "credits-adjusted", "coach-login-linked", "coach-login-unlinked", "qr-rotated", "generated"].includes(key)) return "success";
  if (["slot-saved-conflict", "slot-already-cancelled", "generate-nothing-new"].includes(key)) return "warning";
  if (["rpc", "coach-link-unavailable", "move-target-missing", "slot-capacity-below-seats", "slot-waitlist-below-queue"].includes(key)) return "error";
  return toneForStatus(status);
}

type PanelData = { moveTargets: MoveTarget[]; roster: LessonRosterRow[]; rosterFailed: boolean; slot: AdminLessonSlot };

function filterSlots(slots: AdminLessonSlot[], query: CalendarQuery) {
  return slots.filter(
    (slot) =>
      (!query.course || slot.program_id === query.course) &&
      (!query.coach || slot.coach_id === query.coach) &&
      (!query.venue || slot.venue_id === query.venue),
  );
}

export default async function AdminLessonsPage({ searchParams }: AdminLessonsPageProps) {
  const params = await searchParams;
  const tab = parseLessonsTab(params.tab);
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/lessons",
    requiredRole: "admin",
    searchParams: params,
  });
  await requireAdminArea("lessons", access);

  const bypass = access.isBypass;
  const today = bangkokDate();
  const query = parseCalendarQuery(params, today);
  const memberQuery = (params.member ?? "").trim().slice(0, 60);
  const range = query.view === "month" ? monthRange(query.date) : weekRange(query.date);

  let base: LessonsBase = { coaches: [], issues: [], programs: [], rules: defaultLessonRules, v2: true, venues: [] };
  const issues: LoadIssue[] = [];
  let calendarSlots: AdminLessonSlot[] = [];
  let listFrom = addDays(today, -LIST_PAST_DAYS);
  let closures: LessonClosure[] = [];
  let panel: PanelData | null = null;
  let extras: CourseExtras = {
    activeEnrollments: 0,
    archivedPackages: [],
    archivedPrograms: [],
    issues: [],
    memberResults: [],
    packageStats: new Map(),
    packages: [],
    pendingEnrollments: [],
  };
  let hours = new Map<string, { hours: number; rounds: number }>();
  let staffNames = new Map<string, StaffName>();
  let acks: number | null = null;

  if (bypass) {
    const sample = lessonSampleData(today);
    const programName = new Map(sample.programs.map((program) => [program.id, program.name]));
    const slots: AdminLessonSlot[] = sample.slots.map((slot) => ({
      ...slot,
      program_id: slot.program_id ?? "",
      program_name: programName.get(slot.program_id ?? "") ?? null,
      title: slot.title ?? "รอบเรียน",
    }));
    base = { coaches: sample.coaches, issues: [], programs: sample.programs, rules: sample.rules, v2: true, venues: sample.venues };
    calendarSlots = query.view === "list" ? slots : slots.filter((slot) => slot.lesson_date >= range.from && slot.lesson_date <= range.to);
    closures = sample.closures;
    const selected = query.slot ? slots.find((slot) => slot.id === query.slot) : null;
    if (selected) {
      panel = { moveTargets: moveTargets(slots, selected, today), roster: sample.roster, rosterFailed: false, slot: selected };
    }
    const stats = new Map<string, { active: number; pending: number }>();
    sample.enrollments.forEach((row) => {
      if (!row.package_id) return;
      const entry = stats.get(row.package_id) ?? { active: 0, pending: 0 };
      if (row.status === "active") entry.active += 1;
      if (row.status === "pending_payment") entry.pending += 1;
      stats.set(row.package_id, entry);
    });
    extras = {
      activeEnrollments: sample.enrollments.filter((row) => row.status === "active").length,
      archivedPackages: [],
      archivedPrograms: [],
      issues: [],
      memberResults: memberQuery
        ? [{ employee_code: "500123", enrollments: sample.enrollments, full_name: "สมชาย ใจงาม", id: sample.enrollments[0].member_id, member_code: "PEAGC-0012", nickname: "ชาย", phone: "0890000001" }]
        : [],
      packageStats: stats,
      packages: sample.packages,
      pendingEnrollments: sample.enrollments.filter((row) => row.status === "pending_payment").map((row) => ({ ...row, member_name: "สมชาย ใจงาม (ชาย)" })),
    };
    hours = coachHours(slots);
  } else if (access.clubId) {
    const supabase = await createClient();
    const clubId = access.clubId;
    base = await loadLessonsBase(supabase, clubId);
    issues.push(...base.issues);

    if (tab === "calendar") {
      if (query.view === "list") {
        const list = await loadSlotList(supabase, clubId, base.v2, LIST_PAST_DAYS, LIST_LIMIT);
        calendarSlots = list.slots;
        listFrom = list.from;
        issues.push({ error: list.error, label: "รอบเรียน" });
      } else {
        const [loaded, closureResult] = await Promise.all([
          loadSlotsBetween(supabase, clubId, range.from, range.to, base.v2),
          base.v2 ? loadClosures(supabase, clubId, range.from, range.to) : Promise.resolve({ closures: [], error: null }),
        ]);
        calendarSlots = loaded.slots;
        closures = closureResult.closures;
        issues.push({ error: loaded.error, label: "รอบเรียน" }, { error: closureResult.error, label: "วันงดเรียน" });
      }

      if (query.slot) {
        if (base.v2) {
          // Offers that ran out are handed to the next person before the roster is read.
          const { error } = await supabase.rpc("expire_lesson_offers", { p_club_id: clubId });
          if (error) logDbError("admin.lessons expire_lesson_offers", error);
        }
        const found = calendarSlots.find((slot) => slot.id === query.slot) ?? (await loadSlot(supabase, clubId, query.slot, base.v2)).slot;
        if (found) {
          const [roster, upcoming] = await Promise.all([
            loadRoster(supabase, clubId, found, base.v2),
            base.v2 ? loadSlotsBetween(supabase, clubId, today, addDays(today, MOVE_WINDOW_DAYS), true) : Promise.resolve({ error: null, outdated: false, slots: [] }),
          ]);
          if (roster.error) logDbError("admin.lessons roster", roster.error);
          panel = { moveTargets: moveTargets(upcoming.slots, found, today), roster: roster.roster, rosterFailed: Boolean(roster.error), slot: found };
        }
      }
    }

    if (tab === "courses") {
      extras = await loadCourseExtras(supabase, clubId, base.v2, memberQuery);
      issues.push(...extras.issues);
    }

    if (tab === "coaches" && base.v2) {
      const month = monthRange(today);
      const [monthSlots, names] = await Promise.all([
        loadSlotsBetween(supabase, clubId, `${today.slice(0, 7)}-01`, month.lastOfMonth, true),
        loadStaffNames(supabase, clubId),
      ]);
      hours = coachHours(monthSlots.slots);
      staffNames = names.names;
      issues.push({ error: monthSlots.error, label: "ชั่วโมงสอน" });
      if (names.error) logDbError("admin.lessons staff names", names.error);
    }

    if (tab === "announcement") {
      const result = await countAnnouncementAcks(supabase, clubId, base.rules.announcement_version);
      acks = result.error ? null : result.count;
      if (result.error) logDbError("admin.lessons announcement acks", result.error);
    }
  }

  const v2 = base.v2;
  let loadError = collectLoadErrors("admin.lessons", issues);
  if (!v2 && !bypass) {
    loadError = { labels: ["ผู้สอน สถานที่ แพ็กเกจ เครดิต เช็กชื่อด้วย QR งดเรียนทั้งวัน", ...(loadError?.labels ?? [])], outdated: true };
  }

  const rules = bypass ? { ...base.rules, booking_open_at: base.rules.booking_open_at ?? "2026-01-01T01:00:00.000Z" } : base.rules;
  const bookingPhase = getBookingPhase(rules);
  const booking = { openAt: rules.booking_open_at, phase: bookingPhase };
  const phase = phaseInfo[bookingPhase];
  const activePrograms = base.programs.filter((program) => program.status === "active");
  const usesCredits = base.programs.some((program) => program.requires_package);
  const shownSlots = filterSlots(calendarSlots, query);

  const notBookableYet = bookingPhase !== "open" ? " · สมาชิกยังจองไม่ได้จนกว่าจะเปิดจอง (ตั้งได้ที่แท็บ \"กติกา\")" : "";
  const statusMessage = params.status ? statusText(params.status, notBookableYet) : null;
  const tabHref = (key: LessonsAdminTab, hash?: string) => lessonsAdminHref({ bypass, hash, tab: key });
  const tabCounts: Partial<Record<LessonsAdminTab, number>> = { coaches: v2 ? base.coaches.length : undefined, courses: base.programs.length };
  const createFailed = Boolean(params.status && /^(program-missing|program-create-failed|text-corrupted)/.test(params.status));
  const panelReturnTo = lessonsAdminHref({ ...query, bypass });
  const calendarReturnTo = lessonsAdminHref({ ...query, bypass, slot: "" });
  const AddIcon = appIcons.add;

  return (
    <main className="px-4 py-6 text-ink sm:px-6 lg:px-8">
      <LessonsOpenHash key={params.status ?? ""} />
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader
          actions={
            tab !== "create" ? (
              <Link className={buttonPrimary} href={tabHref("create")}>
                <AddIcon className="size-4" aria-hidden="true" />
                สร้างรอบเรียน
              </Link>
            ) : null
          }
          description="ปฏิทินรอบเรียน คอร์สและแพ็กเกจ ผู้สอน สถานที่ และกติกาการจอง"
          title="ตารางเรียน"
        />

        {statusMessage && params.status ? (
          <StatusBanner className="mt-5" floating tone={bannerTone(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        <LoadErrorBanner error={loadError} />

        {bypass ? (
          <StatusBanner className="mt-5" tone="warning">
            โหมดทดลอง: แสดงข้อมูลตัวอย่าง บันทึกจริงไม่ได้
          </StatusBanner>
        ) : null}

        <nav aria-label="ส่วนของหน้าตารางเรียน" className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex min-w-max gap-1 border-b border-line">
            {lessonsAdminTabs.map((item) => {
              const active = item.key === tab;
              const count = tabCounts[item.key];
              return (
                <li key={item.key}>
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`-mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition ${active ? "border-brand-600 text-brand-600" : "border-transparent text-ink-muted hover:border-line hover:text-brand-600"}`}
                    href={tabHref(item.key)}
                  >
                    {item.label}
                    {count !== undefined ? (
                      <span className={`rounded-full px-2 text-xs font-medium tabular-nums ${active ? "bg-brand-50 text-brand-600" : "bg-neutral-bg text-ink-muted"}`}>{count}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {tab === "calendar" ? (
          <div className="mt-6 grid gap-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-white px-4 py-3 shadow-card">
              <StatusBadge tone={phase.tone}>{phase.label}</StatusBadge>
              <span className="min-w-0 flex-1 text-sm text-ink-muted">{phaseDetail(bookingPhase, rules)}</span>
              <Link className="text-sm font-semibold text-brand-600 underline-offset-4 hover:underline" href={tabHref("settings", "booking-window")}>
                ตั้งช่วงเปิดจอง
              </Link>
            </div>

            <LessonsAdminCalendar
              allSlots={calendarSlots}
              bypass={bypass}
              closures={closures}
              coaches={base.coaches}
              programs={base.programs}
              query={query}
              returnTo={calendarReturnTo}
              slots={shownSlots}
              today={today}
              v2={v2}
              venues={base.venues}
            />

            {query.view === "list" ? (
              <LessonsAdminSlotList
                from={listFrom}
                limit={LIST_LIMIT}
                props={{ bypass, closures, coaches: base.coaches, programs: base.programs, query, slots: shownSlots, today, v2, venues: base.venues }}
              />
            ) : null}

            {query.view !== "list" && !calendarSlots.length ? (
              <section className={`${card} text-center`}>
                <p className="text-sm text-ink-muted">ช่วงนี้ยังไม่มีรอบเรียน สร้างรอบซ้ำทุกสัปดาห์ได้ในขั้นตอนเดียว</p>
                <Link className={`${buttonPrimary} mt-3`} href={tabHref("create")}>
                  <AddIcon className="size-4" aria-hidden="true" />
                  สร้างรอบเรียน
                </Link>
              </section>
            ) : null}

            {query.view !== "list" ? <LessonsAdminClosureList closures={closures} venues={base.venues} /> : null}

            {panel ? (
              <LessonsAdminDrawer closeHref={calendarReturnTo} title={`รอบ ${panel.slot.title}`}>
                <LessonsAdminSlotPanel
                  bypass={bypass}
                  closeHref={calendarReturnTo}
                  coaches={base.coaches}
                  cutoffHours={rules.change_cutoff_hours}
                  moveTargets={panel.moveTargets}
                  programs={base.programs}
                  qrHref={v2 ? `/admin/lessons/slots/${panel.slot.id}/qr${bypass ? "?bypass=admin" : ""}` : null}
                  returnTo={panelReturnTo}
                  roster={panel.roster}
                  rosterFailed={panel.rosterFailed}
                  slot={panel.slot}
                  v2={v2}
                  venues={base.venues}
                />
              </LessonsAdminDrawer>
            ) : null}
          </div>
        ) : null}

        {tab === "create" ? (
          activePrograms.length ? (
            <>
              <section className={`mt-6 ${card}`}>
                <h2 className={sectionTitle}>สร้างรอบซ้ำทุกสัปดาห์</h2>
                <p className="mb-4 mt-1 text-sm text-ink-muted">
                  เลือกคอร์ส ผู้สอน สถานที่ วันและเวลา แล้วดูตัวอย่างก่อนสร้าง รอบที่ชนกับรอบเดิมจะถูกข้าม สร้างได้ครั้งละไม่เกิน {MAX_GENERATED_SLOTS} รอบ
                </p>
                <LessonsAdminWizard
                  booking={booking}
                  bypass={bypass}
                  coaches={base.coaches}
                  cutoffHours={rules.change_cutoff_hours}
                  disabled={bypass}
                  programs={activePrograms}
                  today={today}
                  v2={v2}
                  venues={base.venues}
                />
              </section>
              <CreatePanel hint="สำหรับรอบพิเศษหรือรอบชดเชยวันเดียว" title="สร้างทีละรอบ">
                <SlotForm booking={booking} coaches={base.coaches} cutoffHours={rules.change_cutoff_hours} disabled={bypass} programs={activePrograms} v2={v2} venues={base.venues} />
              </CreatePanel>
            </>
          ) : (
            <section className={`mt-6 ${card} text-center`}>
              <p className="text-sm text-ink-muted">ต้องมีคอร์สที่สถานะ &quot;ใช้งาน&quot; อย่างน้อย 1 คอร์สก่อน จึงจะสร้างรอบเรียนได้</p>
              <Link className={`${buttonPrimary} mt-3`} href={tabHref("courses")}>
                <GraduationCap className="size-4" aria-hidden="true" />
                ไปที่คอร์สและแพ็กเกจ
              </Link>
            </section>
          )
        ) : null}

        {tab === "courses" ? (
          <LessonsAdminCourses
            bypass={bypass}
            coaches={base.coaches}
            createFailed={createFailed}
            extras={extras}
            memberQuery={memberQuery}
            programs={base.programs}
            v2={v2}
            venues={base.venues}
          />
        ) : null}

        {tab === "coaches" ? (
          <LessonsAdminCoaches
            bypass={bypass}
            coaches={base.coaches}
            hours={hours}
            monthLabel={`เดือน${formatMonthLabel(today)}`}
            staffNames={staffNames}
            v2={v2}
            venues={base.venues}
          />
        ) : null}

        {tab === "settings" ? <LessonsAdminRules bypass={bypass} phase={bookingPhase} rules={rules} usesCredits={usesCredits} v2={v2} /> : null}

        {tab === "announcement" ? <LessonsAdminAnnouncement acks={bypass ? 18 : acks} bypass={bypass} rules={rules} /> : null}
      </div>
    </main>
  );
}
