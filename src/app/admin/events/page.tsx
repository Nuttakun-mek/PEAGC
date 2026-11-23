import Link from "next/link";
import { ChevronDown, MapPin } from "lucide-react";

import { createEvent, setEventStatus, updateEvent } from "@/app/admin/events/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CreatePanel } from "@/components/create-panel";
import { LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buttonClass,
  buttonPrimary,
  fieldHint,
  fieldInput,
  fieldInputClass,
  fieldLabel,
  fieldTextarea,
} from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import {
  UNSET,
  formatFee,
  formatPhone,
  formatThaiDateShort,
  formatThaiTime,
  phoneHref,
} from "@/lib/display";
import { selectWithOptional } from "@/lib/events/db";
import { holdsSeat, registrationStatusLabels } from "@/lib/events/pairing";
import { pickFilter } from "@/lib/filters";
import { appIcons } from "@/lib/icons";
import { eventStatusLabels, eventStatusOptions, eventTypeLabels } from "@/lib/labels";
import { teeDescription } from "@/lib/scoring/courses";
import { defaultRules } from "@/lib/scoring/engine";
import { collectLoadErrors, dbFailureMessages } from "@/lib/supabase/errors";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

type AdminEventsPageProps = {
  searchParams: Promise<{
    bypass?: string;
    event?: string;
    filter?: string;
    q?: string;
    status?: string;
  }>;
};

type EventRow = {
  archived_at?: string | null;
  capacity: number | null;
  course_tee_id?: string | null;
  description: string | null;
  event_date: string;
  event_type: string;
  guest_price: number;
  id: string;
  includes: string | null;
  member_price: number;
  name: string;
  status: string;
  target_bureaus?: string[] | null;
  target_departments?: string[] | null;
  target_divisions?: string[] | null;
  target_sections?: string[] | null;
  target_work_lines?: string[] | null;
  tee_off_time: string | null;
  updated_at?: string | null;
  venue: string | null;
};

type TeeOption = {
  course_rating: number | null;
  golf_courses: { archived_at: string | null; name: string } | null;
  id: string;
  name: string;
  par: number[];
  slope_rating: number | null;
};

const sampleTeeOptions: TeeOption[] = [
  { course_rating: 71.2, golf_courses: { archived_at: null, name: "สนามกอล์ฟรอยัล" }, id: "sample-tee-2", name: "ทีขาว", par: defaultRules.pars, slope_rating: 125 },
  { course_rating: 69.8, golf_courses: { archived_at: null, name: "สนามกอล์ฟรอยัล" }, id: "sample-tee-3", name: "ทีแดง", par: defaultRules.pars, slope_rating: 118 },
];

type EventRegistrationRow = {
  event_id: string;
  id: string;
  members: {
    full_name: string;
    member_code: string | null;
    phone: string | null;
  } | null;
  status: string;
};

/** Org-unit columns of employee_directory; members copy the same values, and sign-up eligibility compares against them. */
type DirectoryUnitRow = {
  bureau: string | null;
  department: string | null;
  division: string | null;
  section: string | null;
  work_line: string | null;
};

/** The five eligibility boxes: form field, stored column on events, and the directory column it is matched against. */
const targetFields = [
  { column: "work_line", key: "targetWorkLines", label: "สายงาน", stored: "target_work_lines" },
  { column: "bureau", key: "targetBureaus", label: "สำนัก", stored: "target_bureaus" },
  { column: "division", key: "targetDivisions", label: "ฝ่าย", stored: "target_divisions" },
  { column: "department", key: "targetDepartments", label: "กอง", stored: "target_departments" },
  { column: "section", key: "targetSections", label: "แผนก", stored: "target_sections" },
] as const;

type TargetSuggestions = Partial<Record<(typeof targetFields)[number]["column"], string[]>>;

/** Keep the suggestion lists a sensible size for the page; typing still filters them. */
const MAX_SUGGESTIONS_PER_FIELD = 1000;

