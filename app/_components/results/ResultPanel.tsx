"use client";

import { GitBranch, Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { GithubAnalysisPanel } from "@/app/_components/GithubAnalysisPanel";
import { hasRenderableComparison } from "@/app/_lib/comparison";
import { reconcileScoreTotal } from "@/app/_lib/format";
import { AddToPipelineButton, type PipelineRef } from "./AddToPipelineButton";
import { ArchetypeBanner } from "./ArchetypeBanner";
import { QualityStrip } from "./QualityStrip";
import type { Analysis, GithubAnalysis } from "@/app/_lib/schemas";
import { CompareIcon, ExtractionIcon, InterviewIcon, JobFitIcon, SalaryIcon } from "../icons";
import { CompareTab } from "./compare/CompareTab";
import { ExtractionTab } from "./extraction/ExtractionTab";
import { InterviewTab } from "./interview/InterviewTab";
import { JobFitTab } from "./job-fit/JobFitTab";
import { SalaryTab } from "./salary/SalaryTab";

export type ResultPanelGithub = {
  status: "loading" | "done" | "error";
  analysis: GithubAnalysis | null;
  error: string | null;
  warning: string | null;
};

type ResultPanelProps = {
  analysis: Analysis;
  github?: ResultPanelGithub;
  // GH5 — re-fire the deep-dive alone from the GitHub tab's error state.
  // Provided by the live Analyze tab; absent on saved reports (no run to retry).
  onGithubRetry?: () => void;
  // When the caller can identify the candidate AND the role this result was run
  // against, the report offers an "Add to pipeline" action so the recruiter can
  // act on a job-fit read without leaving for the Match tab. Omitted where the
  // identifiers aren't available (e.g. a fresh, not-yet-saved analyze run).
  pipelineRef?: PipelineRef;
  // Metering (Direction 2): when the live Analyze tab served this result from the
  // prompt cache, it passes cached=true so the cost line reads "no new cost"
  // instead of the recorded estimate. Omitted on saved reports (which always show
  // the cost the run actually recorded).
  runCached?: boolean;
  // Direction 1 — when the run CAN'T be filed under a job (a JD-less analysis, or
  // one that didn't persist), the live Analyze tab passes an honest one-line
  // reason instead of a hidden button, so the recruiter's dead-end is explained
  // rather than silent. Ignored when `pipelineRef` is present (the button wins).
  pipelineDisabledReason?: string;
};

type ResultTab = "extraction" | "compare" | "jobFit" | "salary" | "interview" | "github";

// Format a small USD figure: sub-cent runs keep 4 decimals so they don't read as
// "$0.00"; larger ones use the usual 2. Non-contractual estimate (see RunCostLine).
function formatCostUsd(cost: number): string {
  return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

// Metering cost line (Direction 2): the per-analysis LLM cost estimate, from what
// the run actually recorded (metadata.runCost, priced through the shared table) —
// not a UI re-guess. A cache-served run shows a no-new-cost note instead.
function RunCostLine({
  runCost,
  cached,
}: {
  runCost: NonNullable<Analysis["metadata"]>["runCost"] | undefined;
  cached?: boolean;
}) {
  const t = useTranslations("report");
  if (cached) {
    return <p className="text-xs text-steel">{t("runCost.cached")}</p>;
  }
  if (!runCost) return null;
  const model = runCost.model ?? "—";
  if (runCost.costUsd == null) {
    return (
      <p className="text-xs text-steel" title={t("runCost.title")}>
        {t("runCost.unpriced", { model })}
      </p>
    );
  }
  return (
    <p className="text-xs text-steel" title={t("runCost.title")}>
      {t("runCost.line", { cost: formatCostUsd(runCost.costUsd), model })}
    </p>
  );
}

export function ResultPanel({ analysis, github, onGithubRetry, pipelineRef, runCached, pipelineDisabledReason }: ResultPanelProps) {
  // RES2 — the report chrome (tab labels, aria) is bilingual; the tab CONTENT
  // is the LLM narrative, already generated in the recruiter's language.
  const t = useTranslations("report");
  // A comparison only counts — for showing the Compare tab AND for defaulting
  // to it below — when it meets the minimum-variant contract. A stray 1-variant
  // payload no longer auto-opens an empty Compare tab; it falls through to
  // Extraction like any non-comparison analysis. Same gate CompareTab renders by.
  const hasComparison = hasRenderableComparison(analysis.comparison);
  const hasGithub = Boolean(github);

  const tabs: Array<{ id: ResultTab; label: string; icon: React.ReactNode }> = [
    { id: "extraction", label: t("tabs.extraction"), icon: <ExtractionIcon className="h-4 w-4" /> },
    ...(hasComparison
      ? [{ id: "compare" as const, label: t("tabs.compare"), icon: <CompareIcon className="h-4 w-4" /> }]
      : []),
    { id: "jobFit", label: t("tabs.jobFit"), icon: <JobFitIcon className="h-4 w-4" /> },
    { id: "salary", label: t("tabs.salary"), icon: <SalaryIcon className="h-4 w-4" /> },
    { id: "interview", label: t("tabs.interview"), icon: <InterviewIcon className="h-4 w-4" /> },
    ...(hasGithub
      ? [
          {
            id: "github" as const,
            label: t("tabs.github"),
            icon: <GitBranch className="h-4 w-4" />,
          },
        ]
      : []),
  ];

  // Score-breakdown invariant, asserted on load: ScoreDial (total) and
  // FactorChart (components) must tell one story. reconcileScoreTotal reports —
  // once, in dev/test only — any analysis whose pipeline total disagrees with
  // its component sum, so bad generations are caught here regardless of which
  // tab the recruiter opens (the extraction dial may never be rendered).
  useEffect(() => {
    reconcileScoreTotal(analysis.score);
  }, [analysis.score]);

  const [activeTab, setActiveTab] = useState<ResultTab>(hasComparison ? "compare" : "extraction");

  const activeIndex = tabs.findIndex((t) => t.id === activeTab);

  // This component instance survives across analyses (rendered without a key),
  // so activeTab can point at a tab that no longer exists — e.g. running a
  // multi-variant compare (defaults to "compare") then a single-CV analysis
  // drops the Compare tab. Without this, activeIndex is -1 and the panel
  // renders blank. Fall back to the first available tab when that happens —
  // adjusted DURING render (the guarded render-phase pattern), so the stale tab
  // never paints for a frame the way an effect-driven reset would let it.
  if (activeIndex === -1 && tabs.length > 0) {
    setActiveTab(tabs[0].id);
  }

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next = activeIndex;
    if (event.key === "ArrowRight") next = (activeIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };

  // Tailwind needs explicit, statically-known class names for dynamic grid
  // counts to survive purge — so we pick from a small lookup table.
  const lgGridClass = (() => {
    switch (tabs.length) {
      case 4:
        return "lg:grid-cols-4";
      case 5:
        return "lg:grid-cols-5";
      case 6:
        return "lg:grid-cols-6";
      case 7:
        return "lg:grid-cols-7";
      default:
        return "lg:grid-cols-5";
    }
  })();

  return (
    <section className="animate-fade-in space-y-5">
      {pipelineRef ? (
        <div className="flex items-start justify-end">
          <AddToPipelineButton
            pipelineRef={pipelineRef}
            // GH2 — a done deep-dive rides the add as compact evidence.
            github={github?.status === "done" ? github.analysis : null}
          />
        </div>
      ) : pipelineDisabledReason ? (
        <div className="flex items-start justify-end">
          <PipelineDisabledNote reason={pipelineDisabledReason} label={t("addToPipeline")} />
        </div>
      ) : null}
      {analysis.v2Profile ? <ArchetypeBanner v2Profile={analysis.v2Profile} /> : null}
      <QualityStrip checks={analysis.sanityChecks ?? []} />
      <RunCostLine runCost={analysis.metadata?.runCost} cached={runCached} />

      <div className="rounded-lg border border-stone-200 bg-white p-2 shadow-panel">
        <div role="tablist" aria-label={t("sections")} onKeyDown={onTabKeyDown} className={`grid gap-1 sm:grid-cols-2 ${lgGridClass}`}>
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={selected}
                aria-controls="result-tabpanel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                className={`focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-base font-semibold ${
                  selected ? "bg-ink text-white" : "text-steel hover:bg-paper hover:text-ink"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" id="result-tabpanel" aria-labelledby={`tab-${activeTab}`} tabIndex={0} className="focus-ring rounded-md">
        {activeTab === "extraction" ? <ExtractionTab analysis={analysis} /> : null}
        {activeTab === "compare" ? <CompareTab analysis={analysis} /> : null}
        {activeTab === "jobFit" ? <JobFitTab analysis={analysis} /> : null}
        {activeTab === "salary" ? <SalaryTab analysis={analysis} /> : null}
        {activeTab === "interview" ? <InterviewTab analysis={analysis} /> : null}
        {activeTab === "github" && github ? (
          <GithubAnalysisPanel
            status={github.status}
            analysis={github.analysis}
            error={github.error}
            warning={github.warning}
            onRetry={onGithubRetry}
          />
        ) : null}
      </div>
    </section>
  );
}

// Direction 1 — the honest counterpart to AddToPipelineButton: when a run can't be
// filed under a job, show a DISABLED add affordance with a one-line reason rather
// than hiding the action (so the recruiter learns WHY they can't add, e.g. "board
// lanes are keyed by a job"). Tokens only; reads correctly in both themes.
function PipelineDisabledNote({ reason, label }: { reason: string; label: string }) {
  const reasonId = useId();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled
        aria-disabled
        aria-describedby={reasonId}
        className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-md border border-stone-300 px-4 text-base font-semibold text-steel opacity-70"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {label}
      </button>
      <p id={reasonId} className="max-w-xs text-right text-sm text-steel">
        {reason}
      </p>
    </div>
  );
}
