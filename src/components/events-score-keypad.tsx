"use client";

import { ChevronLeft, ChevronRight, Delete, X } from "lucide-react";
import { useReducer, useRef } from "react";

import { SubmitButton } from "@/components/submit-button";
import { buttonClass } from "@/components/ui/styles";
import { appIcons } from "@/lib/icons";
import { HIGH_VALUES, initialKeypadState, keypadFieldValues, keypadReducer, keypadTotals } from "@/lib/scoring/keypad";

type ScoreKeypadProps = {
  action: (formData: FormData) => void | Promise<void>;
  eventId: string;
  initialValues: string[];
  pars: number[];
  playerName: string;
  registrationId: string;
  /** Hole the player's group starts on (shotgun / 10th tee). */
  startHole?: number | null;
  strokeIndex: number[];
  triggerClassName?: string;
  triggerLabel?: string;
};

const keyClass =
  "flex h-16 items-center justify-center rounded-xl border border-line bg-white text-2xl font-semibold tabular-nums text-ink shadow-card transition active:scale-[0.97] active:bg-brand-50";

/**
 * Hole-by-hole score entry for phones: big buttons 1-9 and "10+", one value per tap, then the next
 * hole. Shows par and SI for the hole and the running OUT / IN / TOTAL. Posts the same h1..h18
 * fields as the desktop grid, so the server action is unchanged.
 */
export function ScoreKeypad({
  action,
  eventId,
  initialValues,
  pars,
  playerName,
  registrationId,
  startHole,
  strokeIndex,
  triggerClassName,
  triggerLabel = "กรอกทีละหลุม",
}: ScoreKeypadProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, dispatch] = useReducer(keypadReducer, undefined, () => initialKeypadState(initialValues, startHole ?? 1));
  const totals = keypadTotals(state.values);
  const fields = keypadFieldValues(state.values);
  const current = state.values[state.hole];
  const par = pars[state.hole];
  const ScoresIcon = appIcons.scores;
  const SaveIcon = appIcons.save;

  const nineLabel = (label: string, nine: { filled: number; pickups: number; strokes: number }) => (
    <div className="rounded-lg bg-canvas px-2 py-1.5 text-center">
      <p className="text-xs font-medium text-ink-subtle">{label}</p>
      <p className="text-h3 font-semibold tabular-nums text-ink">{nine.filled ? nine.strokes : "–"}</p>
      <p className="text-xs tabular-nums text-ink-subtle">
        {nine.filled}/{label === "รวม" ? 18 : 9} หลุม{nine.pickups ? ` · X ${nine.pickups}` : ""}
      </p>
    </div>
  );

  return (
    <>
      <button className={triggerClassName ?? buttonClass("primary", "md")} onClick={() => dialogRef.current?.showModal()} type="button">
        <ScoresIcon className="size-4" aria-hidden="true" />
        {triggerLabel}
      </button>
      <dialog
        aria-label={`กรอกสกอร์ ${playerName}`}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-canvas p-0 text-ink backdrop:bg-ink/40 sm:m-auto sm:h-auto sm:max-h-[92dvh] sm:max-w-md sm:rounded-2xl"
        ref={dialogRef}
      >
        <form action={action} className="flex h-full flex-col">
          <input name="eventId" type="hidden" value={eventId} />
          <input name="registrationId" type="hidden" value={registrationId} />
          {fields.map((value, i) => (
            <input key={i} name={`h${i + 1}`} type="hidden" value={value} />
          ))}

          <header className="flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-3">
            <p className="min-w-0 truncate font-semibold text-ink">{playerName}</p>
            <button
              aria-label="ปิด"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-canvas"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {/* Hole strip: tap to jump */}
            <div className="grid gap-1.5" role="group" aria-label="เลือกหลุม">
              {[0, 9].map((start) => (
                <div className="grid grid-cols-9 gap-1" key={start}>
                  {Array.from({ length: 9 }, (_, i) => start + i).map((index) => {
                    const value = state.values[index];
                    const active = index === state.hole;
                    return (
                      <button
                        aria-current={active ? "step" : undefined}
                        aria-label={`หลุม ${index + 1}${value === null ? " ยังไม่กรอก" : ` สกอร์ ${value}`}`}
                        className={`flex h-11 flex-col items-center justify-center rounded-md border text-sm tabular-nums ${
                          active ? "border-brand-600 bg-brand-50 ring-2 ring-brand-600/20" : "border-line bg-white"
                        }`}
                        key={index}
                        onClick={() => dispatch({ hole: index, type: "goto" })}
                        type="button"
                      >
                        <span className="text-xs leading-4 text-ink-subtle">{index + 1}</span>
                        <span className="font-semibold leading-4 text-ink">{value ?? "·"}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div aria-live="polite" className="mt-3 flex items-end justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
              <div>
                <p className="text-h2 font-semibold text-ink">
                  หลุม <span className="tabular-nums">{state.hole + 1}</span>
                </p>
                <p className="text-sm text-ink-muted">
                  พาร์ <span className="font-semibold tabular-nums text-ink">{par}</span> · ลำดับความยาก (SI){" "}
                  <span className="tabular-nums">{strokeIndex[state.hole]}</span>
                </p>
              </div>
              <p className="text-[3rem] font-semibold leading-none tabular-nums text-brand-600">{current ?? "–"}</p>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {nineLabel("OUT", totals.out)}
              {nineLabel("IN", totals.in)}
              {nineLabel("รวม", totals.total)}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {(state.page === "high" ? HIGH_VALUES : [1, 2, 3, 4, 5, 6, 7, 8, 9]).map((value) => (
                <button
                  className={`${keyClass} ${value === par ? "border-brand-600/40" : ""}`}
                  key={value}
                  onClick={() => dispatch({ type: "digit", value })}
                  type="button"
                >
                  {value}
                </button>
              ))}
              <button
                aria-label="เก็บลูก (X)"
                className={`${keyClass} text-lg`}
                onClick={() => dispatch({ type: "pickup" })}
                type="button"
              >
                X
              </button>
              <button
                aria-pressed={state.page === "high"}
                className={`${keyClass} text-lg ${state.page === "high" ? "border-brand-600 bg-brand-50 text-brand-600" : ""}`}
                onClick={() => dispatch({ type: "toggleHigh" })}
                type="button"
              >
                {state.page === "high" ? "1-9" : "10+"}
              </button>
              <button aria-label="ล้างหลุมนี้" className={`${keyClass} text-lg`} onClick={() => dispatch({ type: "clear" })} type="button">
                <Delete className="size-6" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className={buttonClass("secondary", "lg")} onClick={() => dispatch({ type: "prev" })} type="button">
                <ChevronLeft className="size-5" aria-hidden="true" />
                หลุมก่อน
              </button>
              <button className={buttonClass("secondary", "lg")} onClick={() => dispatch({ type: "next" })} type="button">
                หลุมถัดไป
                <ChevronRight className="size-5" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-subtle">X = เก็บลูก ไม่จบหลุม · กดเลขแล้วไปหลุมถัดไปเอง</p>
          </div>

          <footer className="grid gap-3 border-t border-line bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input className="size-5" name="verifyNow" type="checkbox" /> ยืนยันทันที (ตรวจกับการ์ดแล้ว)
            </label>
            <SubmitButton className={`${buttonClass("primary", "lg")} w-full`} pendingText="กำลังบันทึก...">
              <SaveIcon className="size-5" aria-hidden="true" />
              บันทึกสกอร์ (รวม <span className="tabular-nums">{totals.total.strokes}</span>)
            </SubmitButton>
          </footer>
        </form>
      </dialog>
    </>
  );
}
