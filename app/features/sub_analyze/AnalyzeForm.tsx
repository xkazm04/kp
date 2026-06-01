"use client";

import {
  BriefcaseBusiness,
  Building2,
  FileText,
  GitBranch,
  RotateCcw,
} from "lucide-react";
import { ScanAnimationCompact } from "@/app/_components/ScanAnimation";
import { AnalyzeColumn } from "./AnalyzeColumn";
import { AnalyzeFileDropZone } from "./AnalyzeFileDropZone";
import { AnalyzePasteRow } from "./AnalyzePasteRow";
import { AnalyzeProfileInput } from "./AnalyzeProfileInput";
import { AnalyzeSavedJdPicker } from "./AnalyzeSavedJdPicker";
import { MAX_CV_VARIANTS } from "./AnalyzeTypes";
import type { AnalyzeFormState } from "./useAnalyzeForm";

export function AnalyzeForm({ state }: { state: AnalyzeFormState }) {
  const { refs, inputs, setters, handlers, flags, statuses, library, result } = state;
  const { setJobDescriptionFile, setJobDescriptionText, setCompanyFile, setCompanyText, setGithubProfile } = setters;
  const { setSelectedJdSlug } = library;

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel"
      aria-busy={flags.isLoading || flags.isCompleting}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-h2 text-ink">Analyze profile</h2>
          <p className="mt-1 text-base text-steel">
            CV is required. Job description, company overview, and GitHub profile are optional —
            attach any combination and run.
          </p>
        </div>
        <button
          type="button"
          onClick={handlers.reset}
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink hover:bg-stone-50"
          title="Reset"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reset
        </button>
      </div>

      {/* The required CV sits in its own column; the optional trio is grouped
          in a sub-grid set off by a faint divider so the asymmetric rules read
          structurally, not just from the prose above. */}
      <div className="mt-5 grid gap-4 xl:grid-cols-4">
        <AnalyzeColumn
          icon={<FileText className="h-4 w-4 text-coral" aria-hidden />}
          heading="CV"
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
            heading="Job description"
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
              onPick={async (jd) => {
                // The list payload only carries a preview now, so fetch the full
                // body on demand before populating the textarea.
                setSelectedJdSlug(jd.slug);
                try {
                  const response = await fetch(`/api/jds/${encodeURIComponent(jd.slug)}`);
                  if (!response.ok) return;
                  const full = await response.json();
                  if (typeof full?.body === "string") setJobDescriptionText(full.body);
                } catch {
                  /* leave the textarea as-is; the selection is still recorded */
                }
              }}
              onClear={() => setSelectedJdSlug(null)}
            />
            <div className="mt-auto">
              <AnalyzePasteRow
                ariaLabel="Job description text"
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
            heading="Company overview"
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
                ariaLabel="Company overview text"
                inputId="company-overview-paste"
                text={inputs.companyText}
                onChange={setCompanyText}
                onClear={() => setCompanyText("")}
              />
            </div>
          </AnalyzeColumn>

          <AnalyzeColumn
            icon={<GitBranch className="h-4 w-4 text-coral" aria-hidden />}
            heading="GitHub profile"
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
                <input
                  aria-label="GitHub profile"
                  value={inputs.githubProfile}
                  onChange={(event) => setGithubProfile(event.target.value)}
                  className="focus-ring h-10 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-base text-ink"
                  placeholder="https://github.com/username or username"
                />
              </div>
              <p className="text-sm text-steel">Public profile — we read pinned repos.</p>
            </div>
          </AnalyzeColumn>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div aria-live="polite" className="sm:flex-1">
          {result.error ? (
            <p className="rounded-md bg-red-50 p-3 text-base text-red-700" role="alert">
              {result.error}
            </p>
          ) : (
            <p className="text-base text-steel">
              {inputs.cvFiles.length === 0
                ? "Attach a CV to enable Analyze."
                : "Ready — Gemini takes 15–25 seconds."}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handlers.submit}
          disabled={flags.isLoading || flags.isCompleting || inputs.cvFiles.length === 0}
          className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-base font-semibold text-white hover:bg-steel disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {flags.isLoading ? (
            <ScanAnimationCompact className="h-5 w-5" />
          ) : (
            <FileText className="h-4 w-4" aria-hidden />
          )}
          Analyze
        </button>
      </div>
    </section>
  );
}
