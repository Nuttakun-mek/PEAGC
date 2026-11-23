// Filters of the audit log page (/admin/audit), parsed from the URL. Pure.

import { auditActionEntityLabel, auditActionLabels, auditEntityLabels } from "./audit-diff";
import { bangkokDate } from "./lessons/booking";

export const AUDIT_PAGE_SIZE = 50;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actionPattern = /^[a-z_]+(\.[a-z_]+)?\.?$/;

export type AuditFilters = {
  action: string;
  actor: string;
  entity: string;
  entityId: string;
  from: string;
  page: number;
  to: string;
};

export type AuditSearchParams = Partial<Record<"action" | "actor" | "entity" | "entityId" | "from" | "page" | "to", string>>;

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * URL → filters. Dates default to the last 30 days (Bangkok); a reversed range is swapped.
 * `entityId` (from the member 360 link) widens the default range to everything, because a
 * member's history starts long before last month.
 */
export function parseAuditFilters(params: AuditSearchParams, today = bangkokDate()): AuditFilters {
  const entityId = params.entityId && uuidPattern.test(params.entityId) ? params.entityId.toLowerCase() : "";
  const defaultFrom = entityId ? "2020-01-01" : shiftDays(today, -29);
  let from = params.from && datePattern.test(params.from) ? params.from : defaultFrom;
  let to = params.to && datePattern.test(params.to) ? params.to : today;
  if (from > to) [from, to] = [to, from];
  const page = Math.max(1, Math.min(10_000, Number.parseInt(params.page ?? "1", 10) || 1));
  const entity = params.entity && /^[a-z_]+$/.test(params.entity) ? params.entity : "";
  const actor = params.actor === "none" || (params.actor && uuidPattern.test(params.actor)) ? params.actor.toLowerCase() : "";
  const action = params.action && actionPattern.test(params.action) ? params.action : "";
  return { action, actor, entity, entityId, from, page, to };
}

/** Query string for a filter set (page 1 and default-empty values are left out). */
export function auditQueryString(filters: Partial<AuditFilters>, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.entity) params.set("entity", filters.entity);
  if (filters.entityId) params.set("entityId", filters.entityId);
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.action) params.set("action", filters.action);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Bangkok day bounds as ISO instants for timestamptz filters. */
export function auditDayRange(from: string, to: string) {
  return {
    end: new Date(`${to}T23:59:59.999+07:00`).toISOString(),
    start: new Date(`${from}T00:00:00+07:00`).toISOString(),
  };
}

/** "Action" filter options grouped by entity prefix, e.g. member.* → สมาชิก. */
export function auditActionOptions() {
  const groups = new Map<string, Array<{ label: string; value: string }>>();
  for (const [value, label] of Object.entries(auditActionLabels)) {
    const prefix = value.split(".")[0];
    const list = groups.get(prefix) ?? [];
    list.push({ label, value });
    groups.set(prefix, list);
  }
  return [...groups.entries()]
    .map(([prefix, options]) => ({
      label: auditActionEntityLabel(prefix),
      options: options.sort((a, b) => a.label.localeCompare(b.label, "th")),
      prefix,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));
}

export function auditEntityOptions() {
  return Object.entries(auditEntityLabels)
    .map(([value, label]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));
}

/** Pages to link: 1 … around current … last. */
export function pageWindow(page: number, totalPages: number, radius = 1) {
  const pages = new Set<number>([1, totalPages]);
  for (let index = page - radius; index <= page + radius; index += 1) {
    if (index >= 1 && index <= totalPages) pages.add(index);
  }
  return [...pages].filter((value) => value >= 1).sort((a, b) => a - b);
}
