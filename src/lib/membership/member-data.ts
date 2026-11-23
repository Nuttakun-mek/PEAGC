import "server-only";

import { cache } from "react";

import { type MembershipSettings, defaultMembershipSettings, loadMembershipSettings } from "@/lib/membership/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

export type MyMembership = {
  applicant_type: string | null;
  club_id: string;
  id: string;
  joined_at: string | null;
  membership_expires_at: string | null;
  pdpa_consent_at: string | null;
  pdpa_policy_version: string | null;
  photo_consent: boolean | null;
  sponsor_member_id: string | null;
  status: string;
  status_reason: string | null;
};

export type MyMembershipResult = {
  /** False when the membership_points migration is not applied yet: hide the new sections. */
  available: boolean;
  member: MyMembership | null;
  openDeleteRequestAt: string | null;
  settings: MembershipSettings;
  sponsor: { full_name: string; member_code: string | null } | null;
};

const columns =
  "id, club_id, status, status_reason, joined_at, membership_expires_at, applicant_type, sponsor_member_id, pdpa_consent_at, pdpa_policy_version, photo_consent";

/**
 * The signed-in member's membership fields (expiry, sponsor, consent) and the club settings, loaded
 * once per request however many sections ask for them. Never throws.
 */
export const loadMyMembership = cache(async (userId: string | null): Promise<MyMembershipResult> => {
  const empty: MyMembershipResult = {
    available: false,
    member: null,
    openDeleteRequestAt: null,
    settings: { ...defaultMembershipSettings },
    sponsor: null,
  };
  if (!userId) return empty;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("members")
      .select(columns)
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (classifyDbError(error) !== "schema-outdated") logDbError("membership.load_my", error);
      return empty;
    }
    const member = (data ?? null) as MyMembership | null;
    if (!member) return { ...empty, available: true };

    const [{ settings }, requestResult, sponsorResult] = await Promise.all([
      loadMembershipSettings(supabase, member.club_id),
      supabase
        .from("member_data_requests")
        .select("created_at")
        .eq("member_id", member.id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Members cannot read other members under RLS; only the sponsor linked to this row is shown.
      member.sponsor_member_id
        ? createAdminClient().from("members").select("full_name, member_code").eq("id", member.sponsor_member_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    return {
      available: true,
      member,
      openDeleteRequestAt: (requestResult.data as { created_at: string } | null)?.created_at ?? null,
      settings,
      sponsor: (sponsorResult.data as MyMembershipResult["sponsor"]) ?? null,
    };
  } catch (error) {
    console.error("[membership] load_my failed:", error instanceof Error ? error.message : String(error));
    return empty;
  }
});
