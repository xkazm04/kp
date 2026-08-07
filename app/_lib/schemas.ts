import { z } from "zod";
import { analysisResultSchema } from "./schemas.generated.ts";
import { CODE_REVIEW_STATUSES } from "./code-review-status.ts";

export { analysisResultSchema };
export type { AnalysisResult } from "./schemas.generated.ts";

// A URL string that is rendered as an `<a href={...}>` (the GitHub profile link
// and each repo link in the recruiter console). The live /api/github-analysis
// path feeds these from GitHub's API, but the persisted-report path
// (PATCH /api/analyses/[slug]) accepts client-supplied values, so a `javascript:`
// or `data:` scheme would be stored XSS in the recruiter console. Length is not
// sanitization — the scheme must be vetted. This transform blanks anything that
// isn't a well-formed http(s) URL (a blank href is inert), mirroring
// github-summary.ts's safeLinkUrl so every producer/consumer of the schema
// inherits the guard at this single choke point.
const _HTTP_LINK_SCHEMES = new Set(["http:", "https:"]);
const httpUrlOrBlank = z.string().transform((value) => {
  try {
    const u = new URL(value);
    return _HTTP_LINK_SCHEMES.has(u.protocol) ? u.href : "";
  } catch {
    return ""; // relative/scheme-less/malformed
  }
});

// Mirrors the `score` breakdown on `analysisResultSchema` (above, generated from
// pipeline/jobfit/models.py::ScoreBreakdown). Contract: `total` is DEFINED as the
// sum of the five components (experience/skills/roleSeniority/education/traits,
// maxima 25/30/23/12/10 → 100). The pipeline doesn't enforce that, so any surface
// rendering a total beside its parts reconciles it via reconcileScoreTotal in
// ./format.ts — see the score-breakdown invariant documented there.
const comparisonScoreSchema = z.object({
  total: z.number(),
  experience: z.number(),
  skills: z.number(),
  roleSeniority: z.number(),
  education: z.number(),
  traits: z.number()
});

const comparisonVariantSchema = z.object({
  label: z.string(),
  score: comparisonScoreSchema,
  jobFitScore: z.number().nullable(),
  keywordCoveragePercent: z.number().nullable(),
  matchingSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  skillsCount: z.number(),
  yearsExperience: z.number()
});

// Structured, language-neutral narrative entries (Direction: compare-speaks-your-
// language). buildComparison emits these ALONGSIDE the English strings so CompareTab
// can localize the compare narrative at render instead of painting TS-emitted English
// inside fully-localized chrome. Every field is a stable code or a raw param — no
// display text — so the same payload renders in any locale. All ADDITIVE + optional:
// a payload persisted before this seam existed simply omits them, and the UI falls
// back to the English strings (never blank).
const compareMetricSchema = z.enum(["overall", "jobFit"]);

const compareDriverSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tie"), best: z.string(), other: z.string(), metric: compareMetricSchema, score: z.number() }),
  z.object({
    kind: z.literal("delta"),
    best: z.string(),
    other: z.string(),
    dir: z.enum(["lead", "trail"]),
    amount: z.number(),
    metric: compareMetricSchema,
    bestScore: z.number(),
    otherScore: z.number()
  }),
  z.object({ kind: z.literal("driver"), component: z.string(), dir: z.enum(["win", "loss"]), amount: z.number(), other: z.string() }),
  z.object({ kind: z.literal("uniqueBest"), best: z.string(), skills: z.array(z.string()) }),
  z.object({ kind: z.literal("uniqueOther"), other: z.string(), skills: z.array(z.string()) })
]);

// Stable, non-display section keys — they double as React keys in CompareTab, so
// they must NOT change across locales (unlike the human-facing `section` label).
export const COMPARE_SECTION_KEYS = ["headline", "summary", "bullets", "skillsLine"] as const;
const compareSectionKeySchema = z.enum(COMPARE_SECTION_KEYS);

// THE minimum-variant contract for a comparison (idea-38a6fd70). A comparison
// exists to contrast CV variants against one another, so it is only meaningful
// with at least two of them. Pinned here once so the four paths that used to
// disagree about what "a comparison" is now read from one number: buildComparison
// refuses to build one below this, comparisonSchema below refuses to parse one,
// and the UI (ResultPanel's Compare tab default + CompareTab's render guard, via
// hasRenderableComparison) refuses to render one. Change it here and everywhere
// follows.
export const MIN_COMPARISON_VARIANTS = 2;

