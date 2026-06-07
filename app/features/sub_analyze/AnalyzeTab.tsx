"use client";

import { useEffect, useRef, useState } from "react";
import { ResultPanel } from "@/app/_components/results/ResultPanel";
import { AnalysisProgress } from "@/app/_components/AnalysisProgress";
import { AnalyzeForm } from "./AnalyzeForm";
import { AnalyzeFormCollapsed } from "./AnalyzeFormCollapsed";
import { useAnalyzeForm } from "./useAnalyzeForm";

export function AnalyzeTab() {
  const state = useAnalyzeForm();
  const { inputs, flags, result } = state;
  const isAnalyzing = flags.isLoading || flags.isCompleting;
  const hasResult = result.analysis !== null;

  // Auto-collapse the form on the leading edge of an analysis (or when a
  // result lands), and auto-expand again once we return to an idle state
  // via reset(). The transition guard lets the user manually re-expand
  // mid-result without being immediately collapsed again on re-render.
  const [expanded, setExpanded] = useState(true);
  const wasIdleRef = useRef(true);
  useEffect(() => {
    const idle = !isAnalyzing && !hasResult;
    if (wasIdleRef.current && !idle) setExpanded(false);
    if (!wasIdleRef.current && idle) setExpanded(true);
    wasIdleRef.current = idle;
  }, [isAnalyzing, hasResult]);

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
        />
      ) : null}

      {result.analysis ? (
        <ResultPanel
          analysis={result.analysis}
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
        />
      ) : null}
    </div>
  );
}
