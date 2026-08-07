import { NextResponse } from "next/server";
import { logGithub, newRequestId } from "@/app/_lib/logger";
import { parseGithubUsername } from "@/app/_lib/github-handle";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { githubCacheKey, readGithubCache, writeGithubCache } from "@/app/_lib/github/cache";
import { buildGithubAnalysis } from "@/app/_lib/github/analysis";
import { GithubAnalysisError } from "@/app/_lib/github/client";

// HTTP shell for the public-GitHub candidate analysis. Everything it needs —
// the REST client, the ranking/skill heuristics, the Gemini deep review, the
// usage metering and the TTL cache — lives in @/app/_lib/github/*; this file
// only parses the request, guards it (cache, throttle), and shapes the response.

export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = newRequestId();
  const startedAt = Date.now();

  const body = await request.json().catch(() => null);
  const rawProfile = typeof body?.profile === "string" ? body.profile.trim() : "";
  const jobDescription = typeof body?.jobDescriptionText === "string" ? body.jobDescriptionText : "";
  const username = parseGithubUsername(rawProfile);

  // Every failure below answers with `{ error, code }`: `error` is canonical
  // English for the server log and API consumers, `code` is what the UI resolves
  // in the reader's language (docs/architecture/localization.md).
  if (!username) {
    return NextResponse.json(
      { error: "Enter a GitHub username or profile URL.", code: "HANDLE_REQUIRED" },
      { status: 400 }
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
  // the shared limiter convention wins, and the panel reads `error` either way.
  if (!rateLimit(`github-analysis:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ error: RATE_LIMITED_ERROR, code: "REQUEST_THROTTLED" }, { status: 429 });
  }

  try {
    const validated = await buildGithubAnalysis(username, jobDescription, requestId);
    writeGithubCache(cacheKey, validated);
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
    const message = error instanceof Error ? error.message : "GitHub analysis failed.";
    const code = error instanceof GithubAnalysisError ? error.code : "ANALYSIS_FAILED";
    void logGithub({
      request_id: requestId,
      github_user: username,
      duration_ms: Date.now() - startedAt,
      status: "error",
      rest_repos: 0,
      error: message,
    });
    // Optional analysis: surface the failure as a 200 + {error, code} so the
    // browser console doesn't flag a Bad Gateway every time GitHub rate-limits
    // a request. The frontend detects the failure by the presence of `error`
    // regardless of status code, and renders the localized `code` inside the
    // GithubAnalysisPanel error state.
    return NextResponse.json({ error: message, code });
  }
}
