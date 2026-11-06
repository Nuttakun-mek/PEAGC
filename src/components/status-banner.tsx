import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

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
  if (/(failed|invalid|closed|full|locked|denied|required|not-approved|too-large|unreadable|mismatch|limit|overlap|started)/.test(status)) return "error";
  if (/(pending|review|waitlist|stale|not-open)/.test(status)) return "warning";
  if (/(saved|created|updated|approved|booked|changed|cancelled|submitted|imported|acked|registered|deleted|archived|removed|generated|sent)/.test(status)) return "success";
  return "info";
}

export function StatusBanner({
  children,
  className = "",
  title,
  tone = "info",
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  tone?: BannerTone;
}) {
  const { icon: Icon, wrap } = toneStyles[tone];
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${wrap} ${className}`} role="status">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-6">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5" : "font-medium"}>{children}</div>
      </div>
    </div>
  );
}
