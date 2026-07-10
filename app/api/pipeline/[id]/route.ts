import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, clearIntakeDegraded, getPipelineEntry, PIPELINE_STAGES, reinstatePipelineEntry, setApproval, setEntryGithubEvidence, setEntryNotes, setPipelineEntryStage, type PipelineAction, type PipelineEntry } from "@/app/_lib/db";
import { coerceGithubEvidenceSummary } from "@/app/_lib/github-summary";
import { dispatchOffer, dispatchRejection } from "@/app/_lib/comms-dispatch";
import { getOrCreateOpenOffer } from "@/app/_lib/offers-store";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { safeJsonError } from "@/app/_lib/api-response";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


const ACTIONS: PipelineAction[] = ["accept", "reject", "approve_event"];

// Upper bound for the persistent recruiter note (set_notes). Generous enough for
// pasted call notes, tight enough that the column can't become a blob dump. The
// drawer's textarea enforces the same cap client-side (maxLength).
const MAX_NOTES_LENGTH = 4000;

// gsim-l2-103 — truthful audit attribution for programmatic callers. The guided
// simulation drives this route with real HTTP accepts; without a declaration,
// every engine-driven action was recorded as a human decision (an `advanced`
// pipeline event + a sealed "human:recruiter" record) — machine actions
// misattributed to people, the one thing a regulator-facing audit trail must
// never do. A caller may declare itself with body.actor; only the known
// non-human value is honored, so the claim can only DOWNGRADE authority
// (human → automated). A spoofed field can therefore never forge a human
// decision — the failure mode that matters for an Art. 22 dossier.
const SIM_ACTOR = "sim";
const SIM_SEAL_ACTOR = "auto:sim"; // decision-chain vocabulary: "auto:*" | "human:*"

