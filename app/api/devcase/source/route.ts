import { NextRequest, NextResponse } from "next/server";
import { getDevCase } from "@/app/_lib/db/devcase";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { runSourceForRole, seedPipelineFromMatches } from "@/app/_lib/devcase-run";


// Phase C — proactive sourcing for an approved case: rank the candidate DB against the
// role and seed the pipeline at the Accepted stage. Deterministic (matching, no LLM).
//
// TENANCY: both halves take the caller's workspace, and they must agree. Unscoped,
// the READ ranked the DEFAULT team's profiles and the WRITE filed them under the
// caller's — copying another tenant's real people (name, id, archetype, score)
// onto this team's board. Scoping only the write would be worse than neither: the
// entries would look native while the people in them still belonged elsewhere.
export async function POST(request: NextRequest) {
  // AUTHORITY (/perfect wave 31). Sourcing spawns the Python matcher over the whole
  // candidate pool and WRITES pipeline entries at the Accepted stage - a recruiter
  // operation by any reading - and this door asked nothing about the caller at all.
  // Identity presence first (a no-op in open mode), then the seat question.
  const denied = await requireOperator();
  if (denied) return denied;
  const forbidden = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (forbidden) return forbidden;
  try {
    const body = (await request.json().catch(() => ({}))) as { caseId?: string };
    if (!body.caseId) return NextResponse.json({ error: "caseId is required." }, { status: 400 });
    const ws = await currentWorkspace();
    const devCase = getDevCase(body.caseId);
    // getDevCase is a by-id point read (globally-unique id), so ownership is
    // checked here: a known case id from another team must not be sourceable.
    if (!devCase || devCase.workspaceId !== ws) return NextResponse.json({ error: "case not found" }, { status: 404 });

    const role = (devCase.role as { title?: string } & Record<string, unknown>) ?? {};
    const { candidates: matches, skipped, skippedReasons } = await runSourceForRole(role, { workspaceId: ws });
    const roleTitle = role.title ?? devCase.roleTitle ?? "Dev case";
    // Shared write contract (incl. the `sourceChannel: "devcase"` origin marker)
    // with the lifecycle orchestrator — previously this route omitted the marker.
    const { added } = seedPipelineFromMatches(matches, { caseId: devCase.id, roleTitle, workspaceId: ws });
    // `skipped` > 0 with an empty `candidates` means the pool failed to parse, not that
    // nobody matched — surfaced so the UI can be honest about an empty shortlist.
    return NextResponse.json({ ok: true, added, skipped, skippedReasons, candidates: matches });
  } catch (error) {
    // The matching spawn's stderr and the store's SQLITE_* detail stay in the server
    // log; the caller gets the code.
    return safeJsonError(error, "api:devcase/source", "DEVCASE_SOURCE_FAILED");
  }
}
