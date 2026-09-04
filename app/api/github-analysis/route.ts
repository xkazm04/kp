import { NextResponse } from "next/server";
import { logGithub, newRequestId } from "@/app/_lib/logger";
import { parseGithubUsername } from "@/app/_lib/github-handle";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { REFUSAL_ERRORS, requireCapabilityCoded } from "@/app/_lib/api-response";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { githubCacheKey, readGithubCache, writeGithubCache } from "@/app/_lib/github/cache";
import { buildGithubAnalysis, isTransientlyDegraded } from "@/app/_lib/github/analysis";
import { GITHUB_ERRORS, GithubAnalysisError } from "@/app/_lib/github/client";

// The pasted job description reaches the Gemini prompt, and only the CACHE KEY was
// ever capped (github/cache.ts normalizes to 4000 chars for hashing) — the prompt
// itself took the whole string. A 2 MB paste was therefore an uncapped spend on the
// deployment's own Gemini key, from any caller who could reach this door. Refuse
// past this length rather than silently truncating: a JD this long is a mistake, and
// analyzing a third of one and calling it a job fit is the worse failure.
const GITHUB_JD_MAX_CHARS = 20_000;

// HTTP shell for the public-GitHub candidate analysis. Everything it needs —
// the REST client, the ranking/skill heuristics, the Gemini deep review, the
// usage metering and the TTL cache — lives in @/app/_lib/github/*; this file
// only parses the request, guards it (cache, throttle), and shapes the response.

export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = newRequestId();
  const startedAt = Date.now();

  // AUTHORIZATION, not identity. This door spends the DEPLOYMENT's money — up to
  // ~31 GitHub REST calls and one paid Gemini call per uncached run — and produces
  // a hiring judgement about a named person. It asks for `pipeline:write`, the
  // recruiter capability that already governs "acts on candidates" (moves, decisions,
  // comms): a `viewer` seat may read the board but must not be able to commission
  // an assessment or burn the org's provider budget. Open dev and an operator session
  // both fold to owner, so local use is unchanged.
  const denied = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const rawProfile = typeof body?.profile === "string" ? body.profile.trim() : "";
  const jobDescription = typeof body?.jobDescriptionText === "string" ? body.jobDescriptionText : "";
  const username = parseGithubUsername(rawProfile);

  // Every failure below answers with `{ error, code }`: `error` is canonical
  // English for the server log and API consumers, `code` is what the UI resolves
  // in the reader's language (docs/architecture/localization.md).
  if (!username) {
    return NextResponse.json({ error: GITHUB_ERRORS.HANDLE_REQUIRED, code: "HANDLE_REQUIRED" }, { status: 400 });
  }
  // The prompt budget, refused at the door rather than absorbed downstream. `max` is
  // DATA beside the code so the panel can name the limit in the reader's language
  // instead of the server shipping an English sentence with a number in it.
  if (jobDescription.length > GITHUB_JD_MAX_CHARS) {
    return NextResponse.json(
      { error: GITHUB_ERRORS.JD_TOO_LONG, code: "JD_TOO_LONG", max: GITHUB_JD_MAX_CHARS },
      { status: 413 }
    );
  }

  const cacheKey = githubCacheKey(username, jobDescription);
  const cached = readGithubCache(cacheKey);
  if (cached !== undefined) {
    return NextResponse.json(cached);
  }

  // Per-IP abuse containment (backlog #7): an uncached run burns up to ~31
  // GitHub REST calls + one paid Gemini call. The throttle sits AFTER the
  // content-hash cache lookup above so cached responses keep serving freely
  // without consuming budget — only runs that would actually spend external
  // calls count. 10/10min/IP is generous for a human (GitHub's anonymous 60/hr
  // ceiling binds first anyway) while blunting a scripted cost-amplifier. Note
  // this is a real 429, unlike the 200+{error} GitHub-failure envelope below —
  // the shared limiter convention wins.
  //
  // THE ONE 429 THAT DOES NOT CARRY `TOO_MANY_REQUESTS` (api-contracts.md §1.1).
  // Every other throttle answers `jsonRefusal("TOO_MANY_REQUESTS", 429)`, which the
  // client resolves in the app-wide `errors` namespace. This surface's failures live
  // in their OWN namespace (`results.github.errors`, resolved by useGithubErrorMessage
  // — the deep dive's codes describe one optional feature) and that namespace's throttle
  // key is `REQUEST_THROTTLED`. Changing the code here would leave the panel with a code
  // its catalog does not know. The MESSAGE is still the one registered sentence, taken
  // from the refusal registry rather than a second import of the limiter's constant, so
  // the two can never drift.
  if (!rateLimit(`github-analysis:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ error: REFUSAL_ERRORS.TOO_MANY_REQUESTS, code: "REQUEST_THROTTLED" }, { status: 429 });
  }

  try {
    const validated = await buildGithubAnalysis(username, jobDescription, requestId);
    // Only a COMPLETE run is cacheable. A run degraded by a transient GitHub/Gemini
    // failure still answers 200, and caching it made the panel's "retry shortly for a
    // complete read" (and its Retry button) a no-op for the full TTL — serving the
    // same knowingly-incomplete read of a candidate's work, with its original
    // analyzedAt, as though it were final. Same rule the cache already applies to
    // errors: a failure that a retry can clear must stay retryable.
    if (!isTransientlyDegraded(validated)) writeGithubCache(cacheKey, validated);
    void logGithub({
      request_id: requestId,
      github_user: username,
      duration_ms: Date.now() - startedAt,
      status: "ok",
      rest_repos: validated.metrics.ownedReposAnalyzed,
      // `codeReview` is schema-optional (older cached payloads predate it) but
      // buildGithubAnalysis always emits it, so this logs the same status as before.
      code_review_status: validated.codeReview?.status,
    });
    return NextResponse.json(validated);
  } catch (error) {
    const code = error instanceof GithubAnalysisError ? error.code : "ANALYSIS_FAILED";
    // The CANONICAL English for the code — never the thrown error's `.message`. The
    // raw cause still reaches the operator (the log line below plus console.error),
    // but an undici/provider internal string can no longer ride a 200 payload onto a
    // recruiter's screen in a language they did not choose (api-contracts.md §1.1).
    const message = GITHUB_ERRORS[code];
    if (!(error instanceof GithubAnalysisError)) console.error("[api:github-analysis] ANALYSIS_FAILED", error);
    // `retryAfterSec` is present only when GitHub itself said when to come back
    // (Retry-After / x-ratelimit-reset). The panel turns an open-ended "try again
    // shortly" into a time the reader can act on.
    const retryAfterSec = error instanceof GithubAnalysisError ? error.retryAfterSec : undefined;
    void logGithub({
      request_id: requestId,
      github_user: username,
      duration_ms: Date.now() - startedAt,
      status: "error",
      rest_repos: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    // Optional analysis: surface the failure as a 200 + {error, code} so the
    // browser console doesn't flag a Bad Gateway every time GitHub rate-limits
    // a request. The frontend detects the failure by the presence of `error`
    // regardless of status code, and renders the localized `code` inside the
    // GithubAnalysisPanel error state.
    return NextResponse.json(retryAfterSec ? { error: message, code, retryAfterSec } : { error: message, code });
  }
}
