"use client";

// Job description / Company overview / GitHub columns — the optional trio grouped
// beside the required CV column — split out of AnalyzeForm.tsx.
import { BriefcaseBusiness, Building2, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { AnalyzeColumn } from "./AnalyzeColumn";
import { AnalyzeFileDropZone } from "./AnalyzeFileDropZone";
import { AnalyzePasteRow } from "./AnalyzePasteRow";
import { AnalyzeSavedJdPicker } from "./AnalyzeSavedJdPicker";
import { shouldNoteBlindGithubSuppressed } from "./analyzeGithubRunPolicy";
import type { AnalyzeFormState } from "./useAnalyzeForm";

export function AnalyzeFormOptionalColumns({ state }: { state: AnalyzeFormState }) {
  const t = useTranslations("analyze");
  const { refs, inputs, setters, handlers, flags, statuses, library } = state;
  const { setJobDescriptionFile, setJobDescriptionText, setCompanyFile, setCompanyText, setGithubProfile } = setters;
  const { setSelectedJdSlug } = library;

  return (
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
  );
}
