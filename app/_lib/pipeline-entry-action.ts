import type { PipelineEntry } from "@/app/_lib/db/core";
import {
  actOnPipelineEntry,
  getPipelineEntry,
  recordAutomationEvent,
  setApproval,
  setPipelineEntryStage,
  type PipelineAction,
} from "@/app/_lib/db/pipeline";
import { REFUSAL_ERRORS, type RefusalErrorCode } from "@/app/_lib/api-response";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import { dispatchOffer, dispatchRejection } from "@/app/_lib/comms-dispatch";
import { getOrCreateOpenOffer } from "@/app/_lib/offers-store";
import { validateOfferTerms } from "@/app/_lib/offer-policy";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { planRoutesAiScorecardToHumanRound } from "@/app/_lib/decision-config-schema";
import { getInterviewPlan } from "@/app/_lib/interview-plan";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { invalidateGroupEvalSelection } from "@/app/_lib/group-eval";
import { stageHasRole, stageIndex, stageWithRole, type StageDef } from "@/app/_lib/pipeline-stages";

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

// The AI verdict the human is ratifying or overriding. It lives only in the
// entry's approval_detail JSON, and the accept/reject write NULLs that column —
// so unless it is read off the pre-write snapshot and sealed here, the pair
// (what the machine proposed, what the human decided) is destroyed by the very
// act of deciding, and the override rate can never be computed after the fact.
// Absent/unparseable detail yields nulls: a decision with no AI verdict behind
// it (a plain board move) is the normal case, not an error.
function aiVerdict(entry: PipelineEntry): { aiRecommendation: string | null; aiConfidence: number | null } {
  if (!entry.approvalDetail) return { aiRecommendation: null, aiConfidence: null };
  try {
    const parsed = JSON.parse(entry.approvalDetail) as { recommendation?: unknown; confidence?: unknown };
    return {
      aiRecommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : null,
      aiConfidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    };
  } catch {
    return { aiRecommendation: null, aiConfidence: null };
  }
}

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

/** Would a one-stage `accept` from `stage` LAND on this board's TERMINAL column?
 *
 *  Mirrors the store's own advance rule (nextStageOnAxis in db/pipeline.ts): the
 *  next column on the axis, clamped at the end, and an off-axis stage has no
 *  "next" so it never moves. False when the entry is ALREADY at the terminal
 *  stage — that accept is the no-op approval clear the store already handles, not
 *  a new outcome.
 *
 *  This is the real form of the "the terminal stage is outcome-bearing" rule that
 *  `set_stage` enforces by role. The accept path used to express it as "is the
 *  entry standing on the OFFER column", which is only a proxy: it holds on the
 *  shipped axis because Offer immediately precedes Hired, and stops holding the
 *  moment a workspace composes its own board (validatePipelineStages requires only
 *  an entry and a terminal stage, so an axis may put a column between offer and
 *  terminal — or carry no offer column at all). */
function acceptWouldReachTerminal(stage: string, axis: readonly StageDef[]): boolean {
  const i = stageIndex(stage, axis);
  if (i < 0 || i >= axis.length - 1) return false;
  const next = axis[i + 1];
  return !!next && stageHasRole(next.id, "terminal", axis);
}

const ok = (body: Record<string, unknown>): EntryActionResult => ({ status: 200, body });

/**
 * Expire the role's cached group evaluations after a write that moved its cohort.
 *
 * The Decisions "group evaluation" cache (`app/_lib/group-eval.ts`) had no TTL and no
 * invalidation. Its SELECTION keys are stable across pipeline writes by construction
 * — `<role>#sel:<n>-<hash>` over the same entry ids hashes identically however far
 * those candidates have since moved — so rejecting two of a compared four and
 * reopening the identical selection served the cached comparison: a lead crowned
 * over a field that no longer exists. This is the write side of that cache, and the
 * only place that knows a cohort just changed.
 *
 * Called from the ENTRY-ACTION layer rather than from `db/pipeline.ts`: the store
 * module must not reach across into another store's cache, and this is the seam both
 * routes and the automation pass already go through.
 *
 * `roleKey` mirrors `roleKeyOf` (decisionsQueueTypes.ts): jobId ?? jobTitle ??
 * "unassigned" — the same key the eval was persisted under.
 *
 * Best-effort by design: expiring a cache must never turn a completed decision into
 * a failed request. A miss costs one stale modal open (which the pool-drift banner
 * still discloses); a throw here would cost the recruiter their decision.
 */
