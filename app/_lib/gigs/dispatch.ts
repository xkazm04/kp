import { boundedBudget } from "@/app/api/agents/dispatch/spec-bounds";
import { getHiredAgent } from "../db/agents";
import { getGig, transitionGig } from "../db/gigs";
import { createGigAttempt, listGigAttemptsForGig, setGigAttemptExecutionId, transitionGigAttempt } from "../db/gigs-attempts";
import { getAcceptedGigPlan } from "../db/gigs-plans";
import { getGigSpecialist } from "../db/gigs-specialists";
import { gigChecklist } from "./checklists";
import { checkGigStillOpen, type GigStillOpenResult } from "./freshness";
import { GIG_RUNNABLE_HIRE_STATUSES, pickGigMatch } from "./match";
import { GIG_PAIRABLE_STATUSES, pairGig, type PairGigResult } from "./pairing";
import { executePersonaForGig, type ExecutePersonaResult } from "./personas-exec";
import { buildGigPlanAssignment, type GigPairedAssignment, type GigPlanAssignment } from "./plan-status";
import { prepareGigProject, type PrepareGigProjectResult } from "./project";
import { rankGigSpecialists } from "./qualify";
import { GIG_PERSONA_MAX_BUDGET_USD } from "./plan-seats";
import { GIG_DEFAULT_BUDGET_USD } from "./specialist-defaults";
import { clearGigDeliverableOutputs } from "./workdir";
import {
  GIG_DELIVERABLE_CONTRACT,
  type Gig,
  type GigAssignment,
  type GigAttempt,
  type GigSpecialist,
  type GigStatus,
} from "./types";

// Dispatch one gig attempt to a Personas persona.
//
// WHICH PERSONA (gig-mastery S2, docs/features/gigs/README.md "Pairing"):
//   - a gig with an operator-ACCEPTED plan goes to its OWN persona: pairing.ts pairs it
//     (folder + project in the type's workspace, the plan as a milestone, the persona hired
//     or reused). A persona Personas has not approved yet answers GIG_SPECIALIST_NOT_READY
//     `pairing_pending` (the route's 202) and nothing is claimed - the sync runs the gig once the hire is active.
//     The assignment then carries `plan` (steps with their goal ids, the operator's note and
//     the PLAN-STATUS contract, plan-status.ts);
//   - a gig with NO accepted plan is refused GIG_PLAN_NOT_ACCEPTED - unless it was already
//     worked by a niche specialist (it has attempts), which keeps working exactly as before
//     (the LEGACY path below, its specialist found as it always was).
//
// ORDER, and why it is not "create, POST, then move the gig":
//   1. cheap refusals (not found, suspect, not dispatchable, no plan, specialist not ready) -
//      nothing written;
//   1b. PREPARE the gig's workspace (the pairing does it for a paired gig; project.ts for a
//      legacy one) - network, so outside any transaction, and before the claim so a refusal
//      here leaves the gig exactly where it was. On the legacy path a Personas build without
//      the project route dispatches WITHOUT `_projectId` (the attempt records
//      `personas_route_missing`); any other failure refuses with GIG_WORKSPACE_FAILED;
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
// spliced into the persona's requirements (specialist.ts builds those from trusted parts).

export type DispatchGigRefusalCode =
  | "GIG_NOT_FOUND"
  | "GIG_SUSPECT"
  | "GIG_NOT_DISPATCHABLE"
  | "GIG_SPECIALIST_NOT_READY"
  | "GIG_PLAN_NOT_ACCEPTED"
  /** The source says the listing no longer takes proposals (`detail` = awarded / frozen /
   *  closed / gone). A waiting gig was expired on the same answer; nothing was dispatched. */
  | "GIG_SOURCE_CLOSED";

/** `GIG_SPECIALIST_NOT_READY` details the pairing adds (the route turns the first into a 202). */
export const GIG_PAIRING_PENDING_DETAIL = "pairing_pending";
export const GIG_PAIRING_HIRE_FAILED_DETAIL = "hire_failed";

