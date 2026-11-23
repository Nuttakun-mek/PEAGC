"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";
import { bangkokToday } from "@/lib/membership/lifecycle";
import { type DirectoryRow, matchDirectory } from "@/lib/membership/matching";
import { PRIVACY_POLICY_VERSION, loadMembershipSettings } from "@/lib/membership/settings";
import { anyCorruptedText } from "@/lib/text-integrity";
import { isValidHandicap, normalizeEmployeeCode, normalizePhone } from "@/lib/validation";

import { createAdminClient } from "@/lib/supabase/admin";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function getNumberOrNull(formData: FormData, key: string) {
  const value = getString(formData, key);

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function getAvatarFile(formData: FormData) {
  const file = formData.get("avatar");

  if (!(file instanceof File) || file.size === 0) {
    return null;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return { error: "invalid-avatar-type" as const, file: null };
  }

  if (file.size > 5 * 1024 * 1024) {
    return { error: "avatar-too-large" as const, file: null };
  }

  return { error: null, file };
}

type DirectoryProfileRow = DirectoryRow & {
  association_member_code?: string | null;
  bureau?: string | null;
  department: string | null;
  division?: string | null;
  member_type?: string | null;
  position?: string | null;
  section?: string | null;
  work_line?: string | null;
};

/** members.employee_match_detail for a staff applicant: checks, reason and a directory snapshot. */
function employeeMatchDetail(directory: DirectoryProfileRow | null, match: ReturnType<typeof matchDirectory>) {
  if (!directory) {
    return { reason: "not_found" };
  }
  return {
    checks: match.checks,
    ...(match.reason ? { reason: match.reason } : {}),
    directory: {
      affiliation: directory.affiliation,
      association_member_code: directory.association_member_code,
      bureau: directory.bureau,
      department: directory.department,
      division: directory.division,
      email: directory.email,
      employment_status: directory.employment_status,
      first_name: directory.first_name,
      full_name: directory.full_name,
      last_name: directory.last_name,
      member_type: directory.member_type,
      membership_status: directory.membership_status,
      position: directory.position,
      section: directory.section,
      title_prefix: directory.title_prefix,
      work_line: directory.work_line,
    },
  };
}

/** Statuses a member cannot leave by editing their own profile (admin or the daily job decides). */
const STICKY_STATUSES = ["inactive", "expired", "suspended", "resigned"];

/** Columns added by the membership_points migration; dropped from the write when it is not applied yet. */
const MEMBERSHIP_COLUMNS = [
  "applicant_type",
  "sponsor_member_id",
  "pdpa_consent_at",
  "pdpa_policy_version",
  "photo_consent",
  "photo_consent_at",
] as const;

export async function savePersonalProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  const fullName = getString(formData, "fullName");
  const nickname = getString(formData, "nickname");
  const phoneInput = normalizePhone(getString(formData, "phone"));
  const lineId = getString(formData, "lineId");
  // PEA staff sign up with an employee code; outsiders name an active member who vouches for them.
  const applicantType = getString(formData, "applicantType") === "external" ? "external" : "staff";
  const employeeCode = applicantType === "staff" ? normalizeEmployeeCode(getString(formData, "employeeCode")) : "";
  const sponsorCode = getString(formData, "sponsorCode").replace(/\s+/g, "").toUpperCase();
  const department = getString(formData, "department");
  const affiliation = getString(formData, "affiliation");
  const organization = getString(formData, "organization");
  const handicap = getNumberOrNull(formData, "handicap");
  const skillLevel = getString(formData, "skillLevel");
  const avatarInput = getAvatarFile(formData);
  const consentGiven = getString(formData, "pdpaConsent") === "yes";
  // The consent block renders this marker, so an unticked photo box means "no" (not "not shown").
  const photoConsentShown = formData.has("photoConsentShown");
  const photoConsent = getString(formData, "photoConsent") === "yes";

  if (!fullName || !getString(formData, "phone") || (applicantType === "staff" && !employeeCode)) {
    redirect("/profile?status=missing-required");
  }
  if (applicantType === "external" && !sponsorCode) {
    redirect("/profile?status=sponsor-required");
  }
  if (!phoneInput.ok || !phoneInput.value) {
    redirect("/profile?status=phone-invalid");
  }
  const phone = phoneInput.value;
  if (!isValidHandicap(handicap) || (getString(formData, "handicap") && handicap === null)) {
    redirect("/profile?status=handicap-invalid");
  }
  if (anyCorruptedText([fullName, nickname, department, affiliation, organization])) {
    redirect("/profile?status=text-corrupted");
  }

  if (avatarInput?.error) {
    redirect(`/profile?status=${avatarInput.error}`);
  }

  const { data: club, error: clubError } = await supabase
    .from("clubs")
    .select("id")
    .eq("status", "active")
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (clubError || !club) {
    redirect("/profile?status=no-club");
  }

  const admin = createAdminClient();

  // One employee code belongs to one member: refuse a code another account already uses.
  if (employeeCode) {
    const { data: codeOwner } = await admin
      .from("members")
      .select("id")
      .eq("club_id", club.id)
      .ilike("employee_code", employeeCode.replace(/[\\%_]/g, (char) => `\\${char}`))
      .is("archived_at", null)
      .neq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (codeOwner) {
      redirect("/profile?status=employee-code-taken");
    }
  }

  // The member row as it is now. Newer columns may be missing until the migration is applied.
  type ExistingMember = {
    employee_code: string | null;
    joined_at: string | null;
    member_code: string | null;
    member_type_id: string | null;
    pdpa_consent_at?: string | null;
    photo_consent?: boolean | null;
    status: string;
  };
  const legacyColumns = "employee_code, member_code, member_type_id, status, joined_at";
  let membershipSchema = true;
  let existingResult = await admin
    .from("members")
    .select(`${legacyColumns}, pdpa_consent_at, photo_consent`)
    .eq("club_id", club.id)
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();
  if (existingResult.error && classifyDbError(existingResult.error) === "schema-outdated") {
    membershipSchema = false;
    existingResult = await admin
      .from("members")
      .select(legacyColumns)
      .eq("club_id", club.id)
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle();
  }
  const existingMember = (existingResult.data ?? null) as ExistingMember | null;

  // PDPA: consent is required once (sign-up, or the first save after this was introduced).
  if (membershipSchema && !existingMember?.pdpa_consent_at && !consentGiven) {
    redirect("/profile?status=consent-required");
  }

  const { settings } = await loadMembershipSettings(admin, club.id);

  let sponsor: { id: string; member_code: string | null } | null = null;
  if (applicantType === "external") {
    const { data: sponsorRow } = await admin
      .from("members")
      .select("id, member_code")
      .eq("club_id", club.id)
      .ilike("member_code", sponsorCode.replace(/[\\%_]/g, (char) => `\\${char}`))
      .eq("status", "active")
      .is("archived_at", null)
      .neq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!sponsorRow) {
      redirect("/profile?status=sponsor-not-found");
    }
    sponsor = sponsorRow;
  }

  const { data: directoryData } = employeeCode
    ? await admin
        .from("employee_directory")
        .select("id, title_prefix, first_name, last_name, full_name, email, position, work_line, bureau, division, department, section, affiliation, employment_status, membership_status, member_type, association_member_code, archived_at")
        .eq("club_id", club.id)
        .eq("employee_code", employeeCode)
        .order("archived_at", { ascending: false, nullsFirst: true })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const directory = (directoryData ?? null) as DirectoryProfileRow | null;
  const match = matchDirectory({ directory, email: user.email ?? null, fullName });
  const verifiedDirectory = match.canAutoApprove && directory ? directory : null;
  const liveDirectory = directory && !directory.archived_at ? directory : null;

  // New sign-ups get the club's regular "สมาชิก" type instead of none ("ไม่ระบุประเภท").
  let memberTypeId = existingMember?.member_type_id ?? null;
  if (!memberTypeId) {
    const { data: types } = await admin
      .from("member_types")
      .select("id, name")
      .eq("club_id", club.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    memberTypeId = (types ?? []).find((type) => type.name === "สมาชิก")?.id ?? types?.[0]?.id ?? null;
  }

  // Status: admin decisions stick; an approved member keeps access while the identity is the same;
  // otherwise auto-approve when the club allows it and the directory matches, else wait for review.
  const previousStatus = existingMember?.status ?? null;
  const sameIdentity =
    applicantType === "staff"
      ? Boolean(existingMember?.employee_code) && normalizeEmployeeCode(existingMember?.employee_code) === employeeCode
      : !existingMember?.employee_code;
  let nextStatus: string;
  if (previousStatus && STICKY_STATUSES.includes(previousStatus)) {
    nextStatus = previousStatus;
  } else if (previousStatus === "active" && sameIdentity) {
    nextStatus = "active";
  } else if (applicantType === "staff" && settings.autoApprove && match.canAutoApprove) {
    nextStatus = "active";
  } else {
    nextStatus = "pending_verification";
  }
  const newlyApproved = nextStatus === "active" && previousStatus !== "active";
  const nowIso = new Date().toISOString();
  const memberCode = existingMember?.member_code ?? null;
  let avatarUrl: string | null = null;

  if (avatarInput?.file) {
    const extension = avatarInput.file.type.split("/")[1] ?? "jpg";
    const objectPath = `${club.id}/${user.id}/${Date.now()}.${extension}`;
    const { error: uploadError } = await admin.storage
      .from("member-avatars")
      .upload(objectPath, avatarInput.file, {
        contentType: avatarInput.file.type,
        upsert: true,
      });

    if (uploadError) {
      redirect("/profile?status=avatar-upload-failed");
    }

    const { data: publicUrl } = admin.storage
      .from("member-avatars")
      .getPublicUrl(objectPath);

    avatarUrl = publicUrl.publicUrl;
  }

  const memberPayload: Record<string, unknown> = {
      avatar_url: avatarUrl || undefined,
      association_member_code: liveDirectory?.association_member_code ?? null,
      association_member_type: liveDirectory?.member_type ?? null,
      association_membership_status: liveDirectory?.membership_status ?? null,
      bureau: verifiedDirectory?.bureau ?? null,
      club_id: club.id,
      email: user.email,
      affiliation: verifiedDirectory?.affiliation ?? affiliation,
      department: verifiedDirectory?.department ?? department,
      division: verifiedDirectory?.division ?? null,
      employee_code: employeeCode || null,
      employee_directory_id: applicantType === "staff" ? (liveDirectory?.id ?? null) : null,
      employee_match_checked_at: nowIso,
      employee_match_detail:
        applicantType === "external"
          ? { reason: "external", sponsor_code: sponsorCode, sponsor_member_id: sponsor?.id ?? null }
          : employeeMatchDetail(directory, match),
      employee_match_status: applicantType === "external" ? "not_checked" : match.status,
      first_name: verifiedDirectory?.first_name ?? null,
      full_name: verifiedDirectory?.full_name ?? fullName,
      handicap,
      last_name: verifiedDirectory?.last_name ?? null,
      line_id: lineId || null,
      member_code: memberCode,
      member_type_id: memberTypeId ?? undefined,
      nickname: nickname || null,
      organization: organization || null,
      phone,
      position: verifiedDirectory?.position ?? null,
      section: verifiedDirectory?.section ?? null,
      skill_level: skillLevel || null,
      status: nextStatus,
      title_prefix: verifiedDirectory?.title_prefix ?? null,
      updated_by: user.id,
      user_id: user.id,
      work_line: verifiedDirectory?.work_line ?? null,
      // membership_points columns
      applicant_type: applicantType,
      sponsor_member_id: sponsor?.id ?? null,
    };
  if (newlyApproved) {
    memberPayload.verification_note = "ตรวจสอบอัตโนมัติจากฐานสมาชิกสมาคม";
    memberPayload.verified_at = nowIso;
    if (!existingMember?.joined_at) memberPayload.joined_at = bangkokToday();
  } else if (nextStatus === "pending_verification") {
    memberPayload.verification_note = null;
    memberPayload.verified_at = null;
  }
  if (consentGiven && !existingMember?.pdpa_consent_at) {
    memberPayload.pdpa_consent_at = nowIso;
    memberPayload.pdpa_policy_version = settings.privacyPolicyVersion || PRIVACY_POLICY_VERSION;
  }
  if (photoConsentShown && photoConsent !== Boolean(existingMember?.photo_consent)) {
    memberPayload.photo_consent = photoConsent;
    memberPayload.photo_consent_at = nowIso;
  }
  if (!membershipSchema) {
    for (const column of MEMBERSHIP_COLUMNS) delete memberPayload[column];
  }

  // One name everywhere: the profile shows the member's (directory-verified) full name.
  const { error: profileError } = await supabase.from("profiles").upsert({
    display_name: memberPayload.full_name as string,
    id: user.id,
    line_id: lineId || null,
    phone,
    updated_at: nowIso,
  });

  if (profileError) {
    redirect("/profile?status=profile-failed");
  }

  // Written with the service role after the checks above: the members RLS policy only lets a
  // member save "pending_verification", so an auto-approved sign-up could not set "active".
  let { error: memberError } = await admin.from("members").upsert(memberPayload, { onConflict: "club_id,user_id" });
  if (memberError && classifyDbError(memberError) === "schema-outdated" && membershipSchema) {
    for (const column of MEMBERSHIP_COLUMNS) delete memberPayload[column];
    ({ error: memberError } = await admin.from("members").upsert(memberPayload, { onConflict: "club_id,user_id" }));
  }

  if (memberError) {
    logDbError("profile.member_upsert", memberError);
    redirect(memberError.code === "23505" && memberError.message?.includes("employee_code") ? "/profile?status=employee-code-taken" : "/profile?status=member-failed");
  }

  if (avatarUrl) {
    await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", user.id);
  }

  redirect(
    newlyApproved
      ? "/member?status=profile-approved"
      : nextStatus === "pending_verification"
        ? "/member?status=pending-review"
        : "/member?status=profile-saved",
  );
}
