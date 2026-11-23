"use server";

import { recordAudit } from "@/lib/audit";
import { requireStaffClub } from "@/lib/auth/staff";
import { redirectAfterAction as redirect } from "@/lib/navigation";
import { parseRulePoints, pointRuleReasons, pointsErrorToStatus } from "@/lib/points/rules";
import { failureStatus, logDbError } from "@/lib/supabase/errors";
import { anyCorruptedText } from "@/lib/text-integrity";

const pointsAdminRoles = ["platform_owner", "club_admin", "committee"];

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function back(status: string, anchor = "", extra: Record<string, string> = {}): never {
  const params = new URLSearchParams({ status, ...extra });
  redirect(`/admin/points?${params.toString()}${anchor ? `#${anchor}` : ""}`);
}

async function requirePointsAdmin() {
  return requireStaffClub(pointsAdminRoles, "/admin/points");
}

/** Points per rule and on/off switches (one form for all six rules). */
export async function savePointRules(formData: FormData) {
  const { clubId, supabase, userId } = await requirePointsAdmin();
  const rows = [];
  for (const reason of pointRuleReasons) {
    const points = parseRulePoints(reason, getString(formData, `points_${reason}`) || "0");
    if (points === null) back("rules-invalid", "rules");
    rows.push({ club_id: clubId, enabled: getString(formData, `enabled_${reason}`) === "on", points, reason, updated_by: userId });
  }

  const { data: before } = await supabase.from("point_rules").select("reason, points, enabled").eq("club_id", clubId);
  const { error } = await supabase.from("point_rules").upsert(rows, { onConflict: "club_id,reason" });
  if (error) {
    logDbError("point_rules.save", error);
    back(failureStatus("rules-failed", error), "rules");
  }
  await recordAudit(supabase, {
    action: "point_rules.updated",
    actorUserId: userId,
    after: rows.map(({ enabled, points, reason }) => ({ enabled, points, reason })),
    before,
    clubId,
    entityType: "point_rules",
    metadata: { source: "admin.points" },
  });
  back("rules-saved", "rules");
}

const adjustKinds: Record<string, { reason: "staff_award" | "adjust"; sign: 1 | -1 }> = {
  add: { reason: "adjust", sign: 1 },
  award: { reason: "staff_award", sign: 1 },
  deduct: { reason: "adjust", sign: -1 },
};

/** Manual award or deduction for one member (by member number). Reason required; audited in SQL. */
export async function adjustMemberPoints(formData: FormData) {
  const { clubId, supabase } = await requirePointsAdmin();
  const memberCode = getString(formData, "memberCode").replace(/\s+/g, "").toUpperCase();
  const kind = adjustKinds[getString(formData, "kind")];
  const amountText = getString(formData, "points");
  const note = getString(formData, "note").slice(0, 300);
  if (!memberCode || !kind || !amountText) back("adjust-missing", "adjust");
  if (!/^\d{1,5}$/.test(amountText) || Number(amountText) <= 0 || Number(amountText) > 10000) back("points-invalid", "adjust");
  if (!note) back("points-needs-reason", "adjust");
  if (anyCorruptedText([note])) back("text-corrupted", "adjust");

  const { data: member } = await supabase
    .from("members")
    .select("id, full_name")
    .eq("club_id", clubId)
    .ilike("member_code", memberCode.replace(/[\\%_]/g, (char) => `\\${char}`))
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (!member) back("adjust-member-not-found", "adjust", { code: memberCode });

  const delta = kind.sign * Number(amountText);
  const { error } = await supabase.rpc("admin_adjust_points", {
    p_delta: delta,
    p_member: member.id,
    p_note: note,
    p_reason: kind.reason,
  });
  if (error) {
    const status = pointsErrorToStatus(error.message, failureStatus("adjust-failed", error));
    if (status === "adjust-failed") logDbError("points.adjust", error);
    back(status, "adjust");
  }
  back("adjust-saved", "adjust", { who: member.full_name as string, delta: String(delta) });
}

function rewardValues(formData: FormData) {
  const name = getString(formData, "name").slice(0, 120);
  const description = getString(formData, "description").slice(0, 300) || null;
  const costText = getString(formData, "cost");
  const stockText = getString(formData, "stock");
  const status = getString(formData, "status") || "active";
  if (!name || !costText) return { error: "reward-missing" } as const;
  if (!/^\d{1,6}$/.test(costText) || Number(costText) < 1 || Number(costText) > 100000) return { error: "reward-cost-invalid" } as const;
  if (stockText && !/^\d{1,6}$/.test(stockText)) return { error: "reward-stock-invalid" } as const;
  if (!["active", "inactive", "archived"].includes(status)) return { error: "reward-missing" } as const;
  if (anyCorruptedText([name, description])) return { error: "text-corrupted" } as const;
  return {
    error: null,
    values: { cost: Number(costText), description, name, status, stock: stockText ? Number(stockText) : null },
  } as const;
}

export async function createPointReward(formData: FormData) {
  const { clubId, supabase, userId } = await requirePointsAdmin();
  const parsed = rewardValues(formData);
  if (!parsed.values) back(parsed.error, "rewards");
  const { data, error } = await supabase
    .from("point_rewards")
    .insert({ ...parsed.values, club_id: clubId, created_by: userId, updated_by: userId })
    .select("id")
    .single();
  if (error || !data) {
    logDbError("point_rewards.create", error);
    back(failureStatus("reward-failed", error), "rewards");
  }
  await recordAudit(supabase, {
    action: "point_reward.created",
    actorUserId: userId,
    after: parsed.values,
    clubId,
    entityId: data.id as string,
    entityType: "point_rewards",
    metadata: { source: "admin.points" },
  });
  back("reward-created", "rewards");
}

export async function updatePointReward(formData: FormData) {
  const rewardId = getString(formData, "rewardId");
  const { clubId, supabase, userId } = await requirePointsAdmin();
  const parsed = rewardValues(formData);
  if (!rewardId) back("reward-missing", "rewards");
  if (!parsed.values) back(parsed.error, "rewards");
  const { data: before } = await supabase.from("point_rewards").select("name, description, cost, stock, status").eq("id", rewardId).eq("club_id", clubId).maybeSingle();
  if (!before) back("reward-failed", "rewards");
  const { error } = await supabase
    .from("point_rewards")
    .update({ ...parsed.values, updated_by: userId })
    .eq("id", rewardId)
    .eq("club_id", clubId);
  if (error) {
    logDbError("point_rewards.update", error);
    back(failureStatus("reward-failed", error), "rewards");
  }
  await recordAudit(supabase, {
    action: "point_reward.updated",
    actorUserId: userId,
    after: parsed.values,
    before,
    clubId,
    entityId: rewardId,
    entityType: "point_rewards",
    metadata: { source: "admin.points" },
  });
  back("reward-saved", "rewards");
}

/** Hand over (fulfilled) or cancel a redemption; cancelling refunds the points. Audited in SQL. */
export async function decideRedemption(formData: FormData) {
  const redemptionId = getString(formData, "redemptionId");
  const decision = getString(formData, "decision");
  const note = getString(formData, "note").slice(0, 300) || null;
  if (!redemptionId || !["fulfilled", "cancelled"].includes(decision)) back("redemption-failed", "queue");
  if (decision === "cancelled" && !note) back("points-needs-reason", "queue");
  const { supabase } = await requirePointsAdmin();
  const { error } = await supabase.rpc("set_point_redemption_status", {
    p_note: note,
    p_redemption: redemptionId,
    p_status: decision,
  });
  if (error) {
    const status = pointsErrorToStatus(error.message, failureStatus("redemption-failed", error));
    if (status === "redemption-failed") logDbError("points.redemption_decide", error);
    back(status, "queue");
  }
  back(decision === "fulfilled" ? "redemption-fulfilled" : "redemption-cancelled", "queue");
}
