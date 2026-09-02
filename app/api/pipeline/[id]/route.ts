import { NextRequest, NextResponse } from "next/server";
import { clearIntakeDegraded, getPipelineEntry, reinstatePipelineEntry, setEntryGithubEvidence, setEntryNotes } from "@/app/_lib/db/pipeline";
import { coerceGithubEvidenceSummary } from "@/app/_lib/github-summary";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { withCanonicalScores } from "@/app/_lib/match-score-resolve";
import { runPipelineEntryAction } from "@/app/_lib/pipeline-entry-action";


// AUTH (single-entry-authz-parity): the per-card single-entry surface is gated in
// lock-step with the workspace-wide bulk surfaces (/api/pipeline/batch,
// /api/pipeline/command), closing the last ungated adverse-action path — POST
// accept/reject extends candidate-facing rejection comms and reinstate reverses a
// sealed decision, exactly the class the batch/command bars operator-gate, and a
// demo session could otherwise drive them one card at a time. The GET (one
// canonical-scored entry: full label + score + provenance) and the sibling
// /timeline GET (full labels, comms letters, scorecard) expose the same recruiter
// PII, so all three are gated the SAME way. Semantics match requireOperator exactly:
// open mode (no KP_OPERATOR_PASSWORD) is a no-op, so local dev and the guided sim
// (already gated at its own /api/decisions/screen-wave step — it runs open-mode or
// under a real operator) are unaffected; a valid operator session passes; the
// anonymous demo-workspace session the proxy waves through is refused (401).

// Upper bound for the persistent recruiter note (set_notes). Generous enough for
// pasted call notes, tight enough that the column can't become a blob dump. The
// drawer's textarea enforces the same cap client-side (maxLength).
const MAX_NOTES_LENGTH = 4000;

// One canonical-scored pipeline entry by id (drawer-flow-friction / rematch-story-
// navigable). The board opens the drawer from a full Entry it already holds; this
// answers the two cases the board list can't: a COUNTERPART entry reached from a
// rematch link (which may be terminal, off the active board) and an IN-PLACE refresh
// after a stage move (the drawer stays open on the same candidate). Canonical score +
// provenance stamped so the reopened header matches the board and decisions surfaces.
// Workspace-scoped (getPipelineEntry) — a deleted or other-tenant id answers 404,
// which the caller treats as "no navigation", never a broken drawer.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    const entry = getPipelineEntry(id, ws);
    if (!entry) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    return NextResponse.json({ entry: withCanonicalScores([entry], ws)[0] });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:entry", "PIPELINE_LIST_FAILED");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const { id } = await context.params;
  const ws = await currentWorkspace();
  try {
    const body = (await request.json()) as { action?: string; detail?: string; expectedStage?: string; toStage?: string; github?: unknown; notes?: unknown; ttlDays?: unknown; actor?: unknown };

    // Attach a GitHub deep-dive summary to this entry — the drawer's on-demand
    // run for an inbound applicant who shared a handle at apply. Validated by
    // the shared coercer at the boundary (same contract as the add-to-pipeline
    // POST: the only producer is our own client, so a shape mismatch is drift,
    // not input) and FILL-ONLY in the db layer, so evidence already attached is
    // never silently overwritten.
    if (body.action === "set_github") {
      const summary = coerceGithubEvidenceSummary(body.github);
      if (!summary) {
        return jsonRefusal("PIPELINE_GITHUB_EVIDENCE_INVALID", 400);
      }
      const updated = setEntryGithubEvidence(id, JSON.stringify(summary), ws);
      if (!updated) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
      return NextResponse.json({ entry: updated });
    }

    // Persistent per-candidate recruiter note: the drawer's always-visible
    // scratchpad autosaves through here. Field-validated and bounded — free
    // text, trimmed, capped at MAX_NOTES_LENGTH, stored as NULL when emptied so
    // a cleared note reads as "no note" everywhere. Last write wins (a note is
    // recruiter-owned prose, not AI-attached evidence — no fill-only guard).
    if (body.action === "set_notes") {
      if (typeof body.notes !== "string") {
        return jsonRefusal("PIPELINE_NOTES_INVALID", 400);
      }
      const trimmed = body.notes.trim();
      if (trimmed.length > MAX_NOTES_LENGTH) {
        // The cap rides as DATA beside the code — a number the reader's own
        // sentence can carry, instead of an English sentence with a number in it.
        return jsonRefusal("PIPELINE_NOTES_TOO_LONG", 400, { max: MAX_NOTES_LENGTH, length: trimmed.length });
      }
      const updated = setEntryNotes(id, trimmed === "" ? null : trimmed, ws);
      if (!updated) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
      return NextResponse.json({ entry: updated });
    }

    // Reinstate an auto-rejected candidate for re-review (idea-e43fa801): put them
    // back to active at Screened, audited. Guarded server-side to a still-rejected
    // entry, so a double-click / stale "Reconsider" view 409s instead of churning.
    if (body.action === "reinstate") {
      // UAT LUC-ANA-4 — a reversal is the most accountability-bearing act on this
      // surface (a person overruling the machine), so it must name that person in
      // BOTH halves of the record. Resolved ONCE, from the SESSION (never the body),
      // exactly as runPipelineEntryAction does for accept/reject/set_stage: this
      // route was the last human write that left `pipeline_events.actor` NULL while
      // sealing the class token beside it, so on an identified deployment the
      // decision log's "who" column read "not identified" for the one act that most
      // needs a name. Identity-less deployments resolve to the same
      // "human:recruiter" role token as before.
      const actor = await humanActor();
      const restored = reinstatePipelineEntry(id, ws, actor);
      if (!restored) {
        return jsonRefusal("PIPELINE_NOT_REINSTATABLE", 409);
      }
      // Seal the REVERSAL into the tamper-evident decision chain too. The auto-reject
      // is sealed by screen-wave; recording only a pipeline event for the reinstate
      // left the chain showing a rejection with no record it was overturned — an
      // incomplete audit trail. Best-effort (sealDecisionSafe never throws): a seal
      // failure must not fail the reinstate the recruiter already committed.
      sealDecisionSafe({
        kind: "reinstated",
        actor,
        policyVersion: "manual",
        candidateRef: id,
        rationale: "Auto-rejection reversed for re-review.",
        reasonCode: "reinstate",
        inputs: { previousStatus: "rejected", restoredStage: "Screened" },
      });
      return NextResponse.json({ entry: restored });
    }

    // Resolving a degraded-intake stub: the recruiter has manually captured the
    // candidate's profile, so clear the flag (not a stage move) and keep the entry.
    if (body.action === "resolve_intake") {
      const cleared = clearIntakeDegraded(id, ws);
      if (!cleared) {
        return jsonRefusal("PIPELINE_INTAKE_NOT_DEGRADED", 404);
      }
      return NextResponse.json({ entry: cleared });
    }

    // The three board move/decide actions (set_stage / accept / reject / approve_event)
    // run through the shared runPipelineEntryAction so the single route and the batch
    // route (/api/pipeline/batch) can never diverge on the expectedStage CAS, the
    // Hired-is-outcome-bearing 422, the offer_review → EXTEND branch, or the seal.
    const result = await runPipelineEntryAction({
      id,
      action: typeof body.action === "string" ? body.action : "",
      toStage: body.toStage,
      expectedStage: typeof body.expectedStage === "string" ? body.expectedStage : undefined,
      detail: typeof body.detail === "string" ? body.detail : undefined,
      ttlDays: body.ttlDays,
      actor: body.actor,
      origin: new URL(request.url).origin,
      workspaceId: ws,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:action", "PIPELINE_ACTION_FAILED");
  }
}
