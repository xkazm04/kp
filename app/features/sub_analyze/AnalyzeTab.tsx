"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { GithubAnalysisPanel } from "@/app/_components/GithubAnalysisPanel";
import { ResultPanel } from "@/app/_components/results/ResultPanel";
import { AnalysisProgress } from "@/app/_components/AnalysisProgress";
import { AnalyzeForm } from "./AnalyzeForm";
import { AnalyzeFormCollapsed } from "./AnalyzeFormCollapsed";
import { deriveCollapseDecision } from "./analyzeCollapse";
import { deriveAnalyzePipelineAffordance } from "./analyzePipelineRef";
import { useAnalyzeForm } from "./useAnalyzeForm";

export function AnalyzeTab() {
  const t = useTranslations("analyze");
  const state = useAnalyzeForm();
  const { inputs, flags, result, handlers } = state;
  // Direction 1 — offer the SAME Add-to-pipeline the saved report does, right on
  // the live result, reusing the shared AddToPipelineButton plumbing. A JD-less
  // (or unsaved) run gets an honest disabled affordance with a one-line reason.
  const affordance = deriveAnalyzePipelineAffordance(result.analysis);
  const pipelineRef = affordance?.kind === "add" ? affordance.ref : undefined;
  const pipelineDisabledReason =
    affordance?.kind === "disabled"
      ? affordance.reason === "jdless"
        ? t("addToPipelineJdless")
        : t("addToPipelineUnsaved")
      : undefined;
  const isAnalyzing = flags.isLoading || flags.isCompleting;
  // A GitHub-only run (GH3) produces no main analysis — its panel below counts
  // as a result for the form auto-collapse too. A CV error, however, is NOT a
  // result: it forces `idle` true so the form re-expands and its aria-live error
  // slot surfaces the failure, even when a parallel GitHub run succeeded (which
  // would otherwise pin the form collapsed with the error visible nowhere —
  // bug-ui-scan-2026-07-09 #1). See deriveCollapseDecision.
  const { idle } = deriveCollapseDecision({
    isAnalyzing,
    hasAnalysis: result.analysis !== null,
    githubStatus: result.githubStatus,
    cvError: result.error !== null,
  });

  // Auto-collapse the form on the leading edge of an analysis (or when a
  // result lands), and auto-expand again once we return to an idle state
  // (via reset() OR a CV error). The transition guard lets the user manually
  // re-expand mid-result without being immediately collapsed again on re-render.
  const [expanded, setExpanded] = useState(true);
  const wasIdleRef = useRef(true);
  useEffect(() => {
    if (wasIdleRef.current && !idle) setExpanded(false);
    if (!wasIdleRef.current && idle) setExpanded(true);
    wasIdleRef.current = idle;
  }, [idle]);

  return (
    <div className="space-y-5">
      {expanded ? (
        <AnalyzeForm state={state} />
      ) : (
        <AnalyzeFormCollapsed state={state} onExpand={() => setExpanded(true)} />
      )}

      {isAnalyzing ? (
        <AnalysisProgress
          stages={result.stageState}
          complete={flags.isCompleting}
          fileName={inputs.cvFiles.length === 1 ? inputs.cvFiles[0].name : undefined}
          variantCount={inputs.cvFiles.length}
          // #5 — the server's REAL per-variant completion drives the bar for a
          // multi-CV comparison instead of the faked stage timeline.
          variantsDone={result.variantProgress?.done}
          variantsTotal={result.variantProgress?.total}
          onCancel={handlers.cancel}
        />
      ) : null}

      {result.analysis ? (
        <ResultPanel
          analysis={result.analysis}
          pipelineRef={pipelineRef}
          pipelineDisabledReason={pipelineDisabledReason}
          github={
            result.githubStatus === "idle"
              ? undefined
              : {
                  status: result.githubStatus,
                  analysis: result.githubAnalysis,
                  error: result.githubError,
                  warning: result.githubWarning,
                }
          }
          onGithubRetry={handlers.retryGithub}
        />
      ) : result.githubStatus !== "idle" ? (
        // GH3 — GitHub-only run: no CV attached, so there's no main analysis or
        // tabbed report; the deep-dive panel stands alone in the result area.
        <GithubAnalysisPanel
          status={result.githubStatus}
          analysis={result.githubAnalysis}
          error={result.githubError}
          warning={result.githubWarning}
          onRetry={handlers.retryGithub}
        />
      ) : null}
    </div>
  );
}
