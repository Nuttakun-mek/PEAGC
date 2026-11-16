import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

import { StatusBannerShell } from "@/components/status-banner-shell";

export type BannerTone = "success" | "info" | "warning" | "error";

const toneStyles: Record<BannerTone, { icon: typeof Info; wrap: string }> = {
  error: { icon: XCircle, wrap: "border-[#f3c6cb] bg-[#fdecec] text-[#8a1f11]" },
  info: { icon: Info, wrap: "border-[#e6d9e2] bg-[#f8edf4] text-[#722257]" },
  success: { icon: CheckCircle2, wrap: "border-[#bfe3cf] bg-[#edf9f3] text-[#16794b]" },
  warning: { icon: AlertTriangle, wrap: "border-[#efd9a6] bg-[#fff9ed] text-[#805300]" },
};

/** Picks a tone from a `?status=` key by its wording so every page colours feedback consistently. */
export function toneForStatus(status: string | undefined): BannerTone {
  if (!status) return "info";
  if (/(failed|invalid|closed|full|locked|denied|required|not-approved|too-large|unreadable|mismatch|limit|overlap|started|not-pairable|no-groups|no-players|too-many|outdated|not-found|taken|blocked|corrupt|duplicate|not-saved|wrong|needs-reason|weak|same-password|expired)/.test(status)) return "error";
  if (/(pending|review|waitlist|stale|not-open|partial|not-bookable)/.test(status)) return "warning";
  if (/(saved|created|updated|approved|booked|changed|cancelled|submitted|imported|acked|registered|deleted|archived|removed|generated|sent|checked-in|assigned|moved|cleared|marked|undone|promoted|restored|opened)/.test(status)) return "success";
  return "info";
}

export function StatusBanner({
  children,
  className = "",
  floating = false,
  title,
  tone = "info",
}: {
  children: React.ReactNode;
  className?: string;
  /** Result of a just-submitted action: shown as a toast until dismissed or the admin moves on. */
  floating?: boolean;
  title?: string;
  tone?: BannerTone;
}) {
  const { icon: Icon, wrap } = toneStyles[tone];
  return (
    <StatusBannerShell
      // A floating banner is a fixed toast; the caller's layout margins only apply inline.
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${wrap} ${floating ? "" : className}`}
      floating={floating}
      tone={tone}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-6">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5" : "font-medium"}>{children}</div>
      </div>
    </StatusBannerShell>
  );
}

/** Page-level warning when one or more queries failed, instead of silently showing empty lists. */
export function LoadErrorBanner({
  className = "mt-5",
  error,
}: {
  className?: string;
  error: { labels: string[]; outdated: boolean } | null;
}) {
  if (!error) return null;
  return (
    <StatusBanner className={className} title="โหลดข้อมูลบางส่วนไม่สำเร็จ" tone="error">
      {error.outdated
        ? `ฐานข้อมูลยังไม่ได้อัปเดตให้ตรงกับระบบ (migration ค้างอยู่) ส่วนที่ได้รับผลกระทบ: ${error.labels.join(", ")} ข้อมูลที่แสดงอาจไม่ครบ กรุณาแจ้งผู้ดูแลระบบ`
        : `ส่วนที่โหลดไม่สำเร็จ: ${error.labels.join(", ")} กรุณาลองโหลดหน้าใหม่ หากยังไม่หายให้แจ้งผู้ดูแลระบบ`}
    </StatusBanner>
  );
}
