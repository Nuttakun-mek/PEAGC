import { BadgeCheck, Clock3, ShieldAlert } from "lucide-react";

import { MemberAvatar } from "@/components/member-avatar";

export type MemberCardData = {
  association_member_code?: string | null;
  association_member_type?: string | null;
  avatar_url?: string | null;
  employee_code?: string | null;
  full_name?: string | null;
  joined_at?: string | null;
  member_code?: string | null;
  nickname?: string | null;
  status?: string | null;
  work_line?: string | null;
};

const statusMeta: Record<string, { icon: typeof BadgeCheck; label: string; tone: string }> = {
  active: { icon: BadgeCheck, label: "พร้อมใช้งาน", tone: "bg-white/18 text-white" },
  guest: { icon: Clock3, label: "บุคคลภายนอก", tone: "bg-white/18 text-white" },
  inactive: { icon: ShieldAlert, label: "ไม่ใช้งาน", tone: "bg-black/25 text-white/80" },
  pending_verification: { icon: Clock3, label: "รอตรวจสอบ", tone: "bg-[#C69214] text-[#2a1a00]" },
};

function formatJoined(value: string | null | undefined) {
  if (!value) return null;
  return new Date(`${value}T12:00:00+07:00`).toLocaleDateString("th-TH", { month: "short", timeZone: "Asia/Bangkok", year: "numeric" });
}

/**
 * Digital membership card: the first thing a member sees. Shows the club member number,
 * association type/code, and verification state, like a wallet pass.
 */
export function MemberCard({ displayName, member }: { displayName: string; member: MemberCardData | null }) {
  const status = member?.status ?? "pending_verification";
  const meta = statusMeta[status] ?? statusMeta.pending_verification;
  const Icon = meta.icon;
  const joined = formatJoined(member?.joined_at);
  const code = member?.member_code ?? "รอออกเลขสมาชิก";

  return (
    <section
      aria-label="บัตรสมาชิก PEAGC"
      className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#4a1238_0%,#722257_55%,#8e2c6e_100%)] p-5 text-white shadow-[0_24px_60px_rgba(74,18,56,0.35)]"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full border-[26px] border-[#C69214]/25" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-12 size-44 rounded-full bg-white/5" />

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#efd798]">PEA Golf Club</p>
          <p className="mt-1 text-xs text-white/70">ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${meta.tone}`}>
          <Icon className="size-3.5" aria-hidden="true" />
          {meta.label}
        </span>
      </div>

      <div className="relative mt-6 flex items-center gap-4">
        <div className="rounded-xl bg-white/10 p-1 ring-1 ring-white/25">
          <MemberAvatar avatarUrl={member?.avatar_url} displayName={displayName} size="large" />
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-xl font-semibold leading-tight">{member?.full_name || displayName}</p>
          <p className="mt-0.5 line-clamp-2 text-sm text-white/75">
            {member?.nickname ? `“${member.nickname}”` : ""}
            {member?.nickname && member?.work_line ? " · " : ""}
            {member?.work_line ?? ""}
          </p>
        </div>
      </div>

      <div className="relative mt-6 grid grid-cols-2 gap-x-4 gap-y-3">
        <div className="col-span-2">
          <p className="text-[11px] uppercase tracking-wider text-white/60">เลขสมาชิก</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.12em]">{code}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-white/60">ประเภทสมาชิก</p>
          <p className="mt-1 text-base font-semibold">{member?.association_member_type ?? "—"}</p>
          {member?.association_member_code ? <p className="text-xs text-white/70">รหัส {member.association_member_code}</p> : null}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-white/60">รหัสพนักงาน</p>
          <p className="mt-1 font-mono text-base font-semibold">{member?.employee_code ?? "—"}</p>
          {joined ? <p className="text-xs text-white/70">ตั้งแต่ {joined}</p> : null}
        </div>
      </div>

      <div aria-hidden="true" className="relative mt-5 h-1 w-full rounded-full bg-[linear-gradient(90deg,#C69214_0_72%,rgba(255,255,255,.35)_72%)]" />
    </section>
  );
}
