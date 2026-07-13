import { actOnPipelineEntry, getPipelineEntry, PIPELINE_STAGES, setApproval, setPipelineEntryStage, type PipelineAction, type PipelineEntry } from "@/app/_lib/db";
import { dispatchOffer, dispatchRejection } from "@/app/_lib/comms-dispatch";
import { getOrCreateOpenOffer } from "@/app/_lib/offers-store";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { publicBaseUrl } from "@/app/_lib/public-base-url";

// One canonical move/decide action against a single pipeline entry, shared by the
// per-entry route (/api/pipeline/[id]) AND the batch route (/api/pipeline/batch)
// so the two can never diverge on the guards that matter: the expectedStage CAS,
// the Hired-is-outcome-bearing 422, the offer_review → EXTEND-not-hire branch, the
// tamper-evident decision seal, and the rejection comm. Returns a plain
// { status, body } pair (never throws for a business-rule refusal) so each route
// maps it to its own transport shape — a NextResponse for the single route, a
// per-id { ok, reason } row for the batch route.
//
// Scope: the three board actions — `set_stage` (manual override), `accept`,
// `reject`. The route keeps owning the non-move actions (set_github, set_notes,
// reinstate, resolve_intake) since those never appear in a batch.

// gsim-l2-103 — a caller may DECLARE itself the engine (actor:"sim"); only the
// known non-human value is honored, so the claim can only DOWNGRADE authority
// (human → automated) and can never forge a human decision.
export const SIM_ACTOR = "sim";
const SIM_SEAL_ACTOR = "auto:sim"; // decision-chain vocabulary: "auto:*" | "human:*"

// The generic accept/reject/approve_event actions (set_stage is validated on its
// own path). Mirrors the route's ACTIONS list.
export const GENERIC_ACTIONS: PipelineAction[] = ["accept", "reject", "approve_event"];

export type EntryActionInput = {
  id: string;
  action: string;
  toStage?: string;
  expectedStage?: string;
  // Optional free-text rationale for accept/reject (the single route forwards the
  // recruiter's note; the batch route never sends one).
  detail?: string;
  // The recruiter's per-offer deadline (whole days), chosen at approval time on an
  // offer_review accept. Preferred over any value stored on the draft; the batch
  // route never sends one (it can't extend offers — see the guard below).
  ttlDays?: unknown;
  // A declared programmatic caller (body.actor). Anything but SIM_ACTOR stays human.
  actor?: unknown;
  // Request origin — needed only to mint the candidate-facing offer link on an
  // offer_review accept. Every route already has it (new URL(request.url).origin).
  origin: string;
  workspaceId: string;
};

// A plain, transport-agnostic result: status + JSON body. ok is the 200 case.
export type EntryActionResult = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown>): EntryActionResult => ({ status: 200, body });
const err = (status: number, error: string, extra: Record<string, unknown> = {}): EntryActionResult => ({
  status,
  body: { error, ...extra },
});

// Human gate for the offer: approving a drafted offer EXTENDS it to the candidate
// with a secure accept/decline link, rather than bare-advancing to Hired. The
// Hired move happens only when the candidate accepts (see /api/offer/[token]).
async function extendOffer(
  entry: PipelineEntry,
  workspaceId: string,
  origin: string,
  bodyTtlDays: unknown,
  sealActor = "human:recruiter"
): Promise<EntryActionResult> {
  let draft: { subject?: unknown; body?: unknown; recommended?: unknown; currency?: unknown; ttlDays?: unknown; startDate?: unknown } = {};
  try {
    draft = entry.approvalDetail ? JSON.parse(entry.approvalDetail) : {};
  } catch {
    draft = {};
  }

  // Reuse an already-open offer for this entry (idempotent re-extends). Atomic
  // (idea-00987b3c): the old getOpenOfferForEntry() ?? createOffer() was a TOCTOU
  // a double-clicked approval defeated, minting two live offer links. A re-extend
  // re-sends the SAME link — never a second one.
  const { offer, created, updated } = getOrCreateOpenOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    // P2-1 — store the offer draft's OWN currency; do NOT fabricate "CZK" when the
    // draft carried none. A null currency renders unit-less rather than mislabeling.
    currency: typeof draft.currency === "string" ? draft.currency : null,
    salary: Number(draft.recommended) || null,
    payload: draft,
    // The recruiter's deadline lever: prefer the value chosen at approval time
    // (bodyTtlDays) over any stored on the draft; out-of-range/omitted falls back
    // to the deployment default in resolveOfferTtlMs.
    ttlDays: Number(bodyTtlDays) || Number(draft.ttlDays) || null,
  });

  // Decision SoR: seal the recruiter's offer-terms decision on a genuinely NEW
  // offer OR a re-extend that CORRECTED the terms — so the sealed record always
  // matches the terms the candidate can now accept. Best-effort; never blocks.
  if (created || updated) {
    sealDecisionSafe({
      kind: "offer_terms",
      actor: sealActor,
      policyVersion: "offer",
      candidateRef: entry.id,
      rationale: `Offer extended: ${offer.salary ?? "—"} ${offer.currency ?? ""} for ${entry.jobTitle ?? "role"}.`,
      reasonCode: "offer",
      inputs: { salary: offer.salary, currency: offer.currency, jobTitle: entry.jobTitle },
    });
  }

  const link = `${publicBaseUrl(origin)}/offer/${offer.token}`;
  await dispatchOffer(entry, draft, link, {
    expiresAt: offer.expiresAt,
    startDate: typeof draft.startDate === "string" ? draft.startDate : null,
  });

  // The offer is out — clear the recruiter approval; now awaiting the candidate.
  setApproval(entry.id, null, "", workspaceId);
  return ok({ entry: getPipelineEntry(entry.id, workspaceId), offerExtended: true, link });
}

