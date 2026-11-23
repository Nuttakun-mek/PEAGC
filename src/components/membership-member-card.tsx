import { MemberCard, type MemberCardData } from "@/components/member-card";
import { addDays, bangkokToday, deriveLifecycle, isRenewalOpen } from "@/lib/membership/lifecycle";
import { loadMyMembership } from "@/lib/membership/member-data";
import { loadMemberPoints } from "@/lib/points/member-points";

/**
 * The member card on /member with the membership extras: end date ("ใช้ได้ถึง"), a renew button
 * when renewal is open and the club collects a fee, and the แต้มสะสม balance. Until the membership
 * migration is applied it renders the plain card.
 */
export async function MembershipMemberCard({
  displayName,
  isBypass,
  member,
  userId,
}: {
  displayName: string;
  isBypass: boolean;
  member: (MemberCardData & { id?: string | null }) | null;
  userId: string | null;
}) {
  const today = bangkokToday();

  if (isBypass) {
    const expiresAt = addDays(today, 20);
    return (
      <MemberCard
        displayName={displayName}
        member={member}
        membership={{
          expiresAt,
          lifecycle: member?.status === "pending_verification" ? "pending" : "expiring",
          points: 145,
          pointsHref: "#points",
          renewHref: "/member/membership?bypass=member",
        }}
      />
    );
  }

  const mine = await loadMyMembership(userId);
  if (!mine.available || !mine.member) {
    return <MemberCard displayName={displayName} member={member} />;
  }

  const { settings } = mine;
  const lifecycle = deriveLifecycle(mine.member, today, settings.renewalNoticeDays);
  const points = await loadMemberPoints(mine.member.id);
  const canRenew =
    settings.annualFee > 0 &&
    (lifecycle === "active" || lifecycle === "expiring" || lifecycle === "expired") &&
    isRenewalOpen(mine.member.membership_expires_at, today, settings.renewalNoticeDays);
  const showPoints = points.available && (points.txns.length > 0 || lifecycle === "active" || lifecycle === "expiring");

  return (
    <MemberCard
      displayName={displayName}
      member={member}
      membership={{
        expiresAt: mine.member.membership_expires_at,
        lifecycle,
        points: showPoints ? points.ledger.balance : null,
        pointsHref: "#points",
        renewHref: canRenew ? "/member/membership" : null,
      }}
    />
  );
}
