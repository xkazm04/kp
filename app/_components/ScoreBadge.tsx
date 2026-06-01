import { scoreTone, type ScoreTone } from "@/app/_lib/format";

// A score rendered as a color-banded pill so the eye can rank candidates
// without reading every number: strong (>=75) reads moss, mid (50-74) amber,
// weak (<50) coral, and a null score shows a neutral steel em-dash chip. The
// 75/50 cutoffs live once in scoreTone(); these classes only map a tier to its
// `--color-score-*` token, so the matrix view, history list, and JD page stay
// consistent and a re-tone is a single edit in globals.css.
const TONE_CLASS: Record<ScoreTone, string> = {
  strong: "bg-score-strong/10 text-score-strong",
  mid: "bg-score-mid/10 text-score-mid",
  weak: "bg-score-weak/10 text-score-weak",
  null: "bg-score-null/10 text-score-null",
};

export function ScoreBadge({ score }: { score: number | null }) {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-sm font-semibold nums";
  const tone = scoreTone(score);

  if (tone === "null") {
    return <span className={`${base} ${TONE_CLASS.null}`}>—</span>;
  }

  return <span className={`${base} ${TONE_CLASS[tone]}`}>{score}</span>;
}
