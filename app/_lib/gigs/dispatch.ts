import { boundedBudget } from "@/app/api/agents/dispatch/spec-bounds";
import { getHiredAgent } from "../db/agents";
import { getGig, transitionGig } from "../db/gigs";
import { createGigAttempt, setGigAttemptExecutionId, transitionGigAttempt } from "../db/gigs-attempts";
import { getGigSpecialist } from "../db/gigs-specialists";
import { gigChecklist } from "./checklists";
import { GIG_RUNNABLE_HIRE_STATUSES, pickGigMatch } from "./match";
import { executePersonaForGig, type ExecutePersonaResult } from "./personas-exec";
import { prepareGigProject, type PrepareGigProjectResult } from "./project";
import { rankGigSpecialists } from "./qualify";
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
//   1b. PREPARE the gig's workspace (project.ts: its folder, the arena's Personas workspace,
//      the project rooted at the folder) - network, so outside any transaction, and before
//      the claim so a refusal here leaves the gig exactly where it was. A Personas build
//      without the project route dispatches WITHOUT `_projectId` (the attempt records
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
// spliced into the persona's prompt (specialist.ts builds that from trusted parts).

export type DispatchGigRefusalCode =
  | "GIG_NOT_FOUND"
  | "GIG_SUSPECT"
  | "GIG_NOT_DISPATCHABLE"
  | "GIG_SPECIALIST_NOT_READY";

export type DispatchGigAttemptResult =
  | { ok: true; gig: Gig; attempt: GigAttempt; executionId: string }
  | { ok: false; code: DispatchGigRefusalCode; detail?: string }
  /** The workspace could not be prepared: `detail` is the reason code (workdir_* for the
   *  folder, personas_* for the project). Nothing was claimed or written but the folder. */
  | { ok: false; code: "GIG_WORKSPACE_FAILED"; detail: string }
  | { ok: false; code: "GIG_DISPATCH_FAILED"; reason: string; attempt: GigAttempt | null; gig: Gig | null };

export type DispatchGigDeps = {
  executePersona: (personaId: string, assignment: GigAssignment) => Promise<ExecutePersonaResult>;
  /** Required, not defaulted per call: a test that injects a transport must also say where
   *  the folder goes, or it would scaffold into the real gigs root. */
  prepareProject: (workspaceId: string, gigId: string) => Promise<PrepareGigProjectResult>;
};

const defaultDeps: DispatchGigDeps = {
  executePersona: executePersonaForGig,
  prepareProject: (workspaceId, gigId) => prepareGigProject(workspaceId, gigId),
};

/** Where the run executes: the folder always when prepared, the project only when linked. */
export type GigPlacement = { workdir: string; projectId: string | null };

/** The gig statuses a dispatch may start from: a qualified gig's first attempt, or a
 *  drafted / in-review gig's revision. */
export const DISPATCHABLE_GIG_STATUSES: readonly GigStatus[] = ["qualified", "drafted", "in_review"];

/** Hire statuses under which the persona exists in Personas and may run (match.ts owns the list). */
const RUNNABLE_AGENT_STATUSES = GIG_RUNNABLE_HIRE_STATUSES;

function isSuspect(gig: Gig): boolean {
  return gig.status === "suspect" || gig.suspectReasons.length > 0;
}

/** The specialist the gig is matched to (qualify.ts records it, a route overrides it),
 *  else the matcher's pick (match.ts): the best ready candidate, or - so the refusal can
 *  name the hire's state - the best-fitting one that is not ready yet. Null when nothing
 *  in the arena fits the gig at all. */
function specialistFor(workspaceId: string, gig: Gig): GigSpecialist | null {
  const matched = gig.specialistId ? getGigSpecialist(workspaceId, gig.specialistId) : null;
  if (matched) return matched;
  const ranked = rankGigSpecialists(workspaceId, gig);
  const pick = pickGigMatch(ranked) ?? ranked.find((m) => m.score > 0) ?? null;
  return pick ? getGigSpecialist(workspaceId, pick.specialistId) : null;
}

/** The assignment kp hands Personas as `input_data`. Pure. */
export function buildGigAssignment(gig: Gig, attempt: GigAttempt, specialist: GigSpecialist, place?: GigPlacement): GigAssignment {
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
    // Omitted, never null, when absent: Personas reads `_projectId` as "a string or not there".
    ...(place ? { workdir: place.workdir } : {}),
    ...(place?.projectId ? { _projectId: place.projectId } : {}),
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

  // Step 1b - the workspace. Outside any transaction; nothing claimed yet.
  let prepared: PrepareGigProjectResult;
  try {
    prepared = await deps.prepareProject(workspaceId, gigId);
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
  const place: GigPlacement = { workdir: prepared.workdir, projectId: link.linked ? link.projectId : null };

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
    // An older Personas without the project route: the run executes where Personas always
    // ran it, and the attempt says so.
    fallbackReason: link.linked ? null : link.reason,
  });
  if (!attempt) {
    // The gig vanished between the claim and the insert (deleted in another tab).
    return { ok: false, code: "GIG_NOT_FOUND" };
  }

  const assignment = buildGigAssignment(claimed.gig, attempt, specialist, place);
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
