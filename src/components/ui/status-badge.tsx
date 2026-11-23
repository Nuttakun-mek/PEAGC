import { type StatusKind, type StatusTone, statusTone } from "@/lib/status";

const toneClass: Record<StatusTone, { dot: string; wrap: string }> = {
  danger: { dot: "bg-danger", wrap: "bg-danger-bg text-danger ring-danger/15" },
  info: { dot: "bg-info", wrap: "bg-info-bg text-info ring-info/15" },
  neutral: { dot: "bg-neutral/60", wrap: "bg-neutral-bg text-neutral ring-neutral/10" },
  success: { dot: "bg-success", wrap: "bg-success-bg text-success ring-success/15" },
  warning: { dot: "bg-warning", wrap: "bg-warning-bg text-warning ring-warning/15" },
};

/**
 * Status pill used by every list. The leading dot keeps statuses distinguishable for colour-blind
 * readers. Pass `tone` directly, or `kind` + `status` to look the tone up in lib/status.ts.
 */
export function StatusBadge({
  children,
  className = "",
  kind,
  status,
  tone,
}: {
  children: React.ReactNode;
  className?: string;
  kind?: StatusKind;
  status?: string | null;
  tone?: StatusTone;
}) {
  const resolved = tone ?? (kind ? statusTone(kind, status) : "neutral");
  const { dot, wrap } = toneClass[resolved];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${wrap} ${className}`}>
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      {children}
    </span>
  );
}
