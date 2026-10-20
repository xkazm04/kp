import type { Candidate, Matrix, Position } from "./matrixTabTypes";

/** Preserve the visible grid's row/column order, then append scorer omissions. */
export function matrixCsvRows(
  data: Pick<Matrix, "cells" | "missingJobs">,
  rows: { cand: Candidate; ri: number }[],
  cols: { i: number; p: Position }[],
  labels: { candidate: string; missingJobId: string; missingJobError: string },
  blockedLabel: (cell: { koKeys?: string[] }) => string,
): (string | number)[][] {
  const csv: (string | number)[][] = [
    [labels.candidate, ...cols.map(({ p }) => p.title)],
    ...rows.map(({ cand, ri }) => [
      cand.label,
      ...cols.map(({ i }) => {
        const cell = data.cells[ri]?.[i];
        if (cell?.blocked) return blockedLabel(cell);
        return cell?.score ?? "–";
      }),
    ]),
  ];
  if (data.missingJobs?.length) {
    csv.push([], [labels.missingJobId, labels.missingJobError]);
    csv.push(...data.missingJobs.map(({ id, error }) => [id ?? "", error]));
  }
  return csv;
}