export type DispatchGigAttemptResult =
  | { ok: true; gig: Gig; attempt: GigAttempt; executionId: string }
  /** `GIG_SPECIALIST_NOT_READY` with `detail: "pairing_pending"` + `specialistId`: paired, but
   *  the gig's persona still waits on Personas - nothing was claimed, and the sync dispatches
   *  the gig once the hire is active. With `detail: "hire_failed"` + `hireCode` (the hire
   *  tail's code) + `status`: the gig persona's hire did not go out. */
  | { ok: false; code: DispatchGigRefusalCode; detail?: string; specialistId?: string; hireCode?: string; status?: number }
  /** The workspace could not be prepared: `detail` is the reason code (workdir_* for the
   *  folder, personas_* for the project). Nothing was claimed or written but the folder. */
  | { ok: false; code: "GIG_WORKSPACE_FAILED"; detail: string }
  | { ok: false; code: "GIG_DISPATCH_FAILED"; reason: string; attempt: GigAttempt | null; gig: Gig | null };

export type DispatchGigDeps = {
  executePersona: (personaId: string, assignment: GigAssignment) => Promise<ExecutePersonaResult>;
  /** Required, not defaulted per call: a test that injects a transport must also say where
   *  the folder goes, or it would scaffold into the real gigs root. Used by the LEGACY path
   *  (a gig worked by a niche specialist); a paired gig is prepared by `pair`. */
  prepareProject: (workspaceId: string, gigId: string) => Promise<PrepareGigProjectResult>;
  /** Clear a qualified gig's folder before a fresh run so a retry does not inherit a prior
   *  attempt's deliverable (which makes the run treat the work as done). Optional: defaults to
   *  `clearGigDeliverableOutputs`, which no-ops on a folder that is not on disk (a test's
   *  injected placement), so a test need not supply it. */
  resetDeliverable?: (workdir: string) => void;
  /** Pair a gig that has an accepted plan (default pairing.ts pairGig). */
  pair?: (workspaceId: string, gigId: string) => Promise<PairGigResult>;
  /** Ask the source whether the listing still takes proposals (gigs/freshness.ts). Only the
   *  default deps carry it: injected deps without it skip the check, so no test reaches the
   *  network. A source that cannot answer never blocks the dispatch. */
  checkSource?: (workspaceId: string, gig: Gig) => Promise<GigStillOpenResult>;
};

const defaultDeps: DispatchGigDeps = {
  executePersona: executePersonaForGig,
  prepareProject: (workspaceId, gigId) => prepareGigProject(workspaceId, gigId),
  resetDeliverable: clearGigDeliverableOutputs,
  pair: (workspaceId, gigId) => pairGig(workspaceId, gigId),
  checkSource: (workspaceId, gig) => checkGigStillOpen(workspaceId, gig),
};

/** Where the run executes: the folder always when prepared, the project only when linked. */
export type GigPlacement = { workdir: string; projectId: string | null };

/** The gig statuses a dispatch may start from: a qualified gig's first attempt, or a
 *  drafted / in-review gig's revision (the same list pairing.ts pairs in). */
export const DISPATCHABLE_GIG_STATUSES: readonly GigStatus[] = GIG_PAIRABLE_STATUSES;

/** Hire statuses under which the persona exists in Personas and may run (match.ts owns the list). */
const RUNNABLE_AGENT_STATUSES = GIG_RUNNABLE_HIRE_STATUSES;

function isSuspect(gig: Gig): boolean {
  return gig.status === "suspect" || gig.suspectReasons.length > 0;
}

/** LEGACY: the niche specialist the gig is matched to (a route or an earlier attempt set
 *  it), else the matcher's pick (match.ts): the best ready candidate, or - so the refusal
 *  can name the hire's state - the best-fitting one that is not ready yet. Null when nothing
 *  in the arena fits the gig at all. */
