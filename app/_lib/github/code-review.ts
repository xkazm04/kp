import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { codeReviewSchema } from "@/app/_lib/schemas";
import { describeEvidenceBasis } from "@/app/_lib/github-evidence";
import { withGeminiRetry } from "@/app/_lib/gemini-retry";
import { resolveProviderKey } from "@/app/_lib/llm-config";
import { fetchRepoBundle, type GithubRepo, type RepoBundle } from "./client";
import { GEMINI_MODEL, recordGeminiUsage } from "./usage";

// How many top-ranked repos get the Gemini deep review — the review's cost and
// latency budget, applied by the caller to the ranked repo list.
export const DEEP_REVIEW_REPO_LIMIT = 3;

// Derived from the single codeReviewSchema (app/_lib/schemas) so this payload,
// the GithubAnalysis schema and the e2e fixture can't silently drift apart.
export type CodeReviewPayload = z.infer<typeof codeReviewSchema>;

// describeEvidenceBasis + the README_TRUNCATE / COMMITS_PER_REPO / FILES_PER_REPO
// limits live in @/app/_lib/github-evidence so this route and the e2e fixture
// share one source of truth (the fixture used to hardcode the numbers by value).

// Shape the Gemini model is asked to emit (snake_case). Each field .catch()es to
// a safe default so a malformed/partial field snaps to empty instead of throwing,
// and safeParse on a non-object returns failure (-> we flag a malformed payload).
const geminiReviewSchema = z.object({
  summary: z.string().catch(""),
  confirmed_skills: z.array(z.string()).catch([]),
  unverified_claims: z.array(z.string()).catch([]),
  hidden_strengths: z.array(z.string()).catch([]),
});

