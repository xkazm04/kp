import { NextRequest, NextResponse } from "next/server";
import { aggregateLlmUsage, promptCacheStats } from "@/app/_lib/db";
import { requireOperator } from "@/app/_lib/auth/require-operator";


// Usage/cost read surface for the Models tab — the first reader of the llm_usage
// ledger (docs/LLM_PROVIDER_LAYER.md, T0.1): per (day × use_case × provider ×
// model) rollups plus the prompt-cache hit stats. Operator-gated exactly like
// /api/llm/keys (requireOperator rejects the anonymous demo session): spend
// figures are operator telemetry, not demo content. Read-only by design — the
// ledger is written only by spawnPython's sidecar ingest.

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

/** Clamp ?days= to a sane window; anything unparsable falls back to the default. */
function windowDays(raw: string | null): number {
  const parsed = raw === null ? DEFAULT_DAYS : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(Math.max(parsed, 1), MAX_DAYS);
}

export async function GET(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const days = windowDays(request.nextUrl.searchParams.get("days"));
  return NextResponse.json({
    days,
    rows: aggregateLlmUsage(days),
    promptCache: promptCacheStats(),
  });
}
