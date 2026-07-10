import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Filter,
  MapPin,
  Pencil,
  Plus,
  Search,
  UsersRound,
} from "lucide-react";

import { createEvent, updateEvent } from "@/app/admin/events/actions";
import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type AdminEventsPageProps = {
  searchParams: Promise<{
    bypass?: string;
    event?: string;
    q?: string;
    status?: string;
  }>;
};

type EventRow = {
  capacity: number | null;
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
  venue: string | null;
};

const sampleEvents: EventRow[] = [
  {
    capacity: 72,
    description: "กิจกรรมออกรอบประจำเดือนสำหรับสมาชิก",
    event_date: "2026-08-15",
    event_type: "golf_round",
    guest_price: 2800,
    id: "sample-event-1",
    includes: "Green fee, caddie, dinner",
    member_price: 2200,
    name: "PEAGC Monthly Round",
    status: "open",
    tee_off_time: "11:30",
    venue: "Royal Golf Club",
  },
  {
    capacity: 48,
    description: "ร่างกิจกรรมการแข่งขันภายในชมรม",
    event_date: "2026-09-05",
    event_type: "tournament",
    guest_price: 3500,
    id: "sample-event-2",
    includes: "Green fee, trophy, dinner",
    member_price: 3000,
    name: "PEAGC Club Challenge",
    status: "draft",
    tee_off_time: "12:00",
    venue: "Bangkok Golf Club",
  },
];

const eventTypeLabels: Record<string, string> = {
  charity: "Charity",
  golf_round: "ออกรอบ",
  tournament: "แข่งขัน",
  training: "Academy",
};

const statusLabels: Record<string, string> = {
  archived: "Archived",
  cancelled: "Cancelled",
  closed: "Closed",
  completed: "Completed",
  draft: "Draft",
  open: "Open",
};

const statusMessages: Record<string, string> = {
  "create-failed": "สร้างกิจกรรมไม่สำเร็จ",
  created: "สร้างกิจกรรมเรียบร้อยแล้ว",
  "missing-required": "กรุณากรอกชื่อกิจกรรมและวันที่",
  "update-failed": "แก้ไขกิจกรรมไม่สำเร็จ",
  updated: "แก้ไขกิจกรรมเรียบร้อยแล้ว",
};

function getStatusClass(status: string) {
  if (status === "open") {
    return "bg-[#f8edf4] text-[#722257]";
  }

  if (status === "draft") {
    return "bg-[#fff5d8] text-[#805300]";
  }

  if (status === "closed" || status === "completed") {
    return "bg-[#eef2ff] text-[#3730a3]";
  }

  return "bg-[#f1f3ef] text-[#6b6475]";
}

