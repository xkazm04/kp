"use client";

import { GitBranch, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTablist } from "@/app/_components/ui/useTablist";
import { useTranslations } from "next-intl";
import { GithubAnalysisPanel, type GithubPanelError } from "@/app/_components/GithubAnalysisPanel";
import { hasRenderableComparison } from "@/app/_lib/comparison";
import { reconcileScoreTotal } from "@/app/_lib/format";
import { PANEL } from "@/app/_components/ui/recipes";
import { parseResultTabHash, resolveActiveTab, resultTabHash, type ResultTab } from "./resultTabs.ts";
import { AddToPipelineButton, type PipelineRef } from "./AddToPipelineButton";
import { ArchetypeBanner } from "./ArchetypeBanner";
import { QualityStrip } from "./QualityStrip";
import { VerdictBanner } from "./VerdictBanner";
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
  // A machine code the panel resolves in the reader's language, or a line the
  // caller already localized (see GithubPanelError).
  error: GithubPanelError | null;
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
  // Lineage (profile ↔ CV): the saved analysis slug this result renders, threaded
  // to ArchetypeBanner's "Save as profile" so profiles born there carry source
  // lineage (staleness detection). Absent on unsaved runs → lineage-less save,
  // exactly the old behavior.
  analysisSlug?: string;
  // The live pipeline entry this candidate is ON (resolved by the report page from
  // the on-board lookup). Present ONLY when the candidate is active on the board —
  // it is the honest handle the Interview tab needs to push its question kit into
  // the real interview-prep pack. Absent on off-pipeline reports → no import
  // affordance (a fresh analyze run, or a candidate never added to the board).
  prepEntryId?: string;
  // Deep link: the tab to open on. A recruiter sending a colleague "look at the
  // salary read on this report" could only send the report — the active tab lived
  // in a useState no URL could reach. The panel now also honours (and writes) a
  // `#report-<tab>` fragment, so the link a recruiter copies out of the address
  // bar carries the tab. This prop is the server-side half of the same idea (the
  // report page can open a tab without a client round trip); a hash in the URL
  // wins over it, because the hash is what the sender actually clicked.
  initialTab?: ResultTab;
};

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
    return <p className="text-micro text-steel">{t("runCost.cached")}</p>;
  }
  if (!runCost) return null;
  const model = runCost.model ?? "—";
  if (runCost.costUsd == null) {
    return (
      <p className="text-micro text-steel" title={t("runCost.titleEstimate")}>
        {t("runCost.unpriced", { model })}
      </p>
    );
  }
  // Direction 1 (#f): an ESTIMATED cost (priced from token counts × list prices) is
  // marked as an estimate; a METERED cost (the provider's own reported figure) reads
  // as an exact cost with no "estimate" tag — the two no longer render identically.
  const cost = formatCostUsd(runCost.costUsd);
  return (
    <p
      className="text-micro text-steel"
      title={runCost.estimated ? t("runCost.titleEstimate") : t("runCost.titleMetered")}
    >
      {runCost.estimated
        ? t("runCost.lineEstimate", { cost, model })
        : t("runCost.lineMetered", { cost, model })}
    </p>
  );
}

export function ResultPanel({ analysis, github, onGithubRetry, pipelineRef, runCached, pipelineDisabledReason, analysisSlug, prepEntryId, initialTab }: ResultPanelProps) {
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

  const [activeTab, setActiveTab] = useState<ResultTab>(initialTab ?? (hasComparison ? "compare" : "extraction"));

  // This component instance survives across analyses (rendered without a key),
  // so activeTab can point at a tab that no longer exists — e.g. running a
  // multi-variant compare (defaults to "compare") then a single-CV analysis
  // drops the Compare tab. Without this the panel renders blank. Fall back to
  // the first available tab — adjusted DURING render (the guarded render-phase
  // pattern), so the stale tab never paints for a frame the way an effect-driven
  // reset would let it. The rule itself is pure (resultTabs.ts, pinned).
  const ids = tabs.map((tab) => tab.id);
  const resolved = resolveActiveTab(activeTab, ids);
  if (resolved && resolved !== activeTab) {
    setActiveTab(resolved);
  }

  // The URL fragment is the shareable half of the tab state. Read on mount (and
  // on hashchange, so a second link pasted into the same page still moves the
  // panel); written on every selection with replaceState, so browsing the tabs
  // of one report does not bury the previous page under six history entries.
  // A fragment naming a tab THIS report does not have resolves to null and the
  // default stands — never a blank panel.
  // Held in a ref, written in an effect (never during render): the hash listener
  // is mounted once and must read the CURRENT tab list, not the one that existed
  // when it was installed. Declared before the listener's effect so the first
  // applyHash below already sees this render's ids.
  const idsRef = useRef(ids);
  useEffect(() => {
    idsRef.current = ids;
  });
  useEffect(() => {
    const applyHash = () => {
      const fromHash = parseResultTabHash(window.location.hash, idsRef.current);
      if (fromHash) setActiveTab(fromHash);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const selectTab = useCallback((id: ResultTab) => {
    setActiveTab(id);
    // history, not location.hash: assigning the hash would scroll the fragment
    // into view (there is no such element) and push a history entry per tab.
    window.history.replaceState(null, "", resultTabHash(id));
  }, []);

  // Roles + roving tabindex + arrows/Home/End from the shared hook, which also
  // owns the ids — so moving focus no longer needs a document.getElementById
  // round trip against a hand-built `tab-${id}` string.
  const tablist = useTablist({ ids, active: activeTab, onSelect: selectTab });

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
      {/* Direction 1 — the report LEADS with the verdict (the eval-report standard),
          so the reconciled overall score + band is above the fold instead of buried
          in the Extraction tab's dial. On a multi-variant run (which defaults to the
          Compare tab) it shows the winner's verdict. Both consumers — live Analyze
          and the saved report — render the same banner. */}
      <VerdictBanner analysis={analysis} />
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
      {analysis.v2Profile ? <ArchetypeBanner v2Profile={analysis.v2Profile} sourceAnalysisSlug={analysisSlug} /> : null}
      <QualityStrip checks={analysis.sanityChecks ?? []} />
      <RunCostLine runCost={analysis.metadata?.runCost} cached={runCached} />

      <div className={`${PANEL} p-2`}>
        <div {...tablist.tablistProps} aria-label={t("sections")} className={`grid gap-1 sm:grid-cols-2 ${lgGridClass}`}>
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                {...tablist.tabProps(tab.id)}
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

      <div {...tablist.panelProps} className="focus-ring rounded-md">
        {activeTab === "extraction" ? <ExtractionTab analysis={analysis} /> : null}
        {activeTab === "compare" ? <CompareTab analysis={analysis} /> : null}
        {activeTab === "jobFit" ? <JobFitTab analysis={analysis} /> : null}
        {activeTab === "salary" ? <SalaryTab analysis={analysis} /> : null}
        {activeTab === "interview" ? <InterviewTab analysis={analysis} prepEntryId={prepEntryId} /> : null}
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
