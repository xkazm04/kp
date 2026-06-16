import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, clearIntakeDegraded, getPipelineEntry, PIPELINE_STAGES, reinstatePipelineEntry, setApproval, setEntryGithubEvidence, setEntryNotes, setPipelineEntryStage, type PipelineAction, type PipelineEntry } from "@/app/_lib/db";
import { coerceGithubEvidenceSummary } from "@/app/_lib/github-summary";
import { dispatchOffer, dispatchRejection } from "@/app/_lib/comms-dispatch";
import { getOrCreateOpenOffer } from "@/app/_lib/offers-store";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { safeJsonError } from "@/app/_lib/api-response";
import { publicBaseUrl } from "@/app/_lib/public-base-url";

export const runtime = "nodejs";

const ACTIONS: PipelineAction[] = ["accept", "reject", "approve_event"];

// Upper bound for the persistent recruiter note (set_notes). Generous enough for
// pasted call notes, tight enough that the column can't become a blob dump. The
// drawer's textarea enforces the same cap client-side (maxLength).
const MAX_NOTES_LENGTH = 4000;

// Human gate for the offer: approving a drafted offer EXTENDS it to the candidate
// with a secure accept/decline link, rather than bare-advancing to Hired. The
// Hired move happens only when the candidate accepts (see /api/offer/[token]).
async function extendOffer(request: NextRequest, entry: PipelineEntry) {
  let draft: { subject?: unknown; body?: unknown; recommended?: unknown; currency?: unknown } = {};
  try {
    draft = entry.approvalDetail ? JSON.parse(entry.approvalDetail) : {};
  } catch {
    draft = {};
  }

  // Reuse an already-open offer for this entry (idempotent re-extends). Atomic
  // (idea-00987b3c): the old `getOpenOfferForEntry() ?? createOffer()` was a
  // TOCTOU that a double-clicked approval defeated, minting two live offer
  // links. A re-extend re-sends the SAME link — never a second one.
  const { offer, created } = getOrCreateOpenOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: typeof draft.currency === "string" ? draft.currency : "CZK",
    salary: Number(draft.recommended) || null,
    payload: draft,
  });

  // Decision SoR (moonshot D backfill): seal the recruiter's offer-terms decision —
  // only on a genuinely NEW offer (created), not an idempotent re-extend of the same
  // link. Best-effort; never blocks the offer dispatch.
  if (created) {
    sealDecisionSafe({
      kind: "offer_terms",
      actor: "human:recruiter",
      policyVersion: "offer",
      candidateRef: entry.id,
      rationale: `Offer extended: ${offer.salary ?? "—"} ${offer.currency ?? ""} for ${entry.jobTitle ?? "role"}.`,
      reasonCode: "offer",
      inputs: { salary: offer.salary, currency: offer.currency, jobTitle: entry.jobTitle },
    });
  }

  // Canonical candidate-link origin (idea-e6c66bcd): the same resolver the client
  // uses, so this server-minted offer link can't diverge from the voice/scheduling
  // links the recruiter copies in the drawer.
  const link = `${publicBaseUrl(new URL(request.url).origin)}/offer/${offer.token}`;
  await dispatchOffer(entry, draft, link); // records the `offer_sent` event + outbox message

  // The offer is out — clear the recruiter approval; now awaiting the candidate.
  setApproval(entry.id, null, "");
  return NextResponse.json({ entry: getPipelineEntry(entry.id), offerExtended: true, link });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { action?: string; detail?: string; expectedStage?: string; toStage?: string; github?: unknown; notes?: unknown };

    // Manual recruiter stage override (set_stage): move a candidate backward, skip
    // a stage, or fix a miscategorization — the transitions accept/reject can't
    // express. Same expectedStage CAS as the AI actions: a client deciding from a
    // snapshot sends the stage it saw, and a mismatch is a 409 carrying the fresh
    // entry rather than a blind overwrite.
    if (body.action === "set_stage") {
      const toStage = typeof body.toStage === "string" ? body.toStage : "";
      if (!(PIPELINE_STAGES as readonly string[]).includes(toStage)) {
        return NextResponse.json(
          { error: `Unknown stage "${toStage}". Expected one of: ${PIPELINE_STAGES.join(", ")}.` },
          { status: 400 }
        );
      }
      const expected = typeof body.expectedStage === "string" ? body.expectedStage : undefined;
      const moved = setPipelineEntryStage(id, toStage, expected ? { expectedStage: expected } : undefined);
      if (!moved) {
        const fresh = getPipelineEntry(id);
        if (!fresh) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
        // Missing was handled above, so null here means the CAS lost in the gap or
        // the entry is closed out — either way the caller's view is stale.
        return NextResponse.json(
          {
            error: "Couldn't move this candidate — they were just changed or are closed out. Refresh and try again.",
            entry: fresh,
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ entry: moved });
    }

    // Attach a GitHub deep-dive summary to this entry — the drawer's on-demand
    // run for an inbound applicant who shared a handle at apply. Validated by
    // the shared coercer at the boundary (same contract as the add-to-pipeline
    // POST: the only producer is our own client, so a shape mismatch is drift,
    // not input) and FILL-ONLY in the db layer, so evidence already attached is
    // never silently overwritten.
    if (body.action === "set_github") {
      const summary = coerceGithubEvidenceSummary(body.github);
      if (!summary) {
        return NextResponse.json({ error: "Invalid GitHub evidence payload." }, { status: 400 });
      }
      const updated = setEntryGithubEvidence(id, JSON.stringify(summary));
      if (!updated) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
      return NextResponse.json({ entry: updated });
    }

    // Persistent per-candidate recruiter note: the drawer's always-visible
    // scratchpad autosaves through here. Field-validated and bounded — free
    // text, trimmed, capped at MAX_NOTES_LENGTH, stored as NULL when emptied so
    // a cleared note reads as "no note" everywhere. Last write wins (a note is
    // recruiter-owned prose, not AI-attached evidence — no fill-only guard).
    if (body.action === "set_notes") {
      if (typeof body.notes !== "string") {
        return NextResponse.json({ error: `Field "notes" must be a string.` }, { status: 400 });
      }
      const trimmed = body.notes.trim();
      if (trimmed.length > MAX_NOTES_LENGTH) {
        return NextResponse.json(
          { error: `Note is too long (${trimmed.length} characters; max ${MAX_NOTES_LENGTH}).` },
          { status: 400 }
        );
      }
      const updated = setEntryNotes(id, trimmed === "" ? null : trimmed);
      if (!updated) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
      return NextResponse.json({ entry: updated });
    }

    // Reinstate an auto-rejected candidate for re-review (idea-e43fa801): put them
    // back to active at Screened, audited. Guarded server-side to a still-rejected
    // entry, so a double-click / stale "Reconsider" view 409s instead of churning.
    if (body.action === "reinstate") {
      const restored = reinstatePipelineEntry(id);
      if (!restored) {
        return NextResponse.json(
          { error: "Couldn't reinstate — this candidate isn't in a rejected state (already reinstated, or closed differently)." },
          { status: 409 }
        );
      }
      return NextResponse.json({ entry: restored });
    }

    // Resolving a degraded-intake stub: the recruiter has manually captured the
    // candidate's profile, so clear the flag (not a stage move) and keep the entry.
    if (body.action === "resolve_intake") {
      const cleared = clearIntakeDegraded(id);
      if (!cleared) {
        return NextResponse.json({ error: "No degraded-intake flag to resolve." }, { status: 404 });
      }
      return NextResponse.json({ entry: cleared });
    }

    const action = body.action as PipelineAction;
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    // Optimistic-concurrency contract (idea-84392364): a client that decides
    // from a SNAPSHOT (the Decisions queue's cards and analysis modal hold a
    // frozen Entry while the live queue refreshes underneath) sends the stage
    // it believes the candidate is in. A mismatch is a 409 carrying the fresh
    // entry — the recruiter re-decides against reality instead of blindly
    // overriding a state they never saw. Clients that omit expectedStage keep
    // the prior act-on-current behavior.
    const expectedStage = typeof body.expectedStage === "string" ? body.expectedStage : undefined;
    const staleResponse = (entry: PipelineEntry) =>
      NextResponse.json(
        { error: "This candidate's stage changed since the view was opened — refresh and decide again.", entry },
        { status: 409 }
      );
    const current = getPipelineEntry(id);
    if (!current) {
      return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
    }
    if (expectedStage && current.stage !== expectedStage) return staleResponse(current);

    // Approving a drafted offer extends it to the candidate (not a bare Hire click).
    if (action === "accept" && current.stage === "Offer" && current.approvalKind === "offer_review") {
      return await extendOffer(request, current);
    }

    const updated = actOnPipelineEntry(
      id,
      action,
      typeof body.detail === "string" ? body.detail : undefined,
      expectedStage ? { expectedStage } : undefined
    );
    if (!updated) {
      // The pre-check passed but the guarded write refused — a concurrent actor
      // moved the stage in the gap (the CAS held) or the row vanished.
      const fresh = getPipelineEntry(id);
      if (!fresh) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
      return staleResponse(fresh);
    }
    // A human reject is the gate; the candidate hears about it (queued by default).
    if (action === "reject") await dispatchRejection(updated);
    return NextResponse.json({ entry: updated });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:action", "PIPELINE_ACTION_FAILED");
  }
}
