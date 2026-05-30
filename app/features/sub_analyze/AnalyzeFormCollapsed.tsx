"use client";

import { ChevronDown, FileText, RotateCcw } from "lucide-react";
import { ScanAnimationCompact } from "@/app/_components/ScanAnimation";
import type { AnalyzeFormState } from "./useAnalyzeForm";

export function AnalyzeFormCollapsed({
  state,
  onExpand,
}: {
  state: AnalyzeFormState;
  onExpand: () => void;
}) {
  const { inputs, flags, statuses, handlers } = state;
  const isAnalyzing = flags.isLoading || flags.isCompleting;

  const summary = buildSummary({
    cvFiles: inputs.cvFiles,
    jobAttached: statuses.jobStatus.tone === "attached",
    jobLabel: statuses.jobStatus.label,
    companyAttached: statuses.companyStatus.tone === "attached",
    companyLabel: statuses.companyStatus.label,
    githubAttached: statuses.githubStatusLabel.tone === "attached",
    githubLabel: statuses.githubStatusLabel.label,
  });

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          {isAnalyzing ? (
            <ScanAnimationCompact className="h-4 w-4" />
          ) : (
            <FileText className="h-4 w-4 text-coral" aria-hidden />
          )}
          <span className="text-sm font-semibold text-ink">
            {isAnalyzing ? "Analyzing…" : "Analyze profile"}
          </span>
        </div>
        <p
          className="min-w-0 flex-1 truncate text-xs text-steel"
          title={summary || undefined}
        >
          {summary || "No inputs attached"}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onExpand}
            disabled={isAnalyzing}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 text-xs font-semibold text-ink hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            title={isAnalyzing ? "Wait for analysis to finish" : "Edit form"}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            Edit
          </button>
          <button
            type="button"
            onClick={handlers.reset}
            disabled={isAnalyzing}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 text-xs font-semibold text-ink hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            title="Reset and start over"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}

function buildSummary(args: {
  cvFiles: File[];
  jobAttached: boolean;
  jobLabel: string;
  companyAttached: boolean;
  companyLabel: string;
  githubAttached: boolean;
  githubLabel: string;
}): string {
  const parts: string[] = [];
  if (args.cvFiles.length === 1) parts.push(args.cvFiles[0].name);
  else if (args.cvFiles.length > 1) parts.push(`${args.cvFiles.length} CV variants`);
  if (args.jobAttached) parts.push(`JD: ${args.jobLabel}`);
  if (args.companyAttached) parts.push(`Company: ${args.companyLabel}`);
  if (args.githubAttached) parts.push(`GitHub: ${args.githubLabel}`);
  return parts.join(" · ");
}