const sampleEvents: EventRow[] = [
  {
    capacity: 72,
    description: "กิจกรรมออกรอบประจำเดือนสำหรับสมาชิก",
    event_date: "2026-08-15",
    event_type: "golf_round",
    guest_price: 2800,
    id: "sample-event-1",
    includes: "ค่ากรีน แคดดี้ อาหารเย็น",
    member_price: 2200,
    name: "ออกรอบประจำเดือน PEAGC",
    status: "open",
    tee_off_time: "11:30",
    venue: "สนามกอล์ฟรอยัล",
  },
  {
    capacity: 48,
    description: "ร่างกิจกรรมการแข่งขันภายในชมรม",
    event_date: "2026-09-05",
    event_type: "tournament",
    guest_price: 3500,
    id: "sample-event-2",
    includes: "ค่ากรีน ถ้วยรางวัล อาหารเย็น",
    member_price: 3000,
    name: "การแข่งขันชมรม PEAGC",
    status: "draft",
    tee_off_time: "12:00",
    venue: "สนามกอล์ฟกรุงเทพ",
  },
];

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "create-failed": "สร้างกิจกรรมไม่สำเร็จ",
  created: "สร้างกิจกรรมแล้ว",
  "event-archived": "เก็บกิจกรรมถาวรแล้ว (ซ่อนจากรายการและหน้าสมาชิก) ดูหรือนำกลับได้ที่ตัวกรอง \"เก็บถาวร\"",
  "event-restored": "นำกิจกรรมกลับมาแล้ว",
  "event-status-changed": "เปลี่ยนสถานะกิจกรรมแล้ว",
  "missing-required": "กรอกชื่อกิจกรรมและวันที่ก่อนบันทึก",
  "text-corrupted": "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) พิมพ์ใหม่ก่อนบันทึก",
  "update-failed": "แก้ไขกิจกรรมไม่สำเร็จ",
  "update-not-found": "ไม่พบกิจกรรมนี้ หรือบัญชีนี้ไม่มีสิทธิ์แก้ไข",
  "update-not-saved": "ยังไม่ได้บันทึกการเปลี่ยนแปลง ลองอีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ",
  updated: "แก้ไขกิจกรรมแล้ว",
};

/** Quick status buttons offered for each current status. */
const quickStatusActions: Record<string, Array<{ confirm?: string; label: string; status: string }>> = {
  archived: [{ label: "นำกลับมาเป็นฉบับร่าง", status: "draft" }],
  cancelled: [
    { label: "เปิดรับสมัครอีกครั้ง", status: "open" },
    { confirm: "เก็บกิจกรรมนี้ถาวร? จะซ่อนจากรายการและหน้าสมาชิก (นำกลับได้ภายหลัง)", label: "เก็บถาวร", status: "archived" },
  ],
  closed: [
    { label: "เปิดรับสมัครอีกครั้ง", status: "open" },
    { label: "ทำเครื่องหมายว่าเสร็จสิ้น", status: "completed" },
    { confirm: "ยืนยันยกเลิกกิจกรรมนี้? สมาชิกจะเห็นว่ากิจกรรมถูกยกเลิก", label: "ยกเลิกกิจกรรม", status: "cancelled" },
    { confirm: "เก็บกิจกรรมนี้ถาวร? จะซ่อนจากรายการและหน้าสมาชิก (นำกลับได้ภายหลัง)", label: "เก็บถาวร", status: "archived" },
  ],
  completed: [
    { confirm: "เก็บกิจกรรมนี้ถาวร? จะซ่อนจากรายการและหน้าสมาชิก (นำกลับได้ภายหลัง)", label: "เก็บถาวร", status: "archived" },
  ],
  draft: [
    { label: "เปิดรับสมัคร", status: "open" },
    { confirm: "เก็บกิจกรรมนี้ถาวร? จะซ่อนจากรายการ (นำกลับได้ภายหลัง)", label: "เก็บถาวร", status: "archived" },
  ],
  open: [
    { label: "ปิดรับสมัคร", status: "closed" },
    { confirm: "ยืนยันยกเลิกกิจกรรมนี้? สมาชิกจะเห็นว่ากิจกรรมถูกยกเลิก", label: "ยกเลิกกิจกรรม", status: "cancelled" },
    { confirm: "เก็บกิจกรรมนี้ถาวร? จะซ่อนจากรายการและหน้าสมาชิก (นำกลับได้ภายหลัง)", label: "เก็บถาวร", status: "archived" },
  ],
};

