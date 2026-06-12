import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDot, Minus, XCircle } from "lucide-react";
import { PotentialBadge } from "@/app/_components/PotentialBadge";
import { ConfidenceBandBadge, confidenceBandTitle, FitTierBadge } from "@/app/_components/Badge";
import { provLabel } from "@/app/features/sub_match/MatchTypes";
import { formatSalaryRange, scoreTone, scoreToneColor } from "@/app/_lib/format";
import { isSameCurrency, normalizeCurrency, salaryBandPosition } from "@/app/_lib/salary-band";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { coverageCount, percentOf, potentialOf } from "./helpers";
import { ArchetypeTag, Pill, PILL_TONE } from "./primitives";
import type { EvalCandidate } from "./types";

// ---- Value cells of the comparison table (one candidate column each) -------

export const Dash = () => <span className="text-stone-300">—</span>;

export function FitCell({ c }: { c: EvalCandidate }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-serif text-[26px] leading-none tabular-nums" style={{ color: scoreToneColor(scoreTone(c.score)) }}>
        {c.score}
      </span>
      <FitTierBadge tier={c.fitTier} score={c.score} />
    </div>
  );
}

export function ConfidenceCell({ c }: { c: EvalCandidate }) {
  if (!c.confidence) return <Dash />;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="nums text-sm text-steel" title={confidenceBandTitle(c.confidence.drivers)}>
        {c.confidence.low}–{c.confidence.high}
      </span>
      <ConfidenceBandBadge level={c.confidence.level} drivers={c.confidence.drivers} />
    </div>
  );
}

export function ProfileCell({ c }: { c: EvalCandidate }) {
  const enumLabel = useEnumLabel();
  return (
    <div className="flex flex-wrap gap-1">
      <ArchetypeTag archetype={c.archetype} />
      {c.seniority ? <Pill>{enumLabel("seniority", c.seniority)}</Pill> : null}
      {c.potentialScore != null ? <PotentialBadge potential={potentialOf(c)} /> : null}
    </div>
  );
}

export function CoverageCell({ c, mustRows }: { c: EvalCandidate; mustRows: string[] }) {
  const n = coverageCount(c, mustRows);
  const tone = n === mustRows.length ? "text-moss" : n === 0 ? "text-red-700" : "text-amber-700";
  return (
    <div>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>
        {n}/{mustRows.length}
      </span>
      <div className="mt-1 flex gap-0.5" aria-hidden>
        {mustRows.map((_, i) => (
          <span key={i} className={`h-2 flex-1 rounded-full ${i < n ? "bg-moss" : "bg-stone-200"}`} />
        ))}
      </div>
    </div>
  );
}

export function DimCell({ c, dimKey, isLeader }: { c: EvalCandidate; dimKey: string; isLeader: boolean }) {
  const t = useTranslations("decisions.groupEval");
  const pct = percentOf(c, dimKey);
  if (pct == null) return <Dash />;
  return (
    <div className="flex items-center gap-2">
      <span className={`w-7 shrink-0 tabular-nums ${isLeader ? "font-semibold text-ink" : "text-ink"}`}>{pct}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: scoreToneColor(scoreTone(pct)) }} />
      </span>
      {isLeader ? <Pill tone="moss">{t("dimLeader")}</Pill> : null}
    </div>
  );
}

export function SkillsLegend() {
  const t = useTranslations("decisions.groupEval");
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Pill tone="moss">
        <CheckCircle2 size={12} /> {t("strong")}
      </Pill>
      <Pill tone="amber">
        <CircleDot size={12} /> {t("partial")}
      </Pill>
      <Pill tone="coral">
        <XCircle size={12} /> {t("missing")}
      </Pill>
    </span>
  );
}

