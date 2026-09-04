import { NextRequest, NextResponse } from "next/server";
import { ReasoningError, runReasoning, type ReasoningInput } from "@/app/_lib/reasoning-run";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getServerLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/locales";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { matrixEngineAnswer, MATRIX_REASONING_SURFACE } from "@/app/api/matrix/matrix-error-code";
import type { RefusalErrorCode } from "@/app/_lib/api-response";

// The runner's own machine code -> the refusal this surface answers with, as a
// DECLARED table (never a blind index into REFUSAL_ERRORS with a string that came
// off a subprocess's stderr — same rule as matrix-error-code.ts's RUNNER_REFUSALS).
//
// Why it exists: `parseStderrError` and `runReasoning` both produce "not_found" vs
// "invalid_input", and the route used to collapse them by re-deriving a code from
// the HTTP status alone. A request that named no candidate at all was answered
// "that match can no longer be explained — the candidate or role behind it is
// gone", pointing the reader at "refresh the grid" for a malformed body. The two
// now keep their own sentences; an unmapped/absent code still falls through to
// matrixEngineAnswer, which preserves the previous behaviour exactly.
const REASONING_RUNNER_REFUSALS: Record<string, RefusalErrorCode> = {
  not_found: "MATCH_REASONING_UNAVAILABLE",
  invalid_input: "MATCH_REASONING_INPUT_INVALID",
};


// Synchronous convenience wrapper. The hardened/background path is /api/tasks
// with kind "reasoning" (tracked, dedup'd, refresh-safe); both share runReasoning.
export async function POST(request: NextRequest) {
  // ADDED scan-sweep 2026-08-24. Keyless/open is the standing premise of the
  // rate-limit contract, so this route is reachable unauthenticated — and every
  // cache MISS spawns reasoning_cli, which resolves a provider and makes a real
  // LLM call. Varying jobId/profileId misses the cache every time, so N requests
  // bought N model calls with no ceiling. The BACKGROUND twin (/api/tasks kind
  // "reasoning" -> the same runReasoning) was limited two days ago for exactly
  // this; the synchronous wrapper was the same hole one file over.
  //
  // 60/10min sits below the batch path's 120 while still clearing a real matrix
  // session, where opening many cells is the intended use. Limiter first: a
  // refused call must not pay for the body parse or the locale read.
  if (!rateLimit(`match-reasoning:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    // matrix-answers-with-codes-and-retries: coded, so the grid's popover can say
    // "you're going too fast, try again shortly" in the reader's language instead of
    // the same generic "couldn't load" it shows for an engine crash.
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json()) as ReasoningInput;
    // MAT1 — default the narrative locale to the request's locale when the body
    // didn't pin one (the task path passes the client's active locale directly).
    const lang = isLocale(body.lang) ? body.lang : await getServerLocale();
    // Forward the request's abort signal (same contract as /api/match and
    // /api/matrix): an abandoned request SIGKILLs the reasoning child instead of
    // orphaning an LLM-backed subprocess to python-runner's 600s backstop while it
    // holds a temp workdir. Right for THIS route precisely because it is the
    // synchronous wrapper — the survive-navigation path is /api/tasks with kind
    // "reasoning", which passes the TASK's own signal so a refresh doesn't kill it.
    const data = await runReasoning({ ...body, lang }, request.signal, await currentWorkspace());
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ReasoningError) {
      // ReasoningError now carries the RUNNER's own code (reasoning-run.ts stamps
      // one at every throw site), so the answer no longer has to be guessed from the
      // HTTP status: not_found and invalid_input are different sentences with
      // different remedies. The declared table wins; anything it doesn't name falls
      // through to matrixEngineAnswer's status-derived answer, unchanged — including
      // the 429 refusal and the 5xx withheld-message path.
      const forwarded = error.code ? REASONING_RUNNER_REFUSALS[error.code] : undefined;
      if (forwarded && error.status < 500) return jsonRefusal(forwarded, error.status);
      const answer = matrixEngineAnswer({ status: error.status, code: error.code }, MATRIX_REASONING_SURFACE);
      return answer.kind === "refusal"
        ? jsonRefusal(answer.code, error.status)
        : safeJsonError(error, "api:match/reasoning", answer.code, error.status);
    }
    return safeJsonError(error, "api:match/reasoning", "MATCH_REASONING_FAILED");
  }
}
