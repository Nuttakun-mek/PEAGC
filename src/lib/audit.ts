/**
 * Audit log helper shared by every admin action.
 *
 * `recordAudit` writes one row to `audit_logs` (who, what, before → after). It never throws:
 * a failed audit insert is logged on the server and the caller's main action still succeeds,
 * because blocking an approval because its log line failed would be worse than a missing row.
 *
 * Pass the same Supabase client the action used for its write (the user's client keeps RLS:
 * staff of the club may insert; members' self-service actions use the service-role client).
 */

type AuditInsertResult = { error: { code?: string | null; message?: string | null } | null };

/** Minimal structural type so both the cookie (RLS) client and the service-role client fit. */
export type AuditClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => PromiseLike<AuditInsertResult>;
  };
};

export type AuditEntry = {
  clubId: string | null;
  actorUserId: string | null;
  /** Dotted verb, e.g. "payment.approved", "member.updated", "lesson_slot.archived". */
  action: string;
  /** Table or concept name, e.g. "payment_records", "members". */
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** jsonb-safe copy: drops functions/undefined, turns Dates into ISO, caps runaway payloads. */
function toJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return null;
    // A whole import file does not belong in one audit row; keep a marker instead.
    if (text.length > 200_000) return { truncated: true, bytes: text.length };
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function buildAuditRow(entry: AuditEntry) {
  const entityId = entry.entityId && UUID_PATTERN.test(entry.entityId) ? entry.entityId : null;
  const metadata: Record<string, unknown> = { ...(toJson(entry.metadata ?? {}) as Record<string, unknown> | null) };
  // entity_id is a uuid column; keep non-uuid keys (e.g. club_id+module_key) in metadata.
  if (entry.entityId && !entityId) metadata.entity_key = entry.entityId;

  return {
    action: entry.action,
    actor_user_id: entry.actorUserId ?? null,
    after_data: toJson(entry.after),
    before_data: toJson(entry.before),
    club_id: entry.clubId ?? null,
    entity_id: entityId,
    entity_type: entry.entityType,
    metadata,
  };
}

export async function recordAudit(supabase: AuditClient, entry: AuditEntry): Promise<boolean> {
  try {
    const { error } = await supabase.from("audit_logs").insert(buildAuditRow(entry));
    if (error) {
      console.error(`[audit] ${entry.action} ${entry.entityType}:`, error.code ?? "-", error.message ?? "");
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[audit] ${entry.action} ${entry.entityType}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}
