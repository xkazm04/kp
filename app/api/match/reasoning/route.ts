import { NextRequest, NextResponse } from "next/server";
import { ReasoningError, runReasoning, type ReasoningInput } from "@/app/_lib/reasoning-run";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getServerLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/locales";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { matrixEngineAnswer, MATRIX_REASONING_SURFACE } from "@/app/api/matrix/matrix-error-code";


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
      // ReasoningError carries only message + status (it is thrown from
      // app/_lib/reasoning-run.ts, which several callers share), so the code is
      // derived from the status — a 4xx is the caller's pair being unresolvable, a
      // 5xx is the engine, and only the latter's message must be withheld.
      const answer = matrixEngineAnswer({ status: error.status }, MATRIX_REASONING_SURFACE);
      return answer.kind === "refusal"
        ? jsonRefusal(answer.code, error.status)
        : safeJsonError(error, "api:match/reasoning", answer.code, error.status);
    }
    return safeJsonError(error, "api:match/reasoning", "MATCH_REASONING_FAILED");
  }
}
