import { NextRequest, NextResponse } from "next/server";
import { listLlmActivity, LLM_ACTIVITY_WINDOW } from "@/app/_lib/db/llm";
import { requireHomeOrgReader } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { isLlmUseCase, LLM_USE_CASES } from "@/app/_lib/llm-config";

// Row-level read surface of the llm_usage ledger — the Insights → Activity
// audit table (every individual LLM action: when, which use case, which
// provider/model, tokens, cost, llm-vs-deterministic source). HOME-ORG gated
// exactly like /api/llm/usage: the ledger has no org column, so a member of
// another org would be reading every tenant's actions and request ids. Read-only by
// design — the ledger is written only by spawnPython's sidecar ingest.
//
// Returns a bounded newest-first window (LLM_ACTIVITY_WINDOW rows); the client
// filters and pages it in memory with the shared table primitives.
export async function GET(request: NextRequest) {
  const denied = await requireHomeOrgReader();
  if (denied) return denied;
  const query = request.nextUrl.searchParams;
  const rawUseCase = query.get("useCase") || undefined;
  const useCase = rawUseCase === "*" ? undefined : rawUseCase;
  const outcome = query.get("outcome") || undefined;
  const rawCursor = query.get("cursor") || undefined;
  if ((useCase && !isLlmUseCase(useCase)) || (outcome && outcome !== "ok" && outcome !== "failed")) {
    return jsonRefusal("LLM_ACTIVITY_QUERY_INVALID", 400, { useCases: LLM_USE_CASES, outcomes: ["ok", "failed"] });
  }
  let cursor: { ts: string; id: number } | undefined;
  if (rawCursor) {
    const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)\|(\d+)$/.exec(rawCursor);
    const id = match ? Number(match[2]) : Number.NaN;
    if (!match || !Number.isSafeInteger(id) || id < 1 || !Number.isFinite(Date.parse(match[1]))) {
      return jsonRefusal("LLM_ACTIVITY_QUERY_INVALID", 400, { useCases: LLM_USE_CASES, outcomes: ["ok", "failed"] });
    }
    cursor = { ts: match[1], id };
  }
  try {
    const rows = listLlmActivity(LLM_ACTIVITY_WINDOW, { useCase, outcome: outcome as "ok" | "failed" | undefined, cursor });
    const last = rows.at(-1);
    return NextResponse.json({ rows, window: LLM_ACTIVITY_WINDOW, nextCursor: rows.length === LLM_ACTIVITY_WINDOW && last ? `${last.ts}|${last.id}` : null });
  } catch (error) {
    // A CODE, never the thrown message: this read sits on better-sqlite3, so the
    // message can carry the DB path and the failing SQL, and the client renders
    // `errors.<CODE>` in the reader's own language rather than the server's English.
    return safeJsonError(error, "api:llm/activity", "LLM_ACTIVITY_FAILED");
  }
}
