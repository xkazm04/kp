import { NextRequest, NextResponse } from "next/server";
import { getDevCase } from "@/app/_lib/db/devcase";
import { runSourceForRole, seedPipelineFromMatches } from "@/app/_lib/devcase-run";


// Phase C — proactive sourcing for an approved case: rank the candidate DB against the
// role and seed the pipeline at the Accepted stage. Deterministic (matching, no LLM).
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { caseId?: string };
    if (!body.caseId) return NextResponse.json({ error: "caseId is required." }, { status: 400 });
    const devCase = getDevCase(body.caseId);
    if (!devCase) return NextResponse.json({ error: "case not found" }, { status: 404 });

    const role = (devCase.role as { title?: string } & Record<string, unknown>) ?? {};
    const { candidates: matches, skipped, skippedReasons } = await runSourceForRole(role);
    const roleTitle = role.title ?? devCase.roleTitle ?? "Dev case";
    // Shared write contract (incl. the `sourceChannel: "devcase"` origin marker)
    // with the lifecycle orchestrator — previously this route omitted the marker.
    const { added } = seedPipelineFromMatches(matches, { caseId: devCase.id, roleTitle });
    // `skipped` > 0 with an empty `candidates` means the pool failed to parse, not that
    // nobody matched — surfaced so the UI can be honest about an empty shortlist.
    return NextResponse.json({ ok: true, added, skipped, skippedReasons, candidates: matches });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing failed." }, { status: 500 });
  }
}
