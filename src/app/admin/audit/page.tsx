import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { LoadErrorBanner, StatusBanner } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass, card, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { type AuditChange, auditActionLabel, auditEntityLabel, diffAuditData, formatAuditValue, summarizeAuditChanges } from "@/lib/audit-diff";
import {
  AUDIT_PAGE_SIZE,
  type AuditFilters,
  auditActionOptions,
  auditDayRange,
  auditEntityOptions,
  auditQueryString,
  pageWindow,
  parseAuditFilters,
} from "@/lib/audit-query";
import { formatThaiDate, formatThaiDateTime } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { roleLabels } from "@/lib/labels";
import { collectLoadErrors } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "บันทึกการแก้ไข" };

type PageProps = {
  searchParams: Promise<{ action?: string; actor?: string; bypass?: string; entity?: string; entityId?: string; from?: string; page?: string; to?: string }>;
};

type AuditRow = {
  action: string;
  actor_user_id: string | null;
  after_data: unknown;
  before_data: unknown;
  created_at: string;
  entity_id: string | null;
  entity_type: string;
  id: string;
  metadata: Record<string, unknown> | null;
};

type Actor = { name: string; roles: string[] };

const AuditIcon = appIcons.audit;
const rowGrid = "lg:grid-cols-[10rem_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_1.5rem]";
const cellLabel = "w-20 shrink-0 text-ink-subtle lg:sr-only";
const cellWrap = "flex gap-2 text-sm lg:block";

/** Metadata keys worth showing to a reader, with Thai labels. */
const metadataLabels: Record<string, string> = {
  batch_id: "ชุดนำเข้า",
  count: "จำนวน",
  event_id: "กิจกรรม",
  file_name: "ไฟล์",
  member_id: "สมาชิก",
  reason: "เหตุผล",
  source: "หน้าที่ใช้",
  source_file_name: "ไฟล์",
};

const sourceLabels: Record<string, string> = {
  "admin.employees": "ฐานสมาชิกสมาคม",
  "admin.employees.import": "ฐานสมาชิกสมาคม (นำเข้าไฟล์)",
  "admin.events": "กิจกรรม",
  "admin.lessons": "ตารางเรียน",
  "admin.members": "รายชื่อสมาชิก",
  "admin.payments": "ตรวจสลิป",
  "admin.settings": "เปิด/ปิดโมดูล",
  "member.portal": "หน้าสมาชิก (สมาชิกทำเอง)",
};

const sampleActors: Record<string, Actor> = {
  "00000000-0000-0000-0000-0000000000a1": { name: "ผู้ดูแลระบบทดลอง", roles: ["club_admin"] },
  "00000000-0000-0000-0000-0000000000a2": { name: "เหรัญญิก ทดลอง", roles: ["finance_officer"] },
  "00000000-0000-0000-0000-0000000000a3": { name: "สมชาย ใจดี", roles: [] },
};

function sampleRows(): AuditRow[] {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return [
    {
      action: "payment.reviewed",
      actor_user_id: "00000000-0000-0000-0000-0000000000a2",
      after_data: { amount: 1200, status: "approved" },
      before_data: { amount: 1200, status: "review" },
      created_at: at(12),
      entity_id: "00000000-0000-0000-0000-0000000000f1",
      entity_type: "payment_records",
      id: "s1",
      metadata: { source: "admin.payments" },
    },
    {
      action: "member.approved",
      actor_user_id: "00000000-0000-0000-0000-0000000000a1",
      after_data: { status: "active", verification_note: "ตรงฐานสมาชิกสมาคม" },
      before_data: { status: "pending_verification", verification_note: null },
      created_at: at(55),
      entity_id: "00000000-0000-0000-0000-0000000000e1",
      entity_type: "members",
      id: "s2",
      metadata: { source: "admin.members" },
    },
    {
      action: "member.updated",
      actor_user_id: "00000000-0000-0000-0000-0000000000a1",
      after_data: { nickname: "ชาย", phone: "0891000005" },
      before_data: { nickname: null, phone: "0891000004" },
      created_at: at(60 * 5),
      entity_id: "00000000-0000-0000-0000-0000000000e1",
      entity_type: "members",
      id: "s3",
      metadata: { source: "admin.members" },
    },
    {
      action: "lesson_booking.created_by_member",
      actor_user_id: "00000000-0000-0000-0000-0000000000a3",
      after_data: { slot_id: "slot-1", status: "booked" },
      before_data: null,
      created_at: at(60 * 26),
      entity_id: "00000000-0000-0000-0000-0000000000b1",
      entity_type: "lesson_bookings",
      id: "s4",
      metadata: { source: "member.portal" },
    },
    {
      action: "event.created",
      actor_user_id: "00000000-0000-0000-0000-0000000000a1",
      after_data: { capacity: 40, event_date: "2026-12-20", member_price: 1200, name: "ออกรอบประจำเดือนธันวาคม", status: "draft" },
      before_data: null,
      created_at: at(60 * 50),
      entity_id: "00000000-0000-0000-0000-0000000000c1",
      entity_type: "events",
      id: "s5",
      metadata: { source: "admin.events" },
    },
    {
      action: "employee_directory.imported",
      actor_user_id: "00000000-0000-0000-0000-0000000000a1",
      after_data: { deactivated_count: 5, flagged_member_count: 2, imported_count: 512, mode: "replace", source_file_name: "สมาชิกสมาคม-พ.ย.69.xlsx" },
      before_data: null,
      created_at: at(60 * 24 * 6),
      entity_id: null,
      entity_type: "employee_directory",
      id: "s6",
      metadata: { source: "admin.employees.import" },
    },
  ];
}

