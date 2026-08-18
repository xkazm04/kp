"use client";

import { useLocale, useTranslations } from "next-intl";
import { ConfidenceBandBadge, confidenceBandTitle } from "@/app/_components/Badge";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import type { MatchRef, MatchResult } from "@/app/features/shared/matchTypes";
import { formatBandCompact, isEarlyCareer } from "@/app/features/shared/matchTypes";
import { Bar, ReasoningPanel, ScoreBreakdown, useConfidenceBandCopy, useFitTierLabels, useMatchLabels } from "@/app/features/shared/MatchPresentation";
import { FitTierBadge } from "@/app/_components/Badge";
import { Checkbox } from "@/app/_components/Checkbox";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useMatchCardReasoning } from "./useMatchCardReasoning";
import { MatchCardSkillChips } from "./MatchCardSkillChips";

export function MatchCard({
  m,
  index,
  matchRef,
  archetype,
  canAdd,
  added,
  adding,
  addError,
  onAdd,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  m: MatchResult;
  index: number;
  matchRef: MatchRef;
  archetype: string;
  canAdd: boolean;
  added: boolean;
  adding: boolean;
  addError?: string;
  onAdd: () => void;
  // Bulk-shortlist selection (only meaningful when the candidate can be added and
  // isn't already in the pipeline). The checkbox is hidden otherwise.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const t = useTranslations("match");
  // UAT RECON-02 — the shared score-provenance vocabulary (app/_components/
  // ScoreProvenanceLabel.tsx doctrine: "every surface that shows THE match score
  // names where the number came from … so the wording can't drift"). Read from the
  // same `scoreProvenance` catalog as the board and the decisions queue so the
  // three producers are named in one language.
  const tProv = useTranslations("scoreProvenance");
  // Compact band digits group in the READER's locale (format.ts number-locale contract).
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const matchLabels = useMatchLabels();
  // Localized confidence-band drivers (English fallback baked in) — reused by the
  // badge tooltip, the score-column title, and the inline "why this band" line so
  // all three read the same language.
  const driverLabels = matchLabels.drivers(m.confidence);
  const bandCopy = useConfidenceBandCopy();
  const fitLabels = useFitTierLabels();
  const early = isEarlyCareer(archetype);
  const canExplain = Boolean(matchRef.profileId || matchRef.analysisSlug);
  const { reasoning, explain } = useMatchCardReasoning({ t, matchRef, jobId: m.jobId, title: m.title });

  return (
    <li className="rounded-lg border border-stone-200 p-3">
      <div className="flex items-start gap-4">
        {/* UAT RECON-02 — the score is no longer bare. `m.total` here is producer
            (C) in the match-score producer map (app/_lib/match-score.ts): a FRESH
            recompute run against this role's current text, never persisted back to
            the pipeline entry. The board shows producer (B), the snapshot stamped
            at add-to-pipeline time. Both are legitimate, and they diverge — the
            same candidate can honestly read 57 here and 49 there — so the number
            names its own producer instead of leaving the reader to assume one
            of them is broken. The chip sits in the header row beside the band
            badge; the full sentence is in this number's own title.

            UAT RECON-06 — and the interval under it is labelled `Range`, its own
            word. It is a MEASUREMENT interval (how far this score could move given
            how thin the evidence is), which is a different thing from the model's
            self-report on a decisions card, from the salary read's evidence grade,
            and from the archetype's signal agreement. One word each. */}
        <div className="w-16 shrink-0 text-center tabular-nums tracking-tight">
          <div className="font-serif text-2xl text-ink" title={tProv("freshMatchTitle")}>
            {m.total}
          </div>
          <div className="mt-0.5 text-meta uppercase tracking-wide text-stone-400">{t("card.rangeLabel")}</div>
          <div className="text-sm text-steel" title={confidenceBandTitle(driverLabels, bandCopy.title)}>
            <span className="sr-only">{t("card.rangeAria", { low: m.confidence.low, high: m.confidence.high })}</span>
            <span aria-hidden>
              {m.confidence.low}–{m.confidence.high}
            </span>
          </div>
          <div className="mt-0.5 text-sm uppercase text-steel">#{index + 1}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-ink">{m.title}</span>
            <FitTierBadge tier={m.fitTier} score={m.total} labels={fitLabels} />
            {m.isEntryEligible ? (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-sm font-semibold text-green-700">
                {t("card.entryEligible")}
              </span>
            ) : null}
            <ConfidenceBandBadge level={m.confidence.level} drivers={driverLabels} copy={bandCopy} />
            {/* UAT RECON-02 — the score's producer, in the repo's established
                provenance-chip grammar (CHIP_QUIET + a caller-supplied tone; see
                ProvenanceChip in the JD-intake brief). Deliberately toneless: a
                fresh recompute is neither a claim someone made nor an assumption
                the app filled in, so it gets no moss/coral tint — just its name. */}
            <span className={CHIP_QUIET} title={tProv("freshMatchTitle")}>
              {tProv("freshMatch")}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {selectable && canAdd && !added ? (
                <Checkbox
                  checked={selected}
                  onChange={onToggleSelect}
                  aria-label={t("card.shortlistAria", { title: m.title })}
                  title={t("card.shortlistTitle")}
                />
              ) : null}
              {canAdd ? (
                <button
                  type="button"
                  onClick={onAdd}
                  disabled={added || adding}
                  className={`focus-ring rounded-md px-2 py-0.5 text-sm font-semibold transition-colors ${
                    added
                      ? "bg-moss/10 text-moss"
                      : "border border-stone-200 text-ink hover:bg-paper disabled:opacity-40"
                  }`}
                >
                  {added ? t("card.inPipeline") : adding ? t("card.adding") : t("card.addPipeline")}
                </button>
              ) : null}
              {canExplain ? (
                <button
                  type="button"
                  onClick={explain}
                  disabled={reasoning?.loading}
                  className="focus-ring rounded-md border border-stone-200 px-2 py-0.5 text-sm font-semibold text-coral hover:bg-paper disabled:opacity-40"
                >
                  {reasoning?.loading ? t("card.reasoningBusy") : reasoning?.data ? t("card.refreshReasoning") : t("card.explainFit")}
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-0.5 text-sm text-steel tabular-nums tracking-tight">
            {t.rich("card.metaLine", {
              company: m.company ?? "—",
              location: m.location ?? "—",
              workMode: m.workMode ? enumLabel("workMode", m.workMode) : "—",
              family: m.roleFamily ? enumLabel("family", m.roleFamily) : "—",
              seniority: m.seniority ?? "—",
              salary: formatBandCompact(m.salaryBand, locale),
              b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
            })}
          </p>

          {m.scoreBreakdown && m.scoreBreakdown.length > 0 ? (
            <ScoreBreakdown dims={m.scoreBreakdown} total={m.total} />
          ) : (
            // Fallback for a response without the server breakdown (e.g. an older
            // cached shape): the raw per-dimension scores, weight-blind.
            <div className="mt-2 grid max-w-md grid-cols-3 gap-2">
              <Bar label={early ? t("dims.foundation") : t("dims.skills")} value={m.skillsScore} />
              <Bar label={early ? t("dims.potential") : t("dims.career")} value={m.careerScore} />
              <Bar label={early ? t("dims.fit") : t("dims.personal")} value={m.personalScore} />
            </div>
          )}

          {/* A non-tight band's WHY belongs in plain sight, not in a tooltip — a
              recruiter reading "34–62" must see "early-career, thinner record"
              without knowing to hover. Tight bands stay quiet. */}
          {m.confidence.level !== "tight" && driverLabels.length > 0 ? (
            <p className="mt-1.5 text-sm text-steel">
              <span className="font-medium text-ink">{t("card.whyBandLabel")}</span> {driverLabels.join(" · ")}
            </p>
          ) : null}

          <MatchCardSkillChips
            matchedSkills={m.matchedSkills}
            missingSkills={m.missingSkills}
            matchedSkillProvenance={m.matchedSkillProvenance}
            matchedSkillStrength={m.matchedSkillStrength}
            early={early}
          />

          {addError ? (
            <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-sm text-red-700" role="alert">
              {addError}
            </p>
          ) : null}

          {reasoning ? <ReasoningPanel state={reasoning} /> : null}
        </div>
      </div>
    </li>
  );
}
