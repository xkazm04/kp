import { NextResponse } from "next/server";
import {
  claimProposal,
  getProposal,
  releaseProposal,
  resolveProposal,
  stampProposalOutcome,
} from "@/app/_lib/db/companion";
import { companionAction, coerceCompanionAction, coerceProposalPayload } from "@/app/_lib/companion-actions";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getServerLocale } from "@/i18n/server";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import type { CompanionProposal } from "@/app/_lib/db/companion";

// ALREADY ANSWERED, WITH THE ROW. The dock's contract is "take the response's
// proposal whatever the status": a 409 that carried only a code left the card
// armed on a closed proposal, so every further click bought another 409 until a
// poll happened. The row beside the code is what lets the card repaint as
// answered, which is the truth the 409 is reporting in the first place.
//
// A decision, not an accident: the code lives in REFUSAL_ERRORS and jsonRefusal
// carries the row as the data the reader's sentence needs.
function alreadyResolved(proposal: CompanionProposal | null) {
  return jsonRefusal("COMPANION_PROPOSAL_RESOLVED", 409, { proposal });
}

// POST /api/companion/proposals/[id]/resolve — the operator's answer to one
// companion proposal (docs/features/companion/README.md, WP3).
//
// THIS IS THE ONE DOOR. Candi proposes; nothing she says executes until a request
// arrives here, and this handler re-validates from scratch: the proposal is still
// open, its stored payload still parses, its action still exists in the catalog,
// its parameters still satisfy the catalog's declared shape, and — inside the
// action's own `execute` — the thing it names still exists in THIS tenant.
// Everything interesting about a proposal can change between the reply and the
// click (a candidate is hired, a role is closed, an action is retired), so a
// proposal-time check is a claim and an execution-time check is the guarantee.
//
// ACCEPT IS THREE STEPS, NOT ONE. Write-then-work leaves a failed accept marked
// done; work-then-write runs a double-click twice. So the row is CLAIMED with an
// atomic conditional UPDATE only one caller can win, the work runs, and the
// outcome is stamped — with a release path on failure, guarded on `resolved_at IS
// NULL` so a completed acceptance can never be re-opened.
//
// THROTTLE (rate-limit-contract.test.ts): an accept dispatches a background task
// that spends — a screening call, a JD build, an outreach letter, a digest. The
// route is operator-gated, but in open mode (no KP_OPERATOR_PASSWORD) the whole
// API is open, so it self-limits per IP. 60/10min sits far above a human reading
// cards and clicking Accept, and pins a scripted loop. It runs AFTER the cheap
// refusals (404 for an unknown or other-tenant proposal, 400 for a malformed
// decision, 409 for one already answered) so a rejected call never consumes
// budget, and BEFORE the claim + the dispatch.

const DECISIONS = new Set(["accept", "decline"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const proposal = getProposal(id, ws);
    if (!proposal) {
      return jsonRefusal("COMPANION_PROPOSAL_NOT_FOUND", 404);
    }
    const body = (await request.json().catch(() => ({}))) as { decision?: unknown };
    const decision = typeof body.decision === "string" ? body.decision : "";
    if (!DECISIONS.has(decision)) {
      return NextResponse.json({ error: "decision must be accept or decline" }, { status: 400 });
    }
    // Already answered. 409, not 404: the proposal exists and the operator is
    // entitled to know it was resolved rather than that it vanished — a re-opened
    // dock racing a sibling tab is the common case, not an attack.
    if (proposal.status !== "open") {
      // The ROW rides with the code. The dock takes the response's proposal
      // whatever the status, so a card that lost the race repaints as answered
      // instead of re-arming Accept on a closed proposal and 409-ing on every
      // further click until the next poll.
      return alreadyResolved(proposal);
    }

    if (!rateLimit(`companion-resolve:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
      // RATE_LIMITED_ERROR through the refusal chokepoint (api-contracts.md §1.1).
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    if (decision === "decline") {
      // A decline runs nothing, so it is one atomic write. The outcome is stamped
      // separately because it belongs in the payload beside the summary that was
      // declined, which is the whole story of that proposal in one row.
      if (!resolveProposal(id, "declined", ws)) {
        return alreadyResolved(getProposal(id, ws));
      }
      stampProposalOutcome(id, { key: "declined" }, ws);
      return NextResponse.json({ proposal: getProposal(id, ws) });
    }

    const payload = coerceProposalPayload(proposal.payload);
    const spec = payload ? companionAction(payload.actionId) : null;
    // A payload that no longer parses, or an action this build no longer carries,
    // is not an error the operator caused — it is a proposal that has outlived its
    // catalog. Decline it on their behalf and say so, rather than leaving an
    // Accept button that can never succeed.
    if (!payload || !spec) {
      resolveProposal(id, "declined", ws);
      stampProposalOutcome(id, { key: "retired" }, ws);
      return NextResponse.json({ proposal: getProposal(id, ws) });
    }
    // The catalog's shape check, run AGAIN on the stored params. The row has been
    // sitting in a database since the reply that produced it; re-deriving from the
    // spec is what makes the catalog the single validator rather than a thing that
    // happened to be consulted once.
    const revalidated = coerceCompanionAction({ id: payload.actionId, params: payload.params });
    if (!revalidated.ok) {
      resolveProposal(id, "declined", ws);
      stampProposalOutcome(id, { key: "retired" }, ws);
      return NextResponse.json({ proposal: getProposal(id, ws) });
    }

    // Win the right to run it. A losing double-click reads the same 409 a second
    // tab would, which is the truth: someone already answered this.
    if (!claimProposal(id, ws)) {
      return alreadyResolved(getProposal(id, ws));
    }
    try {
      const outcome = await spec.execute(revalidated.params, {
        workspaceId: ws,
        threadId: proposal.threadId ?? id,
        locale: await getServerLocale(),
      });
      stampProposalOutcome(id, outcome, ws);
      return NextResponse.json({ proposal: getProposal(id, ws) });
    } catch (error) {
      // An accept that ran nothing must not read as done: put the proposal back so
      // the operator can try again, then report. The release is guarded on
      // `resolved_at IS NULL`, so it can only ever undo the claim above.
      releaseProposal(id, ws);
      return safeJsonError(error, "api:companion/resolve", "COMPANION_PROPOSAL_FAILED");
    }
  } catch (error) {
    return safeJsonError(error, "api:companion/resolve", "COMPANION_PROPOSAL_FAILED");
  }
}
