import { clampPercent, scoreTone, type ScoreTone } from "@/app/_lib/format";

// A score rendered as a color-banded pill so the eye can rank candidates
// without reading every number: strong (>=75) reads moss, mid (50-74) amber,
// weak (<50) coral, and a null score shows a neutral steel em-dash chip. The
// 75/50 cutoffs live once in scoreTone(); these classes only map a tier to its
// `--color-score-*` token, so the matrix view, history list, and JD page stay
// consistent and a re-tone is a single edit in globals.css.
//
// Spark Dark renders the pill as a STAMP — the landing's verdict mark on the
// CV pile: a tilted, tone-bordered seal with a hard shadow and the display
// face for the number. Same tone language, louder register.
const TONE_CLASS: Record<ScoreTone, string> = {
  strong: "bg-score-strong/10 text-score-strong dark:border-score-strong",
  mid: "bg-score-mid/10 text-score-mid dark:border-score-mid",
  weak: "bg-score-weak/10 text-score-weak dark:border-score-weak",
  null: "bg-score-null/10 text-score-null",
};

const STAMP = "dark:-rotate-3 dark:border-2 dark:font-serif dark:shadow-sticker-xs";

export function ScoreBadge({ score }: { score: number | null }) {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-sm font-semibold nums";
  const tone = scoreTone(score);

  // The null chip stays a flat em-dash in both themes: an absent score is not
  // a verdict, so it never earns the stamp.
  if (tone === "null") {
    return <span className={`${base} ${TONE_CLASS.null}`}>—</span>;
  }

  // Normalize the display the way every sibling score surface does (Meter rounds,
  // ScoreDial clamps+rounds): a fractional 82.6 or out-of-range 150 must not leak
  // onto a hiring surface (shared-ui-design-system #5). score is non-null here.
  return <span className={`${base} ${STAMP} ${TONE_CLASS[tone]}`}>{Math.round(clampPercent(score as number))}</span>;
}