function specialistFor(workspaceId: string, gig: Gig): GigSpecialist | null {
  const matched = gig.specialistId ? getGigSpecialist(workspaceId, gig.specialistId) : null;
  if (matched) return matched;
  const ranked = rankGigSpecialists(workspaceId, gig);
  const pick = pickGigMatch(ranked) ?? ranked.find((m) => m.score > 0) ?? null;
  return pick ? getGigSpecialist(workspaceId, pick.specialistId) : null;
}

/** The assignment kp hands Personas as `input_data`. Pure. A paired gig's carries `plan`. */
export function buildGigAssignment(
  gig: Gig,
  attempt: GigAttempt,
  specialist: GigSpecialist,
  place?: GigPlacement,
  plan?: GigPlanAssignment | null
): GigAssignment | GigPairedAssignment {
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
    // A gig persona (a paired run) runs at the gig persona cap - uncapped today; a niche
    // specialist keeps its arena budget.
    budgetUsd: plan ? GIG_PERSONA_MAX_BUDGET_USD : budget !== null && budget > 0 ? budget : GIG_DEFAULT_BUDGET_USD[gig.arena],
    deliverableContract: GIG_DELIVERABLE_CONTRACT,
    // Omitted, never null, when absent: Personas reads `_projectId` as "a string or not there".
    ...(place ? { workdir: place.workdir } : {}),
    ...(place?.projectId ? { _projectId: place.projectId } : {}),
    ...(plan ? { plan } : {}),
  };
}

type Target = {
  specialist: GigSpecialist;
  personaId: string;
  place: GigPlacement;
  /** Recorded on the attempt (an older Personas without the project route). */
  fallbackReason: string | null;
  plan: GigPlanAssignment | null;
};

type Resolved = { ok: true; target: Target } | Exclude<DispatchGigAttemptResult, { ok: true }>;

/** A gig with an accepted plan: pair it, and run it only when its persona is active. */
async function pairedTarget(workspaceId: string, gigId: string, deps: DispatchGigDeps): Promise<Resolved> {
  let paired: PairGigResult;
  try {
    paired = await (deps.pair ?? defaultDeps.pair!)(workspaceId, gigId);
  } catch {
    // The default never throws (every step answers a code); an injected one might.
    paired = { ok: false, code: "GIG_WORKSPACE_FAILED", detail: "personas_unreachable" };
  }
  if (!paired.ok) {
    if (paired.code === "GIG_PAIRING_HIRE_FAILED") {
      return { ok: false, code: "GIG_SPECIALIST_NOT_READY", detail: GIG_PAIRING_HIRE_FAILED_DETAIL, hireCode: paired.hireCode, status: paired.status };
    }
    if (paired.code === "GIG_WORKSPACE_FAILED") return { ok: false, code: "GIG_WORKSPACE_FAILED", detail: paired.detail };
    if (paired.code === "GIG_SUSPECT" || paired.code === "GIG_NOT_DISPATCHABLE") return { ok: false, code: paired.code, detail: paired.detail };
    return { ok: false, code: paired.code };
  }
  if (paired.state === "pending" || !paired.personaId) {
    return { ok: false, code: "GIG_SPECIALIST_NOT_READY", detail: GIG_PAIRING_PENDING_DETAIL, specialistId: paired.specialist.id };
  }
  return {
    ok: true,
    target: {
      specialist: paired.specialist,
      personaId: paired.personaId,
      place: { workdir: paired.workdir, projectId: paired.projectId },
      fallbackReason: null,
      plan: buildGigPlanAssignment(paired.plan),
    },
  };
}

