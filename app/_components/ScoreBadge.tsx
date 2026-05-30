// A score rendered as a color-banded pill so the eye can rank candidates
// without reading every number: moss for strong (>=75), dial-amber for the
// middle (50-74), coral for weak (<50). A null score shows a neutral steel
// em-dash chip. Encapsulating the score→color map here keeps the matrix view,
// history list, and JD page consistent.
export function ScoreBadge({ score }: { score: number | null }) {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums";

  if (score == null) {
    return <span className={`${base} bg-steel/10 text-steel`}>—</span>;
  }

  const tone =
    score >= 75
      ? "bg-moss/10 text-moss"
      : score >= 50
        ? "bg-dial-amber/10 text-dial-amber"
        : "bg-coral/10 text-coral";

  return <span className={`${base} ${tone}`}>{score}</span>;
}
