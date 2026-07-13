"use client";

import {
  BriefcaseBusiness,
  Building2,
  FileText,
  GitBranch,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ScanAnimationCompact } from "@/app/_components/ScanAnimation";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { Checkbox } from "@/app/_components/Checkbox";
import { useEngineAvailability } from "@/app/features/useEngineAvailability";
import { LOCALES } from "@/i18n/locales";
import { AnalyzeColumn } from "./AnalyzeColumn";
import { AnalyzeFileDropZone } from "./AnalyzeFileDropZone";
import { AnalyzePasteRow } from "./AnalyzePasteRow";
import { AnalyzeProfileInput } from "./AnalyzeProfileInput";
import { AnalyzeSavedJdPicker } from "./AnalyzeSavedJdPicker";
import { MAX_CV_VARIANTS } from "./AnalyzeTypes";
import { shouldNoteBlindGithubSuppressed } from "./githubRunPolicy";
import type { AnalyzeFormState } from "./useAnalyzeForm";

const REPORT_LANGS = LOCALES;

export function AnalyzeForm({ state }: { state: AnalyzeFormState }) {
  const t = useTranslations("analyze");
  // DATA4 — preflight the Gemini engine so a doomed run is a fixable one-liner
  // BEFORE submit, not a cryptic task failure minutes later.
  const engines = useEngineAvailability();
  const { refs, inputs, setters, handlers, flags, statuses, library, result } = state;
  const { setJobDescriptionFile, setJobDescriptionText, setCompanyFile, setCompanyText, setGithubProfile, setReportLang, setBlind } = setters;
  const { setSelectedJdSlug } = library;

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

        <div className="grid gap-4 border-t border-stone-200 pt-4 sm:grid-cols-2 lg:grid-cols-3 xl:col-span-3 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <AnalyzeColumn
            icon={<BriefcaseBusiness className="h-4 w-4 text-coral" aria-hidden />}
            heading={t("colJob")}
            status={statuses.jobStatus}
            onClear={flags.hasJobDescription ? handlers.clearJobDescription : undefined}
          >
            <AnalyzeFileDropZone
              inputId="job-description-file"
              inputRef={refs.jobInputRef}
              file={inputs.jobDescriptionFile}
              onFileChange={(file) => {
                setJobDescriptionFile(file);
                setSelectedJdSlug(null);
              }}
              onRemove={() => setJobDescriptionFile(null)}
            />
            <AnalyzeSavedJdPicker
              jds={library.jdLibrary}
              selectedSlug={library.selectedJdSlug}
              loading={flags.jdLoading}
              loadFailed={library.jdLoadFailed}
              // The hook owns the load-full-JD-by-slug flow (fetch + textarea +
              // slug bookkeeping); the form just hands it the picked slug.
              onPick={(jd) => library.pickJd(jd.slug)}
              onClear={() => setSelectedJdSlug(null)}
            />
            <div className="mt-auto">
              <AnalyzePasteRow
                ariaLabel={t("jobTextAria")}
                inputId="job-description-paste"
                text={inputs.jobDescriptionText}
                onChange={(value) => {
                  setJobDescriptionText(value);
                  setSelectedJdSlug(null);
                }}
                onClear={() => {
                  setJobDescriptionText("");
                  setSelectedJdSlug(null);
                }}
              />
            </div>
          </AnalyzeColumn>

          <AnalyzeColumn
            icon={<Building2 className="h-4 w-4 text-coral" aria-hidden />}
            heading={t("colCompany")}
            status={statuses.companyStatus}
            onClear={flags.hasCompany ? handlers.clearCompany : undefined}
          >
            <AnalyzeFileDropZone
              inputId="company-overview-file"
              inputRef={refs.companyInputRef}
              file={inputs.companyFile}
              onFileChange={setCompanyFile}
              onRemove={() => setCompanyFile(null)}
            />
            <div className="mt-auto">
              <AnalyzePasteRow
                ariaLabel={t("companyTextAria")}
                inputId="company-overview-paste"
                text={inputs.companyText}
                onChange={setCompanyText}
                onClear={() => setCompanyText("")}
              />
            </div>
          </AnalyzeColumn>

          <AnalyzeColumn
            icon={<GitBranch className="h-4 w-4 text-coral" aria-hidden />}
            heading={t("colGithub")}
            status={statuses.githubStatusLabel}
          >
            {/* The GitHub input is a single field rather than a drop zone, so
                without a leading affordance + helper it reads as a bare,
                unfinished cell next to the taller Job/Company columns. A
                leading icon (pl-9 reserves the room) and a one-line helper give
                it the same considered weight; the column itself stretches to
                match its siblings via the grid's default align-stretch. */}
            <div className="space-y-1.5">
              <div className="relative">
                <GitBranch
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel"
                  aria-hidden
                />
                <TextInput
                  aria-label={t("githubAria")}
                  value={inputs.githubProfile}
                  onChange={(event) => setGithubProfile(event.target.value)}
                  className="pl-9 pr-3"
                  placeholder={t("githubPlaceholder")}
                />
              </div>
              <p className="text-sm text-steel">{t("githubHelper")}</p>
              {/* bug-ui-scan-2026-07-09 (cv-analysis-workspace #3): blind mode
                  suppresses the GitHub deep-dive (it would reveal the identity
                  blind screening just redacted). Say so up front rather than
                  silently dropping the column. */}
              {shouldNoteBlindGithubSuppressed({ hasGithub: flags.hasGithub, blind: inputs.blind ?? false }) ? (
                <p role="status" className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-sm text-amber-800">
                  {t("blindGithubSuppressed")}
                </p>
              ) : null}
            </div>
          </AnalyzeColumn>
        </div>
      </div>

      {engines && !engines.gemini ? (
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
    </section>
  );
}