export function SkillCell({ skill, c }: { skill: string; c: EvalCandidate }) {
  const t = useTranslations("decisions.groupEval");
  const enumLabel = useEnumLabel();
  const matched = (c.matchedSkills ?? []).includes(skill);
  const missing = (c.missingSkills ?? []).includes(skill);
  if (matched) {
    const strength = c.matchedSkillStrength?.[skill] ?? 1;
    const strong = strength >= 0.85;
    const pct = Math.round(strength * 100);
    const pl = provLabel(c.matchedSkillProvenance?.[skill] ?? "self_declared");
    return (
      <span className="inline-flex items-center gap-1" title={strong ? t("skillStrongTitle", { pct }) : t("skillPartialTitle", { pct })}>
        {strong ? <CheckCircle2 size={16} className="text-moss" aria-hidden /> : <CircleDot size={16} className="text-amber-600" aria-hidden />}
        <span className={`rounded px-1 text-sm uppercase ${pl.tone}`}>{enumLabel("provenance", pl.key)}</span>
        {!strong ? <span className="nums text-sm text-steel">{pct}%</span> : null}
      </span>
    );
  }
  if (missing) {
    return (
      <span className="inline-flex items-center text-red-700" title={t("missingMustHaveTitle")} aria-label={t("missingAria")}>
        <XCircle size={16} aria-hidden />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-stone-300" title={t("notApplicableTitle")} aria-label={t("notApplicableAria")}>
      <Minus size={16} aria-hidden />
    </span>
  );
}

// Presentation of the over/under-band verdict: the pure math + the currency-safety
// contract live in salary-band.ts; this only maps the position to a label + tone.
// Callers MUST gate on isSameCurrency first (see SalaryCell) so this never prints a
// confident "% over" for an expectation in a different currency than the band.
function salaryVerdict(mid: number, lo: number, hi: number): { position: "over" | "under" | "within"; pct: number; tone: keyof typeof PILL_TONE } {
  const { position, pct } = salaryBandPosition(mid, lo, hi);
  if (position === "over") return { position: "over", pct, tone: "coral" };
  if (position === "under") return { position: "under", pct, tone: "info" };
  return { position: "within", pct: 0, tone: "moss" };
}

// The shared salary scale (built once in ComparisonTable, consumed per cell) so
// the bars are comparable column-to-column.
export type SalaryScale = { lo: number; hi: number; pct: (v: number) => number };

export function SalaryCell({ c, sal, bandCurrency }: { c: EvalCandidate; sal: SalaryScale; bandCurrency: string }) {
  const t = useTranslations("decisions.groupEval");
  const s = c.salaryExpectation;
  // The over/under-band verdict AND the band-relative bar position are only
  // meaningful when the expectation shares the band's currency — the app does no
  // FX, so a EUR expectation against a CZK band would otherwise print a confident
  // but meaningless "% over" and plot at a bogus spot. On a mismatch we drop the
  // bar/verdict and surface the currencies explicitly instead.
  const comparable = Boolean(s) && isSameCurrency(s!.currency, bandCurrency);
  const verdict = s && comparable && sal.hi > 0 ? salaryVerdict(s.midpoint, sal.lo, sal.hi) : null;
  return (
    <div className="space-y-1">
      <div className="relative h-5 overflow-hidden rounded-md bg-stone-100">
        {sal.hi > 0 ? (
          <span
            className="absolute inset-y-0 bg-moss/15 ring-1 ring-inset ring-moss/30"
            style={{ left: `${sal.pct(sal.lo)}%`, width: `${Math.max(1, sal.pct(sal.hi) - sal.pct(sal.lo))}%` }}
            aria-hidden
          />
        ) : null}
        {s && comparable ? (
          <>
            <span
              className="absolute inset-y-1 rounded-full bg-ink/70"
              style={{ left: `${sal.pct(s.minimum)}%`, width: `${Math.max(1.5, sal.pct(s.maximum) - sal.pct(s.minimum))}%` }}
              aria-hidden
            />
            <span
              className="absolute inset-y-0 w-0.5 bg-coral"
              style={{ left: `${sal.pct(s.midpoint)}%` }}
              title={t("midpointTitle", { range: formatSalaryRange(s.midpoint, s.midpoint, { currency: s.currency }) })}
              aria-hidden
            />
          </>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm text-steel">
          {s ? formatSalaryRange(s.minimum, s.maximum, { currency: s.currency }) : t("noExpectation")}
        </span>
        {verdict ? (
          <Pill tone={verdict.tone}>
            {t(
              verdict.position === "over" ? "salaryOver" : verdict.position === "under" ? "salaryUnder" : "salaryWithin",
              { pct: verdict.pct }
            )}
          </Pill>
        ) : s && !comparable && sal.hi > 0 ? (
          <Pill
            tone="amber"
            className="whitespace-nowrap"
            title={t("crossCurrencyTitle", {
              expectation: normalizeCurrency(s.currency),
              band: normalizeCurrency(bandCurrency),
            })}
          >
            {t("crossCurrencyPill", { expectation: normalizeCurrency(s.currency), band: normalizeCurrency(bandCurrency) })}
          </Pill>
        ) : null}
      </div>
    </div>
  );
}
