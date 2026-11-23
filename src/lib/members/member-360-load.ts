import "server-only";

import { diffAuditData } from "@/lib/audit-diff";
import { bangkokDate } from "@/lib/lessons/booking";
import { classifyDbError, collectLoadErrors, logDbError } from "@/lib/supabase/errors";
import type { createClient } from "@/lib/supabase/server";

import {
  bookingDisplayStatus,
  buildMemberPreview,
  ledgerBalance,
  membershipSummary,
  mergeAuditRows,
  paymentPurposeLabels,
  pickField,
  pointReasonLabels,
  queuePositions,
  splitByDate,
} from "./member-360";
import type {
  Member360Audit,
  Member360Booking,
  Member360Data,
  Member360Directory,
  Member360Member,
  Member360Notification,
  Member360Package,
  Member360Payment,
  Member360PointRow,
  Member360Registration,
  Member360Term,
} from "./member-360-data";

type Client = Awaited<ReturnType<typeof createClient>>;
type DbError = { code?: string | null; details?: string | null; hint?: string | null; message?: string | null } | null;
type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles that may read payment_records under RLS (payments_select_by_finance). */
const paymentRoles = ["platform_owner", "club_admin", "finance_officer", "auditor"];

/** Lesson credit ledger: track 1 (lessons v2) owns the name; try the likely ones. */
const creditLedgerTables = ["lesson_credit_txns", "lesson_credit_transactions", "lesson_credit_ledger"];