function expireCachedGroupEvals(entry: PipelineEntry | null | undefined, workspaceId: string): void {
  if (!entry) return;
  try {
    invalidateGroupEvalSelection(entry.jobId ?? entry.jobTitle ?? "unassigned", workspaceId);
  } catch (error) {
    console.warn("[pipeline-entry-action] group-eval cache expiry failed:", error instanceof Error ? error.message : error);
  }
}

/** Every refusal on this helper answers a CODE (api-contracts.md 1.1), never a
 *  hand-written sentence: both callers put these straight on the wire — the single
 *  route as the response body, the batch route as a per-id reason — and the board's
 *  bulk action bar used to PAINT that prose, so a lost race read English on a Czech
 *  board. The canonical English rides along for the log and for API consumers;
 *  `extra` carries the data a localized sentence needs (the board's step ids). */
const err = (status: number, code: RefusalErrorCode, extra: Record<string, unknown> = {}): EntryActionResult => ({
  status,
  body: { error: REFUSAL_ERRORS[code], code, ...extra },
});

// Gate for the offer: approving a drafted offer EXTENDS it to the candidate
// with a secure accept/decline link, rather than bare-advancing to Hired. The
// Hired move happens only when the candidate accepts (see /api/offer/[token]).
// Exported for the interviewPlan offerGate="auto" path (automation-run.ts),
// which extends a freshly-drafted offer unattended — same idempotent
// open-offer reuse, same truthful dispatch, sealActor names the machine.
export async function extendDraftedOffer(
  entry: PipelineEntry,
  workspaceId: string,
  origin: string,
  bodyTtlDays: unknown,
  sealActor = "human:recruiter"
): Promise<EntryActionResult> {
  let draft: {
    subject?: unknown;
    body?: unknown;
    recommended?: unknown;
    currency?: unknown;
    ttlDays?: unknown;
    startDate?: unknown;
    /** Optional free-text terms note (a bonus, a notice period) the draft may carry
     *  alongside the letter. Length-capped by validateOfferTerms so an unbounded
     *  string can't ride into the sealed decision record. */
    notes?: unknown;
  } = {};
  try {
    draft = entry.approvalDetail ? JSON.parse(entry.approvalDetail) : {};
  } catch {
    draft = {};
  }

  // VALIDATE THE TERMS BEFORE ANY OF THEM CAN BE MINTED (perfect:
  // an-offer-carries-validated-terms). The figure and the currency go straight onto a
  // PUBLIC accept page and into a sealed decision record, and the only checks here
  // used to be `Number(draft.recommended) || null` and `typeof === "string"` — so a
  // negative figure rendered verbatim as the salary someone was asked to accept and
  // any sentence rode along as the unit label. offer-policy owns the rule (pure,
  // unit-tested); the refusal is a CODE the recruiter's card localizes, and `max`
  // carries the bound a localized sentence needs. Refusing BEFORE getOrCreateOpenOffer
  // means an invalid draft mints no token, sends no letter and seals no decision.
  const terms = validateOfferTerms({ salary: draft.recommended, currency: draft.currency, notes: draft.notes });
  if (!terms.ok) return err(400, terms.code, { max: terms.max });

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
    // Normalized by validateOfferTerms, so " czk " persists as "CZK" and a re-extend's
    // termsChanged comparison can't see a whitespace difference as a terms correction.
    currency: terms.currency,
    salary: terms.salary,
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
  try {
    await dispatchOffer(entry, draft, link, {
      expiresAt: offer.expiresAt,
      startDate: typeof draft.startDate === "string" ? draft.startDate : null,
    });
  } catch (dispatchError) {
    // COMPENSATION (stated deliberately): the approval is LEFT IN PLACE and the
    // offer row is left open. The token was minted but never reached the wire, and
    // getOrCreateOpenOffer is idempotent — so the recruiter's retry re-sends THAT
    // SAME link rather than minting a second one, and the un-sent token is pending,
    // not orphaned. The alternative (clearing the approval here) is the one thing
    // that must not happen: it would leave a live offer link nobody was ever sent,
    // with no gate left on the card to notice.
    console.error(`[pipeline:offer] offer dispatch failed for ${entry.id}`, dispatchError);
    recordAutomationEvent(
      entry.id,
      "offer_comms_failed",
      "The offer was drafted but the message did not go out. The approval is still open — approve again to re-send the same link.",
      workspaceId
    );
    return err(502, "OFFER_NOT_DISPATCHED", {
      entry: getPipelineEntry(entry.id, workspaceId),
      offerExtended: false,
    });
  }

  // The offer is out — clear the recruiter approval; now awaiting the candidate.
  // GUARDED on the approval kind read BEFORE the dispatch above: that await is a
  // comms round trip, and a bare UPDATE here overwrote whatever a human decided in
  // the gap (raising a fresh gate, or resolving this one) with a stale NULL.
  const cleared = setApproval(entry.id, null, "", workspaceId, { expectedApprovalKind: entry.approvalKind });
  if (!cleared) {
    // The offer DID go out; only the approval clear was refused because the card
    // moved under us. Say so rather than reporting a clean extend: the candidate
    // holds a live link and the card still shows a gate someone else just set.
    return err(409, "OFFER_SENT_APPROVAL_CHANGED", {
      entry: getPipelineEntry(entry.id, workspaceId),
      offerExtended: true,
      link,
    });
  }
  expireCachedGroupEvals(entry, workspaceId);
  return ok({ entry: getPipelineEntry(entry.id, workspaceId), offerExtended: true, link });
}

