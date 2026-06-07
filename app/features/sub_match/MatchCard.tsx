"use client";

import { useState } from "react";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { ConfidenceBandBadge, confidenceBandTitle } from "@/app/_components/Badge";
import type { MatchRef, MatchResult, Reasoning, ReasoningState } from "./MatchTypes";
import { isEarlyCareer, FAMILY_LABEL, provLabel } from "./MatchTypes";
import { Bar, ReasoningPanel, ScoreBreakdown } from "./MatchShared";
import { FitTierBadge } from "@/app/_components/Badge";

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
}) {
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
    const t = await startTask("reasoning", { ...matchRef, jobId: m.jobId, label: m.title });
    if (!t) {
      setReasoning({ error: "Couldn't start the fit analysis." });
      return;
    }
    setTaskId(t.id);
  };

  const { status: reasoningStatus, error: reasoningError, full: reasoningFull } = useTaskResult(taskId);
  // Task completion is consumed DURING render (guarded: taskId is cleared in the
  // same pass, so this runs once per task) — the guarded render-phase pattern,
  // so the result paints in the same commit instead of one effect-frame later.
  if (taskId && reasoningStatus === "succeeded" && reasoningFull) {
    const p = reasoningFull.result as { reasoning?: Reasoning; source?: string; cached?: boolean } | null;
    setReasoning(p?.reasoning ? { data: p.reasoning, source: p.source, cached: p.cached } : { error: "No reasoning returned." });
    setTaskId(null);
  } else if (taskId && (reasoningStatus === "failed" || reasoningStatus === "canceled" || reasoningStatus === "interrupted")) {
    setReasoning({ error: reasoningError ?? "Reasoning failed." });
    setTaskId(null);
  }

  return (
    <li className="rounded-lg border border-stone-200 p-3">
      <div className="flex items-start gap-4">
        <div className="w-16 shrink-0 text-center tabular-nums tracking-tight">
          <div className="font-serif text-2xl text-ink">{m.total}</div>
          <div className="text-sm text-steel" title={confidenceBandTitle(m.confidence.drivers)}>
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
                entry-eligible
              </span>
            ) : null}
            <ConfidenceBandBadge level={m.confidence.level} drivers={m.confidence.drivers} />
            <div className="ml-auto flex items-center gap-1.5">
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
                  {added ? "✓ In pipeline" : adding ? "Adding…" : "+ Pipeline"}
                </button>
              ) : null}
              {canExplain ? (
                <button
                  type="button"
                  onClick={explain}
                  disabled={reasoning?.loading}
                  className="focus-ring rounded-md border border-stone-200 px-2 py-0.5 text-sm font-semibold text-coral hover:bg-paper disabled:opacity-40"
                >
                  {reasoning?.loading ? "Reasoning…" : reasoning?.data ? "Refresh reasoning" : "Explain fit"}
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-0.5 text-sm text-steel tabular-nums tracking-tight">
            <span className="font-medium text-ink">{m.company ?? "—"}</span> · {m.location ?? "—"} · {m.workMode ?? "—"} ·{" "}
            {FAMILY_LABEL[m.roleFamily ?? ""] ?? m.roleFamily} / {m.seniority} ·{" "}
            {m.salaryBand && m.salaryBand.length === 2
              ? `${Math.round(m.salaryBand[0] / 1000)}–${Math.round(m.salaryBand[1] / 1000)}k CZK`
              : "—"}
          </p>

          {m.scoreBreakdown && m.scoreBreakdown.length > 0 ? (
            <ScoreBreakdown dims={m.scoreBreakdown} total={m.total} />
          ) : (
            // Fallback for a response without the server breakdown (e.g. an older
            // cached shape): the raw per-dimension scores, weight-blind.
            <div className="mt-2 grid max-w-md grid-cols-3 gap-2">
              <Bar label={early ? "Foundation" : "Skills"} value={m.skillsScore} />
              <Bar label={early ? "Potential" : "Career"} value={m.careerScore} />
              <Bar label={early ? "Fit" : "Personal"} value={m.personalScore} />
            </div>
          )}

          {/* A non-tight band's WHY belongs in plain sight, not in a tooltip — a
              recruiter reading "34–62" must see "early-career, thinner record"
              without knowing to hover. Tight bands stay quiet. */}
          {m.confidence.level !== "tight" && m.confidence.drivers.length > 0 ? (
            <p className="mt-1.5 text-sm text-steel">
              <span className="font-medium text-ink">Why this band:</span> {m.confidence.drivers.join(" · ")}
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
                      title={partial ? `Partial match (${Math.round(strength * 100)}%) — a related/sibling or self-declared skill, not a verified exact match` : undefined}
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-green-700 ${partial ? "bg-green-50/60 ring-1 ring-inset ring-green-600/30" : "bg-green-50"}`}
                    >
                      {partial ? `~ ${s}` : s}
                      {pl ? <span className={`rounded px-1 text-sm uppercase ${pl.tone}`}>{pl.text}</span> : null}
                    </span>
                  );
                })}
                {missingShown.map((s) => (
                  <span
                    key={`x-${s}`}
                    className="rounded-md bg-red-50 px-1.5 py-0.5 text-sm text-red-700"
                    title={early ? "Missing must-have (often learnable)" : "Missing must-have"}
                  >
                    ✗ {s}
                  </span>
                ))}
                {hidden > 0 || skillsExpanded ? (
                  <button
                    type="button"
                    onClick={() => setSkillsExpanded((v) => !v)}
                    className="focus-ring rounded-md bg-stone-100 px-1.5 py-0.5 text-sm font-semibold text-steel hover:bg-stone-200"
                  >
                    {skillsExpanded ? "Show less" : `+${hidden} more`}
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
