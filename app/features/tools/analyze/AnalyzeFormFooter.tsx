"use client";

// Engine-missing note + status/run button/report-language/blind-mode row, split
// out of AnalyzeForm.tsx.
import { Checkbox } from "@/app/_components/Checkbox";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScanAnimationCompact } from "@/app/_components/ScanAnimation";
import { Select } from "@/app/_components/Select";
import { LOCALES } from "@/i18n/locales";
import type { AnalyzeFormState } from "./useAnalyzeForm";

const REPORT_LANGS = LOCALES;

export function AnalyzeFormFooter({ state, geminiMissing }: { state: AnalyzeFormState; geminiMissing: boolean }) {
  const t = useTranslations("analyze");
  const { inputs, setters, handlers, flags, result } = state;
  const { setReportLang, setBlind } = setters;

  return (
    <>
      {geminiMissing ? (
        <p role="status" className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
          {t("geminiMissing")}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div aria-live="polite" className="sm:flex-1">
          {result.error ? (
            <p className="rounded-md bg-red-50 p-3 text-base text-red-700" role="alert">
              {result.error}
            </p>
          ) : (
            <p className="text-base text-steel">
              {inputs.cvFiles.length === 0
                ? flags.hasGithub
                  ? t("githubOnlyReady")
                  : t("attachCv")
                : t("ready")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handlers.submit}
          // GH3 — a filled GitHub profile alone enables the run (a lighter,
          // deep-dive-only analysis); only the fully empty form stays disabled.
          disabled={flags.isLoading || flags.isCompleting || flags.githubLoading || flags.jdLoading || (inputs.cvFiles.length === 0 && !flags.hasGithub)}
          className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-base font-semibold text-white hover:bg-steel disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {flags.isLoading ? (
            <ScanAnimationCompact className="h-5 w-5" />
          ) : (
            <FileText className="h-4 w-4" aria-hidden />
          )}
          {t("analyze")}
        </button>
        {/* CV3 — pick the report-narrative language for this run (defaults to the
            active locale); lets a recruiter produce an English report for an
            international panel without flipping the whole app. */}
        <label className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-steel">
          {t("reportLanguage")}
          <Select
            ariaLabel={t("reportLanguage")}
            value={inputs.reportLang}
            onChange={setReportLang}
            size="sm"
            options={REPORT_LANGS.map((l) => ({ value: l, label: l.toUpperCase() }))}
          />
        </label>
        {/* b8d711c4 — blind screening: redact identity (name/contact/photo/gendered
            terms/age) from the CV before scoring; the name is re-attached only in
            the result, and the trust ledger notes what was redacted. */}
        <label className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-steel" title={t("blindTitle")}>
          <Checkbox checked={inputs.blind ?? false} onChange={(e) => setBlind(e.target.checked)} />
          {t("blind")}
        </label>
      </div>
    </>
  );
}
