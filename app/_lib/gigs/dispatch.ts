import { boundedBudget } from "@/app/api/agents/dispatch/spec-bounds";
import { getHiredAgent, type AgentStatus } from "../db/agents";
import { getGig, transitionGig } from "../db/gigs";
import { createGigAttempt, setGigAttemptExecutionId, transitionGigAttempt } from "../db/gigs-attempts";
import { findGigSpecialistForArena, getGigSpecialist } from "../db/gigs-specialists";
import { gigChecklist } from "./checklists";
import { executePersonaForGig, type ExecutePersonaResult } from "./personas-exec";
import { GIG_DEFAULT_BUDGET_USD } from "./specialist-defaults";
import {
  GIG_DELIVERABLE_CONTRACT,
  type Gig,
  type GigAssignment,
  type GigAttempt,
  type GigSpecialist,
  type GigStatus,
} from "./types";

// Dispatch one gig attempt to its specialist's Personas persona.
//
// ORDER, and why it is not "create, POST, then move the gig":
//   1. cheap refusals (not found, suspect, not dispatchable, specialist not ready) -
//      nothing written;
//   2. CLAIM the gig: `qualified | drafted | in_review -> dispatched` as a CAS. This is
//      the serialization point - two operators (or a double-click) racing the same gig
//      cannot both mint an attempt, because only one CAS lands;
//   3. create the attempt (`dispatched`, no execution id yet) - its id rides the
//      assignment, so it must exist before the POST;
//   4. POST the assignment to Personas - OUTSIDE any transaction (never await inside
//      db.transaction()); the claim in step 2 is what bridges the gap;
//   5. success: stamp the execution id (write-once); failure: attempt -> `failed` with
//      the reason, gig `dispatched -> qualified` (still workable). Never a fabricated
//      execution id: an attempt without one is an attempt Personas never accepted.
//
// The listing text rides the assignment as `bodyUntrusted` - DATA in `input_data`, never
// spliced into the persona's prompt (specialist.ts builds that from trusted parts).

export type DispatchGigRefusalCode =
  | "GIG_NOT_FOUND"
  | "GIG_SUSPECT"
  | "GIG_NOT_DISPATCHABLE"
  | "GIG_SPECIALIST_NOT_READY";

export type DispatchGigAttemptResult =
  | { ok: true; gig: Gig; attempt: GigAttempt; executionId: string }
  | { ok: false; code: DispatchGigRefusalCode; detail?: string }
  | { ok: false; code: "GIG_DISPATCH_FAILED"; reason: string; attempt: GigAttempt | null; gig: Gig | null };

export type DispatchGigDeps = {
  executePersona: (personaId: string, assignment: GigAssignment) => Promise<ExecutePersonaResult>;
};

const defaultDeps: DispatchGigDeps = { executePersona: executePersonaForGig };

/** The gig statuses a dispatch may start from: a qualified gig's first attempt, or a
 *  drafted / in-review gig's revision. */
export const DISPATCHABLE_GIG_STATUSES: readonly GigStatus[] = ["qualified", "drafted", "in_review"];

/** Hire statuses under which the persona exists in Personas and may run. */
const RUNNABLE_AGENT_STATUSES: readonly AgentStatus[] = ["onboarding", "active"];

function isSuspect(gig: Gig): boolean {
  return gig.status === "suspect" || gig.suspectReasons.length > 0;
}

/** The specialist the gig is matched to (qualify.ts records it), else the arena's. */
function specialistFor(workspaceId: string, gig: Gig): GigSpecialist | null {
  const matched = gig.specialistId ? getGigSpecialist(workspaceId, gig.specialistId) : null;
  return matched ?? findGigSpecialistForArena(workspaceId, gig.arena, gig.niche);
}

