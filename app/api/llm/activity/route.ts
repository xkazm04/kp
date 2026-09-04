import { NextResponse } from "next/server";
import { listLlmActivity, LLM_ACTIVITY_WINDOW } from "@/app/_lib/db/llm";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";

// Row-level read surface of the llm_usage ledger — the Insights → Activity
// audit table (every individual LLM action: when, which use case, which
// provider/model, tokens, cost, llm-vs-deterministic source). Operator-gated
// exactly like /api/llm/usage: spend telemetry, not demo content. Read-only by
// design — the ledger is written only by spawnPython's sidecar ingest.
//
// Returns a bounded newest-first window (LLM_ACTIVITY_WINDOW rows); the client
// filters and pages it in memory with the shared table primitives.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    return NextResponse.json({ rows: listLlmActivity(), window: LLM_ACTIVITY_WINDOW });
  } catch (error) {
    // A CODE, never the thrown message: this read sits on better-sqlite3, so the
    // message can carry the DB path and the failing SQL, and the client renders
    // `errors.<CODE>` in the reader's own language rather than the server's English.
    return safeJsonError(error, "api:llm/activity", "LLM_ACTIVITY_FAILED");
  }
}
