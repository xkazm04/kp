"use client";

import { GitBranch, GitPullRequest, Loader2, Star } from "lucide-react";
import type { GithubAnalysis } from "@/app/_lib/schemas";
import { dedupe } from "@/app/_lib/dedupe";
import { CodeReviewStatusBadge } from "./Badge";
import { Meter } from "./Meter";

// Guard an untrusted/optional ISO date so a blank or malformed `updatedAt` renders an
// em-dash instead of the literal "Invalid Date" in a candidate card.
function safeDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

type GithubAnalysisPanelProps = {
  status: "idle" | "loading" | "done" | "error";
  analysis: GithubAnalysis | null;
  error: string | null;
  /** Non-fatal degradation note shown above the result (e.g. JD-blind run). */
  warning?: string | null;
  /** GH5 — re-fire the deep-dive alone. Rate limits are this route's dominant
   *  failure; without this the only recovery was re-running the whole CV
   *  analysis. Omitted where no re-run is possible (e.g. a saved report). */
  onRetry?: () => void;
};

export function GithubAnalysisPanel({ status, analysis, error, warning, onRetry }: GithubAnalysisPanelProps) {
  if (status === "idle") return null;

  return (
    <section className="animate-fade-in rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-coral" aria-hidden />
            <h2 className="font-serif text-h2 text-ink">GitHub Analysis</h2>
          </div>
          <p className="mt-2 max-w-3xl text-base leading-6 text-steel">
            Runs separately from the CV analysis so public repository evidence can be reviewed without blocking the main result.
          </p>
        </div>
        {status === "loading" ? (
          <div className="inline-flex items-center gap-2 rounded-md bg-paper px-3 py-2 text-base font-medium text-steel">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            In process
          </div>
        ) : null}
      </div>

      {status === "loading" ? (
        <div className="mt-5 h-1 overflow-hidden rounded-full bg-stone-200">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-coral" />
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-4 rounded-md bg-red-50 p-3">
          <p className="text-base text-red-700">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100"
            >
              <GitBranch size={13} aria-hidden /> Retry GitHub analysis
            </button>
          ) : null}
        </div>
      ) : null}

      {warning ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-base text-amber-800" role="status">
          {warning}
        </p>
      ) : null}

      {analysis ? <GithubAnalysisBody analysis={analysis} /> : null}
    </section>
  );
}

function GithubAnalysisBody({ analysis }: { analysis: GithubAnalysis }) {
  // Disambiguate "no JD supplied" from "JD analyzed, zero overlap" (idea-2dd27822): the same
  // empty matchingSkills list means opposite things to a recruiter, so the empty-state copy
  // must spell out which one happened instead of always reading as a damning skills gap.
  const { jobDescriptionProvided } = analysis.jobFitSignals;
  const matchesEmpty = jobDescriptionProvided
    ? "Job description analyzed — no overlapping skills found in public GitHub metadata."
    : "No job description supplied — add one to compare it against this candidate's public work.";
  const gapsEmpty = jobDescriptionProvided
    ? "No job-mentioned gaps detected from public GitHub metadata."
    : "No job description supplied — gaps are only measured against a job description.";
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-paper p-4">
          <a href={analysis.profileUrl} target="_blank" rel="noreferrer" className="text-base font-semibold text-ink underline">
            @{analysis.username}
          </a>
          <p className="mt-3 text-base leading-6 text-ink">{analysis.summary}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-base">
            <Metric label="Repos" value={analysis.metrics.ownedReposAnalyzed} />
            <Metric label="Active" value={analysis.metrics.activeRepos} />
            <Metric label="Stars" value={analysis.metrics.totalStars} />
            <Metric label="Forks" value={analysis.metrics.totalForks} />
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="font-serif text-h3 text-ink">Language Mix</h3>
          <div className="mt-3 space-y-3">
            {analysis.languages.length ? analysis.languages.slice(0, 6).map((language) => (
              <div key={language.name}>
                <div className="flex justify-between gap-3 text-base">
                  <span className="font-medium text-ink">{language.name}</span>
                  <span className="text-steel">{language.percent}%</span>
                </div>
                <Meter value={Math.max(2, language.percent)} tone="strong" className="mt-1" aria-label={`${language.name} ${language.percent}%`} />
              </div>
            )) : <p className="text-base text-steel">No language data returned by GitHub.</p>}
          </div>
        </div>

        <TopRepositoriesBlock repositories={analysis.topRepositories.slice(0, 3)} />
      </div>

      <div className="space-y-5">
        <TitledList title="Contribution Signals" items={analysis.contributionSignals} />
        <div className="grid gap-5 lg:grid-cols-2">
          <TitledList title="Job Skill Matches" items={analysis.jobFitSignals.matchingSkills} empty={matchesEmpty} />
          <TitledList title="Potential Gaps" items={analysis.jobFitSignals.potentialGaps} empty={gapsEmpty} />
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="font-serif text-h3 text-ink">Complexity Assessment</h3>
          <p className="mt-3 text-base leading-6 text-ink">{analysis.jobFitSignals.complexityAssessment}</p>
        </div>
        {analysis.codeReview ? <CodeReviewBlock review={analysis.codeReview} /> : null}
        <TitledList title="Limitations" items={analysis.limitations} />
      </div>
    </div>
  );
}