export const comparisonSchema = z.object({
  // The persisted contract: a comparison carries at least MIN_COMPARISON_VARIANTS
  // variants. A 0- or 1-variant payload is rejected on read (the history/task
  // loaders surface "saved in an older schema"), which is exactly right — such a
  // payload is never produced today and is no longer a state the UI supports.
  variants: z.array(comparisonVariantSchema).min(MIN_COMPARISON_VARIANTS),
  bestLabel: z.string(),
  driverInsights: z.array(z.string()),
  // Structured mirror of driverInsights (see compareDriverSchema). Optional: old
  // payloads omit it and CompareTab renders the English driverInsights strings.
  driverInsightItems: z.array(compareDriverSchema).optional(),
  mergedRecommendation: z.object({
    summary: z.string(),
    // Which summary sentence to build at render — "allSame" (one variant wins every
    // section) or "split" (graft the strongest sections). Optional → English fallback.
    summaryKind: z.enum(["allSame", "split"]).optional(),
    headline: z.string(),
    // The enum slugs + skills the headline is composed from, so CompareTab can render
    // it through the localized enum catalog (seniority/family) instead of the English
    // slug words baked in at analysis time. Optional/nullable → English fallback.
    headlineParams: z
      .object({ seniority: z.string(), roleFamily: z.string(), skills: z.array(z.string()) })
      .nullable()
      .optional(),
    skillsLine: z.string(),
    bullets: z.array(z.string()),
    sectionPicks: z.array(
      z.object({
        section: z.string(),
        // Stable per-section key (React key + label/reason lookup). Optional → the UI
        // keys off `section` and renders the English `reason` string (old payloads).
        key: compareSectionKeySchema.optional(),
        sourceLabel: z.string(),
        reason: z.string(),
        // Numeric params the localized reason sentence interpolates. Which ones are
        // present depends on `key` (headline→pts; summary→pts,yrs; bullets→score;
        // skillsLine→pts,count).
        reasonParams: z
          .object({
            pts: z.number().optional(),
            yrs: z.number().optional(),
            score: z.number().optional(),
            count: z.number().optional()
          })
          .optional()
      })
    )
  })
});

export const analysisSchema = analysisResultSchema.extend({
  comparison: comparisonSchema.optional(),
  // The save receipt analyze-run attaches server-side ({ slug, createdAt } or
  // null when persistence failed). Declaring it here (CV1 enabler) keeps zod
  // from stripping it on the client parse, so the live Analyze tab can address
  // the saved row — e.g. PATCH the GitHub deep-dive onto it (GH1) or link the
  // stable /history/<slug> report.
  // `candidateLabel` + `jdSlug` are echoed from the persisted row so the live
  // Analyze result can offer the same "Add to pipeline" the saved report does,
  // filed under the exact label the board's on-board chip matches by and the JD
  // slug the board keys lanes on (Direction 1). Nullish: a JD-less run has no
  // slug; a failed persist yields a null receipt entirely.
  persistence: z
    .object({
      slug: z.string(),
      createdAt: z.string(),
      candidateLabel: z.string().nullish(),
      jdSlug: z.string().nullish(),
    })
    .nullish(),
  // Direction 2 — settled multi-CV semantics: when a comparison delivers with one
  // or more variants having failed, the survivors still produce a result and the
  // failed variant(s) are NAMED here (which file, what error) so the client can
  // surface them in the result UI, not bury them in logs. Attached by analyze-run
  // only on a partial run; absent on a clean or single-CV run.
  // `error` is engine/server-owned text (Python stderr) shown verbatim; `code`, when
  // present, marks a failure whose reason was OUR OWN generic fallback (not engine
  // text), so the client renders a localized generic line instead of leaking an
  // English literal into the localized frame. Absent code ⇒ show `error` verbatim.
  partialFailures: z.array(z.object({ label: z.string(), error: z.string(), code: z.string().nullish() })).nullish(),
  // True when the delivered run did NO new engine work — every surviving variant
  // was served from the analyze cache (a re-run / duplicate). The live Analyze
  // result reads this to show a "served from cache, no new cost" note.
  servedFromCache: z.boolean().nullish()
});

export type Analysis = z.infer<typeof analysisSchema>;

// An analysis observation as DATA: `kind` names a message in the
// `results.github.finding` catalog, `params` are the raw values ICU formats.
// See app/_lib/github-evidence.ts for why these are not sentences.
export const githubFindingSchema = z.object({
  kind: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional()
});
// A stored analysis predating findings carries the frozen English sentence its
// run produced. Accept it so a saved report keeps rendering (verbatim, in that
// English) instead of failing to parse.
const githubNoteSchema = z.union([z.string(), githubFindingSchema]);

