import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDot, Minus, XCircle } from "lucide-react";
import { PotentialBadge } from "@/app/_components/PotentialBadge";
import { ConfidenceBandBadge, ConfidenceRange, FitTierBadge } from "@/app/_components/Badge";
import { provLabel } from "@/app/features/shared/matchTypes";
import { useConfidenceBandCopy, useFitTierLabels } from "@/app/features/shared/MatchPresentation";
import { scoreTone, scoreToneColor } from "@/app/_lib/format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { coverageCount, percentOf, potentialOf } from "./groupEvalHelpers";
import { ArchetypeTag, Pill } from "./GroupEvalPrimitives";
import type { EvalCandidate } from "@/app/features/shared/groupEvalTypes";
// The Salary cell + its shared scale type live in GroupEvalSalaryCell.tsx (kept
// here as a re-export so existing "./GroupEvalComparisonCells" imports for
// SalaryCell/SalaryScale keep working) — split out to keep this file under 200 lines.
export { SalaryCell, type SalaryScale } from "./GroupEvalSalaryCell";

// ---- Value cells of the comparison table (one candidate column each) -------

// "Not measured" must still be READABLE: stone-300 sits at ~1.5:1 on the dark
// theme's surface, so the honest dash the score cells rely on all but vanished
// exactly where a reader needs to tell "absent" from "zero". text-steel is the
// muted-but-legible neutral in both themes.
export const Dash = () => <span className="text-steel">—</span>;

export function FitCell({ c }: { c: EvalCandidate }) {
  const fitLabels = useFitTierLabels();
  return (
    <div className="flex items-center gap-2">
      {/* Unscored renders a dash in the neutral null tone — never a 0. */}
      <span className="font-serif text-[26px] leading-none tabular-nums" style={{ color: scoreToneColor(scoreTone(c.score)) }}>
        {c.score ?? "—"}
      </span>
      <FitTierBadge tier={c.fitTier} score={c.score} labels={fitLabels} />
    </div>
  );
}

export function ConfidenceCell({ c }: { c: EvalCandidate }) {
  const bandCopy = useConfidenceBandCopy();
  if (!c.confidence) return <Dash />;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ConfidenceRange low={c.confidence.low} high={c.confidence.high} drivers={c.confidence.drivers} copy={bandCopy} className="nums text-sm text-steel" />
      <ConfidenceBandBadge level={c.confidence.level} drivers={c.confidence.drivers} copy={bandCopy} />
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
  // Never assessed against the must-haves (no ranker row for this column) → the neutral
  // dash, matching the "not applicable" dashes SkillCell draws for the same skills. A red
  // "0/N" here would be a fabricated total miss, not a measured one.
  if (n == null) return <Dash />;
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
    <span className="inline-flex items-center text-steel" title={t("notApplicableTitle")} aria-label={t("notApplicableAria")}>
      <Minus size={16} aria-hidden />
    </span>
  );
}

