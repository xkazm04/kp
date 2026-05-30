"use client";

import { AlertTriangle, BriefcaseBusiness } from "lucide-react";
import { ScoreDial } from "@/app/_components/ScoreDial";
import type { Analysis } from "@/app/_lib/schemas";
import { ListBlock } from "../shared";
import { SkillChips } from "./SkillChips";

type KeywordCoverage = NonNullable<Analysis["keywordCoverage"]>;

export function JobFitTab({ analysis }: { analysis: Analysis }) {
  if (!analysis.jobFit) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <h3 className="font-serif text-h3 text-ink">Job Fit</h3>
        <p className="mt-3 text-sm leading-6 text-steel">Attach a job description to produce role-fit scoring, missing skills, and role-specific proof points.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <BriefcaseBusiness className="h-5 w-5 text-coral" aria-hidden />
                <h3 className="font-serif text-h3 text-ink">Job Fit</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-ink">{analysis.jobFit.summary}</p>
            </div>
            <ScoreDial score={analysis.jobFit.score} />
          </div>
          <div className="mt-4">
            <SkillChips
              matchingSkills={analysis.jobFit.matchingSkills}
              missingSkills={analysis.jobFit.missingSkills}
              evidence={analysis.evidenceTrace?.skills}
            />
          </div>
        </div>

        {analysis.keywordCoverage ? (
          <KeywordCoverageBlock coverage={analysis.keywordCoverage} />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <ListBlock
            title="Interview Talking Points"
            items={analysis.jobFit.interviewTalkingPoints}
            emptyHeadline="No talking points generated"
            emptyHint="Add concrete outcomes and metrics to your CV to seed interview stories."
          />
          <ListBlock
            title="Must-Prove Evidence"
            items={analysis.jobFit.mustProveEvidence}
            emptyHeadline="No proof points required"
            emptyHint="Your CV already evidences the core demands of this role."
          />
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">Alignment</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-ink">
            <p>{analysis.jobFit.seniorityAlignment}</p>
            <p>{analysis.jobFit.roleAlignment}</p>
            <p>{analysis.jobFit.salaryAssessment}</p>
          </div>
          <div className="mt-4 rounded-md bg-limewash p-3 text-sm leading-6 text-ink">{analysis.jobFit.negotiationAngle}</div>
        </div>
        <ListBlock
          title="Recruiter Risk Flags"
          items={analysis.jobFit.recruiterRiskFlags}
          emptyHeadline="No risk flags raised"
          emptyHint="A recruiter would not stumble over anything obvious in this CV."
        />
        <ListBlock
          title="CV Rewrite Suggestions"
          items={analysis.jobFit.cvRewriteSuggestions}
          emptyHeadline="No rewrites suggested"
          emptyHint="Your CV reads cleanly against this job description."
        />
      </div>
    </div>
  );
}

function KeywordCoverageBlock({ coverage }: { coverage: KeywordCoverage }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-serif text-h3 text-ink">Keyword Coverage</h3>
        <span className="text-sm font-semibold text-ink tabular-nums">
          {coverage.coveragePercent}%
        </span>
      </div>
      <CoverageBar percent={coverage.coveragePercent} />

      {coverage.hits.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {coverage.hits.map((hit) => (
            <KeywordRow key={hit.keyword} hit={hit} />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm leading-6 text-steel">
          No role keywords were extracted from the job description.
        </p>
      )}

      {coverage.missing.length ? (
        <div className="mt-5">
          <p className="text-sm font-semibold text-ink">Missing role keywords</p>
          <p className="mt-1 text-xs leading-5 text-steel">
            Add these explicitly to the CV — most ATS resume parsers require literal matches.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {coverage.missing.map((keyword) => (
              <li
                key={keyword}
                className="rounded-full border border-coral/40 bg-red-50 px-3 py-1 text-xs font-semibold text-ink"
              >
                {keyword}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {coverage.overUsed.length ? (
        <div className="mt-5 rounded-md bg-paper p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-coral" aria-hidden />
            <p className="text-sm font-semibold text-ink">Possible keyword stuffing</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-steel">
            These appear far more often in the CV than in the JD; recruiters may flag this:
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {coverage.overUsed.map((keyword) => (
              <li
                key={keyword}
                className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-semibold text-ink"
              >
                {keyword}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CoverageBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-stone-200">
      <div
        className="h-full rounded-full bg-moss transition-[width] duration-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function KeywordRow({ hit }: { hit: KeywordCoverage["hits"][number] }) {
  const label = hit.matched ? "matched" : "missing";
  const cls = hit.matched
    ? "border-moss/40 bg-moss/10 text-ink"
    : "border-coral/40 bg-red-50 text-ink";
  return (
    <div className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${cls}`}>
      <span className="truncate font-medium">{hit.keyword}</span>
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-steel">
        JD {hit.inJd} · CV {hit.inCv} · {label}
      </span>
    </div>
  );
}