export async function runPipelineEntryAction(input: EntryActionInput): Promise<EntryActionResult> {
  const { id, action, toStage, expectedStage, origin, workspaceId } = input;
  // See SIM_ACTOR: an unrecognized/absent value stays "human" (real clicks).
  const simActor = input.actor === SIM_ACTOR;
  // UAT LUC-ANA-4 — the one actor string this action attributes everything to: the event
  // row, the sealed record, and the offer seal. Resolved ONCE, from the SESSION (never
  // from the request body), so a caller cannot attribute their decision to a colleague;
  // a declared engine caller can only downgrade to "auto:sim" (see SIM_ACTOR).
  // Identity-less deployments (open dev, no session) keep the role token "human:recruiter"
  // — the honest statement that a human acted and we cannot say which one (guardrail G3).
  const sealActor = simActor ? SIM_SEAL_ACTOR : await humanActor();

  // Manual recruiter stage override (set_stage): move backward, skip a stage, or
  // fix a miscategorization. Same expectedStage CAS as the AI actions.
  if (action === "set_stage") {
    const to = typeof toStage === "string" ? toStage : "";
    // Validated against THIS WORKSPACE's board, not the shipped list: a team that
    // renamed or added a column must be able to move candidates onto it.
    const axis = getPipelineAxis(workspaceId).stages;
    if (!axis.some((s) => s.id === to)) {
      // The board's real step ids ride as DATA, not inside an English sentence.
      return err(400, "PIPELINE_STAGE_UNKNOWN", { stage: to, stages: axis.map((s) => s.id) });
    }
    // The TERMINAL stage is outcome-bearing: reachable only when the candidate
    // ACCEPTS an offer (/api/offer/[token]). A manual override straight to it
    // would bypass the offer record — route the recruiter through the offer flow.
    // Resolved by ROLE, not by the literal "Hired": a workspace that renamed its
    // final column must not suddenly be able to hand-set an outcome.
    if (stageHasRole(to, "terminal", axis)) {
      return err(422, "PIPELINE_TERMINAL_NOT_MANUAL");
    }
    const moved = setPipelineEntryStage(id, to, { ...(expectedStage ? { expectedStage } : {}), actorRef: sealActor }, workspaceId);
    if (!moved) {
      const fresh = getPipelineEntry(id, workspaceId);
      if (!fresh) return err(404, "PIPELINE_ENTRY_NOT_FOUND");
      // The CAS lost in the gap or the entry is closed out — the caller's view is stale.
      return err(409, "PIPELINE_MOVE_CONFLICT", { entry: fresh });
    }
    expireCachedGroupEvals(moved, workspaceId);
    return ok({ entry: moved });
  }

  if (!GENERIC_ACTIONS.includes(action as PipelineAction)) {
    return err(400, "PIPELINE_ACTION_UNKNOWN", { action });
  }

  // Optimistic-concurrency contract: a client deciding from a SNAPSHOT sends the
  // stage it believes the candidate is in. A mismatch is a 409 carrying the fresh
  // entry — the recruiter re-decides against reality. Omitting expectedStage keeps
  // the prior act-on-current behavior.
  const staleResponse = (entry: PipelineEntry) =>
    err(409, "PIPELINE_STAGE_CHANGED", { entry });
  const current = getPipelineEntry(id, workspaceId);
  if (!current) return err(404, "PIPELINE_ENTRY_NOT_FOUND");
  if (expectedStage && current.stage !== expectedStage) return staleResponse(current);

  // The OFFER-role stage, resolved for this workspace — the two guards below and
  // the hybrid-handoff bound all ask "are they at/past the offer step?", which is
  // a question about meaning, not about a column called "Offer".
  const axis = getPipelineAxis(workspaceId).stages;
  const atOfferStage = stageHasRole(current.stage, "offer", axis);

  // Approving a drafted offer extends it to the candidate (not a bare Hire click).
  //
  // Gated on the APPROVAL, not on the column the entry happens to stand on. The
  // offer_review approval IS the offer decision, and the writer that raises it
  // (runAutomationTask("offer") / the sim's offer-draft) sets it WITHOUT moving the
  // stage. On the shipped axis the two coincide, so this is a no-op there; on a
  // workspace board with no offer-role column at all (valid — validatePipelineStages
  // requires only an entry and a terminal stage) `atOfferStage` was false everywhere,
  // so approving a drafted offer fell through to the generic advance below — which
  // NULLs approval_detail. The drafted terms were destroyed and the candidate was
  // advanced with no offer ever extended, no offers row and no acceptance.
  if (action === "accept" && current.approvalKind === "offer_review") {
    return await extendDraftedOffer(current, workspaceId, origin, input.ttlDays, sealActor);
  }

  // The terminal stage is outcome-bearing (same rule as the set_stage guard): the
  // only path onto it is the candidate accepting an EXTENDED offer. Refused when the
  // entry stands on the offer step (that step's own rule — the legitimate accept
  // there is the offer_review approval handled above) OR when a one-stage advance
  // would LAND on the terminal column, which is the invariant itself. The
  // offer-column test alone was a proxy that only holds on the shipped axis, where
  // Offer immediately precedes Hired; a composed board that keeps a column between
  // them, or drops the offer column entirely, let a bare accept hand-set the outcome
  // — exactly the phantom hire the set_stage guard 422s. Byte-identical on the
  // shipped axis (there, "at Offer" and "the next stage is Hired" are the same set).
  if (action === "accept" && (atOfferStage || acceptWouldReachTerminal(current.stage, axis))) {
    return err(422, "PIPELINE_TERMINAL_NOT_ADVANCE");
  }

  // HYBRID HANDOFF (interviewPlan) — accepting an AI round's scorecard, when the
  // workspace plan runs a HUMAN round after it, routes the candidate BACK to the
  // calendar gate (human-round scheduling on the Schedule tab) instead of the
  // generic advance toward Offer. Only AI scorecards hand off: a HUMAN-conducted
  // scorecard (approvalDetail.source === "human") is the later round's own verdict
  // and keeps today's advance. Guarded to pre-Offer stages: a scorecard that
  // somehow rides an Offer-stage entry is past the interview loop. Best-effort
  // plan read — a config hiccup falls back to the shipped default plan.
  const offerStage = stageWithRole("offer", axis);
  const offerIdx = offerStage ? stageIndex(offerStage, axis) : axis.length;
  if (
    action === "accept" &&
    current.approvalKind === "scorecard_review" &&
    // "Still inside the interview loop", expressed against this workspace's axis.
    // An off-axis stage (index -1) is deliberately EXCLUDED rather than treated as
    // pre-offer: a candidate stranded on a retired column should be moved back
    // onto the board before a scorecard reroutes them.
    stageIndex(current.stage, axis) >= 0 &&
    stageIndex(current.stage, axis) < offerIdx
  ) {
    let scorecardSource: string | null = null;
    try {
      scorecardSource = ((JSON.parse(current.approvalDetail ?? "{}") as { source?: unknown }).source as string) ?? null;
    } catch {
      scorecardSource = null;
    }
    if (scorecardSource !== "human" && planRoutesAiScorecardToHumanRound(getInterviewPlan(workspaceId))) {
      // Stage stays put (they are still interviewing); the calendar gate re-arms
      // with the default proposed slot the screening accept uses, so the
      // candidate lands on the Schedule tab's human-round pending list.
      // GUARDED on the approval kind read BEFORE the awaits above (humanActor() +
      // the plan read): without the precondition this overwrote an approval a human
      // resolved in that gap with a calendar gate they had already cleared.
      const armed = setApproval(id, "calendar", "Tue 14:00", workspaceId, { expectedApprovalKind: current.approvalKind });
      if (!armed) {
        const fresh = getPipelineEntry(id, workspaceId);
        if (!fresh) return err(404, "PIPELINE_ENTRY_NOT_FOUND");
        return staleResponse(fresh);
      }
      // Auditable in the candidate timeline + sealed in the decision chain: the
      // human ratified the AI verdict AND the plan chose the next gate.
      recordAutomationEvent(
        id,
        "human_round_queued",
        "AI round passed — queued for the human round per the hiring plan.",
        workspaceId,
        // LUC-ANA-6 maps this kind to the HUMAN; LUC-ANA-4 gives that human a name. The
        // marker is written inside a recruiter's own accept, so it credits the same actor
        // as the seal on the next line.
        sealActor
      );
      const { aiRecommendation, aiConfidence } = aiVerdict(current);
      sealDecisionSafe({
        kind: simActor ? "auto_advanced" : "advanced",
        actor: sealActor,
        policyVersion: "interview-plan",
        candidateRef: id,
        rationale: (typeof input.detail === "string" && input.detail.trim()) || "AI scorecard accepted — routed to the human round per the hiring plan.",
        reasonCode: "accept",
        inputs: {
          fromStage: current.stage,
          aiRecommendation,
          aiConfidence,
          approvalKind: current.approvalKind,
          handoff: "human_round",
        },
      });
      expireCachedGroupEvals(current, workspaceId);
      return ok({ entry: getPipelineEntry(id, workspaceId), routedToHumanRound: true });
    }
  }

  const detail = typeof input.detail === "string" ? input.detail : undefined;
  const updated = actOnPipelineEntry(
    id,
    action as PipelineAction,
    detail,
    { ...(expectedStage ? { expectedStage } : {}), actor: simActor ? "system" : "human", actorRef: sealActor },
    workspaceId
  );
  if (!updated) {
    // The pre-check passed but the guarded write refused — a concurrent actor moved
    // the stage in the gap (the CAS held) or the row vanished.
    const fresh = getPipelineEntry(id, workspaceId);
    if (!fresh) return err(404, "PIPELINE_ENTRY_NOT_FOUND");
    return staleResponse(fresh);
  }
  // Seal the HUMAN accept/reject into the tamper-evident decision chain. A declared
  // programmatic caller is recorded as the engine ("auto:sim"), never a recruiter —
  // the audit chain must tell the truth about machine actions even inside a demo.
  if (action === "accept" || action === "reject") {
    const trimmedDetail = detail?.trim() ?? "";
    // Read from `current` (the pre-write snapshot), never `updated` — the write
    // above already cleared the approval columns.
    const { aiRecommendation, aiConfidence } = aiVerdict(current);
    sealDecisionSafe({
      kind: action === "reject" ? (simActor ? "auto_rejected" : "rejected") : simActor ? "auto_advanced" : "advanced",
      actor: sealActor,
      policyVersion: "manual",
      candidateRef: id,
      rationale: trimmedDetail || `${simActor ? "Guided simulation" : "Recruiter"} ${action} from ${current.stage}.`,
      reasonCode: action,
      inputs: {
        fromStage: current.stage,
        detail: trimmedDetail || null,
        // The pair that makes the override rate computable: what the machine
        // proposed (null when the human acted without an AI verdict on the card),
        // which gate raised it, and how sure it was.
        aiRecommendation,
        aiConfidence,
        approvalKind: current.approvalKind ?? null,
      },
    });
  }
  // A human reject is the gate; the candidate hears about it (queued by default).
  if (action === "reject") await dispatchRejection(updated);
  expireCachedGroupEvals(updated, workspaceId);
  return ok({ entry: updated });
}