// Single source of truth for the code-review payload shape: the route derives
// its CodeReviewPayload from this via z.infer, and the e2e fixture is typed
// against it, so the three former hand-maintained mirrors can no longer drift.
export const codeReviewSchema = z.object({
  // Derived from the single CODE_REVIEW_STATUSES list (see that module for what
  // each of the four states means). `empty` is distinct from `ok` so an empty
  // review — no owned public repos — is never mistaken for evidenced-skills data.
  status: z.enum(CODE_REVIEW_STATUSES),
  // Canonical ENGLISH, like an API envelope's `error`: it is the server log's
  // line AND the text frozen into a pipeline entry's GithubEvidenceSummary
  // (github-summary.ts) at add-to-pipeline time. For the `ok` status it is the
  // model's own prose and the only thing there is to show; for every other status
  // it is machine copy the UI must NOT render — `reason` below is what it renders.
  summary: z.string(),
  // Which non-ok branch produced `summary`, as a stable code the panel resolves
  // through `results.github.review.<reason>`. Four statuses cover eight distinct
  // outcomes (a disabled key vs an undecryptable one, no repos vs no signals vs a
  // throttled read), so status alone cannot localize the line. Nullish: absent on
  // `ok`, and on any payload cached/stored before this field existed.
  reason: z.string().nullish(),
  // FINDING #2 — the review is real but some repository data couldn't be fetched
  // this run. Structured instead of a sentence appended to `summary`, so the panel
  // renders the caveat in the reader's language beside the model's prose.
  partial: z.boolean().nullish(),
  // `confirmedSkills` is the model's read on which skills the *public repo
  // signals* evidence — NOT a confirmation that the source code was inspected.
  // The deep review never reads file bodies or a recursive tree (see
  // `evidenceBasis`), so the UI surfaces these as "Evidenced Skills".
  confirmedSkills: z.array(z.string()),
  unverifiedClaims: z.array(z.string()),
  hiddenStrengths: z.array(z.string()),
  reposReviewed: z.array(z.string()),
  // Deterministic description of the exact evidence the review was built from
  // (README text, commit subjects, root-level file names, …) as findings, so the
  // panel can state its scope — in the reader's language — instead of implying
  // the code was read.
  evidenceBasis: z.array(githubNoteSchema),
  error: z.string().nullable()
});

export const githubAnalysisSchema = z.object({
  username: z.string(),
  profileUrl: httpUrlOrBlank,
  // Canonical English (see codeReview.summary): the line github-summary.ts freezes
  // into a pipeline entry when the deep review has none of its own. The panel
  // renders `summaryFinding` instead whenever it is present.
  summary: z.string(),
  // The same sentence as data — login, repo counts and the leading languages —
  // so the panel composes it in the reader's language.
  summaryFinding: githubFindingSchema.nullish(),
  analyzedAt: z.string(),
  metrics: z.object({
    publicRepos: z.number(),
    followers: z.number(),
    totalStars: z.number(),
    totalForks: z.number(),
    activeRepos: z.number(),
    recentlyUpdatedRepos: z.number(),
    ownedReposAnalyzed: z.number()
  }),
  languages: z.array(
    z.object({
      name: z.string(),
      bytes: z.number(),
      percent: z.number()
    })
  ),
  topRepositories: z.array(
    z.object({
      name: z.string(),
      url: httpUrlOrBlank,
      description: z.string().nullable(),
      primaryLanguage: z.string().nullable(),
      stars: z.number(),
      forks: z.number(),
      updatedAt: z.string(),
      pushedAt: z.string().nullable(),
      topics: z.array(z.string()),
      complexitySignals: z.array(githubNoteSchema)
    })
  ),
  contributionSignals: z.array(githubNoteSchema),
  jobFitSignals: z.object({
    // True iff a non-empty job description was supplied for this run. Lets the UI tell
    // "no JD provided — we never ran a comparison" apart from "JD analyzed, zero overlap",
    // which are opposite conclusions about the same candidate (idea-2dd27822). Without it,
    // an empty matchingSkills list is ambiguous and a benign empty input reads as a skills gap.
    jobDescriptionProvided: z.boolean(),
    matchingSkills: z.array(z.string()),
    potentialGaps: z.array(z.string()),
    // How many skills the fixed taxonomy covers — so the UI can say "compared against
    // N tracked skills" and a recruiter doesn't read "no gaps" as exhaustive.
    // Nullish for backward-compat with any response cached before this field existed.
    trackedSkillCount: z.number().nullish(),
    complexityAssessment: githubNoteSchema
  }),
  limitations: z.array(githubNoteSchema),
  codeReview: codeReviewSchema.optional()
});

export type GithubAnalysis = z.infer<typeof githubAnalysisSchema>;
export type CodeReview = z.infer<typeof codeReviewSchema>;
