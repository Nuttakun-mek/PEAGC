/**
 * Par + stroke index inputs for 18 holes, as two nine-hole rows so it fits a 390px phone.
 * Field names: `par1`..`par18` and `si1`..`si18` (read by the course and scoring-rules actions).
 */

const cell =
  "input-compact h-9 w-full min-w-0 rounded border border-line bg-white text-center text-sm tabular-nums text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15 disabled:bg-canvas disabled:text-ink-muted";

export function HoleGrid({
  disabled,
  idPrefix,
  pars,
  strokeIndex,
}: {
  disabled?: boolean;
  idPrefix: string;
  pars: (number | null)[];
  strokeIndex: (number | null)[];
}) {
  return (
    <div className="grid gap-3">
      {[0, 9].map((start) => {
        const holes = Array.from({ length: 9 }, (_, i) => start + i);
        const parSum = holes.reduce((sum, index) => sum + (pars[index] ?? 0), 0);
        return (
          <table className="w-full table-fixed text-center text-sm" key={start}>
            <caption className="sr-only">{start === 0 ? "หลุม 1-9" : "หลุม 10-18"}</caption>
            <colgroup>
              <col className="w-14" />
              {holes.map((index) => (
                <col key={index} />
              ))}
              <col className="w-12" />
            </colgroup>
            <thead>
              <tr className="text-xs text-ink-subtle">
                <th className="pb-1 pr-1 text-left font-medium" scope="col">หลุม</th>
                {holes.map((index) => (
                  <th className="pb-1 font-semibold tabular-nums text-ink-muted" key={index} scope="col">
                    {index + 1}
                  </th>
                ))}
                <th className="pb-1 font-medium" scope="col">{start === 0 ? "OUT" : "IN"}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="pr-1 text-left text-xs font-medium text-ink-subtle" scope="row">พาร์</th>
                {holes.map((index) => (
                  <td className="px-0.5 py-0.5" key={index}>
                    <input
                      aria-label={`พาร์หลุม ${index + 1}`}
                      className={cell}
                      defaultValue={pars[index] ?? ""}
                      disabled={disabled}
                      id={`${idPrefix}-par${index + 1}`}
                      inputMode="numeric"
                      max={6}
                      min={3}
                      name={`par${index + 1}`}
                      required
                      type="number"
                    />
                  </td>
                ))}
                <td className="text-xs font-semibold tabular-nums text-ink-muted">{parSum || ""}</td>
              </tr>
              <tr>
                <th className="pr-1 text-left text-xs font-medium text-ink-subtle" scope="row">
                  <abbr className="no-underline" title="ลำดับความยากของหลุม (Stroke index) 1 = ยากที่สุด">SI</abbr>
                </th>
                {holes.map((index) => (
                  <td className="px-0.5 py-0.5" key={index}>
                    <input
                      aria-label={`ลำดับความยาก (SI) หลุม ${index + 1}`}
                      className={cell}
                      defaultValue={strokeIndex[index] ?? ""}
                      disabled={disabled}
                      id={`${idPrefix}-si${index + 1}`}
                      inputMode="numeric"
                      max={18}
                      min={1}
                      name={`si${index + 1}`}
                      required
                      type="number"
                    />
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        );
      })}
    </div>
  );
}