/** Link to the changed record when there is a page for it. */
function entityHref(row: AuditRow) {
  if (!row.entity_id) return null;
  switch (row.entity_type) {
    case "members":
      return `/admin/members/${row.entity_id}`;
    case "events":
      return `/admin/events/${row.entity_id}`;
    case "lesson_programs":
      return `/admin/lessons?tab=courses#program-${row.entity_id}`;
    case "employee_directory":
      return `/admin/employees?employee=${row.entity_id}#employee-${row.entity_id}`;
    default:
      return null;
  }
}

function metadataItems(metadata: Record<string, unknown> | null) {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([key, value]) => metadataLabels[key] && value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ({
      label: metadataLabels[key],
      value: key === "source" && typeof value === "string" ? (sourceLabels[value] ?? value) : formatAuditValue(value, key),
    }));
}

function ChangeTable({ changes }: { changes: AuditChange[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-line">
          <tr>
            <th className="py-2 pr-4 text-left text-xs font-medium text-ink-muted" scope="col">ช่อง</th>
            <th className="py-2 pr-4 text-left text-xs font-medium text-ink-muted" scope="col">เดิม</th>
            <th className="py-2 pr-4 text-left text-xs font-medium text-ink-muted" scope="col">ใหม่</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {changes.map((change) => (
            <tr key={change.key}>
              <th className="py-2 pr-4 text-left align-top font-medium text-ink" scope="row">{change.label}</th>
              <td className="py-2 pr-4 align-top text-ink-muted">
                {change.kind === "added" ? <span className="text-ink-subtle">ไม่มี</span> : (
                  <span className={change.kind === "removed" ? "text-danger line-through" : undefined}>{change.before}</span>
                )}
              </td>
              <td className="py-2 pr-4 align-top">
                {change.kind === "removed" ? <span className="text-danger">ลบออก</span> : (
                  <span className={change.kind === "added" ? "text-success" : "font-medium text-ink"}>{change.after}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AuditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: "/admin/audit", requiredRole: "admin", searchParams: params });
  await requireAdminArea("audit", access);
  const filters = parseAuditFilters(params);
  const bypassExtra: Record<string, string> = access.isBypass ? { bypass: "admin" } : {};

  let rows: AuditRow[] = [];
  let total = 0;
  let actors: Record<string, Actor> = {};
  let staffOptions: Array<{ id: string; label: string }> = [];
  let entityNames: Record<string, string> = {};
  let loadError: ReturnType<typeof collectLoadErrors> = null;

  if (access.isBypass || !access.clubId) {
    rows = sampleRows().filter(
      (row) =>
        (!filters.entity || row.entity_type === filters.entity) &&
        (!filters.entityId || row.entity_id === filters.entityId) &&
        (!filters.actor || row.actor_user_id === filters.actor) &&
        (!filters.action || (filters.action.endsWith(".") ? row.action.startsWith(filters.action) : row.action === filters.action)),
    );
    total = rows.length;
    actors = sampleActors;
    staffOptions = Object.entries(sampleActors).map(([id, actor]) => ({ id, label: actor.name }));
    entityNames = {
      "00000000-0000-0000-0000-0000000000c1": "ออกรอบประจำเดือนธันวาคม",
      "00000000-0000-0000-0000-0000000000e1": "สมชาย ใจดี",
    };
  } else {
    const supabase = await createClient();
    const clubId = access.clubId;
    const range = auditDayRange(filters.from, filters.to);
    let query = supabase
      .from("audit_logs")
      .select("id, created_at, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata", { count: "exact" })
      .eq("club_id", clubId)
      .gte("created_at", range.start)
      .lte("created_at", range.end);
    if (filters.entity) query = query.eq("entity_type", filters.entity);
    if (filters.entityId) query = query.eq("entity_id", filters.entityId);
    if (filters.actor === "none") query = query.is("actor_user_id", null);
    else if (filters.actor) query = query.eq("actor_user_id", filters.actor);
    if (filters.action) query = filters.action.endsWith(".") ? query.like("action", `${filters.action}%`) : query.eq("action", filters.action);
    const from = (filters.page - 1) * AUDIT_PAGE_SIZE;

    const [logs, staff] = await Promise.all([
      query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + AUDIT_PAGE_SIZE - 1),
      supabase.rpc("club_staff_names", { p_club_id: clubId }),
    ]);
    rows = (logs.data ?? []) as AuditRow[];
    total = logs.count ?? rows.length;

    // Staff names come from a security-definer function (missing until the platform migration is
    // applied: then names fall back to member records and "ผู้ดูแล").
    for (const item of (staff.data ?? []) as Array<{ display_name: string | null; role_keys: string[] | null; user_id: string }>) {
      actors[item.user_id] = { name: item.display_name?.trim() || "ผู้ดูแล", roles: item.role_keys ?? [] };
    }
    staffOptions = Object.entries(actors)
      .map(([id, actor]) => ({ id, label: actor.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "th"));

    const unknownActors = [...new Set(rows.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id && !actors[id])))];
    const memberIds = [...new Set(rows.filter((row) => row.entity_type === "members" && row.entity_id).map((row) => row.entity_id as string))];
    const eventIds = [...new Set(rows.filter((row) => row.entity_type === "events" && row.entity_id).map((row) => row.entity_id as string))];
    const [actorMembers, members, events] = await Promise.all([
      unknownActors.length
        ? supabase.from("members").select("user_id, full_name").eq("club_id", clubId).in("user_id", unknownActors)
        : null,
      memberIds.length ? supabase.from("members").select("id, full_name").eq("club_id", clubId).in("id", memberIds) : null,
      eventIds.length ? supabase.from("events").select("id, name").eq("club_id", clubId).in("id", eventIds) : null,
    ]);
    for (const item of (actorMembers?.data ?? []) as Array<{ full_name: string; user_id: string }>) {
      actors[item.user_id] = { name: item.full_name, roles: ["member"] };
    }
    entityNames = Object.fromEntries([
      ...((members?.data ?? []) as Array<{ full_name: string; id: string }>).map((item) => [item.id, item.full_name]),
      ...((events?.data ?? []) as Array<{ id: string; name: string }>).map((item) => [item.id, item.name]),
    ]);

    loadError = collectLoadErrors("admin.audit", [
      { error: logs.error, label: "บันทึกการแก้ไข" },
      { error: actorMembers?.error ?? null, label: "ชื่อผู้แก้ไข" },
    ]);
    if (staff.error) console.error("[db] admin.audit staff names:", staff.error.code ?? "-", staff.error.message ?? "");
  }

  const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const hasFilters = Boolean(filters.entity || filters.actor || filters.action || filters.entityId);
  const pageHref = (page: number) => `/admin/audit${auditQueryString({ ...filters, page }, bypassExtra)}`;
  const clearHref = `/admin/audit${auditQueryString({ from: filters.from, to: filters.to }, bypassExtra)}`;
  const actorName = (id: string | null) => (id ? (actors[id]?.name ?? "ผู้ดูแล") : "ระบบ");
  const actorRole = (id: string | null) => {
    const roles = id ? (actors[id]?.roles ?? []) : [];
    if (roles.includes("member") && roles.length === 1) return "สมาชิก (ทำเอง)";
    return roles.map((role) => roleLabels[role] ?? role).join(", ");
  };
  const firstShown = total ? (filters.page - 1) * AUDIT_PAGE_SIZE + 1 : 0;
  const lastShown = Math.min(total, filters.page * AUDIT_PAGE_SIZE);

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader description="ใครแก้อะไร เมื่อไหร่ ค่าเดิมกับค่าใหม่ ของทุกการอนุมัติและการแก้ไข" title="บันทึกการแก้ไข" />

        {access.isBypass ? (
          <StatusBanner className="mt-4" tone="warning">
            โหมดผู้ดูแลทดลอง: แสดงข้อมูลตัวอย่าง
          </StatusBanner>
        ) : null}
        <LoadErrorBanner className="mt-4" error={loadError} />

        <section aria-labelledby="audit-filter-title" className={`${card} mt-6`}>
          <h2 className="sr-only" id="audit-filter-title">
            ตัวกรอง
          </h2>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
            {access.isBypass ? <input name="bypass" type="hidden" value="admin" /> : null}
            {filters.entityId ? <input name="entityId" type="hidden" value={filters.entityId} /> : null}
            <label className="block min-w-0">
              <span className={fieldLabel}>ตั้งแต่</span>
              <input className={fieldInputClass("sm")} defaultValue={filters.from} name="from" type="date" />
            </label>
            <label className="block min-w-0">
              <span className={fieldLabel}>ถึง</span>
              <input className={fieldInputClass("sm")} defaultValue={filters.to} name="to" type="date" />
            </label>
            <label className="block min-w-0">
              <span className={fieldLabel}>เรื่อง</span>
              <select className={fieldInputClass("sm")} defaultValue={filters.entity} name="entity">
                <option value="">ทุกเรื่อง</option>
                {auditEntityOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className={fieldLabel}>ผู้แก้ไข</span>
              <select className={fieldInputClass("sm")} defaultValue={filters.actor} name="actor">
                <option value="">ทุกคน</option>
                {staffOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
                <option value="none">ระบบ (อัตโนมัติ)</option>
              </select>
            </label>
            <label className="block min-w-0">
              <span className={fieldLabel}>การแก้ไข</span>
              <select className={fieldInputClass("sm")} defaultValue={filters.action} name="action">
                <option value="">ทุกการแก้ไข</option>
                {auditActionOptions().map((group) => (
                  <optgroup key={group.prefix} label={group.label}>
                    <option value={`${group.prefix}.`}>ทั้งหมดในเรื่องนี้</option>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
              <button className={`${buttonClass("primary", "sm")} flex-1 lg:flex-none`} type="submit">
                แสดง
              </button>
              {hasFilters ? (
                <Link className={buttonClass("ghost", "sm")} href={clearHref}>
                  ล้างตัวกรอง
                </Link>
              ) : null}
            </div>
          </form>
          <p className="mt-3 text-sm text-ink-muted">
            {formatThaiDate(filters.from)} – {formatThaiDate(filters.to)}
            {filters.entityId ? (
              <>
                {" "}· เฉพาะ{entityNames[filters.entityId] ? ` "${entityNames[filters.entityId]}"` : "รายการที่เลือก"}
              </>
            ) : null}
          </p>
        </section>

        <section aria-labelledby="audit-list-title" className="mt-6 rounded-xl border border-line bg-white shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="audit-list-title">
              <AuditIcon className="size-5 text-brand-600" aria-hidden="true" />
              <span>
                รายการ <span className="tabular-nums">{total.toLocaleString("th-TH")}</span>
              </span>
            </h2>
            {total ? (
              <p className="text-sm tabular-nums text-ink-subtle">
                แสดง {firstShown.toLocaleString("th-TH")}–{lastShown.toLocaleString("th-TH")}
              </p>
            ) : null}
          </div>

          {rows.length ? (
            <>
              <div aria-hidden="true" className={`hidden gap-4 border-b border-line bg-canvas px-5 py-2.5 text-xs font-medium text-ink-subtle lg:grid ${rowGrid}`}>
                <span>เวลา</span>
                <span>ผู้แก้ไข</span>
                <span>การแก้ไข</span>
                <span>สิ่งที่เปลี่ยน</span>
                <span />
              </div>
              <ul className="divide-y divide-line">
                {rows.map((row) => {
                  const changes = diffAuditData(row.before_data, row.after_data);
                  const meta = metadataItems(row.metadata);
                  const href = entityHref(row);
                  const name = row.entity_id ? entityNames[row.entity_id] : undefined;
                  const role = actorRole(row.actor_user_id);
                  return (
                    <li key={row.id}>
                      <details className="group px-5 py-3.5">
                        <summary className={`grid cursor-pointer gap-1.5 rounded-lg lg:items-start lg:gap-4 ${rowGrid}`}>
                          <div className={cellWrap}>
                            <span className={cellLabel}>เวลา</span>
                            <span className="tabular-nums text-ink-muted">{formatThaiDateTime(row.created_at)}</span>
                          </div>
                          <div className={cellWrap}>
                            <span className={cellLabel}>ผู้แก้ไข</span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-ink">{actorName(row.actor_user_id)}</span>
                              {role ? <span className="block truncate text-xs text-ink-subtle">{role}</span> : null}
                            </span>
                          </div>
                          <div className={cellWrap}>
                            <span className={cellLabel}>การแก้ไข</span>
                            <span className="min-w-0">
                              <span className="block font-semibold text-ink">{auditActionLabel(row.action)}</span>
                              <span className="block text-xs text-ink-subtle">
                                {auditEntityLabel(row.entity_type)}
                                {name ? ` · ${name}` : ""}
                              </span>
                            </span>
                          </div>
                          <div className={cellWrap}>
                            <span className={cellLabel}>เปลี่ยน</span>
                            <span className="min-w-0 text-ink-muted">{summarizeAuditChanges(changes) || "ไม่มีรายละเอียดค่าเดิม/ค่าใหม่"}</span>
                          </div>
                          <ChevronDown className="hidden size-5 text-ink-subtle transition group-open:rotate-180 lg:block" aria-hidden="true" />
                        </summary>

                        <div className="mt-3 grid gap-3 rounded-lg border border-line bg-canvas p-4">
                          {changes.length ? <ChangeTable changes={changes} /> : <p className="text-sm text-ink-muted">ไม่มีรายละเอียดค่าเดิม/ค่าใหม่</p>}
                          {meta.length || href ? (
                            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                              {meta.map((item) => (
                                <div className="flex gap-1.5" key={item.label}>
                                  <dt className="text-ink-subtle">{item.label}</dt>
                                  <dd className="text-ink">{item.value}</dd>
                                </div>
                              ))}
                              {href ? (
                                <div>
                                  <dt className="sr-only">รายการที่แก้</dt>
                                  <dd>
                                    <Link className="font-medium text-brand-600 underline-offset-2 hover:underline" href={access.isBypass ? `${href}${href.includes("?") ? "&" : "?"}bypass=admin` : href}>
                                      เปิด{auditEntityLabel(row.entity_type)}นี้
                                    </Link>
                                  </dd>
                                </div>
                              ) : null}
                            </dl>
                          ) : null}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-ink-muted">
                {hasFilters ? "ไม่มีการแก้ไขที่ตรงกับตัวกรองในช่วงวันที่นี้" : "ไม่มีการแก้ไขในช่วงวันที่นี้"}
              </p>
              {hasFilters ? (
                <Link className={`${buttonClass("secondary")} mt-3`} href={clearHref}>
                  ล้างตัวกรอง
                </Link>
              ) : null}
            </div>
          )}

          {totalPages > 1 ? <Pagination filters={filters} pageHref={pageHref} totalPages={totalPages} /> : null}
        </section>
      </div>
    </main>
  );
}

function Pagination({ filters, pageHref, totalPages }: { filters: AuditFilters; pageHref: (page: number) => string; totalPages: number }) {
  const pages = pageWindow(filters.page, totalPages);
  const pill = "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium tabular-nums";
  return (
    <nav aria-label="เลือกหน้า" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
      <p className="text-sm text-ink-muted">
        หน้า <span className="tabular-nums">{filters.page}</span> จาก <span className="tabular-nums">{totalPages}</span>
      </p>
      <ul className="flex items-center gap-1">
        <li>
          {filters.page > 1 ? (
            <Link aria-label="หน้าก่อน" className={`${pill} text-brand-600 hover:bg-brand-50`} href={pageHref(filters.page - 1)}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </li>
        {pages.map((page, index) => (
          <li className="flex items-center" key={page}>
            {index > 0 && page - pages[index - 1] > 1 ? <span className="px-1 text-ink-subtle">…</span> : null}
            <Link
              aria-current={page === filters.page ? "page" : undefined}
              className={`${pill} ${page === filters.page ? "bg-brand-600 text-white" : "text-brand-600 hover:bg-brand-50"}`}
              href={pageHref(page)}
            >
              {page}
            </Link>
          </li>
        ))}
        <li>
          {filters.page < totalPages ? (
            <Link aria-label="หน้าถัดไป" className={`${pill} text-brand-600 hover:bg-brand-50`} href={pageHref(filters.page + 1)}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </li>
      </ul>
    </nav>
  );
}
