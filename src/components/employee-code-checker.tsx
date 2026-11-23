"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, CircleDashed, Loader2, SearchX, ShieldAlert } from "lucide-react";

type CheckResult =
  | { found: true; maskedName: string; memberType: string | null; membershipStatus: string; unit: string | null; updatedAt: string | null }
  | { found: false; reason: string; updatedAt?: string | null };

const membershipLabel: Record<string, string> = {
  active: "สมาชิกสมาคมปัจจุบัน",
  inactive: "พ้นสภาพสมาชิกสมาคม",
  suspended: "พักสิทธิ์สมาชิกสมาคม",
  unknown: "ไม่ระบุสถานะสมาชิก",
};

/**
 * Employee-code field with a live lookup against the association member directory, so the
 * applicant sees immediately whether the code is recognised before submitting the form.
 */
export function EmployeeCodeChecker({
  defaultValue,
  disabled,
  inputClassName,
}: {
  defaultValue?: string | null;
  disabled?: boolean;
  inputClassName: string;
}) {
  const [code, setCode] = useState(defaultValue ?? "");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "done"; result: CheckResult } | { kind: "error" }>({ kind: "idle" });

  useEffect(() => {
    const trimmed = code.trim();
    if (disabled || trimmed.length < 3) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ kind: "loading" });
      try {
        const response = await fetch(`/api/directory/check?code=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        setState({ kind: "done", result: (await response.json()) as CheckResult });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState({ kind: "error" });
      }
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [code, disabled]);

  const effective = disabled || code.trim().length < 3 ? ({ kind: "idle" } as const) : state;
  let feedback: React.ReactNode = null;
  if (effective.kind === "loading") {
    feedback = (
      <p className="flex items-center gap-2 text-sm text-ink-subtle"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> กำลังตรวจสอบ...</p>
    );
  } else if (effective.kind === "error") {
    feedback = <p className="flex items-center gap-2 text-sm text-warning"><CircleDashed className="size-4" aria-hidden="true" /> ตรวจรหัสตอนนี้ไม่ได้ จะตรวจอีกครั้งเมื่อกดบันทึก</p>;
  } else if (effective.kind === "done" && effective.result.found) {
    const active = effective.result.membershipStatus === "active";
    feedback = (
      <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${active ? "bg-success-bg text-success" : "bg-warning-bg text-warning"}`}>
        {active ? <BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
        <span>
          พบข้อมูล <span className="font-semibold">{effective.result.maskedName}</span>
          {effective.result.unit ? ` · ${effective.result.unit}` : ""}
          {effective.result.memberType ? ` · ประเภท ${effective.result.memberType}` : ""}
          <span className="block">{membershipLabel[effective.result.membershipStatus] ?? effective.result.membershipStatus}{active ? "" : " · สมัครได้ แต่รอผู้ดูแลตรวจสอบ"}</span>
        </span>
      </div>
    );
  } else if (effective.kind === "done" && !effective.result.found) {
    feedback = (
      <div className="flex items-start gap-2 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
        <SearchX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          ไม่พบรหัสนี้ในฐานสมาชิกสมาคม ตรวจสอบรหัสอีกครั้ง หรือสมัครต่อแล้วรอผู้ดูแลตรวจสอบ
        </span>
      </div>
    );
  }

  return (
    <div className="grid">
      <input
        autoCapitalize="characters"
        autoComplete="off"
        className={inputClassName}
        disabled={disabled}
        inputMode="text"
        name="employeeCode"
        onChange={(event) => setCode(event.target.value)}
        placeholder="เช่น 497901"
        required
        spellCheck={false}
        value={code}
      />
      {/* Announced to screen readers; spacing only when there is something to show. */}
      <div aria-live="polite" className={feedback ? "mt-2" : undefined}>
        {feedback}
      </div>
    </div>
  );
}