/** The assignment kp hands Personas as `input_data`. Pure. */
export function buildGigAssignment(gig: Gig, attempt: GigAttempt, specialist: GigSpecialist): GigAssignment {
  const budget = boundedBudget(specialist.spec.budgetUsdPerAttempt);
  return {
    kind: "kp.gig.v1",
    gigId: gig.id,
    attemptId: attempt.id,
    arena: gig.arena,
    title: gig.title,
    url: gig.url,
    bodyUntrusted: gig.bodyText,
    reward: gig.reward,
    deadlineAt: gig.deadlineAt,
    recipes: specialist.spec.recipes.map((r) => ({ ...r })),
    checklist: gigChecklist(gig.arena),
    revisionNote: attempt.revisionNote,
    budgetUsd: budget !== null && budget > 0 ? budget : GIG_DEFAULT_BUDGET_USD[gig.arena],
    deliverableContract: GIG_DELIVERABLE_CONTRACT,
  };
}

export async function dispatchGigAttempt(
  workspaceId: string,
  gigId: string,
  opts: { revisionNote?: string | null } = {},
  deps: DispatchGigDeps = defaultDeps
): Promise<DispatchGigAttemptResult> {
  const gig = getGig(workspaceId, gigId);
  if (!gig) return { ok: false, code: "GIG_NOT_FOUND" };
  if (isSuspect(gig)) return { ok: false, code: "GIG_SUSPECT", detail: gig.suspectReasons.join(",") || undefined };
  if (!DISPATCHABLE_GIG_STATUSES.includes(gig.status)) return { ok: false, code: "GIG_NOT_DISPATCHABLE", detail: gig.status };

  const specialist = specialistFor(workspaceId, gig);
  if (!specialist) return { ok: false, code: "GIG_SPECIALIST_NOT_READY", detail: "no_specialist" };
  const agent = getHiredAgent(specialist.hiredAgentId, workspaceId);
  if (!agent || !agent.personaId || !RUNNABLE_AGENT_STATUSES.includes(agent.status)) {
    return { ok: false, code: "GIG_SPECIALIST_NOT_READY", detail: agent ? `hire_${agent.status}` : "no_hire" };
  }

  // Step 2 - the claim. A stale CAS means another dispatch (or the operator) moved it.
  const claimed = transitionGig(workspaceId, gigId, {
    from: DISPATCHABLE_GIG_STATUSES,
    to: "dispatched",
    patch: { specialistId: specialist.id },
  });
  if (!claimed.ok) return { ok: false, code: "GIG_NOT_DISPATCHABLE", detail: claimed.reason };

  const attempt = createGigAttempt(workspaceId, {
    gigId,
    specialistId: specialist.id,
    revisionNote: opts.revisionNote ?? null,
  });
  if (!attempt) {
    // The gig vanished between the claim and the insert (deleted in another tab).
    return { ok: false, code: "GIG_NOT_FOUND" };
  }

  const assignment = buildGigAssignment(claimed.gig, attempt, specialist);
  let sent: ExecutePersonaResult;
  try {
    sent = await deps.executePersona(agent.personaId, assignment);
  } catch {
    // The default transport never throws; an injected one might. Same outcome either way.
    sent = { ok: false, reason: "personas_unreachable" };
  }

  if (sent.ok) {
    const stamped = setGigAttemptExecutionId(workspaceId, attempt.id, sent.executionId);
    // A null stamp means the attempt moved while the POST was on the wire (discarded,
    // or failed by an interrupted-dispatch sweep). The execution id is still the truth
    // about what Personas accepted, so it is reported; the row is not overwritten.
    return { ok: true, gig: claimed.gig, attempt: stamped ?? attempt, executionId: sent.executionId };
  }

  const failed = transitionGigAttempt(workspaceId, attempt.id, {
    from: "dispatched",
    to: "failed",
    patch: { fallbackReason: sent.reason },
  });
  const reverted = transitionGig(workspaceId, gigId, { from: "dispatched", to: "qualified" });
  return {
    ok: false,
    code: "GIG_DISPATCH_FAILED",
    reason: sent.reason,
    attempt: failed.ok ? failed.attempt : attempt,
    gig: reverted.ok ? reverted.gig : getGig(workspaceId, gigId),
  };
}
