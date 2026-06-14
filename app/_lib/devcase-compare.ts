// Side-by-side rubric comparison for the Dev Case studio (idea-b268f5e5). Each
// evaluated submission already carries its capability scores on the SAME rubric
// axes (the case's RUBRIC_DIMENSIONS); laying them out as one axis-by-candidate
// matrix turns "open five EvalPanels and squint" into a direct read of who leads
// on framing vs judgment vs architecture. Pure + import-free (structural input
// types) so it's unit-testable and the studio composes it over loaded submissions.

type RubricDimLike = { name?: string; label?: string };
type DimScoreLike = { name?: string; score?: number };
type EvalInner = { dimensions?: DimScoreLike[]; dimensionScores?: Record<string, number> };
type SubmissionLike = {
  id: string;
  candidateRef?: string | null;
  transferScore?: number | null;
  evaluation?: { evaluation?: EvalInner | null } | null;
};

export type CompareAxis = { name: string; label: string };
export type CompareColumn = {
  id: string;
  candidateRef: string | null;
  transferScore: number | null;
  // axis name -> score (0..100), or null when this submission has no score on it.
  scores: Record<string, number | null>;
};
export type RubricComparison = {
  axes: CompareAxis[];
  columns: CompareColumn[];
  // axis name -> the leading column's id (null when no column scored that axis).
  leaderByAxis: Record<string, string | null>;
};

// A submission's score on one axis: prefer the ordered `dimensions` projection
// (matches what EvalPanel renders), fall back to the dimensionScores source map.
function scoreFor(inner: EvalInner, name: string): number | null {
  const dim = inner.dimensions?.find((d) => d.name === name);
  if (dim && typeof dim.score === "number") return dim.score;
  const s = inner.dimensionScores?.[name];
  return typeof s === "number" ? s : null;
}

/** Build the axis × candidate score matrix for a case's evaluated submissions.
 *  Axes come from the case's rubric (canonical order + labels); when the case
 *  carries none, they're derived from the union of the submissions' own scored
 *  dimensions so older bundles still compare. `maxColumns` caps the matrix width
 *  (highest transferScore first) — the caller reports the true count. */
export function rubricCompare(
  rubricDims: RubricDimLike[],
  submissions: SubmissionLike[],
  maxColumns = 5
): RubricComparison {
  const evaluated = submissions
    .filter((s) => s.evaluation?.evaluation)
    .sort((a, b) => (b.transferScore ?? -1) - (a.transferScore ?? -1))
    .slice(0, maxColumns);

  // Axes: the case's rubric when present, else the union of scored dimension
  // names across the evaluated submissions (first-seen order).
  let axes: CompareAxis[] = rubricDims
    .filter((d): d is RubricDimLike & { name: string } => Boolean(d.name))
    .map((d) => ({ name: d.name, label: d.label ?? d.name }));
  if (axes.length === 0) {
    const seen = new Map<string, string>();
    for (const s of evaluated) {
      const inner = s.evaluation!.evaluation!;
      for (const d of inner.dimensions ?? []) if (d.name && !seen.has(d.name)) seen.set(d.name, d.name);
      for (const name of Object.keys(inner.dimensionScores ?? {})) if (!seen.has(name)) seen.set(name, name);
    }
    axes = [...seen.keys()].map((name) => ({ name, label: name }));
  }

  const columns: CompareColumn[] = evaluated.map((s) => {
    const inner = s.evaluation!.evaluation!;
    const scores: Record<string, number | null> = {};
    for (const axis of axes) scores[axis.name] = scoreFor(inner, axis.name);
    return { id: s.id, candidateRef: s.candidateRef ?? null, transferScore: s.transferScore ?? null, scores };
  });

  const leaderByAxis: Record<string, string | null> = {};
  for (const axis of axes) {
    let bestId: string | null = null;
    let best = -Infinity;
    for (const col of columns) {
      const v = col.scores[axis.name];
      if (v != null && v > best) {
        best = v;
        bestId = col.id;
      }
    }
    leaderByAxis[axis.name] = bestId;
  }

  return { axes, columns, leaderByAxis };
}
