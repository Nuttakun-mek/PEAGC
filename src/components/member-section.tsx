import type { LucideIcon } from "lucide-react";

/** Card surface for /member sections: a little tighter on phones than the shared `card`. */
export const memberCard = "rounded-xl border border-line bg-white p-4 shadow-card sm:p-5";

/**
 * One section of the member page: icon + noun title (+ one short line), then the content.
 * No chevrons: the header is not a link.
 */
export function MemberSection({
  action,
  children,
  className = "",
  description,
  icon: Icon,
  id,
  title,
}: {
  /** Optional small control at the right of the title (e.g. "อ่านทั้งหมด"). */
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  description?: React.ReactNode;
  icon: LucideIcon;
  id?: string;
  title: React.ReactNode;
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section aria-labelledby={titleId} className={`${memberCard} ${className}`} id={id}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-h2 font-semibold text-ink" id={titleId}>
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
