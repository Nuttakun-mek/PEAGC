/**
 * Small "UAT" tag shown on test environments (NEXT_PUBLIC_APP_ENV = uat or staging), so nobody
 * mistakes the test site for the real one. Renders nothing in production or when unset. Works in
 * server and client components (the value is inlined at build time).
 */
export function appEnvLabel(value = process.env.NEXT_PUBLIC_APP_ENV) {
  const env = (value ?? "").trim().toLowerCase();
  if (env === "uat") return "UAT";
  if (env === "staging") return "Staging";
  return null;
}

export function EnvBadge({ className = "" }: { className?: string }) {
  const label = appEnvLabel();
  if (!label) return null;
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-md border border-warning/30 bg-warning-bg px-2 text-xs font-semibold text-warning ${className}`}
      title="ระบบทดสอบ ข้อมูลในนี้อาจถูกลบได้"
    >
      {label}
      <span className="sr-only"> (ระบบทดสอบ)</span>
    </span>
  );
}