export async function runCodeReview(
  repos: GithubRepo[],
  jobDescription: string,
  requestId?: string
): Promise<CodeReviewPayload> {
  const reposReviewed = repos.map((repo) => repo.name);
  // Documented only for paths where the review actually assembles evidence; the
  // disabled / no-repos branches read nothing, so they advertise no basis.
  const evidenceBasis = describeEvidenceBasis();
  // Key resolution follows the app's documented layering (docs/architecture/llm-provider-layer.md,
  // resolveProviderKey): UI-entered BYOM key row → platform key row → env var
  // (GEMINI_API_KEY, then GOOGLE_API_KEY). This route used to read only the env
  // vars, so a workspace running purely on a BYOM Gemini key silently got the
  // "disabled" review. A configured-but-undecryptable stored key throws (KP_SECRET
  // changed/missing) — surface that as a review error, not as key-not-configured.
  let apiKey: string | undefined;
  try {
    apiKey = resolveProviderKey("gemini", ["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  } catch (error) {
    return {
      status: "error",
      summary: "A Gemini provider key is configured but could not be decrypted (check KP_SECRET).",
      reason: "keyUndecryptable",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!apiKey) {
    return {
      status: "disabled",
      summary: "Set GEMINI_API_KEY (or add a Gemini key in Models → Keys) to enable Gemini-based repo-signal review.",
      reason: "disabled",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis: [],
      error: null,
    };
  }
  if (repos.length === 0) {
    // Distinct from "ok": the review ran successfully but found nothing to
    // review, so consumers must not read this as evidenced-skills data.
    return {
      status: "empty",
      summary: "No owned public repositories were available to review.",
      reason: "noRepos",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis: [],
      error: null,
    };
  }

  let results: Array<{ bundle: RepoBundle; incomplete: boolean }>;
  try {
    results = await Promise.all(repos.map(fetchRepoBundle));
  } catch (error) {
    return {
      status: "error",
      summary: "Failed to fetch repository signals for deep review.",
      reason: "fetchFailed",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const bundles = results.map((r) => r.bundle);
  // FINDING #2: was any sub-fetch a coverage loss (throttle/5xx/network, not a
  // genuine 404)? If so this is a PARTIAL read, not a complete one.
  const coverageIncomplete = results.some((r) => r.incomplete);

  // fetchRepoBundle swallows each sub-fetch to a benign default ("" / []), so a
  // rate-limited or 5xx run yields bundles with no readme, commits, or files yet
  // Promise.all still "succeeds". Distinguish three states instead of the old binary
  // any-signal-vs-none, so "partially blind" is never mistaken for "complete".
  const hasAnySignal = bundles.some(
    (b) => b.readme.trim() || b.recentCommits.length > 0 || b.files.length > 0
  );
  if (!hasAnySignal) {
    // COULD NOT DETERMINE: no signal AND a sub-fetch was throttled/errored — almost
    // always a transient rate limit, not empty repos. Sending it to Gemini would
    // fabricate a confident assessment from nothing, so fail loudly.
    if (coverageIncomplete) {
      return {
        status: "error",
        summary: "Couldn't gather public repo signals — GitHub may be rate-limiting (could not determine). Try again shortly.",
        reason: "throttled",
        confirmedSkills: [],
        unverifiedClaims: [],
        hiddenStrengths: [],
        reposReviewed,
        evidenceBasis,
        error: "could_not_determine: repo signal fetch throttled/errored across all repos",
      };
    }
    // NO EVIDENCE: every sub-fetch succeeded and still returned nothing — the repos
    // genuinely expose no README/commit/file signals. A real, successful "empty"
    // (distinct from could-not-determine), so consumers don't read it as data.
    return {
      status: "empty",
      summary: "Reviewed repositories expose no public README, commit, or file signals to assess.",
      reason: "noSignals",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis,
      error: null,
    };
  }

  const evidenceJson = JSON.stringify(
    bundles.map((b) => ({
      name: b.name,
      language: b.language,
      topics: b.topics,
      description: b.description,
      files: b.files,
      recentCommits: b.recentCommits,
      readme: b.readme,
    })),
    null,
    2
  );

  const prompt = [
    "You are a precise senior engineer reviewing public GitHub repo *signals* for hiring evidence.",
    "You are NOT reading the source code. You only receive lightweight public signals: README text (truncated), recent commit subject lines, root-level file/directory NAMES (no file contents), the primary language, and topics.",
    "Decide which technical skills are demonstrably evidenced by these public repo signals, which are *claimed* in the job description but absent from the signals, and which strengths the signals reveal that the job description didn't ask for.",
    "Be conservative: do not infer code quality, architecture, or implementation details you cannot see. Treat a skill as evidenced only when the visible signals directly support it.",
    "In the summary, name any MUST-HAVE job-description skills that are NOT evidenced by the signals explicitly — never imply full coverage (e.g. do not say 'matches N of N must-haves') when a required skill is unproven.",
    "Output ONLY a JSON object matching this shape — no markdown fences, no commentary:",
    `{"summary": "2-3 sentence overall assessment of what the public repo signals show.", "confirmed_skills": ["skill evidenced by the signals"], "unverified_claims": ["jd skill not visible in the repo signals"], "hidden_strengths": ["skill in the signals but not in jd"]}`,
    "",
    "Job description (may be empty):",
    jobDescription || "(none supplied)",
    "",
    "Repository signals (metadata and text only — no file bodies):",
    evidenceJson,
  ].join("\n");

  try {
    const ai = new GoogleGenAI({ apiKey });
    // Bounded retry on transient failures only (429/5xx/timeouts) — this was the
    // one Gemini call site in the app with no retry, so a single rate-limit blip
    // hard-failed the whole review. Policy mirrors the Python side (llm/base.py):
    // 3 attempts, jittered exponential backoff; permanent errors (auth, 400)
    // still fail fast into the catch below.
    const geminiStartedAt = Date.now();
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          temperature: 0.1,
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
        },
      })
    );
    recordGeminiUsage(requestId, response.usageMetadata, Date.now() - geminiStartedAt);
    const text = response.text ?? "";
    const review = geminiReviewSchema.safeParse(parseGeminiJson(text));
    if (!review.success) {
      return {
        status: "error",
        summary: "Gemini returned a malformed repo-signal review payload.",
        reason: "malformed",
        confirmedSkills: [],
        unverifiedClaims: [],
        hiddenStrengths: [],
        reposReviewed,
        evidenceBasis,
        error: "non-json response",
      };
    }
    return {
      status: "ok",
      // The model's own prose — the one summary here that is genuinely free text
      // and therefore stays as written. Everything the app itself has to say about
      // this review is a code (`reason`) or a flag (`partial`), never English prose.
      summary: review.data.summary,
      // FINDING #2: EVIDENCE FOUND but partial — some repo data couldn't be fetched
      // this run. The review is real, but the caveat has to travel with it or an
      // authoritative-sounding read built on a fraction of the evidence carries false
      // confidence. As a flag rather than a sentence appended to `summary`, so the
      // panel states it in the reader's language (and the frozen evidence summary
      // keeps the model's text unpolluted).
      partial: coverageIncomplete,
      confirmedSkills: review.data.confirmed_skills,
      unverifiedClaims: review.data.unverified_claims,
      hiddenStrengths: review.data.hidden_strengths,
      reposReviewed,
      evidenceBasis,
      error: null,
    };
  } catch (error) {
    return {
      status: "error",
      summary: "Gemini repo-signal review request failed.",
      reason: "requestFailed",
      confirmedSkills: [],
      unverifiedClaims: [],
      hiddenStrengths: [],
      reposReviewed,
      evidenceBasis,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Parse the model's JSON, tolerating an optional ```json fence, and return the
// raw value for geminiReviewSchema.safeParse to validate + default. Replaces the
// old brace-matching regex, which could splice a partial object out of prose.
function parseGeminiJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    return null;
  }
}
