import Link from "next/link";
import { LogOut } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { EnvBadge } from "@/components/env-badge";
import { buttonClass } from "@/components/ui/styles";

/** Top bar of the coach portal (/coach): club, who is signed in, sign out. Phone first. */
export function CoachHeader({
  hasMemberRow = false,
  isBypass,
  isStaff,
  name,
}: {
  /** also a club member: link to the member pages */
  hasMemberRow?: boolean;
  isBypass: boolean;
  isStaff: boolean;
  name: string;
}) {
  return (
    <header className="flex items-center gap-3">
      <a className="skip-link" href="#coach-content">
        ข้ามไปยังเนื้อหา
      </a>
      <Link aria-label="ตารางสอน" href={isBypass ? "/coach?bypass=admin" : "/coach"}>
        <ClubCrest priority size={40} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-subtle">{CLUB_NAME} · ผู้สอน</p>
        <p className="truncate text-base font-semibold text-ink">{name}</p>
      </div>
      <EnvBadge className="self-start" />
      {isStaff ? (
        <Link className={`${buttonClass("ghost", "sm")} hidden sm:inline-flex`} href="/admin/lessons">
          หน้าผู้ดูแล
        </Link>
      ) : hasMemberRow ? (
        <Link className={buttonClass("ghost", "sm")} href="/member">
          หน้าสมาชิก
        </Link>
      ) : null}
      {isBypass ? null : (
        <form action={signOut}>
          <button aria-label="ออกจากระบบ" className={buttonClass("secondary", "sm")} type="submit">
            <LogOut className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">ออกจากระบบ</span>
          </button>
        </form>
      )}
    </header>
  );
}
