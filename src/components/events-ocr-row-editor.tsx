"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { checkCard, describeCheck } from "@/lib/ocr/validate";

export type OcrEditorCell = { flags: string[]; raw: string; value: string };

type OcrRowEditorProps = {
  cells: OcrEditorCell[];
  disabled?: boolean;
  pars: number[];
  printedTotals: { in: string; out: string; total: string };
  rowIndex: number;
  /** Offer the player / marker confirmation boxes (needs the confirmations migration). */
  showConfirmations: boolean;
};

const inputBase =
  "input-compact h-10 w-full min-w-0 rounded border text-center text-sm tabular-nums text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15";

/**
 * One scanned row, checked live by the fixed rules (every hole 1-15 or X, sums equal the card's
 * OUT / IN / TOTAL). Failing or doubtful cells are orange (warning tone). Field names: r{n}h1..18,
 * r{n}out / r{n}in / r{n}total, r{n}player / r{n}marker.
 */
export function OcrRowEditor({ cells, disabled, pars, printedTotals, rowIndex: r, showConfirmations }: OcrRowEditorProps) {
  const [values, setValues] = useState(() => Array.from({ length: 18 }, (_, i) => cells[i]?.value ?? ""));
  const [totals, setTotals] = useState(printedTotals);
  const [playerChecked, setPlayerChecked] = useState(false);
  const check = checkCard(values, totals);
  const problems = describeCheck(check);

  const nine = (start: number) => {
    const holes = Array.from({ length: 9 }, (_, i) => start + i);
    const columns = start === 0 ? 1 : 2;
    return (
      <table className="w-full table-fixed text-center text-xs" key={start}>
        <caption className="sr-only">{start === 0 ? "หลุม 1-9" : "หลุม 10-18"}</caption>
        <colgroup>
          <col className="w-16" />
          {holes.map((index) => <col key={index} />)}
          {Array.from({ length: columns }, (_, i) => <col className="w-14" key={`t${i}`} />)}
        </colgroup>
        <thead>
          <tr className="text-ink-muted">
            <th className="pr-1 text-left font-medium" scope="col">หลุม</th>
            {holes.map((index) => <th className="font-semibold tabular-nums" key={index} scope="col">{index + 1}</th>)}
            <th className="font-medium" scope="col">{start === 0 ? "OUT" : "IN"}</th>
            {start === 9 ? <th className="font-medium" scope="col">TOTAL</th> : null}
          </tr>
          <tr className="text-ink-subtle">
            <th className="pr-1 text-left font-medium" scope="row">พาร์</th>
            {holes.map((index) => <td className="tabular-nums" key={index}>{pars[index]}</td>)}
            <td className="tabular-nums">{holes.reduce((sum, index) => sum + pars[index], 0)}</td>
            {start === 9 ? <td className="tabular-nums">{pars.reduce((sum, value) => sum + value, 0)}</td> : null}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="pr-1 text-left font-medium text-ink-muted" scope="row">สโตรก</th>
            {holes.map((index) => {
              const cell = cells[index];
              const issue = check.cellIssues[index];
              const flagged = Boolean(issue) || Boolean(cell?.flags.length);
              const note = [issue, ...(cell?.flags ?? [])].filter(Boolean).join(", ");
              return (
                <td className="px-0.5 align-top" key={index}>
                  <input
                    aria-invalid={issue ? true : undefined}
                    aria-label={`แถว ${r + 1} หลุม ${index + 1}${note ? ` (${note})` : ""}`}
                    className={`${inputBase} ${flagged ? "border-warning bg-warning-bg" : "border-line bg-white"}`}
                    disabled={disabled}
                    inputMode="numeric"
                    name={`r${r}h${index + 1}`}
                    onChange={(event) => setValues((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
                    title={cell ? `เขียนว่า "${cell.raw}"${note ? ` · ${note}` : ""}` : note || undefined}
                    value={values[index]}
                  />
                  <span className="mt-0.5 block h-5 truncate text-xs text-ink-subtle">{cell?.raw ?? ""}</span>
                </td>
              );
            })}
            {(start === 0 ? (["out"] as const) : (["in", "total"] as const)).map((key) => {
              const issue = check.totalIssues[key];
              return (
                <td className="px-0.5 align-top" key={key}>
                  <input
                    aria-invalid={issue ? true : undefined}
                    aria-label={`แถว ${r + 1} ${key.toUpperCase()} ที่เขียนบนการ์ด${issue ? ` (${issue})` : ""}`}
                    className={`${inputBase} ${issue ? "border-warning bg-warning-bg" : "border-line bg-white"}`}
                    disabled={disabled}
                    inputMode="numeric"
                    name={`r${r}${key}`}
                    onChange={(event) => setTotals((current) => ({ ...current, [key]: event.target.value }))}
                    placeholder="บนการ์ด"
                    title={issue ?? "ค่าที่เขียนบนการ์ด"}
                    value={totals[key]}
                  />
                  <span className="mt-0.5 block h-5 text-xs tabular-nums text-ink-subtle">
                    รวม {check.sums[key] ?? "–"}
                  </span>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    );
  };

  return (
    <div className="mt-3 grid gap-3">
      <div className="overflow-x-auto">
        <div className="grid min-w-[36rem] gap-3">
          {nine(0)}
          {nine(9)}
        </div>
      </div>

      {problems.length ? (
        <div className="rounded-lg border border-warning/20 bg-warning-bg px-3 py-2 text-sm text-warning" role="status">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            ยังไม่ผ่านการตรวจ <span className="tabular-nums">{problems.length}</span> จุด
          </p>
          <ul className="mt-1 list-disc pl-6">
            {problems.slice(0, 6).map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        </div>
      ) : (
        <p className="text-sm font-medium text-success" role="status">ผ่านการตรวจ ทุกหลุม 1-15 และผลรวมตรงกับการ์ด</p>
      )}

      {showConfirmations ? (
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink">
          <label className="inline-flex items-center gap-2">
            <input
              checked={playerChecked}
              className="size-5"
              disabled={disabled}
              name={`r${r}player`}
              onChange={(event) => setPlayerChecked(event.target.checked)}
              type="checkbox"
            />
            ผู้เล่นตรวจแล้ว ถูกต้อง
          </label>
          <label className="inline-flex items-center gap-2">
            <input className="size-5" disabled={disabled || !playerChecked} name={`r${r}marker`} type="checkbox" />
            marker ยืนยันแล้ว
          </label>
        </div>
      ) : null}
    </div>
  );
}