/** Datalist id for one eligibility box (shared by the create form and every edit form). */
function suggestionListId(column: string) {
  return `event-target-${column}`;
}

/**
 * 15-minute steps for the tee-off picker, unless an older event was saved off the quarter hour:
 * a value that does not fit the step would block the browser from submitting the edit form.
 */
function teeTimeStep(value: string | null | undefined) {
  const match = value ? /^(\d{1,2}):(\d{2})/.exec(value) : null;
  return !match || Number(match[2]) % 15 === 0 ? 900 : 60;
}

function Required() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-danger">
      *
    </span>
  );
}

function BahtInput({
  defaultValue,
  disabled,
  label,
  name,
}: {
  defaultValue: number | undefined;
  disabled?: boolean;
  label: string;
  name: string;
}) {
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <span className="relative mt-1.5 block">
        <input
          className={`${fieldInputClass("md", { margin: false })} pr-14 tabular-nums`}
          // Empty is saved as 0 (free), so a free event shows the placeholder instead of a 0.
          defaultValue={defaultValue ? defaultValue : ""}
          disabled={disabled}
          inputMode="decimal"
          min="0"
          name={name}
          placeholder="0 = ฟรี"
          step="0.01"
          type="number"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-subtle">บาท</span>
      </span>
    </label>
  );
}

