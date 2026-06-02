import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, getDevCase } from "@/app/_lib/db";
import { runSourceForRole } from "@/app/_lib/devcase-run";

export const runtime = "nodejs";

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
    let added = 0;
    for (const m of matches) {
      if (!m.candidateId) continue;
      createPipelineEntry({
        candidateId: m.candidateId,
        candidateLabel: m.label,
        archetype: m.archetype,
        roleFamily: "software_engineering",
        jobId: `dc-${devCase.id}`,
        jobTitle: roleTitle,
        matchScore: m.score,
        stage: "Accepted",
      });
      added += 1;
    }
    // `skipped` > 0 with an empty `candidates` means the pool failed to parse, not that
    // nobody matched — surfaced so the UI can be honest about an empty shortlist.
    return NextResponse.json({ ok: true, added, skipped, skippedReasons, candidates: matches });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing failed." }, { status: 500 });
  }
}