/** LEGACY: a gig a niche specialist already worked (and no plan was accepted since). */
async function legacyTarget(workspaceId: string, gig: Gig, deps: DispatchGigDeps): Promise<Resolved> {
  const specialist = specialistFor(workspaceId, gig);
  const agent = specialist ? getHiredAgent(specialist.hiredAgentId, workspaceId) : null;
  // The niche specialist is gone or retired (the sync retires them once their open work
  // closes): the way forward is the gig's own persona, which starts from an accepted plan.
  if (!specialist || !agent || agent.status === "retired") return { ok: false, code: "GIG_PLAN_NOT_ACCEPTED" };
  if (!agent.personaId || !RUNNABLE_AGENT_STATUSES.includes(agent.status)) {
    return { ok: false, code: "GIG_SPECIALIST_NOT_READY", detail: agent ? `hire_${agent.status}` : "no_hire" };
  }
  let prepared: PrepareGigProjectResult;
  try {
    prepared = await deps.prepareProject(workspaceId, gig.id);
  } catch {
    // The default never throws (its fs errors are reason codes); an injected one might.
    prepared = { ok: false, code: "GIG_WORKSPACE_FAILED", reason: "workdir_io_error" };
  }
  if (!prepared.ok) {
    if (prepared.code === "GIG_NOT_FOUND") return { ok: false, code: "GIG_NOT_FOUND" };
    return { ok: false, code: "GIG_WORKSPACE_FAILED", detail: prepared.reason };
  }
  const link = prepared.personas;
  if (!link.linked && link.reason !== "personas_route_missing") {
    return { ok: false, code: "GIG_WORKSPACE_FAILED", detail: link.reason };
  }
  return {
    ok: true,
    target: {
      specialist,
      personaId: agent.personaId,
      place: { workdir: prepared.workdir, projectId: link.linked ? link.projectId : null },
      // An older Personas without the project route: the run executes where Personas always
      // ran it, and the attempt says so.
      fallbackReason: link.linked ? null : link.reason,
      plan: null,
    },
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

  // Is the listing still open? A run on an awarded, frozen or deleted project is a wasted run
  // (the training cycle drafted several). One read, skipped while the last answer is fresh; a
  // source that cannot answer does not block the dispatch. A waiting gig is expired on a
  // closed answer (freshness.ts); a drafted or in-review one keeps its status for the operator.
  if (deps.checkSource) {
    const fresh = await deps.checkSource(workspaceId, gig);
    if (fresh.state && fresh.state.state !== "open") return { ok: false, code: "GIG_SOURCE_CLOSED", detail: fresh.state.state };
  }

  // Which persona: the gig's own when a plan is accepted, the niche specialist for a gig one
  // already worked, else nothing until the operator accepts a plan.
  let resolved: Resolved;
  if (getAcceptedGigPlan(workspaceId, gigId)) resolved = await pairedTarget(workspaceId, gigId, deps);
  else if (listGigAttemptsForGig(workspaceId, gigId).length > 0) resolved = await legacyTarget(workspaceId, gig, deps);
  else return { ok: false, code: "GIG_PLAN_NOT_ACCEPTED" };
  if (!resolved.ok) return resolved;
  const { specialist, personaId, place, fallbackReason, plan } = resolved.target;

  // A qualified gig's dispatch (a first attempt, or a failed-retry after the gig reset to
  // qualified) runs from a CLEAN folder: a run that finds a prior kp-deliverable.json and a filled
  // NOTES.md treats the work as done and emits no new block, so sync fails it no_deliverable_block
  // (confirmed 2026-09-27). A drafted / in-review REVISION keeps its prior work as a base, so it is
  // never cleared. Best-effort - a clear that cannot run must not block the dispatch. Re-read: the
  // pairing awaited the network, and the claim below is what decides.
  const now = getGig(workspaceId, gigId) ?? gig;
  if (now.status === "qualified") {
    try {
      (deps.resetDeliverable ?? clearGigDeliverableOutputs)(place.workdir);
    } catch {
      // best-effort: stale state may make the run no-op, but a clear failure never blocks dispatch.
    }
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
    fallbackReason,
  });
  if (!attempt) {
    // The gig vanished between the claim and the insert (deleted in another tab).
    return { ok: false, code: "GIG_NOT_FOUND" };
  }

  const assignment = buildGigAssignment(claimed.gig, attempt, specialist, place, plan);
  let sent: ExecutePersonaResult;
  try {
    sent = await deps.executePersona(personaId, assignment);
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
