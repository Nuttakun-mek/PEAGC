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
      className="group/create mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 shadow-[0_10px_30px_rgba(114,34,87,0.06)]"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-5 py-4 transition hover:bg-[#fcf8fb]">
        <span className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#722257] text-white shadow-[0_6px_14px_rgba(114,34,87,0.25)]">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-semibold text-[#722257]">{title}</span>
            {hint ? <span className="block text-xs text-[#6b6475]">{hint}</span> : null}
          </span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-[#98a2b3] transition group-open/create:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-[#eef0f3] p-5">{children}</div>
    </details>
  );
}
