import { NextRequest, NextResponse } from "next/server";
import { boardEntryView, countRejectedByLane, createPipelineEntry, listPipeline } from "@/app/_lib/db/pipeline";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { getInterviewPlan } from "@/app/_lib/interview-plan";
import { knownStageIds } from "@/app/_lib/pipeline-axis";
import { coerceGithubEvidenceSummary } from "@/app/_lib/github-summary";
import { inferProfileLocale } from "@/app/_lib/comms-locale";
import { withCanonicalScoresCached } from "@/app/_lib/pipeline-score-cache";
import { withTransferScores } from "@/app/_lib/pipeline-transfer-score";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { linkTerminalPriorsToTarget } from "@/app/_lib/rediscovery-prior-link";
import { withheldCandidateIds } from "@/app/_lib/rediscovery-eligibility";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { humanActor } from "@/app/_lib/auth/operator-approver";


export async function GET() {
  try {
    // Canonical match-score read path (REC-01 / OO-L2-10): every entry rides
    // out with `canonicalScore` + `scoreProvenance` so board/drawer/decisions
    // surfaces render ONE number and can label where it came from.
    const ws = await currentWorkspace();
    // Canonical scores via the per-workspace, short-TTL fit-map memo (identical
    // payload shape; only the analyses query is cached — see pipeline-score-cache.ts).
    // ONE THREAD (gap 2): the work-sample transfer score rides out BESIDE the match
    // score, never inside it — `displayScoreOf` picks which one a surface shows and
    // labels the kind, while every ranking read stays on the match half.
    // board-poll-carries-only-what-it-draws: the stamped rows are projected through
    // the BOARD_ENTRY_FIELDS allowlist before they go on the wire. The store row used
    // to ride out verbatim, which put the candidate's `contact`, `locale`, the consent
    // columns, `anonymizedAt`, `workspaceId` and the two devcase ids on every 30s poll
    // although no consumer of this payload reads any of them.
    const entries = withTransferScores(withCanonicalScoresCached(listPipeline(ws), ws), ws).map(boardEntryView);
    // The board's columns ride out WITH the entries, resolved for this workspace.
    // They used to be the compile-time PIPELINE_STAGES name list, which the board
    // ignored in favour of importing the same constant — so the payload field
    // existed but nothing could ever make the two disagree. Now it is the axis:
    // ids the entries are keyed by, labels to render, roles the rules resolve
    // through, plus the retired columns so a stranded candidate's stage still has
    // a name.
    const axis = getPipelineAxis(ws);
    // The hiring plan in force (Settings → Hiring), pruned to this axis: the board's
    // line indicators read each step's executor from it (who a candidate waits on).
    // `rejectedByLane`: how many each lane has rejected — the rows themselves stay off
    // this payload (GET /api/pipeline/rejected serves them on demand).
    return NextResponse.json({
      entries,
      stages: axis.stages,
      retiredStages: axis.retired,
      plan: getInterviewPlan(ws),
      rejectedByLane: countRejectedByLane(ws),
    });
  } catch (error) {
    return safeJsonError(error, "api:pipeline", "PIPELINE_LIST_FAILED");
  }
}

/** The provenance markers that mean "re-surfaced from the pool for a role this person
 *  never applied to" — the rediscovery feed ("rediscovery") and the recruiter/rediscover
 *  panels ("sourcing"). Read twice below: the eligibility gate and the prior link. */
const RESURFACE_SOURCES: ReadonlySet<string> = new Set(["rediscovery", "sourcing"]);

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
      return jsonRefusal("PIPELINE_ADD_IDS_REQUIRED", 400);
    }
    // GH2 — optional GitHub evidence summary riding the add. Validated by the
    // shared coercer (which also bounds every field); a present-but-malformed
    // payload is rejected loudly rather than silently dropped, since the only
    // producer is our own client and a shape mismatch means drift, not input.
    let githubJson: string | null = null;
    if (body.github !== undefined && body.github !== null) {
      const summary = coerceGithubEvidenceSummary(body.github);
      if (!summary) {
        return jsonRefusal("PIPELINE_GITHUB_EVIDENCE_INVALID", 400);
      }
      githubJson = JSON.stringify(summary);
    }
    // Reject an unknown stage at the boundary: createPipelineEntry inserts any
    // string, but the board only renders columns the workspace's axis declares, so
    // a typo'd or renamed stage would persist then silently vanish from the board.
    // Validated against THIS WORKSPACE's axis rather than the compile-time list —
    // a team that renamed its columns must be able to file candidates onto them.
    // Retired stages count as known: they are a legitimate place for a candidate
    // to still be standing (e.g. an ATS sync replaying an older mapping) until a
    // migration moves them, and rejecting the write would lose the application.
    if (body.stage !== undefined) {
      const axis = getPipelineAxis(await currentWorkspace());
      const known = knownStageIds(axis);
      if (!known.has(body.stage)) {
        return jsonRefusal("PIPELINE_ADD_STAGE_UNKNOWN", 400, { stages: axis.stages.map((stage) => stage.id) });
      }
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
        return jsonRefusal("PIPELINE_ADD_APPROVAL_KIND_UNKNOWN", 400);
      }
      approvalKind = "decision";
    }
    // THE rediscovery eligibility gate on a RE-SURFACE add (withheldCandidateIds — the
    // predicate the rank, the alert write wall, the feed read and the Reach-out door
    // ask). A person who opted out, whose pool consent lapsed, or who was erased is never
    // ranked, so a re-surface add naming them is a stale row or a direct call, and filing
    // them would re-engage someone on a basis that is gone. Refused BEFORE the write.
    // Scoped to the re-surface markers on purpose: a human's deliberate add (a manual
    // board add, a re-application) stays allowed — an opt-out stops OUTREACH, it does not
    // withdraw a person from a process — and contact is still refused at the channel
    // (commsSendSuppression), which resolves the opt-out/consent at the person, not the
    // fresh entry. Erasure is also refused for every caller inside createPipelineEntry.
    if (source !== null && RESURFACE_SOURCES.has(source)) {
      const withheld = withheldCandidateIds([body.candidateId]).get(body.candidateId.trim());
      if (withheld) return jsonRefusal("PIPELINE_ADD_CANDIDATE_WITHHELD", 409, { withheld });
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
      // THE RECONSIDER DOOR. A recruiter re-adding a candidate they (or the machine)
      // rejected, or who declined, means "let us look again": this is one of the two
      // human doors that may reopen a closed entry, and it names who did it, so the
      // reversal lands in the decision log as a `reinstated` event with an actor.
      // Erased, role-closed and rematched entries still refuse (body.reopenRefused).
      reopen: { actorRef: await humanActor() },
    });
    // Close-the-prior for SOURCING adds (mirrors the reach-out route): a
    // rediscovery/sourcing add re-engages a silver medalist under a new role, so
    // their terminal priors elsewhere get the same rematched link the automation
    // path stamps. Gated on `created` (idempotent re-adds never re-link) and on
    // the sourcing channels only — a board/manual add is not a re-engagement.
    // Best-effort: a linking hiccup must never fail the add itself.
    if (result.created && source !== null && RESURFACE_SOURCES.has(source)) {
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
