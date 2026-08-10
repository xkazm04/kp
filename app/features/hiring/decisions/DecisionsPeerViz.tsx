"use client";

// Shared peer-comparison visual primitives for the Decisions surfaces (the
// Full-analysis "Bench" modal + the AI-review card prototypes). Data-concrete
// on purpose: every mark encodes a real candidate's score / salary / coverage —
// no decorative meters. Tokens only (both themes); copy resolves through the
// decisions.summary catalog.
import { useTranslations } from "next-intl";
import { Pill } from "./groupEval/GroupEvalPrimitives";
import type { PeerStanding } from "./decisionsPeerCompare";

/** Where a value sits on a 0–100 rail, clamped. */
const pct = (v: number) => Math.max(0, Math.min(100, v));

/** One comparative score rail: peers as quiet ticks, the candidate as the coral
 *  marker, the field's best as an ink tick. Reads as "where do I sit in this
 *  field" in a glance. */
export function PeerScoreRail({
  self,
  peers,
  className = "",
}: {
  self: number;
  peers: number[];
  className?: string;
}) {
  const t = useTranslations("decisions.summary");
  const best = peers.length ? Math.max(...peers, self) : self;
  return (
    <span
      className={`relative block h-2.5 overflow-hidden rounded-full bg-stone-100 ${className}`}
      role="img"
      aria-label={t("scoreRailAria", { score: self, count: peers.length + 1 })}
    >
      {/* quiet field ticks — one per peer */}
      {peers.map((p, i) => (
        <span key={i} className="absolute inset-y-0 w-0.5 bg-stone-300" style={{ left: `${pct(p)}%` }} aria-hidden />
      ))}
      {/* the field's best */}
      <span className="absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: `${pct(best)}%` }} aria-hidden />
      {/* this candidate */}
      <span
        className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-coral ring-2 ring-white"
        style={{ left: `${pct(self)}%` }}
        aria-hidden
      />
    </span>
  );
}

/** "#2 of 6" + the delta to the front-runner. Withholds nothing it can't back:
 *  callers pass a null standing to render nothing at all. */
export function RankChips({ standing }: { standing: PeerStanding | null }) {
  const t = useTranslations("decisions.summary");
  if (!standing) return null;
  const leading = standing.rank === 1;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Pill tone={leading ? "moss" : "neutral"} className="nums">
        {t("rankOf", { rank: standing.rank, of: standing.of })}
      </Pill>
      {standing.deltaBest !== 0 ? (
        <Pill
          tone={leading ? "moss" : "coral"}
          className="nums"
          title={leading ? t("vsBestLeadTitle") : t("vsBestTrailTitle")}
        >
          {t(standing.deltaBest > 0 ? "vsBestAhead" : "vsBestBehind", { delta: standing.deltaBest })}
        </Pill>
      ) : null}
      {standing.unscored > 0 ? (
        <Pill tone="amber" className="nums" title={t("unscoredTitle")}>
          {t("unscoredCount", { count: standing.unscored })}
        </Pill>
      ) : null}
    </span>
  );
}

/** Candidate salary expectation plotted against the role band. Same visual
 *  grammar as the group-eval SalaryCell (band wash, expectation bar, coral
 *  midpoint) in a compact single-row form. Renders nothing without BOTH a band
 *  and a same-currency expectation — an incomparable pair must not plot. */
export function SalaryBandRail({
  band,
  salary,
  bandCurrency,
  className = "",
}: {
  band: number[] | null;
  salary: { minimum: number; maximum: number; midpoint: number; currency: string } | null;
  bandCurrency: string;
  className?: string;
}) {
  const t = useTranslations("decisions.summary");
  if (!band || band.length < 2 || !salary) return null;
  if (salary.currency && bandCurrency && salary.currency.trim().toUpperCase() !== bandCurrency.trim().toUpperCase()) return null;
  const lo = Math.min(band[0], salary.minimum);
  const hi = Math.max(band[1], salary.maximum);
  const span = Math.max(1, hi - lo);
  const at = (v: number) => pct(((v - lo) / span) * 100);
  return (
    <span
      className={`relative block h-2.5 overflow-hidden rounded-full bg-stone-100 ${className}`}
      role="img"
      aria-label={t("salaryRailAria", { expMin: salary.minimum, expMax: salary.maximum, bandMin: band[0], bandMax: band[1] })}
    >
      <span
        className="absolute inset-y-0 bg-moss/20 ring-1 ring-inset ring-moss/30"
        style={{ left: `${at(band[0])}%`, width: `${Math.max(1.5, at(band[1]) - at(band[0]))}%` }}
        aria-hidden
      />
      <span
        className="absolute inset-y-[3px] rounded-full bg-ink/60"
        style={{ left: `${at(salary.minimum)}%`, width: `${Math.max(1.5, at(salary.maximum) - at(salary.minimum))}%` }}
        aria-hidden
      />
      <span className="absolute inset-y-0 w-0.5 bg-coral" style={{ left: `${at(salary.midpoint)}%` }} aria-hidden />
    </span>
  );
}