export async function runPipelineEntryAction(input: EntryActionInput): Promise<EntryActionResult> {
  const { id, action, toStage, expectedStage, origin, workspaceId } = input;
  // See SIM_ACTOR: an unrecognized/absent value stays "human" (real clicks).
  const simActor = input.actor === SIM_ACTOR;

  // Manual recruiter stage override (set_stage): move backward, skip a stage, or
  // fix a miscategorization. Same expectedStage CAS as the AI actions.
  if (action === "set_stage") {
    const to = typeof toStage === "string" ? toStage : "";
    if (!(PIPELINE_STAGES as readonly string[]).includes(to)) {
      return err(400, `Unknown stage "${to}". Expected one of: ${PIPELINE_STAGES.join(", ")}.`);
    }
    // Hired is terminal and OUTCOME-bearing: reachable only when the candidate
    // ACCEPTS an offer (/api/offer/[token]). A manual override straight to Hired
    // would bypass the offer record — route the recruiter through the offer flow.
    if (to === "Hired") {
      return err(
        422,
        "Hired is set when the candidate accepts an offer, not by a manual move. Move them to Offer and extend an offer."
      );
    }
    const moved = setPipelineEntryStage(id, to, expectedStage ? { expectedStage } : undefined, workspaceId);
    if (!moved) {
      const fresh = getPipelineEntry(id, workspaceId);
      if (!fresh) return err(404, "Pipeline entry not found.");
      // The CAS lost in the gap or the entry is closed out — the caller's view is stale.
      return err(
        409,
        "Couldn't move this candidate — they were just changed or are closed out. Refresh and try again.",
        { entry: fresh }
      );
    }
    return ok({ entry: moved });
  }

  if (!GENERIC_ACTIONS.includes(action as PipelineAction)) {
    return err(400, "Unknown action.");
  }

  // Optimistic-concurrency contract: a client deciding from a SNAPSHOT sends the
  // stage it believes the candidate is in. A mismatch is a 409 carrying the fresh
  // entry — the recruiter re-decides against reality. Omitting expectedStage keeps
  // the prior act-on-current behavior.
  const staleResponse = (entry: PipelineEntry) =>
    err(409, "This candidate's stage changed since the view was opened — refresh and decide again.", { entry });
  const current = getPipelineEntry(id, workspaceId);
  if (!current) return err(404, "Pipeline entry not found.");
  if (expectedStage && current.stage !== expectedStage) return staleResponse(current);

  // Approving a drafted offer extends it to the candidate (not a bare Hire click).
  if (action === "accept" && current.stage === "Offer" && current.approvalKind === "offer_review") {
    return await extendOffer(current, workspaceId, origin, input.ttlDays, simActor ? SIM_SEAL_ACTOR : "human:recruiter");
  }

  // Hired is terminal and OUTCOME-bearing (same rule as the set_stage guard): a
  // bare accept on an Offer-stage entry is refused; the legitimate accept at Offer
  // is the offer_review approval handled above.
  if (action === "accept" && current.stage === "Offer") {
    return err(
      422,
      "Hired is set when the candidate accepts an offer, not by advancing them. Draft and extend an offer instead."
    );
  }

  const detail = typeof input.detail === "string" ? input.detail : undefined;
  const updated = actOnPipelineEntry(
    id,
    action as PipelineAction,
    detail,
    { ...(expectedStage ? { expectedStage } : {}), actor: simActor ? "system" : "human" },
    workspaceId
  );
  if (!updated) {
    // The pre-check passed but the guarded write refused — a concurrent actor moved
    // the stage in the gap (the CAS held) or the row vanished.
    const fresh = getPipelineEntry(id, workspaceId);
    if (!fresh) return err(404, "Pipeline entry not found.");
    return staleResponse(fresh);
  }
  // Seal the HUMAN accept/reject into the tamper-evident decision chain. A declared
  // programmatic caller is recorded as the engine ("auto:sim"), never a recruiter —
  // the audit chain must tell the truth about machine actions even inside a demo.
  if (action === "accept" || action === "reject") {
    const trimmedDetail = detail?.trim() ?? "";
    sealDecisionSafe({
      kind: action === "reject" ? (simActor ? "auto_rejected" : "rejected") : simActor ? "auto_advanced" : "advanced",
      actor: simActor ? SIM_SEAL_ACTOR : "human:recruiter",
      policyVersion: "manual",
      candidateRef: id,
      rationale: trimmedDetail || `${simActor ? "Guided simulation" : "Recruiter"} ${action} from ${current.stage}.`,
      reasonCode: action,
      inputs: { fromStage: current.stage, detail: trimmedDetail || null },
    });
  }
  // A human reject is the gate; the candidate hears about it (queued by default).
  if (action === "reject") await dispatchRejection(updated);
  return ok({ entry: updated });
}
