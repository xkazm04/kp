import { NextRequest, NextResponse } from "next/server";
import { promptCacheStats } from "@/app/_lib/db/analyses";
import { aggregateLlmUsage } from "@/app/_lib/db/llm";
import { requireHomeOrgReader } from "@/app/_lib/auth/require-operator";
import { isLlmUseCase, LLM_USE_CASES } from "@/app/_lib/llm-config";


// Usage/cost read surface for the Models tab — the first reader of the llm_usage
// ledger (docs/architecture/llm-provider-layer.md, T0.1): per (day × use_case × provider ×
// model) rollups plus the prompt-cache hit stats. HOME-ORG gated
// (requireHomeOrgReader): the ledger has no org or workspace column, so every row
// is every tenant's; a demo session is a 401 and a member of another org a coded
// 403. Read-only by design — the ledger is written only by spawnPython's sidecar
// ingest.

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

/** Clamp ?days= to a sane window; anything unparsable falls back to the default. */
function windowDays(raw: string | null): number {
  const parsed = raw === null ? DEFAULT_DAYS : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(Math.max(parsed, 1), MAX_DAYS);
}

export async function GET(request: NextRequest) {
  const denied = await requireHomeOrgReader();
  if (denied) return denied;
  const days = windowDays(request.nextUrl.searchParams.get("days"));
  const rawUseCase = request.nextUrl.searchParams.get("useCase");
  // Omit / blank = all. Unknown is 400 with the catalog, never a silent empty.
  let useCase: (typeof LLM_USE_CASES)[number] | null = null;
  if (rawUseCase !== null && rawUseCase !== "") {
    if (!isLlmUseCase(rawUseCase)) {
      return NextResponse.json({ error: "Unknown useCase.", useCases: LLM_USE_CASES }, { status: 400 });
    }
    useCase = rawUseCase;
  }
  const rows = aggregateLlmUsage(days);
  const selectedRows = useCase ? rows.filter((r) => r.useCase === useCase) : rows;
  return NextResponse.json({
    days,
    useCase,
    rows: selectedRows,
    failedCalls: selectedRows.reduce((total, row) => total + row.failedCalls, 0),
    promptCache: promptCacheStats(),
  });
}
