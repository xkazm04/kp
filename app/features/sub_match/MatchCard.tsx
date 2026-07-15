"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { ConfidenceBandBadge, confidenceBandTitle } from "@/app/_components/Badge";
import type { MatchRef, MatchResult, Reasoning, ReasoningState } from "./MatchTypes";
import { formatBandCompact, isEarlyCareer, provLabel } from "./MatchTypes";
import { Bar, ReasoningPanel, ScoreBreakdown, useMatchLabels } from "./MatchShared";
import { FitTierBadge } from "@/app/_components/Badge";
import { Checkbox } from "@/app/_components/Checkbox";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

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
  // MAT1 — the recruiter's active locale is the language the "Explain fit"
  // verdict/strengths/gaps narrative should come back in; ride it in the task
  // params (the detached task can't read the cookie).
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const matchLabels = useMatchLabels();
  // Localized confidence-band drivers (English fallback baked in) — reused by the
  // badge tooltip, the score-column title, and the inline "why this band" line so
  // all three read the same language.
  const driverLabels = matchLabels.drivers(m.confidence);
  const { startTask } = useTasks();
  const [reasoning, setReasoning] = useState<ReasoningState | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const MATCHED_CAP = 8;
  const MISSING_CAP = 6;
  const early = isEarlyCareer(archetype);
  const canExplain = Boolean(matchRef.profileId || matchRef.analysisSlug);

  // Routed through the background-task system: tracked, dedup'd, refresh-safe.
  const explain = async () => {
    if (reasoning?.loading) return;
    setReasoning({ loading: true });
    const started = await startTask("reasoning", { ...matchRef, jobId: m.jobId, label: m.title, lang: locale });
    if (!started) {
      setReasoning({ error: t("card.startFailed") });
      return;
    }
    setTaskId(started.id);
  };

  const { status: reasoningStatus, error: reasoningError, full: reasoningFull } = useTaskResult(taskId);
  // Task completion is consumed DURING render (guarded: taskId is cleared in the
  // same pass, so this runs once per task) — the guarded render-phase pattern,
  // so the result paints in the same commit instead of one effect-frame later.
  if (taskId && reasoningStatus === "succeeded" && reasoningFull) {
    const p = reasoningFull.result as { reasoning?: Reasoning; source?: string; cached?: boolean; narrativeLang?: string } | null;
    setReasoning(p?.reasoning ? { data: p.reasoning, source: p.source, cached: p.cached, narrativeLang: p.narrativeLang } : { error: t("card.noReasoning") });
    setTaskId(null);
  } else if (taskId && (reasoningStatus === "failed" || reasoningStatus === "canceled" || reasoningStatus === "interrupted")) {
    setReasoning({ error: reasoningError ?? t("card.reasoningFailed") });
    setTaskId(null);
  }

  return (
    <li className="rounded-lg border border-stone-200 p-3">
      <div className="flex items-start gap-4">
        <div className="w-16 shrink-0 text-center tabular-nums tracking-tight">
          <div className="font-serif text-2xl text-ink">{m.total}</div>
          <div className="text-sm text-steel" title={confidenceBandTitle(driverLabels)}>
            {m.confidence.low}–{m.confidence.high}
          </div>
          <div className="mt-0.5 text-sm uppercase text-steel">#{index + 1}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-ink">{m.title}</span>
            <FitTierBadge tier={m.fitTier} score={m.total} />
            {m.isEntryEligible ? (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-sm font-semibold text-green-700">
                {t("card.entryEligible")}
              </span>
            ) : null}
            <ConfidenceBandBadge level={m.confidence.level} drivers={driverLabels} />
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
              salary: formatBandCompact(m.salaryBand),
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

          {(() => {
            const matched = m.matchedSkills ?? [];
            const missing = m.missingSkills ?? [];
            const matchedShown = skillsExpanded ? matched : matched.slice(0, MATCHED_CAP);
            const missingShown = skillsExpanded ? missing : missing.slice(0, MISSING_CAP);
            const hidden = Math.max(0, matched.length - matchedShown.length) + Math.max(0, missing.length - missingShown.length);
            return (
              <div className="mt-2 flex flex-wrap gap-1">
                {matchedShown.map((s) => {
                  const pl = early ? provLabel((m.matchedSkillProvenance ?? {})[s] ?? "self_declared") : null;
                  // A 0.5–<1.0 hit is a taxonomy/sibling or provenance-discounted PARTIAL
                  // match, not proven exact possession — mark it so "matched: Kubernetes"
                  // isn't read as verified Kubernetes experience.
                  const strength = (m.matchedSkillStrength ?? {})[s];
                  const partial = typeof strength === "number" && strength < 1;
                  return (
                    <span
                      key={`m-${s}`}
                      title={partial ? t("card.partialTitle", { pct: Math.round(strength * 100) }) : undefined}
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-green-700 ${partial ? "bg-green-50/60 ring-1 ring-inset ring-green-600/30" : "bg-green-50"}`}
                    >
                      {partial ? `~ ${s}` : s}
                      {pl ? <span className={`rounded px-1 text-sm uppercase ${pl.tone}`}>{enumLabel("provenance", pl.key)}</span> : null}
                    </span>
                  );
                })}
                {missingShown.map((s) => (
                  <span
                    key={`x-${s}`}
                    className="rounded-md bg-red-50 px-1.5 py-0.5 text-sm text-red-700"
                    title={early ? t("card.missingTitleEarly") : t("card.missingTitle")}
                  >
                    {`✗ ${s}`}
                  </span>
                ))}
                {hidden > 0 || skillsExpanded ? (
                  <button
                    type="button"
                    onClick={() => setSkillsExpanded((v) => !v)}
                    className="focus-ring rounded-md bg-stone-100 px-1.5 py-0.5 text-sm font-semibold text-steel hover:bg-stone-200"
                  >
                    {skillsExpanded ? t("card.showLess") : t("card.moreCount", { count: hidden })}
                  </button>
                ) : null}
              </div>
            );
          })()}

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
