"use client";

import { ChevronDown, FileText, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScanAnimationCompact } from "@/app/_components/ScanAnimation";
import type { AnalyzeFormState } from "./useAnalyzeForm";

export function AnalyzeFormCollapsed({
  state,
  onExpand,
}: {
  state: AnalyzeFormState;
  onExpand: () => void;
}) {
  const t = useTranslations("analyze");
  const { inputs, flags, statuses, handlers } = state;
  const isAnalyzing = flags.isLoading || flags.isCompleting;

  const summary = buildSummary(t, {
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
          <span className="text-base font-semibold text-ink">
            {isAnalyzing ? t("analyzing") : t("analyzeProfile")}
          </span>
        </div>
        <p
          className="min-w-0 flex-1 truncate text-sm text-steel"
          title={summary || undefined}
        >
          {summary || t("noInputs")}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onExpand}
            disabled={isAnalyzing}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 text-sm font-semibold text-ink hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            title={isAnalyzing ? t("waitForAnalysis") : t("editForm")}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            {t("edit")}
          </button>
          <button
            type="button"
            onClick={handlers.reset}
            disabled={isAnalyzing}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 text-sm font-semibold text-ink hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            title={t("resetTitle")}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t("reset")}
          </button>
        </div>
      </div>
    </section>
  );
}

function buildSummary(
  t: ReturnType<typeof useTranslations<"analyze">>,
  args: {
    cvFiles: File[];
    jobAttached: boolean;
    jobLabel: string;
    companyAttached: boolean;
    companyLabel: string;
    githubAttached: boolean;
    githubLabel: string;
  }
): string {
  const parts: string[] = [];
  if (args.cvFiles.length === 1) parts.push(args.cvFiles[0].name);
  else if (args.cvFiles.length > 1) parts.push(t("cvVariants", { count: args.cvFiles.length }));
  if (args.jobAttached) parts.push(t("summaryJd", { label: args.jobLabel }));
  if (args.companyAttached) parts.push(t("summaryCompany", { label: args.companyLabel }));
  if (args.githubAttached) parts.push(t("summaryGithub", { label: args.githubLabel }));
  return parts.join(" · ");
}
