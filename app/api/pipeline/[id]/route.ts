import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, clearIntakeDegraded, getPipelineEntry, setApproval, type PipelineAction, type PipelineEntry } from "@/app/_lib/db";
import { dispatchOffer, dispatchRejection } from "@/app/_lib/comms-dispatch";
import { getOrCreateOpenOffer } from "@/app/_lib/offers-store";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

const ACTIONS: PipelineAction[] = ["accept", "reject", "approve_event"];

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
  const { offer } = getOrCreateOpenOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: typeof draft.currency === "string" ? draft.currency : "CZK",
    salary: Number(draft.recommended) || null,
    payload: draft,
  });

  const base = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const link = `${base}/offer/${offer.token}`;
  await dispatchOffer(entry, draft, link); // records the `offer_sent` event + outbox message

  // The offer is out — clear the recruiter approval; now awaiting the candidate.
  setApproval(entry.id, null, "");
  return NextResponse.json({ entry: getPipelineEntry(entry.id), offerExtended: true, link });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { action?: string; detail?: string; expectedStage?: string };

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