function EventForm({
  action,
  disabled,
  event,
  title,
}: {
  action: (formData: FormData) => void;
  disabled?: boolean;
  event?: EventRow;
  title: string;
}) {
  return (
    <form action={action} className="grid gap-4">
      {event ? <input name="eventId" type="hidden" value={event.id} /> : null}
      <div className="flex items-center gap-2">
        {event ? (
          <Pencil className="size-4 text-[#722257]" aria-hidden="true" />
        ) : (
          <Plus className="size-4 text-[#722257]" aria-hidden="true" />
        )}
        <h2 className="text-lg font-semibold text-[#722257]">{title}</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_180px_180px]">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ชื่อกิจกรรม</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.name ?? ""}
            disabled={disabled}
            name="name"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ประเภท</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.event_type ?? "golf_round"}
            disabled={disabled}
            name="eventType"
          >
            <option value="golf_round">ออกรอบ</option>
            <option value="tournament">แข่งขัน</option>
            <option value="charity">Charity</option>
            <option value="training">Academy</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สถานะ</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.status ?? "draft"}
            disabled={disabled}
            name="status"
          >
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">วันที่</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.event_date ?? ""}
            disabled={disabled}
            name="eventDate"
            required
            type="date"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">T-Off</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.tee_off_time?.slice(0, 5) ?? ""}
            disabled={disabled}
            name="teeOffTime"
            type="time"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#3f3a48]">สนาม</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.venue ?? ""}
            disabled={disabled}
            name="venue"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">จำนวนรับสมัคร</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.capacity ?? ""}
            disabled={disabled}
            min="0"
            name="capacity"
            type="number"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ค่าสมัครสมาชิก</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.member_price ?? 0}
            disabled={disabled}
            min="0"
            name="memberPrice"
            step="0.01"
            type="number"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ค่าสมัครแขก</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.guest_price ?? 0}
            disabled={disabled}
            min="0"
            name="guestPrice"
            step="0.01"
            type="number"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สิ่งที่รวมในราคา</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.includes ?? ""}
            disabled={disabled}
            name="includes"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">รายละเอียด</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={event?.description ?? ""}
            disabled={disabled}
            name="description"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {[
          { key: "targetWorkLines", label: "สายงาน", value: event?.target_work_lines },
          { key: "targetBureaus", label: "สำนัก", value: event?.target_bureaus },
          { key: "targetDivisions", label: "ฝ่าย", value: event?.target_divisions },
          { key: "targetDepartments", label: "กอง", value: event?.target_departments },
          { key: "targetSections", label: "แผนก", value: event?.target_sections },
        ].map((target) => (
          <label className="block" key={target.key}>
            <span className="text-sm font-semibold text-[#3f3a48]">{target.label}</span>
            <input
              className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
              defaultValue={target.value?.join(", ") ?? ""}
              disabled={disabled}
              name={target.key}
              placeholder="เว้นว่าง = ทุกคน"
            />
          </label>
        ))}
      </div>

      <button
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white transition enabled:hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6] md:w-fit"
        disabled={disabled}
        type="submit"
      >
        <BadgeCheck className="size-4" aria-hidden="true" />
        {event ? "บันทึกกิจกรรม" : "สร้างกิจกรรม"}
      </button>
    </form>
  );
}