export function isMemberId(value: string) {
  return UUID.test(value);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Optional table from another track: missing table/column = not available (no banner). */
function optional(label: string, error: DbError, failures: Array<{ error: DbError; label: string }>) {
  if (!error) return true;
  if (classifyDbError(error) === "schema-outdated") {
    logDbError(`admin.member360 optional ${label}`, error);
    return false;
  }
  failures.push({ error, label });
  return false;
}

async function firstAvailable(supabase: Client, tables: string[], memberId: string) {
  for (const table of tables) {
    const result = await supabase.from(table).select("*").eq("member_id", memberId).limit(500);
    if (!result.error) return { error: null, rows: (result.data ?? []) as Row[], table };
    if (classifyDbError(result.error) !== "schema-outdated") return { error: result.error as DbError, rows: [], table };
  }
  return { error: null, rows: null, table: null };
}

export async function loadMember360(
  supabase: Client,
  clubId: string,
  memberId: string,
  roleKeys: string[],
): Promise<Member360Data | null> {
  const today = bangkokDate();
  const failures: Array<{ error: DbError; label: string }> = [];

  const memberResult = await supabase
    .from("members")
    .select("*, member_types(name)")
    .eq("club_id", clubId)
    .eq("id", memberId)
    .maybeSingle();
  if (memberResult.error) {
    logDbError("admin.member360 member", memberResult.error);
    return null;
  }
  const raw = memberResult.data as Row | null;
  if (!raw) return null;

  const member: Member360Member = {
    affiliation: str(raw.affiliation),
    avatar_url: str(raw.avatar_url),
    department: str(raw.department),
    email: str(raw.email),
    employee_code: str(raw.employee_code),
    employee_directory_id: str(raw.employee_directory_id),
    employee_match_detail: (raw.employee_match_detail as { reason?: string } | null) ?? null,
    employee_match_status: str(raw.employee_match_status),
    full_name: str(raw.full_name) ?? "สมาชิก",
    handicap: num(raw.handicap),
    id: memberId,
    joined_at: str(raw.joined_at),
    line_id: str(raw.line_id),
    member_code: str(raw.member_code),
    member_type: one(raw.member_types as { name: string } | { name: string }[] | null)?.name ?? null,
    nickname: str(raw.nickname),
    organization: str(raw.organization),
    phone: str(raw.phone),
    status: str(raw.status) ?? "active",
    user_id: str(raw.user_id),
  };
  const membershipExpiresAt = str(raw.membership_expires_at);

  const directorySelect =
    "id, employee_code, full_name, membership_status, member_type, association_member_code, position, department, affiliation, employment_status, archived_at";
  const directoryQuery = member.employee_directory_id
    ? supabase.from("employee_directory").select(directorySelect).eq("club_id", clubId).eq("id", member.employee_directory_id).maybeSingle()
    : member.employee_code
      ? supabase.from("employee_directory").select(directorySelect).eq("club_id", clubId).eq("employee_code", member.employee_code).is("archived_at", null).maybeSingle()
      : Promise.resolve({ data: null, error: null });

  const [directory, bookings, registrations, notifications, unread, terms, enrollments, points, credits] = await Promise.all([
    directoryQuery,
    supabase
      .from("lesson_bookings")
      .select(
        "id, status, slot_id, queue_seq, booked_at, checked_in_at, lesson_slots(id, title, lesson_date, start_time, end_time, coach_name, venue, capacity, status, lesson_programs(name))",
      )
      .eq("club_id", clubId)
      .eq("member_id", memberId)
      .limit(500),
    supabase
      .from("event_registrations")
      .select(
        "id, status, event_id, checked_in_at, created_at, gross_score, net_score, stableford_points, score_status, overall_rank, events(id, name, event_date, venue, status, member_price)",
      )
      .eq("club_id", clubId)
      .eq("member_id", memberId)
      .limit(300),
    supabase
      .from("member_notifications")
      .select("id, notification_type, channel, subject, status, sent_at, created_at, read_at")
      .eq("club_id", clubId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("member_notifications")
      .select("id", { count: "exact", head: true })
      .eq("club_id", clubId)
      .eq("member_id", memberId)
      .is("read_at", null),
    supabase.from("membership_terms").select("*").eq("member_id", memberId).limit(50),
    supabase.from("lesson_enrollments").select("*").eq("member_id", memberId).limit(50),
    supabase.from("point_txns").select("*").eq("member_id", memberId).limit(2000),
    firstAvailable(supabase, creditLedgerTables, memberId),
  ]);

  if (directory.error) failures.push({ error: directory.error, label: "ฐานสมาชิกสมาคม" });
  if (bookings.error) failures.push({ error: bookings.error, label: "การจองเรียน" });
  if (registrations.error) failures.push({ error: registrations.error, label: "การสมัครกิจกรรม" });
  if (notifications.error) failures.push({ error: notifications.error, label: "การแจ้งเตือน" });
  const termsAvailable = optional("membership_terms", terms.error, failures);
  const packagesAvailable = optional("lesson_enrollments", enrollments.error, failures);
  const pointsAvailable = optional("point_txns", points.error, failures);
  if (credits.error) failures.push({ error: credits.error, label: "เครดิตเรียน" });

  // ---------- lessons ----------
  type BookingJoin = {
    booked_at: string | null;
    checked_in_at: string | null;
    id: string;
    lesson_slots: {
      capacity: number | null;
      coach_name: string | null;
      end_time: string | null;
      id: string;
      lesson_date: string;
      lesson_programs: { name: string } | { name: string }[] | null;
      start_time: string | null;
      title: string | null;
      venue: string | null;
    } | null;
    queue_seq: number | null;
    slot_id: string;
    status: string;
  };
  const bookingRows = ((bookings.data ?? []) as unknown as BookingJoin[]).filter((row) => one(row.lesson_slots));
  const dateOfBooking = (row: BookingJoin) => {
    const slot = one(row.lesson_slots);
    return slot ? `${slot.lesson_date}T${slot.start_time ?? "00:00"}` : null;
  };
  const lessonSplit = splitByDate(
    bookingRows.filter((row) => row.status !== "cancelled" || (dateOfBooking(row) ?? "") < today),
    dateOfBooking,
    today,
  );
  const upcomingSlotIds = [...new Set(lessonSplit.upcoming.map((row) => row.slot_id))];
  let positions = new Map<string, number>();
  if (upcomingSlotIds.length) {
    const queue = await supabase
      .from("lesson_bookings")
      .select("id, slot_id, status, queue_seq, booked_at")
      .in("slot_id", upcomingSlotIds)
      .neq("status", "cancelled")
      .limit(2000);
    if (queue.error) logDbError("admin.member360 slot queue", queue.error);
    else positions = queuePositions((queue.data ?? []) as Array<{ booked_at: string | null; id: string; queue_seq: number | null; slot_id: string; status: string }>);
  }
  const toBooking = (row: BookingJoin): Member360Booking => {
    const slot = one(row.lesson_slots)!;
    return {
      checkedInAt: row.checked_in_at,
      coach: slot.coach_name,
      date: slot.lesson_date,
      endTime: slot.end_time,
      id: row.id,
      program: one(slot.lesson_programs)?.name ?? null,
      startTime: slot.start_time,
      status: bookingDisplayStatus(row.status, positions.get(row.id), slot.capacity),
      title: slot.title ?? one(slot.lesson_programs)?.name ?? "รอบเรียน",
      venue: slot.venue,
    };
  };
  const lessons = {
    past: lessonSplit.past.map(toBooking),
    upcoming: lessonSplit.upcoming.filter((row) => row.status !== "cancelled").map(toBooking),
  };

  // ---------- events ----------
  type RegistrationJoin = {
    checked_in_at: string | null;
    created_at: string;
    event_id: string;
    events: { event_date: string; id: string; member_price: number | string | null; name: string; status: string | null; venue: string | null } | null;
    gross_score: number | null;
    id: string;
    net_score: number | string | null;
    overall_rank: number | null;
    score_status: string | null;
    stableford_points: number | string | null;
    status: string;
  };
  const registrationRows = ((registrations.data ?? []) as unknown as RegistrationJoin[]).filter((row) => one(row.events));
  const toRegistration = (row: RegistrationJoin): Member360Registration => {
    const event = one(row.events)!;
    const scored = row.score_status === "published" || row.score_status === "verified";
    return {
      checkedInAt: row.checked_in_at,
      date: event.event_date,
      eventId: event.id,
      eventStatus: event.status,
      fee: num(event.member_price),
      id: row.id,
      name: event.name,
      score: scored
        ? { gross: num(row.gross_score), net: num(row.net_score), points: num(row.stableford_points), rank: num(row.overall_rank), status: row.score_status }
        : null,
      status: row.status,
      venue: event.venue,
    };
  };
  const eventSplit = splitByDate(registrationRows, (row) => one(row.events)?.event_date, today);
  const events = {
    past: eventSplit.past.map(toRegistration),
    upcoming: eventSplit.upcoming.filter((row) => !["cancelled", "no_show"].includes(row.status)).map(toRegistration),
  };
  const registrationIds = registrationRows.map((row) => row.id);
  const registrationNames = new Map(registrationRows.map((row) => [row.id, one(row.events)!.name]));

  // ---------- payments (finance, admins and auditors only under RLS) ----------
  const paymentAccess = roleKeys.some((role) => paymentRoles.includes(role));
  let paymentRows: Row[] = [];
  if (paymentAccess) {
    const filter = [`member_id.eq.${memberId}`, registrationIds.length ? `event_registration_id.in.(${registrationIds.join(",")})` : null]
      .filter(Boolean)
      .join(",");
    const current = await supabase
      .from("payment_records")
      .select("id, amount, status, purpose, description, reviewed_at, created_at, slip_file_id, event_registration_id")
      .eq("club_id", clubId)
      .or(filter)
      .order("created_at", { ascending: false })
      .limit(100);
    if (current.error && classifyDbError(current.error) === "schema-outdated") {
      // Before 20261123091000 payments were events-only: no purpose / member_id columns.
      if (registrationIds.length) {
        const legacy = await supabase
          .from("payment_records")
          .select("id, amount, status, reviewed_at, created_at, slip_file_id, event_registration_id")
          .eq("club_id", clubId)
          .in("event_registration_id", registrationIds)
          .order("created_at", { ascending: false })
          .limit(100);
        if (legacy.error) failures.push({ error: legacy.error, label: "การชำระเงิน" });
        paymentRows = (legacy.data ?? []) as Row[];
      }
    } else if (current.error) {
      failures.push({ error: current.error, label: "การชำระเงิน" });
    } else {
      paymentRows = (current.data ?? []) as Row[];
    }
  }
  const payments: Member360Payment[] = paymentRows.map((row) => {
    const purpose = str(row.purpose) ?? "event";
    const registrationId = str(row.event_registration_id);
    return {
      amount: num(row.amount) ?? 0,
      createdAt: String(row.created_at),
      hasSlip: Boolean(row.slip_file_id),
      id: String(row.id),
      label: str(row.description) ?? (registrationId ? registrationNames.get(registrationId) : null) ?? paymentPurposeLabels[purpose] ?? "อื่นๆ",
      purpose,
      reviewedAt: str(row.reviewed_at),
      status: str(row.status) ?? "pending",
    };
  });

  // ---------- membership ----------
  const termRows = termsAvailable ? ((terms.data ?? []) as Row[]) : [];
  const summaryInput = membershipExpiresAt ? [...termRows, { ends_on: membershipExpiresAt, status: "active" }] : termRows;
  const summary = membershipSummary(summaryInput, today);
  const membershipTerms: Member360Term[] = termRows
    .map((term) => ({
      endsOn: pickField<string>(term, ["period_end", "ends_on", "end_date", "expires_on"]),
      fee: num(pickField(term, ["fee", "amount", "price"])),
      id: String(term.id),
      startsOn: pickField<string>(term, ["period_start", "starts_on", "start_date"]),
      status: str(term.status),
    }))
    .sort((a, b) => String(b.endsOn ?? "").localeCompare(String(a.endsOn ?? "")));

  // ---------- packages and credits (lessons v2) ----------
  const packageRows: Member360Package[] = (packagesAvailable ? ((enrollments.data ?? []) as Row[]) : []).map((row) => ({
    creditsLeft: num(pickField(row, ["credits_remaining", "remaining_credits", "credits_left", "balance"])),
    creditsTotal: num(pickField(row, ["credits_total", "total_credits", "credits", "sessions"])),
    expiresOn: pickField<string>(row, ["expires_on", "expires_at", "valid_until", "ends_on"]),
    id: String(row.id),
    name: pickField<string>(row, ["package_name", "name", "title"]) ?? "แพ็กเกจเรียน",
    status: str(row.status),
  }));
  const creditRows = credits.rows;

  // ---------- points ----------
  const pointRows = pointsAvailable ? ((points.data ?? []) as Row[]) : [];
  const pointsRecent: Member360PointRow[] = pointRows
    .map((row) => ({
      amount: num(pickField(row, ["delta", "points", "amount"])) ?? 0,
      date: str(row.created_at),
      id: String(row.id),
      reason: str(row.note) ?? (str(row.reason) ? (pointReasonLabels[String(row.reason)] ?? String(row.reason)) : null),
    }))
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 5);

  // ---------- audit history ----------
  type AuditRow = {
    action: string;
    actor_user_id: string | null;
    after_data: unknown;
    before_data: unknown;
    created_at: string;
    entity_id: string | null;
    entity_type: string;
    id: string;
  };
  const auditSelect = "id, action, entity_type, entity_id, actor_user_id, before_data, after_data, created_at";
  const relatedIds = [...bookingRows.map((row) => row.id), ...registrationIds, ...payments.map((row) => row.id)].slice(0, 100);
  const auditQueries = [
    supabase.from("audit_logs").select(auditSelect).eq("club_id", clubId).eq("entity_id", memberId).order("created_at", { ascending: false }).limit(30),
    supabase.from("audit_logs").select(auditSelect).eq("club_id", clubId).contains("metadata", { member_id: memberId }).order("created_at", { ascending: false }).limit(30),
    relatedIds.length
      ? supabase.from("audit_logs").select(auditSelect).eq("club_id", clubId).in("entity_id", relatedIds).order("created_at", { ascending: false }).limit(30)
      : null,
    member.user_id
      ? supabase.from("audit_logs").select(auditSelect).eq("club_id", clubId).eq("actor_user_id", member.user_id).order("created_at", { ascending: false }).limit(30)
      : null,
  ];
  const [auditResults, staffNames] = await Promise.all([
    Promise.all(auditQueries.map((query) => query ?? Promise.resolve({ data: [] as AuditRow[], error: null }))),
    supabase.rpc("club_staff_names", { p_club_id: clubId }),
  ]);
  const auditError = auditResults.find((result) => result.error)?.error ?? null;
  if (auditError) failures.push({ error: auditError, label: "ประวัติการแก้ไข" });
  if (staffNames.error) logDbError("admin.member360 staff names", staffNames.error);
  const names = new Map<string, string>(
    ((staffNames.data ?? []) as Array<{ display_name: string | null; user_id: string }>)
      .filter((row) => row.display_name)
      .map((row) => [row.user_id, row.display_name as string]),
  );
  if (member.user_id) names.set(member.user_id, member.full_name);
  const audit: Member360Audit[] = mergeAuditRows(auditResults.map((result) => (result.data ?? []) as AuditRow[]), 30).map((row) => ({
    action: row.action,
    actorName: row.actor_user_id ? (names.get(row.actor_user_id) ?? "ผู้ดูแล") : "ระบบ",
    changes: diffAuditData(row.before_data, row.after_data),
    createdAt: row.created_at,
    entityType: row.entity_type,
    id: row.id,
  }));

  // ---------- notifications ----------
  const notificationRows: Member360Notification[] = ((notifications.data ?? []) as Row[]).map((row) => ({
    channel: str(row.channel) ?? "system",
    createdAt: String(row.created_at),
    id: String(row.id),
    readAt: str(row.read_at),
    sentAt: str(row.sent_at),
    status: str(row.status) ?? "queued",
    subject: str(row.subject) ?? "",
    type: str(row.notification_type) ?? "",
  }));
  const unreadCount = unread.error ? 0 : (unread.count ?? 0);
  if (unread.error) logDbError("admin.member360 unread", unread.error);

  // ---------- what the member sees ----------
  const paymentByRegistration = new Map(paymentRows.map((row) => [str(row.event_registration_id), row]));
  const eventSlips = events.upcoming
    .filter((row) => row.status === "pending_payment")
    .map((row) => ({ amount: num(paymentByRegistration.get(row.id)?.amount) ?? row.fee ?? 0, id: row.id, label: row.name }));
  const otherSlips = payments
    .filter((row) => row.purpose !== "event" && row.status === "pending" && !row.hasSlip)
    .map((row) => ({ amount: row.amount, id: row.id, label: row.label }));
  const preview = buildMemberPreview({
    events: events.upcoming.map((row) => ({ date: row.date, id: row.id, name: row.name, status: row.status })),
    lessons: lessons.upcoming.map((row) => ({ date: row.date, id: row.id, status: row.status, time: row.startTime, title: row.title })),
    membership: summary,
    pendingPayments: [...eventSlips, ...otherSlips],
    unread: unreadCount,
  });

  const directoryRow = directory.error ? null : ((directory.data ?? null) as Member360Directory | null);

  return {
    audit,
    credits: { available: Boolean(credits.table) && !credits.error, balance: creditRows ? ledgerBalance(creditRows) : null },
    directory: directoryRow,
    events,
    lessons,
    loadError: collectLoadErrors("admin.member360", failures),
    member,
    membership: {
      available: termsAvailable || Boolean(membershipExpiresAt),
      daysLeft: summary.daysLeft,
      endsOn: summary.endsOn,
      hasPending: Boolean(summary.pending),
      state: summary.state,
      terms: membershipTerms,
    },
    notifications: { rows: notificationRows, unread: unreadCount },
    packages: { available: packagesAvailable, rows: packageRows },
    payments: { access: paymentAccess, rows: payments },
    points: { available: pointsAvailable, balance: ledgerBalance(pointRows, ["delta", "points", "amount"]), recent: pointsRecent },
    preview,
  };
}