function EventForm({
  action,
  disabled,
  event,
  suggestions,
  teeOptions,
}: {
  action: (formData: FormData) => void;
  disabled?: boolean;
  event?: EventRow;
  suggestions: TargetSuggestions;
  /** null = the courses table is not available (older database): no course field. */
  teeOptions: TeeOption[] | null;
}) {
  const SaveIcon = appIcons.save;
  const teeOff = event?.tee_off_time?.slice(0, 5) ?? "";

  return (
    <form action={action} className="grid gap-4">
      {event ? <input name="eventId" type="hidden" value={event.id} /> : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_11rem_11rem]">
        <label className="block">
          <span className={fieldLabel}>
            ชื่อกิจกรรม
            <Required />
          </span>
          <input className={fieldInput} defaultValue={event?.name ?? ""} disabled={disabled} name="name" required />
        </label>
        <label className="block">
          <span className={fieldLabel}>ประเภท</span>
          <select className={fieldInput} defaultValue={event?.event_type ?? "golf_round"} disabled={disabled} name="eventType">
            <option value="golf_round">ออกรอบ</option>
            <option value="tournament">แข่งขัน</option>
            <option value="charity">การกุศล</option>
            <option value="training">ฝึกอบรมกอล์ฟ</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>สถานะ</span>
          <select className={fieldInput} defaultValue={event?.status ?? "draft"} disabled={disabled} name="status">
            {eventStatusOptions.map((value) => (
              <option key={value} value={value}>{eventStatusLabels[value]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={fieldLabel}>
            วันที่
            <Required />
          </span>
          <input className={fieldInput} defaultValue={event?.event_date ?? ""} disabled={disabled} name="eventDate" required type="date" />
        </label>
        <label className="block">
          <span className={fieldLabel}>เวลาออกรอบ</span>
          <input
            className={fieldInput}
            defaultValue={teeOff}
            disabled={disabled}
            name="teeOffTime"
            step={teeTimeStep(teeOff)}
            type="time"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={fieldLabel}>สนาม</span>
          <input className={fieldInput} defaultValue={event?.venue ?? ""} disabled={disabled} name="venue" placeholder="เว้นว่างได้ถ้ายังไม่ได้จอง" />
        </label>
      </div>

      {teeOptions ? (
        <label className="block">
          <span className={fieldLabel}>สนามและทีที่ใช้คิดสกอร์</span>
          <select className={fieldInput} defaultValue={event?.course_tee_id ?? ""} disabled={disabled} name="courseTeeId">
            <option value="">ยังไม่เลือก</option>
            {teeOptions.map((tee) => (
              <option key={tee.id} value={tee.id}>
                {tee.golf_courses?.name} · {teeDescription(tee)}
              </option>
            ))}
          </select>
          <span className={fieldHint}>
            ใช้พาร์ ลำดับความยาก (SI) Course rating และ Slope ของทีนี้เป็นค่าเริ่มต้นของกติกาการแข่งขัน ·{" "}
            <Link className="font-medium text-brand-600 hover:underline" href={disabled ? "/admin/events/courses?bypass=admin" : "/admin/events/courses"}>
              จัดการสนาม
            </Link>
          </span>
        </label>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel}>จำนวนรับ</span>
          <span className="relative mt-1.5 block">
            <input
              className={`${fieldInputClass("md", { margin: false })} pr-12 tabular-nums`}
              defaultValue={event?.capacity ?? ""}
              disabled={disabled}
              inputMode="numeric"
              min="0"
              name="capacity"
              placeholder="ไม่จำกัด"
              type="number"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-subtle">คน</span>
          </span>
        </label>
        <BahtInput defaultValue={event?.member_price} disabled={disabled} label="ค่าสมัครสำหรับสมาชิก" name="memberPrice" />
        <BahtInput defaultValue={event?.guest_price} disabled={disabled} label="ค่าสมัครสำหรับแขก" name="guestPrice" />
      </div>

      <label className="block">
        <span className={fieldLabel}>สิ่งที่รวมในค่าสมัคร</span>
        <input className={fieldInput} defaultValue={event?.includes ?? ""} disabled={disabled} name="includes" placeholder="เช่น ค่ากรีน แคดดี้ อาหารเย็น" />
      </label>

      <label className="block">
        <span className={fieldLabel}>รายละเอียด</span>
        <textarea
          className={fieldTextarea}
          defaultValue={event?.description ?? ""}
          disabled={disabled}
          name="description"
          placeholder="กำหนดการ การแต่งกาย จุดนัดพบ ฯลฯ"
          rows={4}
        />
      </label>

      <fieldset className="grid gap-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">ผู้มีสิทธิ์สมัคร</legend>
        <p className="-mt-1 text-xs text-ink-subtle">
          เว้นว่างทุกช่อง = สมาชิกทุกคนสมัครได้ · ใส่หลายค่าคั่นด้วยจุลภาค (,) · ชื่อต้องตรงกับฐานสมาชิกสมาคม ไม่อย่างนั้นจะไม่มีใครสมัครได้
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {targetFields.map((target) => (
            <label className="block" key={target.key}>
              <span className={fieldLabel}>{target.label}</span>
              <input
                autoComplete="off"
                className={fieldInput}
                defaultValue={event?.[target.stored]?.join(", ") ?? ""}
                disabled={disabled}
                list={suggestions[target.column]?.length ? suggestionListId(target.column) : undefined}
                name={target.key}
                placeholder="ทุกคน"
              />
            </label>
          ))}
        </div>
      </fieldset>

      <button className={`${buttonPrimary} w-full sm:w-fit`} disabled={disabled} type="submit">
        <SaveIcon className="size-4" aria-hidden="true" />
        {event ? "บันทึกการแก้ไข" : "สร้างกิจกรรม"}
      </button>
    </form>
  );
}

function distinctSorted(values: Array<string | null>) {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "th"))
    .slice(0, MAX_SUGGESTIONS_PER_FIELD);
}

export default async function AdminEventsPage({ searchParams }: AdminEventsPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/events",
    requiredRole: "admin",
    searchParams: params,
  });
  await requireAdminArea("events", access);
  const q = params.q?.trim() ?? "";
  // `filter` is the list filter; `status` carries the result of the last save. Older links put
  // the filter in `status`, so accept it there too when it is a real filter value.
  const selectedStatus = pickFilter(params.filter ?? params.status, eventStatusOptions);
  const showArchived = selectedStatus === "archived";
  let events = sampleEvents;
  let registrations: EventRegistrationRow[] = [];
  let suggestions: TargetSuggestions = {};
  let teeOptions: TeeOption[] | null = sampleTeeOptions;
  let loadError: ReturnType<typeof collectLoadErrors> = null;

  if (!access.isBypass && access.clubId) {
    const clubId = access.clubId;
    const supabase = await createClient();
    const eventColumns =
      "id, name, event_type, venue, event_date, tee_off_time, capacity, member_price, guest_price, includes, description, status, archived_at, updated_at, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections";
    const eventQuery = (columns: string) => {
      const query = supabase.from("events").select(columns).eq("club_id", clubId);
      return (showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null))
        .order("event_date", { ascending: true })
        .limit(80);
    };
    const [
      { data, error: eventsError },
      { data: registrationData, error: registrationsError },
      { data: directoryUnits, error: directoryError },
      { data: teeData, error: teeError },
    ] = await Promise.all([
      selectWithOptional<EventRow[]>(eventQuery, `${eventColumns}, course_tee_id`, eventColumns, "admin.events list"),
      supabase
        .from("event_registrations")
        .select("id, event_id, status, members(full_name, member_code, phone)")
        .eq("club_id", clubId)
        .not("status", "in", "(cancelled,no_show)")
        .order("created_at", { ascending: true })
        .limit(500),
      // Suggestions for the eligibility boxes, so a typo does not silently shut everyone out.
      fetchAllRows<DirectoryUnitRow>(
        (from, to) =>
          supabase
            .from("employee_directory")
            .select("work_line, bureau, division, department, section")
            .eq("club_id", clubId)
            .is("archived_at", null)
            .order("id")
            .range(from, to),
        { maxRows: 20_000 },
      ),
      supabase
        .from("golf_course_tees")
        .select("id, name, course_rating, slope_rating, par, golf_courses(name, archived_at)")
        .eq("club_id", clubId)
        .is("archived_at", null)
        .limit(300),
    ]);
    teeOptions = teeError
      ? null
      : ((teeData ?? []) as unknown as TeeOption[])
          .filter((tee) => tee.golf_courses && !tee.golf_courses.archived_at)
          .sort((a, b) => (a.golf_courses?.name ?? "").localeCompare(b.golf_courses?.name ?? "", "th") || a.name.localeCompare(b.name, "th"));

    events = (data ?? []) as EventRow[];
    registrations = (registrationData ?? []) as unknown as EventRegistrationRow[];
    // Suggestions are a convenience: without them the boxes still work as plain text.
    if (!directoryError && directoryUnits) {
      suggestions = Object.fromEntries(
        targetFields.map((target) => [target.column, distinctSorted(directoryUnits.map((row) => row[target.column]))]),
      );
    }
    loadError = collectLoadErrors("admin.events", [
      { error: eventsError, label: "รายการกิจกรรม" },
      { error: registrationsError, label: "รายชื่อผู้สมัคร" },
    ]);
  }

  events = events.filter((event) => {
    // The archived view lists rows with archived_at set, whatever their last status was.
    const matchesStatus = selectedStatus === "all" || showArchived || event.status === selectedStatus;
    const haystack = [event.name, event.venue, event.event_type, event.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !q || haystack.includes(q.toLowerCase());

    return matchesStatus && matchesSearch;
  });

  const openCount = events.filter((event) => event.status === "open").length;
  const draftCount = events.filter((event) => event.status === "draft").length;
  const highlightedEvent = params.event;
  const statusMessage = params.status ? statusMessages[params.status] : null;
  const filtered = Boolean(q) || selectedStatus !== "all";
  const registrationsByEvent = new Map<string, EventRegistrationRow[]>();
  registrations.forEach((registration) => {
    const current = registrationsByEvent.get(registration.event_id) ?? [];
    current.push(registration);
    registrationsByEvent.set(registration.event_id, current);
  });

  const EventIcon = appIcons.events;
  const EditIcon = appIcons.edit;
  const SearchIcon = appIcons.search;
  const MembersIcon = appIcons.members;
  const WaitlistIcon = appIcons.waitlist;
  const rowGrid = "lg:grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_6.5rem]";

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <section className="mx-auto w-full max-w-7xl">
        <PageHeader
          actions={
            <Link className={buttonClass("secondary", "md")} href={access.isBypass ? "/admin/events/courses?bypass=admin" : "/admin/events/courses"}>
              <MapPin className="size-4" aria-hidden="true" />
              สนามและที
            </Link>
          }
          title="กิจกรรมออกรอบ"
        />

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={toneForStatus(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        <LoadErrorBanner error={loadError} />

        {access.isBypass ? (
          <StatusBanner className="mt-5" tone="warning">
            โหมดทดลอง: แสดงข้อมูลตัวอย่างและบันทึกไม่ได้ ต้องปิดโหมดนี้ก่อนเปิดใช้งานจริง
          </StatusBanner>
        ) : null}

        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            { label: "กิจกรรมที่แสดง", value: events.length },
            { label: "เปิดรับสมัคร", value: openCount },
            { label: "ฉบับร่าง", value: draftCount },
          ].map((item) => (
            <article className="rounded-xl border border-line bg-white p-4 shadow-card sm:p-5" key={item.label}>
              <p className="text-sm font-medium text-ink-muted">{item.label}</p>
              <p className="mt-2 text-kpi font-semibold tabular-nums text-ink">{item.value.toLocaleString("th-TH")}</p>
            </article>
          ))}
        </div>

        <CreatePanel
          defaultOpen={Boolean(params.status && !params.event && toneForStatus(params.status) === "error")}
          hint="ตั้งชื่อ วันที่ ค่าสมัคร และจำนวนรับ แล้วเปิดรับสมัครเมื่อพร้อม"
          title="สร้างกิจกรรมใหม่"
        >
          <EventForm action={createEvent} disabled={access.isBypass} suggestions={suggestions} teeOptions={teeOptions} />
        </CreatePanel>

        {/* One copy of each suggestion list, shared by the create form and every edit form. */}
        {targetFields.map((target) =>
          suggestions[target.column]?.length ? (
            <datalist id={suggestionListId(target.column)} key={target.column}>
              {suggestions[target.column]!.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          ) : null,
        )}

        <section className="mt-6 rounded-xl border border-line bg-white shadow-card">
          <form className="grid gap-3 border-b border-line p-5 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
            {access.isBypass ? <input name="bypass" type="hidden" value="admin" /> : null}
            <label className="block">
              <span className={fieldLabel}>ค้นหา</span>
              <input className={fieldInput} defaultValue={q} name="q" placeholder="ชื่อกิจกรรม สนาม หรือรายละเอียด" type="search" />
            </label>
            <label className="block">
              <span className={fieldLabel}>สถานะ</span>
              <select className={fieldInput} defaultValue={selectedStatus} name="filter">
                <option value="all">ทุกสถานะ</option>
                {eventStatusOptions.map((value) => (
                  <option key={value} value={value}>{eventStatusLabels[value]}</option>
                ))}
              </select>
            </label>
            <button className={buttonClass("secondary", "md")} type="submit">
              <SearchIcon className="size-4" aria-hidden="true" />
              ค้นหา
            </button>
          </form>

          {events.length ? (
            <div aria-hidden="true" className={`hidden gap-4 border-b border-line bg-canvas px-5 py-2 text-xs font-medium text-ink-subtle lg:grid ${rowGrid}`}>
              <span />
              <span>กิจกรรม</span>
              <span>วันที่และเวลา</span>
              <span>ผู้สมัครและค่าสมัคร</span>
              <span />
            </div>
          ) : null}

          <div className="divide-y divide-line">
            {events.length ? (
              events.map((event) => {
                const eventRegistrations = registrationsByEvent.get(event.id) ?? [];
                const seated = eventRegistrations.filter((item) => holdsSeat(item.status)).length;
                const waitlisted = eventRegistrations.filter((item) => item.status === "waitlist").length;
                const status = event.archived_at ? "archived" : event.status;
                const statusLabel = eventStatusLabels[status] ?? status;

                return (
                  <details
                    className="group scroll-mt-24 px-5 py-4"
                    id={`event-${event.id}`}
                    key={event.id}
                    open={highlightedEvent === event.id}
                  >
                    <summary className={`grid cursor-pointer list-none gap-3 lg:items-center lg:gap-4 ${rowGrid}`}>
                      <span className="hidden size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 lg:flex">
                        <EventIcon className="size-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{event.name}</span>
                          <StatusBadge kind="event" status={status}>{statusLabel}</StatusBadge>
                        </span>
                        <span className="mt-1 block text-sm text-ink-muted">
                          {eventTypeLabels[event.event_type] ?? event.event_type} · {event.venue?.trim() || "รอแจ้งสนาม"}
                        </span>
                      </span>
                      <span className="text-sm">
                        <span className="block font-medium text-ink">{formatThaiDateShort(event.event_date)}</span>
                        <span className="mt-0.5 block text-ink-muted">
                          ออกรอบ <span className="tabular-nums">{formatThaiTime(event.tee_off_time)}</span>
                        </span>
                      </span>
                      <span className="text-sm">
                        <span className="block text-ink">
                          สมัครแล้ว{" "}
                          <span className="font-semibold tabular-nums">
                            {seated}
                            {event.capacity ? `/${event.capacity}` : ""}
                          </span>{" "}
                          คน
                          {waitlisted ? (
                            <span className="ml-2 inline-flex items-center gap-1 text-warning">
                              <WaitlistIcon className="size-3.5" aria-hidden="true" />
                              คิวสำรอง <span className="tabular-nums">{waitlisted}</span>
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-ink-muted tabular-nums">
                          สมาชิก {formatFee(event.member_price)} · แขก {formatFee(event.guest_price)}
                        </span>
                      </span>
                      <span className={`${buttonClass("secondary", "sm")} w-fit group-open:bg-brand-50`}>
                        <EditIcon className="size-4" aria-hidden="true" />
                        แก้ไข
                        <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden="true" />
                      </span>
                    </summary>

                    <div className="mt-4 grid gap-4 rounded-xl border border-line bg-canvas p-4">
                      {access.isBypass ? null : (
                        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-4">
                          <p className="mr-2 flex items-center gap-2 text-sm font-medium text-ink-muted">
                            สถานะตอนนี้
                            <StatusBadge kind="event" status={status}>{statusLabel}</StatusBadge>
                          </p>
                          {(quickStatusActions[status] ?? []).map((item) => (
                            <form action={setEventStatus} key={item.status}>
                              <input name="eventId" type="hidden" value={event.id} />
                              <input name="status" type="hidden" value={item.status} />
                              {item.confirm ? (
                                <ConfirmSubmitButton className={buttonClass("danger", "sm")} confirmLabel={item.label} message={item.confirm}>
                                  {item.label}
                                </ConfirmSubmitButton>
                              ) : (
                                <button className={buttonClass("secondary", "sm")} type="submit">
                                  {item.label}
                                </button>
                              )}
                            </form>
                          ))}
                        </section>
                      )}

                      <section className="rounded-lg border border-line bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-h3 font-semibold text-ink">
                            ผู้สมัคร <span className="tabular-nums">{eventRegistrations.length}</span> คน
                          </h3>
                          {access.isBypass ? null : (
                            <Link className={buttonClass("primary", "sm")} href={`/admin/events/${event.id}`}>
                              <MembersIcon className="size-4" aria-hidden="true" />
                              ผู้สมัคร · จัดก๊วน · เช็กอิน
                            </Link>
                          )}
                        </div>
                        {eventRegistrations.length ? (
                          <>
                            <div aria-hidden="true" className="mt-3 hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 text-xs font-medium text-ink-subtle sm:grid">
                              <span>ชื่อ</span>
                              <span>เลขสมาชิก</span>
                              <span>โทร</span>
                              <span>สถานะ</span>
                            </div>
                            <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
                              {eventRegistrations.map((registration) => {
                                const phone = registration.members?.phone;
                                const href = phoneHref(phone);
                                return (
                                  <li
                                    className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3"
                                    key={registration.id}
                                  >
                                    <span className="font-semibold text-ink">{registration.members?.full_name ?? "ผู้สมัคร"}</span>
                                    <span className="text-ink-muted tabular-nums">
                                      <span className="text-xs text-ink-subtle sm:hidden">เลขสมาชิก </span>
                                      {registration.members?.member_code ?? UNSET}
                                    </span>
                                    <span className="tabular-nums">
                                      <span className="text-xs text-ink-subtle sm:hidden">โทร </span>
                                      {href ? (
                                        <a className="text-brand-600 hover:underline" href={href}>{formatPhone(phone)}</a>
                                      ) : (
                                        <span className="text-ink-muted">{formatPhone(phone)}</span>
                                      )}
                                    </span>
                                    <span>
                                      <StatusBadge kind="registration" status={registration.status}>
                                        {registrationStatusLabels[registration.status] ?? registration.status}
                                      </StatusBadge>
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </>
                        ) : (
                          <p className="mt-2 text-sm text-ink-muted">
                            {status === "draft"
                              ? "ยังไม่มีคนสมัคร กด “เปิดรับสมัคร” ด้านบนเมื่อพร้อม"
                              : status === "open"
                                ? "ยังไม่มีคนสมัคร สมาชิกสมัครได้จากหน้าสมาชิก"
                                : "ไม่มีผู้สมัคร"}
                          </p>
                        )}
                      </section>

                      <section className="rounded-lg border border-line bg-white p-4">
                        <h3 className="mb-4 flex items-center gap-2 text-h3 font-semibold text-ink">
                          <EditIcon className="size-4 text-ink-subtle" aria-hidden="true" />
                          แก้ไขรายละเอียด
                        </h3>
                        {/* Keyed on updated_at: after a save the form remounts with the stored values
                            instead of keeping (or resetting to) the values from before the save. */}
                        <EventForm
                          action={updateEvent}
                          disabled={access.isBypass}
                          event={event}
                          key={`${event.id}:${event.updated_at ?? ""}`}
                          suggestions={suggestions}
                          teeOptions={teeOptions}
                        />
                      </section>
                    </div>
                  </details>
                );
              })
            ) : (
              <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <p className="text-sm text-ink-muted">
                  {filtered ? "ไม่พบกิจกรรมที่ตรงกับคำค้นหรือสถานะที่เลือก" : "ยังไม่มีกิจกรรม เริ่มจาก “สร้างกิจกรรมใหม่” ด้านบน"}
                </p>
                {filtered ? (
                  <Link className={buttonClass("secondary", "sm")} href={access.isBypass ? "/admin/events?bypass=admin" : "/admin/events"}>
                    ล้างตัวกรอง
                  </Link>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

