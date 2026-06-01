"use client";

import { useEffect, useState } from "react";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import type { MatchRef, MatchResult, Reasoning, ReasoningState } from "./MatchTypes";
import { EARLY_CAREER, FAMILY_LABEL, provLabel } from "./MatchTypes";
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
  const { startTask, tasks } = useTasks();
  const [reasoning, setReasoning] = useState<ReasoningState | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const MATCHED_CAP = 8;
  const MISSING_CAP = 6;
  const early = EARLY_CAREER.has(archetype);
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

  useEffect(() => {
    if (!taskId) return;
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.status === "succeeded") {
      const p = t.result as { reasoning?: Reasoning; source?: string; cached?: boolean } | null;
      setReasoning(p?.reasoning ? { data: p.reasoning, source: p.source, cached: p.cached } : { error: "No reasoning returned." });
      setTaskId(null);
    } else if (t.status === "failed" || t.status === "canceled" || t.status === "interrupted") {
      setReasoning({ error: t.error ?? "Reasoning failed." });
      setTaskId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, taskId]);

  return (
    <li className="rounded-lg border border-stone-200 p-3">
      <div className="flex items-start gap-4">
        <div className="w-16 shrink-0 text-center tabular-nums tracking-tight">
          <div className="font-serif text-2xl text-ink">{m.total}</div>
          <div className="text-sm text-steel">
            {m.confidenceLow}–{m.confidenceHigh}
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
                  return (
                    <span
                      key={`m-${s}`}
                      className="inline-flex items-center gap-1 rounded-md bg-green-50 px-1.5 py-0.5 text-sm text-green-700"
                    >
                      {s}
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
