"use client";

import { Crown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Analysis } from "@/app/_lib/schemas";
import { scoreTone, type ScoreTone } from "@/app/_lib/format";
import { VERDICT_BANDS, scoreBandIndex } from "@/app/_components/scoreDial.logic";
import { PANEL } from "@/app/_components/ui/recipes";
import { resolveVerdict } from "./verdict";
import { FRAMING_KEY, verdictAriaLabel } from "./verdictAria";

// Direction 1 (verdict-above-the-fold) — the report LEADS with a colored, glyphed
// verdict, mirroring the app-wide eval-report standard (pipeline/jobfit/eval/
// runner.py's verdict_banner: a color-coded bar + the shared ✓ / ✗ / – glyph set).
// The verdict used to live only inside the Extraction tab's ScoreDial — and on a
// multi-variant run (which defaults to the Compare tab) it wasn't on screen at all.
//
// The band label + the readout color reuse the SAME helpers the dial does
// (scoreBandIndex / VERDICT_BANDS for the word, scoreTone for the color), so the
// banner and the buried dial can never tell two stories. Tokens only — the
// score-* scale is theme-mapped, so this holds in Spark Dark.

// scoreTone (strong / mid / weak / null) → the shared verdict glyph + its
// score-scale skin. The 3-glyph set collapses the four tones: strong ✓, weak ✗,
// and both mid and the unscored floor read as the neutral – (nothing to affirm or
// reject). Glyphs are aria-hidden — the band word + framing carry the meaning.
const TONE: Record<ScoreTone, { glyph: string; bar: string; text: string; wash: string }> = {
  strong: { glyph: "✓", bar: "border-l-score-strong", text: "text-score-strong", wash: "bg-score-strong/10" },
  mid: { glyph: "–", bar: "border-l-score-mid", text: "text-score-mid", wash: "bg-score-mid/10" },
  weak: { glyph: "✗", bar: "border-l-score-weak", text: "text-score-weak", wash: "bg-score-weak/10" },
  null: { glyph: "–", bar: "border-l-score-null", text: "text-score-null", wash: "bg-score-null/10" },
};


export function VerdictBanner({ analysis }: { analysis: Analysis }) {
  const t = useTranslations("report");
  const { overall, jobFit, winnerLabel } = resolveVerdict(analysis);
  const scored = overall != null;
  // Unscored → the neutral null tone: the – glyph, no band word, and the honest
  // "not enough to score" framing. Never a fabricated band on absent data.
  const tone = scoreTone(scored ? overall : null);
  const skin = TONE[tone];
  const band = scored ? t(VERDICT_BANDS[scoreBandIndex(overall)].key) : null;

  // `role="img"` makes every descendant PRESENTATIONAL (img is one of ARIA's
  // presentational-children roles), so the aria-label is the whole banner for a
  // screen reader — the band word, the framing sentence, the job-fit chip and the
  // crowned winner are all dropped from the accessibility tree. The label used to
  // carry the score + band only, so on a multi-variant run the one fact the banner
  // exists to deliver — WHICH CV won — was announced nowhere. Compose the label
  // from the same already-localized strings the chips render (no new catalog keys)
  // so the spoken banner says exactly what the painted one does.
  const ariaLabel = verdictAriaLabel(t, { overall: scored ? overall : null, band, jobFit, winnerLabel, tone });

  return (
    <div
      // PANEL composed, not re-typed: the accent rail is a separate modifier on
      // top of the recipe, so a restyle of the panel surface reaches the banner.
      className={`${PANEL} border-l-4 ${skin.bar} p-4`}
      role="img"
      aria-label={ariaLabel}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span aria-hidden className={`text-h2 font-bold leading-none ${skin.text}`}>
          {skin.glyph}
        </span>
        <p className="text-meta uppercase tracking-wide text-steel">{t("verdict.heading")}</p>
        {scored ? (
          <span className={`inline-flex items-baseline gap-1.5 ${skin.text}`}>
            <span className="text-display font-bold leading-none nums dark:font-serif">{overall}</span>
            <span className="text-sm text-steel">{t("verdict.outOf")}</span>
            <span className="text-sm font-semibold uppercase tracking-wide">{band}</span>
          </span>
        ) : (
          <span className="text-display font-bold leading-none text-score-null">—</span>
        )}
        {jobFit != null ? (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-sm font-semibold ${TONE[scoreTone(jobFit)].wash} ${TONE[scoreTone(jobFit)].text}`}
          >
            {t("verdict.jobFit", { score: jobFit })}
          </span>
        ) : null}
        {winnerLabel ? (
          <span className="ml-auto inline-flex items-center gap-1 truncate text-sm text-steel" title={winnerLabel}>
            <Crown className="h-3.5 w-3.5 shrink-0 text-coral" aria-hidden />
            <span className="truncate">{t("verdict.winner", { label: winnerLabel })}</span>
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm leading-5 text-steel">{t(FRAMING_KEY[tone])}</p>
    </div>
  );
}
