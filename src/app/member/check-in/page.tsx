import Link from "next/link";
import { CircleCheck, CircleX, ScanQrCode } from "lucide-react";

import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { formatTimeRange } from "@/components/lesson-slot-table";
import { buttonClass } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { formatThaiDateLong, formatThaiDateTime, formatThaiTime } from "@/lib/display";
import { bangkokDate } from "@/lib/lessons/booking";
import { rpcErrorCode, rpcErrorMessage, rpcErrorTime } from "@/lib/lessons/errors";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

// QR check-in landing: the coach shows a QR (or one is printed at the venue) that opens
// /member/check-in?token=… . Signing in keeps the token (next=…), then check_in_lesson marks the
// booking 'attended'. Scanning twice is harmless (the RPC answers "already").

type PageProps = {
  searchParams: Promise<{ bypass?: string; t?: string; token?: string }>;
};

type CheckInResult = {
  already: boolean;
  checked_in_at: string | null;
  end_time: string;
  lesson_date: string;
  start_time: string;
  title: string;
};

type Outcome =
  | { kind: "success"; result: CheckInResult }
  | { kind: "error"; message: string; tryAgain: boolean }
  | { kind: "missing" }
  | { kind: "unavailable" };

const TOKEN = /^[0-9a-f]{32}$/i;

export default async function LessonCheckInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = (params.token ?? params.t ?? "").trim();
  const nextPath = token ? `/member/check-in?token=${encodeURIComponent(token)}` : "/member/check-in";
  const access = await resolveAccess({
    allowBypassRole: "member",
    nextPath,
    requiredRole: "member",
    searchParams: params,
  });
  const q = access.isBypass ? "?bypass=member" : "";

  let outcome: Outcome;
  if (!token) {
    outcome = { kind: "missing" };
  } else if (access.isBypass) {
    const today = bangkokDate();
    outcome = {
      kind: "success",
      result: { already: false, checked_in_at: `${today}T09:22:00.000Z`, end_time: "17:30:00", lesson_date: today, start_time: "16:30:00", title: "กอล์ฟพื้นฐาน" },
    };
  } else if (!TOKEN.test(token)) {
    outcome = { kind: "error", message: rpcErrorMessage("INVALID_TOKEN"), tryAgain: false };
  } else {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("check_in_lesson", { p_token: token });
    if (!error) {
      outcome = { kind: "success", result: data as CheckInResult };
    } else if (classifyDbError(error) === "schema-outdated") {
      outcome = { kind: "unavailable" };
    } else {
      const code = rpcErrorCode(error.message);
      if (!code) logDbError("member.check-in", error);
      const opensAt = code === "TOO_EARLY" ? rpcErrorTime(error.details) : null;
      const message =
        code === "TOO_EARLY" && opensAt
          ? `ยังไม่ถึงเวลาเช็กชื่อ เรียนเริ่ม ${formatThaiTime(opensAt.toISOString())} เช็กชื่อได้ก่อนเรียน 30 นาที`
          : rpcErrorMessage(error.message, "เช็กชื่อไม่สำเร็จ ลองสแกนใหม่อีกครั้ง");
      outcome = { kind: "error", message, tryAgain: code === "TOO_EARLY" || !code };
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-canvas px-4 py-8 text-ink">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <ClubCrest priority size={40} />
          <p className="text-sm font-medium text-ink-subtle">{CLUB_NAME}</p>
        </div>

        <section aria-live="polite" className="rounded-2xl border border-line bg-white p-6 text-center shadow-card">
          {outcome.kind === "success" ? (
            <>
              <CircleCheck className="mx-auto size-20 text-success" aria-hidden="true" />
              <h1 className="mt-4 text-display font-semibold text-success">
                {outcome.result.already ? "เช็กชื่อไว้แล้ว" : "เช็กชื่อสำเร็จ"}
              </h1>
              <p className="mt-3 text-h3 font-semibold text-ink">{outcome.result.title}</p>
              <p className="mt-1 text-base text-ink-muted">{formatThaiDateLong(outcome.result.lesson_date)}</p>
              <p className="text-h3 font-semibold tabular-nums text-brand-600">
                {formatTimeRange(outcome.result.start_time, outcome.result.end_time)}
              </p>
              {outcome.result.checked_in_at ? (
                <p className="mt-3 text-base text-ink-muted">บันทึกเวลา {formatThaiDateTime(outcome.result.checked_in_at)}</p>
              ) : null}
              <p className="mt-1 text-base text-ink-muted">ขอให้สนุกกับการเรียน</p>
            </>
          ) : outcome.kind === "error" ? (
            <>
              <CircleX className="mx-auto size-20 text-danger" aria-hidden="true" />
              <h1 className="mt-4 text-h2 font-semibold text-danger">เช็กชื่อไม่สำเร็จ</h1>
              <p className="mt-3 text-h3 font-medium text-ink">{outcome.message}</p>
              {outcome.tryAgain ? <p className="mt-2 text-base text-ink-muted">ถึงเวลาแล้วสแกน QR อีกครั้ง หรือให้ผู้สอนเช็กชื่อให้</p> : null}
              {!outcome.tryAgain ? <p className="mt-2 text-base text-ink-muted">ถ้าคิดว่าไม่ถูกต้อง ให้ผู้สอนเช็กชื่อให้</p> : null}
            </>
          ) : outcome.kind === "unavailable" ? (
            <>
              <ScanQrCode className="mx-auto size-20 text-ink-subtle" aria-hidden="true" />
              <h1 className="mt-4 text-h2 font-semibold text-ink">ยังเช็กชื่อด้วย QR ไม่ได้</h1>
              <p className="mt-3 text-base text-ink-muted">ให้ผู้สอนเช็กชื่อให้ที่จุดเรียน</p>
            </>
          ) : (
            <>
              <ScanQrCode className="mx-auto size-20 text-ink-subtle" aria-hidden="true" />
              <h1 className="mt-4 text-h2 font-semibold text-ink">สแกน QR เพื่อเช็กชื่อ</h1>
              <p className="mt-3 text-base text-ink-muted">ใช้กล้องมือถือสแกน QR ที่ผู้สอนแสดง หรือที่ติดไว้ที่จุดเรียน</p>
            </>
          )}
        </section>

        <div className="mt-5 grid gap-3">
          <Link className={`${buttonClass("primary", "lg")} w-full`} href={`/member/lessons${q}`}>
            ไปหน้าเรียนกอล์ฟ
          </Link>
          <Link className={`${buttonClass("secondary", "lg")} w-full`} href={`/member${q}`}>
            หน้าสมาชิก
          </Link>
        </div>
      </div>
    </main>
  );
}
