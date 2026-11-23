/**
 * Page title row shared by admin pages: one h1 (the menu already says where you are, so no
 * "ระบบผู้ดูแล" eyebrow), an optional one-line description, and at most the page's primary action.
 */
export function PageHeader({
  actions,
  description,
  title,
}: {
  actions?: React.ReactNode;
  description?: React.ReactNode;
  title: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[1.625rem] font-semibold leading-[2.125rem] text-brand-600 sm:text-display">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
