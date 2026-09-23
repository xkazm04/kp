"use client";

import { FileText, RotateCcw, UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEngineAvailabilityRead } from "@/app/features/shell/useEngineAvailability";
import { BTN_SECONDARY, CARD_PAD, PANEL } from "@/app/_components/ui/recipes";
import { AnalyzeColumn } from "./AnalyzeColumn";
import { AnalyzeProfileInput } from "./AnalyzeProfileInput";
import { AnalyzeFormOptionalColumns } from "./AnalyzeFormOptionalColumns";
import { AnalyzeFormFooter } from "./AnalyzeFormFooter";
import { MAX_CV_VARIANTS } from "./AnalyzeTypes";
import { useAnalyzeIntake } from "./useAnalyzeFileAccept";
import { useGlobalFileDrag } from "./useAnalyzeGlobalFileDrag";
import type { AnalyzeFormState } from "./useAnalyzeForm";

export function AnalyzeForm({ state }: { state: AnalyzeFormState }) {
  const t = useTranslations("analyze");
  // DATA4 — preflight the Gemini engine so a doomed run is a fixable one-liner
  // BEFORE submit, not a cryptic task failure minutes later.
  const { engines, unknown: enginesUnknown } = useEngineAvailabilityRead();
  const { inputs, handlers, flags, statuses } = state;

  // The intake router (challenge-r03 cv-analyze-intake/A): the form hosts the ONE
  // window drop listener, which resolves the zone id a drop landed in and plans the
  // whole drop; every picker plans through the same `intake`. Refusals render once,
  // below the columns.
  const intake = useAnalyzeIntake(state);
  const isWindowDragging = useGlobalFileDrag(intake.route);

  return (
    <section
      className={`${PANEL} ${CARD_PAD}`}
      aria-busy={flags.isLoading || flags.isCompleting}
    >
      {/* Drop-anywhere affordance: a full-window scrim while a file is dragged over
          the page (pointer-events-none so the zones beneath still receive it). It is
          aria-hidden decoration; the fact that the page has become a drop target is
          announced once, politely, through a live region that is always in the tree
          (a region mounted with its content is not reliably announced). */}
      <p role="status" aria-live="polite" className="sr-only">
        {isWindowDragging ? `${t("dropCvAnywhere")} ${t("dropCarveout")}` : ""}
      </p>
      {isWindowDragging ? (
        <div className="animate-fade-in pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-coral/5" aria-hidden>
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-coral bg-white/90 px-10 py-8 shadow-panel">
            <UploadCloud className="h-8 w-8 text-coral" />
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className="text-base font-semibold text-ink">{t("dropCvAnywhere")}</span>
              {/* The routing carve-out (idea-9f3a1c52): a file released on the Job
                  description or Company zone files THERE, never as a CV variant. */}
              <span className="text-sm text-steel">{t("dropCarveout")}</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-h2 text-ink">{t("analyzeProfile")}</h2>
          <p className="mt-1 text-base text-steel">{t("formIntro")}</p>
        </div>
        <button
          type="button"
          onClick={handlers.reset}
          className={`${BTN_SECONDARY} h-9 gap-2 bg-white px-3 text-sm`}
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
            isWindowDragging={isWindowDragging}
            onIntake={(files) => intake.intake("cv", files)}
            onReplace={intake.replaceCv}
            onRemove={handlers.removeCvFile}
            onReport={intake.report}
            maxVariants={MAX_CV_VARIANTS}
          />
        </AnalyzeColumn>

        <AnalyzeFormOptionalColumns state={state} onIntake={intake.intake} />
      </div>

      {/* Every file that did not go in, by name and reason — one line per file. */}
      {intake.refusals.length > 0 ? (
        <ul role="alert" className="mt-3 space-y-0.5 text-sm text-coral">
          {intake.refusals.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}

      <AnalyzeFormFooter
        state={state}
        geminiMissing={Boolean(engines && !engines.gemini)}
        enginesUnknown={enginesUnknown}
      />
    </section>
  );
}