function TopRepositoriesBlock({
  repositories,
}: {
  repositories: GithubAnalysis["topRepositories"];
}) {
  if (repositories.length === 0) return null;
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="font-serif text-h3 text-ink">Top Repositories</h3>
      <div className="mt-3 grid gap-3">
        {repositories.map((repo) => (
          <a
            key={repo.url}
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-paper p-3 hover:bg-limewash"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-semibold text-ink" title={repo.name}>
                {repo.name}
              </p>
              <div className="flex shrink-0 gap-2 text-sm text-steel">
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5" aria-hidden />
                  {repo.stars}
                </span>
                <span className="inline-flex items-center gap-1">
                  <GitPullRequest className="h-3.5 w-3.5" aria-hidden />
                  {repo.forks}
                </span>
              </div>
            </div>
            {repo.description ? (
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-ink">{repo.description}</p>
            ) : null}
            <p className="mt-2 text-sm text-steel">
              {repo.primaryLanguage ?? "Mixed"} · {safeDate(repo.updatedAt)}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}

function CodeReviewBlock({
  review
}: {
  review: NonNullable<GithubAnalysis["codeReview"]>;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-serif text-h3 text-ink">Repo-Signal Review</h3>
        <CodeReviewStatusBadge status={review.status} />
      </div>
      {/* The model never reads source code — only lightweight public signals — so
          this panel is named for the evidence it actually uses, not "code-aware".
          Spelling out the scope here keeps "Evidenced Skills" below from being
          mistaken for a confirmation that the code itself was inspected. */}
      <p className="mt-2 text-sm leading-5 text-steel">
        Skills inferred from public repository signals — READMEs, commit subjects, root-level
        file names, language, and topics — not from reading the source code.
      </p>
      {review.summary ? (
        <p className="mt-3 text-base leading-6 text-ink">{review.summary}</p>
      ) : null}
      {review.error ? (
        <p className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-700">{review.error}</p>
      ) : null}
      {review.reposReviewed.length ? (
        <p className="mt-2 text-sm text-steel">
          Repos reviewed: {review.reposReviewed.join(", ")}
        </p>
      ) : null}
      {review.evidenceBasis.length ? (
        <details className="mt-3 rounded-md bg-paper p-3">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-steel">
            Evidence basis
          </summary>
          <ul className="mt-2 space-y-1 text-sm leading-5 text-ink">
            {review.evidenceBasis.map((item, i) => (
              <li key={`${item}-${i}`}>• {item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <TitledList title="Evidenced Skills" items={review.confirmedSkills} accent="bg-moss/15" empty="None detected." />
        <TitledList title="Unverified Claims" items={review.unverifiedClaims} accent="bg-coral/10" empty="None detected." />
        <TitledList title="Hidden Strengths" items={review.hiddenStrengths} accent="bg-limewash" empty="None detected." />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-white p-3">
      <p className="text-sm font-medium uppercase tracking-wide text-steel">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

// One titled card with a deduped bullet list and an empty-state fallback — the
// single source for both the body panels (Contribution / Job / Limitations) and
// the compact review columns (Evidenced Skills / Unverified Claims / Hidden
// Strengths). `accent` switches to the compact review look (tinted card,
// uppercase label, "•" bullets); without it the panel look renders (white
// bordered card, serif heading). Either way the dedupe call and the
// key={item-index} strategy live here in exactly one place.
function TitledList({
  title,
  items,
  accent,
  empty = "No items detected.",
}: {
  title: string;
  items: string[];
  accent?: string;
  empty?: string;
}) {
  const rows = dedupe(items);
  return (
    <div className={accent ? `rounded-md ${accent} p-3` : "rounded-lg border border-stone-200 bg-white p-4"}>
      {accent ? (
        <p className="text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
      ) : (
        <h3 className="font-serif text-h3 text-ink">{title}</h3>
      )}
      {rows.length ? (
        <ul className={accent ? "mt-2 space-y-1" : "mt-3 space-y-2"}>
          {rows.map((item, i) => (
            <li key={`${item}-${i}`} className="text-base leading-6 text-ink">
              {accent ? `• ${item}` : item}
            </li>
          ))}
        </ul>
      ) : (
        <p className={accent ? "mt-2 text-sm text-steel" : "mt-3 text-base leading-6 text-ink"}>{empty}</p>
      )}
    </div>
  );
}
