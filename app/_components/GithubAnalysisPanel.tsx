"use client";

import { GitBranch, GitPullRequest, Loader2, Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { GithubAnalysis } from "@/app/_lib/schemas";
import { hasEvidenceIncomplete, type GithubNote } from "@/app/_lib/github-evidence";
import { dedupe } from "@/app/_lib/dedupe";
import { CodeReviewStatusBadge } from "./Badge";
import { Meter } from "./Meter";
import { NOTICE, PANEL } from "./ui/recipes";

// Analysis findings arrive as `{ kind, params }` (app/_lib/github-evidence.ts):
// the server decides WHAT was observed, this panel decides how it reads, in the
// reader's language. A payload stored before findings existed carries the frozen
// English sentence that run produced — render it verbatim rather than losing it.
function useFindingText(): (note: GithubNote) => string {
  const t = useTranslations("results.github.finding");
  type FindingKey = Parameters<typeof t>[0];
  return (note) => {
    if (typeof note === "string") return note;
    const key = note.kind as FindingKey;
    return t.has(key) ? t(key, note.params) : "";
  };
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
  const t = useTranslations("results.github");
  if (status === "idle") return null;

  return (
    <section className={`animate-fade-in ${PANEL} p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-coral" aria-hidden />
            <h2 className="font-serif text-h2 text-ink">{t("title")}</h2>
          </div>
          <p className="mt-2 max-w-3xl text-base leading-6 text-steel">{t("intro")}</p>
        </div>
        {status === "loading" ? (
          <div className="inline-flex items-center gap-2 rounded-md bg-paper px-3 py-2 text-base font-medium text-steel">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("inProcess")}
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
              <GitBranch size={13} aria-hidden /> {t("retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {warning ? (
        <p className={`mt-4 ${NOTICE("amber")} p-3 text-base`} role="status">
          {warning}
        </p>
      ) : null}

      {analysis ? <GithubAnalysisBody analysis={analysis} /> : null}
    </section>
  );
}

function GithubAnalysisBody({ analysis }: { analysis: GithubAnalysis }) {
  const t = useTranslations("results.github");
  const format = useFormatter();
  const findingText = useFindingText();
  // Guard an untrusted/optional ISO date so a blank or malformed `updatedAt` renders an
  // em-dash instead of the literal "Invalid Date" in a candidate card. Formatted for the
  // reader's locale, not the OS's (a bare toLocaleDateString() reads the latter).
  const safeDate = (value: string): string => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : format.dateTime(d, { dateStyle: "medium" });
  };
  // Disambiguate "no JD supplied" from "JD analyzed, zero overlap" (idea-2dd27822): the same
  // empty matchingSkills list means opposite things to a recruiter, so the empty-state copy
  // must spell out which one happened instead of always reading as a damning skills gap.
  const { jobDescriptionProvided } = analysis.jobFitSignals;
  // FINDING #2: the route drops this finding into `limitations` when some public GitHub
  // data was throttled away this run. When present, absence of a skill is "could not
  // determine", not a real gap (the route has already suppressed the unreliable
  // gaps), so the panel must say so instead of the falsely-reassuring "no gaps".
  const evidenceIncomplete = hasEvidenceIncomplete(analysis.limitations);
  const matchesEmpty = jobDescriptionProvided ? t("matchesEmptyAnalyzed") : t("matchesEmptyNoJd");
  const gapsEmpty = !jobDescriptionProvided
    ? t("gapsEmptyNoJd")
    : evidenceIncomplete
      ? t("gapsEmptyIncomplete")
      : t("gapsEmptyNone");
  // The headline reads from the finding when the payload carries one; a stored
  // analysis from before findings keeps its own English sentence.
  const summary = analysis.summaryFinding ? findingText(analysis.summaryFinding) : analysis.summary;
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <div className="rounded-lg border border-stone-200 bg-paper p-4">
          {/* profileUrl is `httpUrlOrBlank` (app/_lib/schemas.ts): a non-http(s)
              scheme arriving through PATCH /api/analyses/[slug] is BLANKED, not
              rejected. A blank href is inert as an href but still a live link —
              it resolves to the current URL, so clicking "@user" reloaded the
              report and lost the open tab. Blank ⇒ render the handle as text. */}
          {analysis.profileUrl ? (
            <a href={analysis.profileUrl} target="_blank" rel="noreferrer" className="text-base font-semibold text-ink underline">
              @{analysis.username}
            </a>
          ) : (
            <p className="text-base font-semibold text-ink">@{analysis.username}</p>
          )}
          <p className="mt-3 text-base leading-6 text-ink">{summary}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-base">
            <Metric label={t("metricRepos")} value={analysis.metrics.ownedReposAnalyzed} />
            <Metric label={t("metricActive")} value={analysis.metrics.activeRepos} />
            <Metric label={t("metricStars")} value={analysis.metrics.totalStars} />
            <Metric label={t("metricForks")} value={analysis.metrics.totalForks} />
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="font-serif text-h3 text-ink">{t("languageMix")}</h3>
          <div className="mt-3 space-y-3">
            {analysis.languages.length ? analysis.languages.slice(0, 6).map((language) => (
              <div key={language.name}>
                <div className="flex justify-between gap-3 text-base">
                  <span className="font-medium text-ink">{language.name}</span>
                  <span className="text-steel">{t("percent", { percent: language.percent })}</span>
                </div>
                <Meter
                  value={Math.max(2, language.percent)}
                  tone="strong"
                  className="mt-1"
                  aria-label={t("languageShare", { name: language.name, percent: language.percent })}
                />
              </div>
            )) : <p className="text-base text-steel">{t("noLanguages")}</p>}
          </div>
        </div>

        <TopRepositoriesBlock repositories={analysis.topRepositories.slice(0, 3)} safeDate={safeDate} />
      </div>

      <div className="space-y-5">
        <TitledList title={t("contributionSignals")} items={analysis.contributionSignals.map(findingText)} />
        <div className="grid gap-5 lg:grid-cols-2">
          <TitledList title={t("jobSkillMatches")} items={analysis.jobFitSignals.matchingSkills} empty={matchesEmpty} />
          <TitledList title={t("potentialGaps")} items={analysis.jobFitSignals.potentialGaps} empty={gapsEmpty} />
        </div>
        {jobDescriptionProvided && analysis.jobFitSignals.trackedSkillCount ? (
          <p className="text-sm text-steel">
            {t("trackedNote", { count: analysis.jobFitSignals.trackedSkillCount })}
            {/* FINDING #2: extend (don't duplicate) the honest-coverage caveat when
                this run was partially throttled, so gaps are never read as complete. */}
            {evidenceIncomplete ? ` ${t("trackedIncomplete")}` : null}
          </p>
        ) : null}
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="font-serif text-h3 text-ink">{t("complexityTitle")}</h3>
          <p className="mt-3 text-base leading-6 text-ink">{findingText(analysis.jobFitSignals.complexityAssessment)}</p>
        </div>
        {analysis.codeReview ? <CodeReviewBlock review={analysis.codeReview} /> : null}
        <TitledList title={t("limitations")} items={analysis.limitations.map(findingText)} />
      </div>
    </div>
  );
}

function TopRepositoriesBlock({
  repositories,
  safeDate,
}: {
  repositories: GithubAnalysis["topRepositories"];
  safeDate: (value: string) => string;
}) {
  const t = useTranslations("results.github");
  if (repositories.length === 0) return null;
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="font-serif text-h3 text-ink">{t("topRepositories")}</h3>
      <div className="mt-3 grid gap-3">
        {/* Same `httpUrlOrBlank` contract as profileUrl: a rejected scheme lands here
            as "". Keying by url then collapsed EVERY blanked repo onto key="" (React
            duplicate-key warning + sibling cards swapping content on re-render), and
            the card stayed an <a href=""> that reloaded the page on click. Key by
            name+index and drop the anchor when there is no destination. */}
        {repositories.map((repo, i) => {
          const body = (
            <>
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
                {repo.primaryLanguage ?? t("mixedLanguage")} · {safeDate(repo.updatedAt)}
              </p>
            </>
          );
          const key = `${repo.name}-${i}`;
          return repo.url ? (
            <a key={key} href={repo.url} target="_blank" rel="noreferrer" className="rounded-md bg-paper p-3 hover:bg-limewash">
              {body}
            </a>
          ) : (
            <div key={key} className="rounded-md bg-paper p-3">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CodeReviewBlock({
  review
}: {
  review: NonNullable<GithubAnalysis["codeReview"]>;
}) {
  const t = useTranslations("results.github");
  const tReview = useTranslations("results.github.review");
  const findingText = useFindingText();
  // `summary` is canonical English on every non-ok branch (a disabled key, an empty
  // repo list, a throttled read) — machine copy written for the log and for the
  // frozen pipeline evidence record. `reason` names which branch it was, and THAT is
  // what a reader sees. Only the `ok` branch's summary is the model's own prose.
  type ReasonKey = Parameters<typeof tReview>[0];
  const reasonKey = review.reason as ReasonKey | null | undefined;
  const summary = reasonKey && tReview.has(reasonKey) ? tReview(reasonKey) : review.status === "ok" ? review.summary : "";
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-serif text-h3 text-ink">{t("reviewTitle")}</h3>
        <CodeReviewStatusBadge status={review.status} />
      </div>
      {/* The model never reads source code — only lightweight public signals — so
          this panel is named for the evidence it actually uses, not "code-aware".
          Spelling out the scope here keeps "Evidenced Skills" below from being
          mistaken for a confirmation that the code itself was inspected. */}
      <p className="mt-2 text-sm leading-5 text-steel">{t("reviewScope")}</p>
      {summary ? <p className="mt-3 text-base leading-6 text-ink">{summary}</p> : null}
      {review.partial ? (
        <p className="mt-2 text-sm leading-5 text-amber-800">{tReview("partial")}</p>
      ) : null}
      {review.error ? (
        <p className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-700">{review.error}</p>
      ) : null}
      {review.reposReviewed.length ? (
        <p className="mt-2 text-sm text-steel">{t("reposReviewed", { repos: review.reposReviewed.join(", ") })}</p>
      ) : null}
      {review.evidenceBasis.length ? (
        <details className="mt-3 rounded-md bg-paper p-3">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-steel">
            {t("evidenceBasis")}
          </summary>
          <ul className="mt-2 space-y-1 text-sm leading-5 text-ink">
            {review.evidenceBasis.map(findingText).filter(Boolean).map((item, i) => (
              <li key={`${item}-${i}`}>• {item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <TitledList title={t("evidencedSkills")} items={review.confirmedSkills} accent="bg-moss/15" empty={t("noneDetected")} />
        <TitledList title={t("unverifiedClaims")} items={review.unverifiedClaims} accent="bg-coral/10" empty={t("noneDetected")} />
        <TitledList title={t("hiddenStrengths")} items={review.hiddenStrengths} accent="bg-limewash" empty={t("noneDetected")} />
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
// key={item-index} strategy live here in exactly one place. Copy arrives resolved
// (title, empty state, and findings already rendered) so this stays presentational.
function TitledList({
  title,
  items,
  accent,
  empty,
}: {
  title: string;
  items: string[];
  accent?: string;
  empty?: string;
}) {
  const t = useTranslations("results.github");
  const rows = dedupe(items.filter(Boolean));
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
        <p className={accent ? "mt-2 text-sm text-steel" : "mt-3 text-base leading-6 text-ink"}>{empty ?? t("noItems")}</p>
      )}
    </div>
  );
}
