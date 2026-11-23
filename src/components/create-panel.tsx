import { ChevronDown, Plus } from "lucide-react";

/**
 * Collapsible "add new" panel, so list pages open on the list (what admins use most) instead of
 * a long empty form. Opens by itself when the last create attempt came back with an error.
 */
export function CreatePanel({
  children,
  defaultOpen = false,
  hint,
  title,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  hint?: string;
  title: string;
}) {
  return (
    <details
      className="group/create mt-6 scroll-mt-24 rounded-xl border border-line bg-white shadow-card"
      // "#create" in the URL (quick actions in the search palette) opens the first panel on the page.
      data-create-panel=""
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-5 py-4 transition hover:bg-brand-50/50">
        <span className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-semibold text-brand-600">{title}</span>
            {hint ? <span className="block text-sm text-ink-subtle">{hint}</span> : null}
          </span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-ink-subtle transition group-open/create:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-line p-5">{children}</div>
    </details>
  );
}
