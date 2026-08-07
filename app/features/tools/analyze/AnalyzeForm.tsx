"use client";

import { FileText, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEngineAvailability } from "@/app/features/shell/useEngineAvailability";
import { AnalyzeColumn } from "./AnalyzeColumn";
import { AnalyzeProfileInput } from "./AnalyzeProfileInput";
import { AnalyzeFormOptionalColumns } from "./AnalyzeFormOptionalColumns";
import { AnalyzeFormFooter } from "./AnalyzeFormFooter";
import { MAX_CV_VARIANTS } from "./AnalyzeTypes";
import type { AnalyzeFormState } from "./useAnalyzeForm";

export function AnalyzeForm({ state }: { state: AnalyzeFormState }) {
  const t = useTranslations("analyze");
  // DATA4 — preflight the Gemini engine so a doomed run is a fixable one-liner
  // BEFORE submit, not a cryptic task failure minutes later.
  const engines = useEngineAvailability();
  const { inputs, handlers, flags, statuses } = state;

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel"
      aria-busy={flags.isLoading || flags.isCompleting}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-h2 text-ink">{t("analyzeProfile")}</h2>
          <p className="mt-1 text-base text-steel">{t("formIntro")}</p>
        </div>
        <button
          type="button"
          onClick={handlers.reset}
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink hover:bg-stone-50"
          title={t("reset")}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {t("reset")}
        </button>
      </div>

      {/* The required CV sits in its own column; the optional trio is grouped
          in a sub-grid set off by a faint divider so the asymmetric rules read
          structurally, not just from the prose above. */}
      <div className="mt-5 grid gap-4 xl:grid-cols-4">
        <AnalyzeColumn
          icon={<FileText className="h-4 w-4 text-coral" aria-hidden />}
          heading={t("colCv")}
          status={statuses.cvStatus}
          required
        >
          <AnalyzeProfileInput
            files={inputs.cvFiles}
            onAdd={handlers.addCvFile}
            onReplace={handlers.replaceCvFile}
            onRemove={handlers.removeCvFile}
            maxVariants={MAX_CV_VARIANTS}
          />
        </AnalyzeColumn>

        <AnalyzeFormOptionalColumns state={state} />
      </div>

      <AnalyzeFormFooter state={state} geminiMissing={Boolean(engines && !engines.gemini)} />
    </section>
  );
}
