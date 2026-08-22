// Pure row ordering + floor-filtering for the Fit Matrix, extracted from MatrixTab so the
// score-collapse edge case is unit-testable (MatrixTab is .tsx — the node --test runner
// strips types but cannot load JSX).
//
// bug-ui-scan-2026-07-09 (skill-matrix-coverage #4): the old inline best() did
//   Math.max(0, ...visible.map((s) => s ?? -1))
// so a row with NO assessed visible cell — hard-blocked on every shown role, or simply not
// scored for the current family filter — collapsed to 0, indistinguishable from a candidate
// genuinely scored 0. It sank among the weak on the default sort and then vanished under the
// min-fit floor with no way to tell "no strong fit" from "not assessed / blocked on a gate
// you could renegotiate". columnStats/colScores already exclude blocked+null cells to keep
// "not assessed" distinct from a score; best() was the one axis (sort + floor) that erased
// it. Here best returns null for "no assessed cell", null-best rows sort into their own
// TRAILING group, and the floor treats them as unassessed (hidden AND counted separately)
// rather than as a real 0 — so the count/empty affordance can distinguish the two.

/** Best (max) of a row's VISIBLE scores, or null when the row has NO assessed cell.
 *  null is deliberately NOT 0 — it means "not assessed", the distinction the sort and the
 *  fit floor act on. Non-finite / blocked (null|undefined) cells are ignored. */
export function bestVisibleScore(scores: ReadonlyArray<number | null | undefined>): number | null {
  let best: number | null = null;
  for (const s of scores) {
    if (typeof s === "number" && Number.isFinite(s)) best = best === null ? s : Math.max(best, s);
  }
  return best;
}

export type MatrixRowInput<T> = {
  item: T;
  /** Candidate label — the A–Z sort key. */
  label: string;
  /** The row's scores for the VISIBLE columns, in column order (null/undefined = blocked/unscored). */
  visibleScores: ReadonlyArray<number | null | undefined>;
  /** The score for the column being sorted on, when a column sort is active (else undefined). */
  sortColScore?: number | null;
};

/** BCP-47 tag the A–Z sort collates under. Omitted = the JS runtime default, which is the
 *  BROWSER's locale, not the reader's chosen app locale — and the two disagree on Czech:
 *  `cs` treats Č as its own letter directly after C ("Cejka" < "Čech"), while `en` folds it
 *  into C as an accent and compares the next letter instead ("Čech" < "Cejka"). A cs reader
 *  on an en-US browser got the English order under an "A–Z" label. */
export type CollationLocale = string | undefined;

export type MatrixRowOrder<T> = {
  order: T[];
  /** Rows that HAD an assessed best but scored below minFit (a real weak fit, hidden). */
  hiddenByFloor: number;
  /** Rows with NO assessed cell at all, dropped by a floor > 0 (distinct from a weak fit). */
  hiddenUnassessed: number;
};

// Higher score first; null/undefined (unassessed) always sinks to the trailing group,
// never sorting as if it were 0.
function scoreDesc(a: number | null | undefined, b: number | null | undefined): number {
  return (b ?? -Infinity) - (a ?? -Infinity);
}

/** Order + floor-filter candidate rows for the matrix. Returns the surviving order plus the
 *  two hidden counts so the UI can say "N not scored for this view" separately from the
 *  fit-floor cut. Sort precedence mirrors MatrixTab: an active column sort, else best-fit,
 *  else A–Z. Unassessed (null-best) rows trail every scored row under both numeric sorts. */
export function orderMatrixRows<T>(
  rows: ReadonlyArray<MatrixRowInput<T>>,
  opts: { sortByFit: boolean; sortByColumn: boolean; minFit: number; locale?: CollationLocale },
): MatrixRowOrder<T> {
  const withBest = rows.map((r) => ({ r, best: bestVisibleScore(r.visibleScores) }));

  let hiddenByFloor = 0;
  let hiddenUnassessed = 0;
  const kept = withBest.filter(({ best }) => {
    if (opts.minFit <= 0) return true; // floor off — keep everyone (unassessed rows still trail)
    if (best === null) {
      hiddenUnassessed += 1;
      return false;
    }
    if (best < opts.minFit) {
      hiddenByFloor += 1;
      return false;
    }
    return true;
  });

  const sorted = [...kept].sort((a, b) => {
    if (opts.sortByColumn) return scoreDesc(a.r.sortColScore, b.r.sortColScore);
    if (opts.sortByFit) return scoreDesc(a.best, b.best);
    return a.r.label.localeCompare(b.r.label, opts.locale);
  });

  return { order: sorted.map(({ r }) => r.item), hiddenByFloor, hiddenUnassessed };
}