export default async function AdminEventsPage({ searchParams }: AdminEventsPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/events",
    requiredRole: "admin",
    searchParams: params,
  });
  const q = params.q?.trim() ?? "";
  const selectedStatus = params.status ?? "all";
  let events = sampleEvents;

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("events")
      .select(
        "id, name, event_type, venue, event_date, tee_off_time, capacity, member_price, guest_price, includes, description, status, target_work_lines, target_bureaus, target_divisions, target_departments, target_sections",
      )
      .eq("club_id", access.clubId)
      .is("archived_at", null)
      .order("event_date", { ascending: true })
      .limit(80);

    events = (data ?? []) as EventRow[];
  }

  events = events.filter((event) => {
    const matchesStatus = selectedStatus === "all" || event.status === selectedStatus;
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
  const bypassQuery = access.isBypass ? "?bypass=admin" : "";

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">Admin Portal</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#722257]">
              Event Management
            </h1>
            <p className="mt-2 text-sm text-[#6b6475]">
              สร้างกิจกรรม เปิดรับสมัคร และจัดการรายละเอียดกิจกรรมกอล์ฟ
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="flex h-11 items-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#722257]"
              href={`/admin${bypassQuery}`}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              กลับ Admin
            </Link>
            <Link
              className="flex h-11 items-center rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
              href={access.isBypass ? "/member?bypass=member" : "/member"}
            >
              ดูหน้าสมาชิก
            </Link>
          </div>
        </div>

        {statusMessage ? (
          <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">
            {statusMessage}
          </div>
        ) : null}

        {access.isBypass ? (
          <div className="mt-5 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
            โหมด Admin ทดลอง: แสดงข้อมูลตัวอย่างและปิดการบันทึกจริง ต้องปิดก่อน go live
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { label: "กิจกรรมที่แสดง", value: events.length },
            { label: "Open", value: openCount },
            { label: "Draft", value: draftCount },
          ].map((item) => (
            <article
              className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]"
              key={item.label}
            >
              <p className="text-sm font-semibold text-[#6b6475]">{item.label}</p>
              <p className="mt-2 text-3xl font-semibold text-[#722257]">
                {item.value}
              </p>
            </article>
          ))}
        </div>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <EventForm action={createEvent} disabled={access.isBypass} title="สร้างกิจกรรมใหม่" />
        </section>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="border-b border-[#e6e2ee] p-5">
            <form className="grid gap-3 lg:grid-cols-[1fr_180px_110px]">
              {access.isBypass ? (
                <input name="bypass" type="hidden" value="admin" />
              ) : null}
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]"
                  aria-hidden="true"
                />
                <input
                  className="h-11 w-full rounded-md border border-[#d9d3e6] pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={q}
                  name="q"
                  placeholder="ค้นหาชื่อกิจกรรม สนาม หรือรายละเอียด"
                />
              </label>
              <label className="relative block">
                <Filter
                  className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]"
                  aria-hidden="true"
                />
                <select
                  className="h-11 w-full rounded-md border border-[#d9d3e6] bg-white pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={selectedStatus}
                  name="status"
                >
                  <option value="all">ทุกสถานะ</option>
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <button
                className="h-11 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
                type="submit"
              >
                ค้นหา
              </button>
            </form>
          </div>

          <div className="divide-y divide-[#e6e2ee]">
            {events.length ? (
              events.map((event) => (
                <details
                  className="group px-5 py-4"
                  key={event.id}
                  open={highlightedEvent === event.id}
                >
                  <summary className="grid cursor-pointer list-none gap-4 lg:grid-cols-[44px_1fr_0.75fr_0.65fr_96px] lg:items-center">
                    <div className="flex size-11 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                      <CalendarDays className="size-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#722257]">{event.name}</p>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${getStatusClass(event.status)}`}
                        >
                          {statusLabels[event.status] ?? event.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[#6b6475]">
                        {eventTypeLabels[event.event_type] ?? event.event_type} ·{" "}
                        {event.venue ?? "ยังไม่ระบุสนาม"}
                      </p>
                    </div>
                    <div className="text-sm text-[#3f3a48]">
                      <p>{event.event_date}</p>
                      <p className="mt-1 text-[#6b6475]">
                        T-Off {event.tee_off_time?.slice(0, 5) ?? "-"}
                      </p>
                    </div>
                    <div className="text-sm text-[#3f3a48]">
                      <p>รับ {event.capacity ?? "-"} คน</p>
                      <p className="mt-1 text-[#6b6475]">
                        สมาชิก {event.member_price.toLocaleString()} บาท
                      </p>
                    </div>
                    <span className="w-fit rounded-md border border-[#d9d3e6] px-3 py-2 text-sm font-semibold text-[#722257] group-open:bg-white/70">
                      แก้ไข
                    </span>
                  </summary>

                  <div className="mt-5 rounded-lg border border-[#e6e2ee] bg-white/70 p-4">
                    <div className="mb-4 grid gap-3 rounded-md bg-white p-4 text-sm text-[#3f3a48] md:grid-cols-3">
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 size-4 text-[#722257]" aria-hidden="true" />
                        <div>
                          <p className="font-semibold text-[#6b6475]">สนาม</p>
                          <p className="mt-1 text-[#722257]">{event.venue ?? "-"}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <UsersRound className="mt-0.5 size-4 text-[#722257]" aria-hidden="true" />
                        <div>
                          <p className="font-semibold text-[#6b6475]">จำนวนรับ</p>
                          <p className="mt-1 text-[#722257]">
                            {event.capacity ?? "-"} คน
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <CircleDollarSign className="mt-0.5 size-4 text-[#722257]" aria-hidden="true" />
                        <div>
                          <p className="font-semibold text-[#6b6475]">ราคา</p>
                          <p className="mt-1 text-[#722257]">
                            สมาชิก {event.member_price.toLocaleString()} / แขก{" "}
                            {event.guest_price.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>

                    <EventForm
                      action={updateEvent}
                      disabled={access.isBypass}
                      event={event}
                      title={`แก้ไข ${event.name}`}
                    />
                  </div>
                </details>
              ))
            ) : (
              <div className="px-5 py-10 text-center text-sm text-[#6b6475]">
                ไม่พบกิจกรรมตามเงื่อนไขที่ค้นหา
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
