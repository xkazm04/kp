"use client";

import { useTranslations } from "next-intl";
import { ARCHETYPE_BADGE, isEarlyCareer } from "./JobsTypes";
import type { CandRow } from "./JobsTypes";
// Canonical provenance→badge mapping (incl. the highest-trust `observed` bucket),
// resolved to a localized label via enumLabel at the render site — the JobsTypes
// fork lacked `observed`, so a passed-live-case candidate was mislabeled "academic".
import { provLabel } from "@/app/features/shared/matchTypes";
import { useConfidenceBandCopy, useFitTierLabels } from "@/app/features/shared/MatchPresentation";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ConfidenceBandBadge, ConfidenceRange, FitTierBadge } from "@/app/_components/Badge";
import { PotentialBadge } from "@/app/_components/PotentialBadge";
import { ScoreBadge } from "@/app/_components/ScoreBadge";

export function JobsRecruiterCandidatesCard({
  c,
  added,
  adding,
  error,
  onAdd,
  reached,
  reaching,
  reachError,
  onReach,
  fair,
}: {
  c: CandRow;
  added: boolean;
  adding: boolean;
  error: string | null;
  onAdd: () => void;
  reached: boolean;
  reaching: boolean;
  reachError: string | null;
  onReach: () => void;
  // e1e4e0ea — robust mean + own-vs-robust delta, present only in Fair Rank mode.
  fair?: { own: number; mean: number; delta: number };
}) {
  const t = useTranslations("jobs.candidates");
  const enumLabel = useEnumLabel();
  const bandCopy = useConfidenceBandCopy();
  const fitLabels = useFitTierLabels();
  const res = c.result;
  const early = isEarlyCareer(c.archetype);
  const prov = res.matchedSkillProvenance ?? {};
  // W8-5 — persisted state (server decoration) OR in-session optimism: a
  // candidate reached/filed yesterday must not show fresh, active buttons.
  const wasReached = reached || Boolean(c.outreachSent);
  const persistedStage = c.inPipeline ?? null;
  return (
    <li className="rounded-md border border-stone-200 bg-white p-2">
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBadge score={res.total} />
        {fair ? (
          // e1e4e0ea — the robust (cross-scheme mean) score + delta vs the
          // candidate's own-weight score. Positive Δ = strong under everyone's
          // yardsticks; negative = flattered by their own weights.
          <span
            title={t("robustTitle", { own: fair.own })}
            className={`nums rounded px-1.5 py-0.5 text-sm font-semibold ${fair.delta >= 0 ? "bg-moss/10 text-moss" : "bg-amber-100 text-amber-800"}`}
          >
            {t("robustBadge", { mean: fair.mean, delta: `${fair.delta >= 0 ? "+" : ""}${fair.delta}` })}
          </span>
        ) : null}
        <ConfidenceRange low={res.confidence.low} high={res.confidence.high} drivers={res.confidence.drivers} copy={bandCopy} className="nums text-sm text-steel" />
        <ConfidenceBandBadge level={res.confidence.level} drivers={res.confidence.drivers} copy={bandCopy} />
        <span className="font-medium text-ink">{c.label}</span>
        <span className="rounded-full bg-ink/90 px-1.5 py-0.5 text-sm font-semibold text-white">
          {ARCHETYPE_BADGE[c.archetype] ?? c.archetype}
        </span>
        <FitTierBadge tier={res.fitTier} score={res.total} labels={fitLabels} />
        <span className="ml-auto flex items-center gap-1.5">
          {early && c.potentialScore != null ? (
            <PotentialBadge
              potential={{
                score: c.potentialScore,
                learningSignals: c.learningSignals,
                transferableSkills: c.transferableSkills,
                domainDistance: c.domainDistance,
              }}
            />
          ) : null}
          {wasReached ? (
            // Reaching out also filed them into the pipeline, so a reached candidate
            // collapses to one badge — no redundant "+ pipeline" button.
            <span className="rounded bg-moss/10 px-1.5 py-0.5 text-sm font-semibold text-moss">{t("reachedOut")}</span>
          ) : (
            <>
              <button
                type="button"
                onClick={onReach}
                disabled={reaching}
                title={reachError ?? t("reachTitle")}
                className={`focus-ring rounded px-1.5 py-0.5 text-sm font-semibold ${
                  reachError
                    ? "border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
                    : "border border-coral/40 bg-coral/5 text-coral hover:bg-coral/10 disabled:opacity-40"
                }`}
              >
                {reaching ? t("reaching") : reachError ? t("retry") : t("reachOut")}
              </button>
              {persistedStage && !added ? (
                // Already filed for THIS job (a prior session) — show where they
                // are instead of an add button the server would no-op anyway.
                <span className="rounded bg-moss/10 px-1.5 py-0.5 text-sm font-semibold text-moss">
                  {t("inPipelineStage", { stage: enumLabel("stage", persistedStage) })}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onAdd}
                  disabled={added || adding}
                  title={error ?? undefined}
                  className={`focus-ring rounded px-1.5 py-0.5 text-sm font-semibold ${
                    added
                      ? "bg-moss/10 text-moss"
                      : error
                        ? "border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
                        : "border border-stone-200 text-ink hover:bg-paper disabled:opacity-40"
                  }`}
                >
                  {added ? t("inPipeline") : adding ? t("addingShort") : error ? t("retry") : t("addPipeline")}
                </button>
              )}
            </>
          )}
        </span>
      </div>
      {error && !added ? (
        <p role="alert" className="mt-1 text-sm text-red-700">{t("couldntAdd", { error })}</p>
      ) : null}
      {reachError && !reached ? (
        <p className="mt-1 text-sm text-red-700">{t("couldntReach", { error: reachError })}</p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-1">
        {(res.matchedSkills ?? []).slice(0, 8).map((s) => {
          const pl = provLabel(prov[s] ?? "self_declared");
          return (
            <span key={s} className="inline-flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-sm text-green-700">
              {s}
              <span className={`rounded px-1 text-sm uppercase ${pl.tone}`}>{enumLabel("provenance", pl.key)}</span>
            </span>
          );
        })}
        {(res.missingSkills ?? []).slice(0, 4).map((s) => (
          <span key={`x-${s}`} className="rounded bg-red-50 px-1.5 py-0.5 text-sm text-red-700">
            {`✗ ${s}`}
          </span>
        ))}
      </div>
      {c.assumptions?.length ? (
        <p className="mt-1 text-sm text-steel">
          <span className="font-semibold uppercase">{t("assumptions")}</span> {c.assumptions[0]}
        </p>
      ) : null}
    </li>
  );
}
