// Daily lesson jobs (src/app/api/cron/lessons/route.ts). Every step is idempotent, so a missed or
// repeated run is harmless. Steps run in order and one failure does not stop the others.
//   expire_lesson_offers    offers past their deadline -> back of the queue / dropped, next offered
//   mark_lesson_no_shows    still 'booked' 30 min after the end -> 'no_show' (last 7 days)
//   expire_lesson_credits   expired packages -> 'expired', unused credits leave the ledger, warnings
//   queue_lesson_reminders  in-app reminder for tomorrow's lessons (once per booking)

export const lessonCronSteps = [
  "expire_lesson_offers",
  "mark_lesson_no_shows",
  "expire_lesson_credits",
  "queue_lesson_reminders",
] as const;

export type LessonCronStep = (typeof lessonCronSteps)[number];

type RpcError = { code?: string | null; message: string } | null;
export type LessonCronRpc = (name: LessonCronStep) => PromiseLike<{ data: unknown; error: RpcError }>;

export type LessonCronResult = {
  ok: boolean;
  steps: Array<{ code?: string; error?: string; ok: boolean; result?: unknown; step: LessonCronStep }>;
};

export async function runLessonCron(rpc: LessonCronRpc): Promise<LessonCronResult> {
  const steps: LessonCronResult["steps"] = [];
  for (const step of lessonCronSteps) {
    try {
      const { data, error } = await rpc(step);
      steps.push(
        error
          ? { ...(error.code ? { code: error.code } : {}), error: error.message, ok: false, step }
          : { ok: true, result: data, step },
      );
    } catch (error) {
      steps.push({ error: error instanceof Error ? error.message : String(error), ok: false, step });
    }
  }
  return { ok: steps.every((step) => step.ok), steps };
}

/** Constant-time comparison of the Authorization header with `Bearer ${secret}`. */
export function isAuthorizedCronRequest(header: string | null | undefined, secret: string | null | undefined) {
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const actual = header ?? "";
  let diff = actual.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ (actual.charCodeAt(index) || 0);
  }
  return diff === 0;
}