// Human gate for the offer: approving a drafted offer EXTENDS it to the candidate
// with a secure accept/decline link, rather than bare-advancing to Hired. The
// Hired move happens only when the candidate accepts (see /api/offer/[token]).
async function extendOffer(request: NextRequest, entry: PipelineEntry, workspaceId: string, bodyTtlDays?: unknown, sealActor = "human:recruiter") {
  let draft: { subject?: unknown; body?: unknown; recommended?: unknown; currency?: unknown; ttlDays?: unknown; startDate?: unknown } = {};
  try {
    draft = entry.approvalDetail ? JSON.parse(entry.approvalDetail) : {};
  } catch {
    draft = {};
  }

  // Reuse an already-open offer for this entry (idempotent re-extends). Atomic
  // (idea-00987b3c): the old `getOpenOfferForEntry() ?? createOffer()` was a
  // TOCTOU that a double-clicked approval defeated, minting two live offer
  // links. A re-extend re-sends the SAME link — never a second one.
  const { offer, created, updated } = getOrCreateOpenOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    // P2-1 — store the offer draft's OWN currency (it flows from the candidate's
    // multi-currency analysis since P0-2); do NOT fabricate "CZK" when the draft
    // carried none. A null currency renders unit-less on the offer page rather
    // than mislabeling a non-Czech offer.
    currency: typeof draft.currency === "string" ? draft.currency : null,
    salary: Number(draft.recommended) || null,
    payload: draft,
    // The recruiter's deadline lever (offers-onboarding #3): a per-offer window in
    // whole days. Prefer the value chosen at approval time (request body) over any
    // stored on the draft; out-of-range/omitted falls back to the deployment default
    // in resolveOfferTtlMs.
    ttlDays: Number(bodyTtlDays) || Number(draft.ttlDays) || null,
  });

  // Decision SoR (moonshot D backfill): seal the recruiter's offer-terms decision —
  // on a genuinely NEW offer (created) OR a re-extend that CORRECTED the terms
  // (updated: the open row was refreshed to a new salary/currency), so the sealed
  // record always matches the terms the candidate can now accept. A pure idempotent
  // re-extend (same terms, same link) is not re-sealed. Best-effort; never blocks
  // the offer dispatch.
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

  // Canonical candidate-link origin (idea-e6c66bcd): the same resolver the client
  // uses, so this server-minted offer link can't diverge from the voice/scheduling
  // links the recruiter copies in the drawer.
  const link = `${publicBaseUrl(new URL(request.url).origin)}/offer/${offer.token}`;
  // Records the `offer_sent` event + outbox message. The offer row's ACTUAL
  // deadline (minted from the recruiter's ttlDays above) and any drafted start
  // date ride along so the dispatched letter states them (OO-L1-04) — injected
  // at dispatch, where they are finally known, not guessed at draft time.
  await dispatchOffer(entry, draft, link, {
    expiresAt: offer.expiresAt,
    startDate: typeof draft.startDate === "string" ? draft.startDate : null,
  });

  // The offer is out — clear the recruiter approval; now awaiting the candidate.
  setApproval(entry.id, null, "", workspaceId);
  return NextResponse.json({ entry: getPipelineEntry(entry.id, workspaceId), offerExtended: true, link });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ws = await currentWorkspace();
  try {
    const body = (await request.json()) as { action?: string; detail?: string; expectedStage?: string; toStage?: string; github?: unknown; notes?: unknown; ttlDays?: unknown; actor?: unknown };
    // See SIM_ACTOR above: an unrecognized/absent value stays "human" (real clicks).
    const simActor = body.actor === SIM_ACTOR;

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
      // Hired is terminal and OUTCOME-bearing: it must be reached only when the
      // candidate ACCEPTS an offer (/api/offer/[token]), which records the offer, the
      // acceptance, and fires onboarding. A manual stage override straight to Hired
      // would bypass all of that — a "hire" with no offer record. Route the recruiter
      // through the offer flow (move to Offer → extend offer → candidate accepts).
      if (toStage === "Hired") {
        return NextResponse.json(
          { error: "Hired is set when the candidate accepts an offer, not by a manual move. Move them to Offer and extend an offer." },
          { status: 422 }
        );
      }
      const expected = typeof body.expectedStage === "string" ? body.expectedStage : undefined;
      const moved = setPipelineEntryStage(id, toStage, expected ? { expectedStage: expected } : undefined, ws);
      if (!moved) {
        const fresh = getPipelineEntry(id, ws);
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
      const updated = setEntryGithubEvidence(id, JSON.stringify(summary), ws);
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
      const updated = setEntryNotes(id, trimmed === "" ? null : trimmed, ws);
      if (!updated) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
      return NextResponse.json({ entry: updated });
    }

    // Reinstate an auto-rejected candidate for re-review (idea-e43fa801): put them
    // back to active at Screened, audited. Guarded server-side to a still-rejected
    // entry, so a double-click / stale "Reconsider" view 409s instead of churning.
    if (body.action === "reinstate") {
      const restored = reinstatePipelineEntry(id, ws);
      if (!restored) {
        return NextResponse.json(
          { error: "Couldn't reinstate — this candidate isn't in a rejected state (already reinstated, or closed differently)." },
          { status: 409 }
        );
      }
      // Seal the REVERSAL into the tamper-evident decision chain too. The auto-reject
      // is sealed by screen-wave; recording only a pipeline event for the reinstate
      // left the chain showing a rejection with no record it was overturned — an
      // incomplete audit trail. Best-effort (sealDecisionSafe never throws): a seal
      // failure must not fail the reinstate the recruiter already committed.
      sealDecisionSafe({
        kind: "reinstated",
        actor: "human:recruiter",
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
    const current = getPipelineEntry(id, ws);
    if (!current) {
      return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
    }
    if (expectedStage && current.stage !== expectedStage) return staleResponse(current);

    // Approving a drafted offer extends it to the candidate (not a bare Hire click).
    if (action === "accept" && current.stage === "Offer" && current.approvalKind === "offer_review") {
      return await extendOffer(request, current, ws, body.ttlDays, simActor ? SIM_SEAL_ACTOR : "human:recruiter");
    }

    // Hired is terminal and OUTCOME-bearing (same rule as the set_stage guard
    // above): it is reached only when the CANDIDATE accepts an extended offer
    // (/api/offer/[token] → offer-finalize), which records the offer, the
    // acceptance, and fires onboarding. A bare accept on an Offer-stage entry
    // used to fall through to the generic one-stage advance — a "hire" with no
    // offer record and no candidate consent (gsim-l2-102). Refuse it here; the
    // legitimate accept at Offer is the offer_review approval handled above.
    if (action === "accept" && current.stage === "Offer") {
      return NextResponse.json(
        { error: "Hired is set when the candidate accepts an offer, not by advancing them. Draft and extend an offer instead." },
        { status: 422 }
      );
    }

    const updated = actOnPipelineEntry(
      id,
      action,
      typeof body.detail === "string" ? body.detail : undefined,
      { ...(expectedStage ? { expectedStage } : {}), actor: simActor ? "system" : "human" },
      ws
    );
    if (!updated) {
      // The pre-check passed but the guarded write refused — a concurrent actor
      // moved the stage in the gap (the CAS held) or the row vanished.
      const fresh = getPipelineEntry(id, ws);
      if (!fresh) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
      return staleResponse(fresh);
    }
    // Seal the HUMAN accept/reject into the tamper-evident decision chain. The chain
    // sealed AI auto-rejections, group-eval verdicts, offers and reinstatements, but
    // the recruiter's DIRECT gate decision — the most consequential one for an
    // Art.22 / EU-AI-Act "right to explanation" dossier — flowed through only a
    // mutable pipeline event, so a human-rejected candidate's sealed dossier came back
    // empty. Mirror the reinstate seal; best-effort (sealDecisionSafe never throws).
    if (action === "accept" || action === "reject") {
      const detail = typeof body.detail === "string" ? body.detail.trim() : "";
      // The seal names WHO acted (gsim-l2-103): a declared programmatic caller is
      // recorded as the engine ("auto:sim" + auto_* event kind via the actor opt
      // above), never as "human:recruiter" — the audit chain must tell the truth
      // about machine actions even inside a demo.
      sealDecisionSafe({
        kind: action === "reject" ? (simActor ? "auto_rejected" : "rejected") : simActor ? "auto_advanced" : "advanced",
        actor: simActor ? SIM_SEAL_ACTOR : "human:recruiter",
        policyVersion: "manual",
        candidateRef: id,
        rationale: detail || `${simActor ? "Guided simulation" : "Recruiter"} ${action} from ${current.stage}.`,
        reasonCode: action,
        inputs: { fromStage: current.stage, detail: detail || null },
      });
    }
    // A human reject is the gate; the candidate hears about it (queued by default).
    if (action === "reject") await dispatchRejection(updated);
    return NextResponse.json({ entry: updated });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:action", "PIPELINE_ACTION_FAILED");
  }
}
