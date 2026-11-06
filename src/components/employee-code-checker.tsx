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
      <p className="flex items-center gap-2 text-xs text-[#6b6475]"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> กำลังตรวจสอบ...</p>
    );
  } else if (effective.kind === "error") {
    feedback = <p className="flex items-center gap-2 text-xs text-[#805300]"><CircleDashed className="size-3.5" aria-hidden="true" /> ตรวจสอบอัตโนมัติไม่ได้ในขณะนี้ จะตรวจอีกครั้งเมื่อบันทึก</p>;
  } else if (effective.kind === "done" && effective.result.found) {
    const active = effective.result.membershipStatus === "active";
    feedback = (
      <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${active ? "bg-[#edf9f3] text-[#16794b]" : "bg-[#fff9ed] text-[#805300]"}`}>
        {active ? <BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
        <span>
          พบข้อมูล <b>{effective.result.maskedName}</b>
          {effective.result.unit ? ` · ${effective.result.unit}` : ""}
          {effective.result.memberType ? ` · ประเภท ${effective.result.memberType}` : ""}
          <span className="block">{membershipLabel[effective.result.membershipStatus] ?? effective.result.membershipStatus}{active ? "" : " · สมัครได้ แต่รอผู้ดูแลตรวจสอบ"}</span>
        </span>
      </div>
    );
  } else if (effective.kind === "done" && !effective.result.found) {
    feedback = (
      <div className="flex items-start gap-2 rounded-md bg-[#fff9ed] px-3 py-2 text-xs text-[#805300]">
        <SearchX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          ไม่พบรหัสนี้ในฐานสมาชิกสมาคม ตรวจสอบรหัสอีกครั้ง หรือสมัครต่อแล้วรอผู้ดูแลตรวจสอบ
        </span>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
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
      {feedback}
    </div>
  );
}
