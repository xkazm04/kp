import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, listPipeline, PIPELINE_STAGES } from "@/app/_lib/db";
import { coerceGithubEvidenceSummary } from "@/app/_lib/github-summary";
import { inferProfileLocale } from "@/app/_lib/comms-locale";
import { withCanonicalScoresCached } from "@/app/_lib/pipeline-score-cache";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { linkTerminalPriorsToTarget } from "@/app/_lib/rediscovery-prior-link";
import { safeJsonError } from "@/app/_lib/api-response";


export async function GET() {
  try {
    // Canonical match-score read path (REC-01 / OO-L2-10): every entry rides
    // out with `canonicalScore` + `scoreProvenance` so board/drawer/decisions
    // surfaces render ONE number and can label where it came from.
    const ws = await currentWorkspace();
    // Canonical scores via the per-workspace, short-TTL fit-map memo (identical
    // payload shape; only the analyses query is cached — see pipeline-score-cache.ts).
    const entries = withCanonicalScoresCached(listPipeline(ws), ws);
    return NextResponse.json({ entries, stages: PIPELINE_STAGES });
  } catch (error) {
    return safeJsonError(error, "api:pipeline", "PIPELINE_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      candidateId?: string;
      candidateLabel?: string;
      archetype?: string | null;
      roleFamily?: string | null;
      jobId?: string;
      jobTitle?: string;
      matchScore?: number | null;
      stage?: string;
      github?: unknown;
      source?: unknown;
      approvalKind?: unknown;
    };
    if (!body.candidateId || !body.jobId) {
      return NextResponse.json({ error: "candidateId and jobId are required." }, { status: 400 });
    }
    // GH2 — optional GitHub evidence summary riding the add. Validated by the
    // shared coercer (which also bounds every field); a present-but-malformed
    // payload is rejected loudly rather than silently dropped, since the only
    // producer is our own client and a shape mismatch means drift, not input.
    let githubJson: string | null = null;
    if (body.github !== undefined && body.github !== null) {
      const summary = coerceGithubEvidenceSummary(body.github);
      if (!summary) {
        return NextResponse.json({ error: "Invalid GitHub evidence payload." }, { status: 400 });
      }
      githubJson = JSON.stringify(summary);
    }
    // Reject an unknown stage at the boundary: createPipelineEntry inserts any
    // string, but PipelineBoard only renders lanes for PIPELINE_STAGES, so a typo'd
    // or renamed stage would persist then silently vanish from the board. Omitting
    // stage is fine — createPipelineEntry defaults it to "Screened".
    if (body.stage !== undefined && !(PIPELINE_STAGES as readonly string[]).includes(body.stage)) {
      return NextResponse.json(
        { error: `Unknown stage "${body.stage}". Expected one of: ${PIPELINE_STAGES.join(", ")}.` },
        { status: 400 }
      );
    }
    // d95fed6d — optional provenance: which surface filed this candidate.
    // Bounded + shape-checked at the boundary (a slug-like token, not prose);
    // an out-of-shape value is dropped, not 400'd — provenance is an annotation,
    // never worth failing the add over.
    const source =
      typeof body.source === "string" && /^[a-z0-9_-]{1,40}$/.test(body.source) ? body.source : null;
    // shortlist-to-group-eval — an add may request the pending KEY-DECISION gate
    // (the Decisions tab cohort). Closed set at the boundary: "decision" is the
    // ONLY kind an add can ask for — the review kinds are minted by automation
    // after the fact — and, unlike `source` (a droppable annotation), a wrong
    // value here is a client shape bug that changes decision routing, so it
    // fails loudly. Absent/null means no gate: every other add path (outreach,
    // rediscovery, apply, manual board add) stays byte-identical.
    let approvalKind: "decision" | null = null;
    if (body.approvalKind !== undefined && body.approvalKind !== null) {
      if (body.approvalKind !== "decision") {
        return NextResponse.json(
          { error: `Unknown approvalKind "${String(body.approvalKind)}". Only "decision" may be requested at add time.` },
          { status: 400 }
        );
      }
      approvalKind = "decision";
    }
    const ws = await currentWorkspace();
    const result = createPipelineEntry({
      candidateId: body.candidateId,
      candidateLabel: body.candidateLabel || body.candidateId,
      archetype: body.archetype ?? null,
      roleFamily: body.roleFamily ?? null,
      jobId: body.jobId,
      jobTitle: body.jobTitle || body.jobId,
      matchScore: body.matchScore ?? null,
      stage: body.stage,
      githubJson,
      sourceChannel: source,
      approvalKind,
      // Recruiter/Match adds carry no explicit language choice — infer it from the
      // candidate's CV languages (already on the saved profile) so downstream comms
      // speak their language; no signal stays NULL and resolves to the workspace
      // default at dispatch (backlog #34 / pa-l2-null-locale).
      locale: inferProfileLocale(body.candidateId),
      workspaceId: ws,
    });
    // Close-the-prior for SOURCING adds (mirrors the reach-out route): a
    // rediscovery/sourcing add re-engages a silver medalist under a new role, so
    // their terminal priors elsewhere get the same rematched link the automation
    // path stamps. Gated on `created` (idempotent re-adds never re-link) and on
    // the sourcing channels only — a board/manual add is not a re-engagement.
    // Best-effort: a linking hiccup must never fail the add itself.
    if (result.created && (source === "sourcing" || source === "rediscovery")) {
      try {
        linkTerminalPriorsToTarget(body.candidateId, result.entry.id, body.jobId, ws);
      } catch (linkErr) {
        console.error("[pipeline] prior-link failed (non-fatal):", linkErr);
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    // Raw err.message surfaces better-sqlite3 internals (constraint names, the
    // absolute db path) — log server-side, return the generic catalogue message.
    return safeJsonError(error, "api:pipeline", "PIPELINE_CREATE_FAILED");
  }
}
