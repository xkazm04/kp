import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fetchRequestStatus, type RequestStatusResult } from "../agent-hire/bridge-client";
import { lifecycleEventName, lifecycleTarget } from "../agent-hire/lifecycle";
import { ACTIVE_AGENT_STATUSES, getHiredAgent, transitionHiredAgent, type AgentStatus, type HiredAgentRecord } from "../db/agents";
import { getGig, transitionGig } from "../db/gigs";
import { listGigAttemptsByStatus, listGigAttemptsForGig, transitionGigAttempt } from "../db/gigs-attempts";
import { getAcceptedGigPlan } from "../db/gigs-plans";
import { listGigPersonaSpecialists, listGigSpecialists } from "../db/gigs-specialists";
import { GIG_DELIVERABLE_FILE } from "./contract";
import { parseGigDeliverable, validateGigDeliverable, type ParseGigDeliverableResult } from "./deliverable";
import { dispatchGigAttempt, type DispatchGigAttemptResult } from "./dispatch";
import type { RetirePersonaResult } from "./personas-places";
import { retireGigPersonaHire } from "./persona-retire";
import { fetchPersonaExecution, type FetchExecutionResult } from "./personas-exec";
import { syncGigPlanStatus, type GigPlanStatusDeps } from "./plan-status";
import { requestGigReport } from "./report/trigger";
import { gigTrackOf, type GigAttempt, type GigAttemptStatus, type GigStatus } from "./types";

// Pull the state of every in-flight attempt from Personas and land what finished - then
// walk the gig personas (hires, first runs, PLAN-STATUS, retirement; syncGigPersonas at the
// end of this file).
//
// For each attempt `dispatched | running` in the workspace, GET its execution and map
// the Personas status word (ExecutionState, personas core/src/types.rs) onto the attempt:
//
//   Personas status          attempt                              gig
//   ---------------------    -----------------------------------  -----------------------
//   queued / pending         unchanged (still `dispatched`)       unchanged
//   running                  dispatched -> running                unchanged
//   completed + deliverable  -> drafted (deliverable, cost)       dispatched -> drafted
//     (the output's block, else the gig folder's kp-deliverable.json - see THE DELIVERABLE FILE)
//   completed, no/bad block  -> failed (parse reason, cost)       dispatched -> qualified
//   incomplete + deliverable -> drafted (deliverable, cost)       dispatched -> drafted
//   incomplete, no block     -> failed `personas_incomplete`      dispatched -> qualified
//   failed                   -> failed `personas_failed`          dispatched -> qualified
//   cancelled                -> failed `personas_cancelled`       dispatched -> qualified
//   any other word           unchanged (counted `unknown`)        unchanged
//   GET 404                  -> failed `personas_execution_missing`  dispatched -> qualified
//   GET 403                  -> failed `personas_scope_missing`   dispatched -> qualified
//   unreachable / 401 / 5xx  unchanged (retried next sync)        unchanged
//
// `costUsd` is stored when Personas reported one, null otherwise (null = not reported,
// never "free"). Every write is a CAS through the WP1 helpers: an attempt the operator
// discarded while its run was finishing stays discarded (`stale` is counted, not forced).
//
// An attempt still `dispatched` with NO execution id is a dispatch whose POST never
// finished (a crash between the POST and the stamp). Past DISPATCH_INTERRUPTED_MS it is
// failed `dispatch_interrupted` so the gig returns to `qualified` instead of hanging.

export const DISPATCH_INTERRUPTED_MS = 10 * 60_000;

// THE DELIVERABLE FILE. A completed run whose output carries no valid `kp-deliverable`
// block is not failed yet: the specialist also writes the object to kp-deliverable.json at
// its gig folder's root (contract.ts has why - Personas can replace kp's prompt and append
// its own protocol after the model's last words). The file counts only when it is a
// regular file (never a link out of the folder), at most GIG_DELIVERABLE_FILE_MAX_BYTES,
// and modified AFTER this attempt was created - an earlier attempt's file is never landed
// as this one's draft. It goes through the same validator as a fenced block.
export const GIG_DELIVERABLE_FILE_MAX_BYTES = 512 * 1024;

/** The deliverable file's text, or null when there is none this attempt may use. */
export function readGigDeliverableFile(workdir: string, notBefore: string): string | null {
  const file = path.join(workdir, GIG_DELIVERABLE_FILE);
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > GIG_DELIVERABLE_FILE_MAX_BYTES) return null;
    const since = Date.parse(notBefore);
    if (Number.isFinite(since) && st.mtimeMs < since) return null;
    return readFileSync(file, "utf8");
  } catch {
    // absent or unreadable: the attempt fails on the output's own reason, exactly as before
    return null;
  }
}

/** The output's block first; else the gig folder's deliverable file. Pure given `readFile`. */
export function resolveGigDeliverable(
  outputData: string | null,
  workdir: string | null,
  notBefore: string,
  readFile: (workdir: string, notBefore: string) => string | null
): ParseGigDeliverableResult & { source?: "output" | "file" } {
  const fromOutput = parseGigDeliverable(outputData);
  if (fromOutput.ok) return { ...fromOutput, source: "output" };
  const text = workdir ? readFile(workdir, notBefore) : null;
  if (text === null) return fromOutput;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: "invalid_json", detail: `${GIG_DELIVERABLE_FILE}: ${e instanceof Error ? e.message.slice(0, 160) : "unparseable"}` };
  }
  const fromFile = validateGigDeliverable(value);
  return fromFile.ok ? { ...fromFile, source: "file" } : { ...fromFile, detail: `${GIG_DELIVERABLE_FILE}: ${fromFile.detail ?? ""}`.trim() };
}

export type GigSyncDeps = {
  fetchExecution: (executionId: string) => Promise<FetchExecutionResult>;
  /** The gig folder's deliverable file (default: readGigDeliverableFile). */
  readDeliverableFile?: (workdir: string, notBefore: string) => string | null;
  now?: () => Date;
  /** The persona steps (syncGigPersonas below); each defaults to the real transport. */
  fetchHireStatus?: (requestId: string) => Promise<RequestStatusResult>;
  dispatchPaired?: (workspaceId: string, gigId: string) => Promise<DispatchGigAttemptResult>;
  planStatus?: GigPlanStatusDeps;
  retirePersona?: (personaId: string) => Promise<RetirePersonaResult>;
};

export type GigSyncSummary = {
  checked: number;
  running: number;
  drafted: number;
  failed: number;
  unchanged: number;
  /** Personas answered a status word kp does not know. */
  unknown: number;
  /** Personas could not be asked (retried next sync). */
  unreachable: number;
  /** A write lost its CAS - the attempt or gig moved meanwhile. */
  stale: number;
  /** The gig personas' pass (hires, first runs, PLAN-STATUS, retirement). */
  personas: GigPersonaSyncSummary;
};

const defaultDeps: GigSyncDeps = { fetchExecution: fetchPersonaExecution };

type Landing =
  | { kind: "none" }
  | { kind: "running" }
  | { kind: "drafted"; outputData: string | null; costUsd: number | null }
  | { kind: "failed"; reason: string; costUsd: number | null };

/** The Personas status word -> what kp does with it. Pure; exported for the table test. */
export function landingFor(status: string, outputData: string | null, costUsd: number | null): Landing {
  switch (status.toLowerCase()) {
    case "queued":
    case "pending":
      return { kind: "none" };
    case "running":
      return { kind: "running" };
    case "completed":
      return { kind: "drafted", outputData, costUsd };
    case "incomplete":
      // A run cut short (turn or budget cap) may still have ended with its block; if it
      // did, the operator reviews it like any draft. If not, the reason is the cut.
      return parseGigDeliverable(outputData).ok
        ? { kind: "drafted", outputData, costUsd }
        : { kind: "failed", reason: "personas_incomplete", costUsd };
    case "failed":
      return { kind: "failed", reason: "personas_failed", costUsd };
    case "cancelled":
      return { kind: "failed", reason: "personas_cancelled", costUsd };
    default:
      return { kind: "none" };
  }
}

function failGig(workspaceId: string, gigId: string): boolean {
  return transitionGig(workspaceId, gigId, { from: "dispatched", to: "qualified" }).ok;
}

function failAttempt(workspaceId: string, attempt: GigAttempt, reason: string, costUsd: number | null, s: GigSyncSummary): void {
  const res = transitionGigAttempt(workspaceId, attempt.id, {
    from: ["dispatched", "running"],
    to: "failed",
    patch: { fallbackReason: reason, ...(costUsd !== null ? { costUsd } : {}) },
  });
  if (!res.ok) {
    s.stale += 1;
    return;
  }
  s.failed += 1;
  // The gig may already have moved on (withdrawn, a newer attempt): only a gig still
  // waiting on THIS dispatch goes back to qualified.
  failGig(workspaceId, attempt.gigId);
}

async function syncOne(workspaceId: string, attempt: GigAttempt, deps: GigSyncDeps, now: Date, s: GigSyncSummary): Promise<void> {
  if (!attempt.executionId) {
    const age = now.getTime() - Date.parse(attempt.createdAt);
    if (attempt.status === "dispatched" && Number.isFinite(age) && age > DISPATCH_INTERRUPTED_MS) {
      failAttempt(workspaceId, attempt, "dispatch_interrupted", null, s);
    } else s.unchanged += 1;
    return;
  }
  s.checked += 1;
  let fetched: FetchExecutionResult;
  try {
    fetched = await deps.fetchExecution(attempt.executionId);
  } catch {
    // The default transport never throws; an injected one might - treated as unreachable.
    fetched = { ok: false, reason: "personas_unreachable", retryable: true };
  }
  if (!fetched.ok) {
    if (fetched.retryable) {
      s.unreachable += 1;
      return;
    }
    failAttempt(workspaceId, attempt, fetched.reason, null, s);
    return;
  }
  const { status, outputData, costUsd } = fetched.execution;
  const landing = landingFor(status, outputData, costUsd);
  if (landing.kind === "none") {
    if (!["queued", "pending"].includes(status.toLowerCase())) s.unknown += 1;
    else s.unchanged += 1;
    return;
  }
  if (landing.kind === "running") {
    if (attempt.status === "running") {
      s.unchanged += 1;
      return;
    }
    const res = transitionGigAttempt(workspaceId, attempt.id, { from: "dispatched", to: "running" });
    if (res.ok) s.running += 1;
    else s.stale += 1;
    return;
  }
  if (landing.kind === "failed") {
    failAttempt(workspaceId, attempt, landing.reason, landing.costUsd, s);
    return;
  }
  const workdir = getGig(workspaceId, attempt.gigId)?.workdir ?? null;
  const parsed = resolveGigDeliverable(landing.outputData, workdir, attempt.createdAt, deps.readDeliverableFile ?? readGigDeliverableFile);
  if (!parsed.ok) {
    failAttempt(workspaceId, attempt, parsed.reason, landing.costUsd, s);
    return;
  }
  const res = transitionGigAttempt(workspaceId, attempt.id, {
    from: ["dispatched", "running"],
    to: "drafted",
    patch: { deliverable: parsed.deliverable, fallbackReason: null, costUsd: landing.costUsd },
  });
  if (!res.ok) {
    s.stale += 1;
    return;
  }
  s.drafted += 1;
  transitionGig(workspaceId, attempt.gigId, { from: "dispatched", to: "drafted" });
  // The gig's report (gigs/report/trigger.ts): best-effort, never part of the landing.
  requestGigReport(workspaceId, attempt.gigId, "drafted");
}

/** One sync pass over the workspace's in-flight attempts, oldest first, sequential (a
 *  local bridge, a handful of rows - and one slow GET must not fan out into many). */
export async function syncGigAttempts(workspaceId: string, deps: GigSyncDeps = defaultDeps): Promise<GigSyncSummary> {
  const s: GigSyncSummary = {
    checked: 0,
    running: 0,
    drafted: 0,
    failed: 0,
    unchanged: 0,
    unknown: 0,
    unreachable: 0,
    stale: 0,
    personas: emptyPersonaSummary(),
  };
  const now = deps.now ? deps.now() : new Date();
  for (const attempt of listGigAttemptsByStatus(workspaceId, ["dispatched", "running"])) {
    await syncOne(workspaceId, attempt, deps, now, s);
  }
  // After the attempts, so a gig whose last run just landed is judged on its new status.
  s.personas = await syncGigPersonas(workspaceId, deps);
  return s;
}

// ---------------------------------------------------------------------------
// The gig personas (gig-mastery S2, docs/features/gigs/README.md "Pairing"). After the
// attempts, each pass walks the workspace's personas, in four steps, each a no-op when
// there is nothing for it:
//
//   1. HIRES: a gig persona whose hire is still pending_approval | onboarding is polled
//      (GET /api/kp/persona-requests/{id}, the Agents tab's pull fallback) and moved through
//      the one lifecycle map (agent-hire/lifecycle.ts) - an auto-approved request lands here
//      on the next pass, a manually approved one when the operator approves it;
//   2. RUN: a paired gig (`qualified`, its specialist_id naming its persona, an accepted plan)
//      whose persona is now `active` and that it has never run is dispatched (dispatch.ts) -
//      this is the "202 pending" dispatch finishing. Once only: a failed first run returns
//      the gig to qualified WITH an attempt, and the operator decides the retry;
//   3. PLAN-STATUS: every gig with an active persona has its PLAN-STATUS.json read and the
//      changed goals mirrored to the Personas milestone (plan-status.ts);
//   4. RETIRE: a gig persona whose gig ended (accepted, rejected, declined, withdrawn,
//      expired - or is gone) is retired, and so is a NICHE specialist that no attempt in
//      dispatched | running | drafted | approved references any more: POST
//      /api/kp/personas/{id}/retire, then the hire -> `retired` (hired_agents, the same row
//      the hire status always lived on). A hire with no persona yet is retired in kp only.
//      A persona Personas no longer knows is retired in kp too; any other refusal (not
//      kp's, an older Personas without the route, unreachable) leaves it for a later pass.
// ---------------------------------------------------------------------------

/** Gig statuses after which the gig's persona is retired. */
export const GIG_TERMINAL_STATUSES: readonly GigStatus[] = ["accepted", "rejected", "declined", "withdrawn", "expired"];

/** Attempt statuses that keep a NICHE specialist alive (work it still owns). */
export const GIG_OPEN_ATTEMPT_STATUSES: readonly GigAttemptStatus[] = ["dispatched", "running", "drafted", "approved"];

const POLLED_HIRE_STATUSES: readonly AgentStatus[] = ["pending_approval", "onboarding"];

export type GigPersonaSyncSummary = {
  /** Pending gig-persona hires asked about. */
  hiresPolled: number;
  /** Of those, now active. */
  activated: number;
  /** Paired gigs run for the first time now that their persona is active. */
  executed: number;
  /** Paired gigs whose run was refused or failed (the gig keeps its state; see the attempt). */
  executeFailed: number;
  /** Plan goals whose reported status landed (Personas patched, or local-only). */
  planGoalsUpdated: number;
  retired: number;
  /** A retire Personas refused or could not be asked; retried next pass. */
  retireDeferred: number;
};

function emptyPersonaSummary(): GigPersonaSyncSummary {
  return { hiresPolled: 0, activated: 0, executed: 0, executeFailed: 0, planGoalsUpdated: 0, retired: 0, retireDeferred: 0 };
}

async function pollHire(workspaceId: string, agent: HiredAgentRecord, deps: GigSyncDeps, p: GigPersonaSyncSummary): Promise<void> {
  if (!agent.requestId || !POLLED_HIRE_STATUSES.includes(agent.status)) return;
  p.hiresPolled += 1;
  let polled: RequestStatusResult;
  try {
    polled = await (deps.fetchHireStatus ?? fetchRequestStatus)(agent.requestId);
  } catch {
    // The default transport never throws; an injected one might - asked again next pass.
    return;
  }
  if (!polled.ok) return;
  const signal = { kind: "poll" as const, status: polled.status };
  const mapped = lifecycleTarget(signal);
  if (!mapped || mapped === agent.status) return;
  // A CAS on the status read before the network call (the push report may have moved it).
  const t = transitionHiredAgent(
    agent.id,
    { from: agent.status, to: mapped, event: lifecycleEventName(signal), personaId: polled.personaId, personaName: polled.personaName },
    workspaceId
  );
  if (t.applied && mapped === "active") p.activated += 1;
}

async function retireOne(
  workspaceId: string,
  agent: HiredAgentRecord,
  reason: string,
  deps: GigSyncDeps,
  p: GigPersonaSyncSummary
): Promise<void> {
  if (await retireGigPersonaHire(workspaceId, agent, reason, deps.retirePersona)) p.retired += 1;
  else p.retireDeferred += 1;
}

/** The four persona steps above. Sequential (a local bridge, a handful of rows). */
export async function syncGigPersonas(workspaceId: string, deps: GigSyncDeps = defaultDeps): Promise<GigPersonaSyncSummary> {
  const p = emptyPersonaSummary();
  const personas = listGigPersonaSpecialists(workspaceId);

  // 1. hires
  for (const s of personas) {
    const agent = getHiredAgent(s.hiredAgentId, workspaceId);
    if (agent) await pollHire(workspaceId, agent, deps, p);
  }

  // 2. run a paired gig whose persona just became active
  for (const s of personas) {
    const agent = getHiredAgent(s.hiredAgentId, workspaceId);
    if (!agent || agent.status !== "active" || !agent.personaId || !s.gigId) continue;
    const gig = getGig(workspaceId, s.gigId);
    if (!gig || gig.status !== "qualified" || gig.specialistId !== s.id) continue;
    // A freelance bid is the proposal track: its persona (paired before the tracks split) is
    // never run - kp writes the gig a client proposal instead (gigs/proposal/run.ts).
    if (gigTrackOf(gig.arena) === "proposal") continue;
    if (!getAcceptedGigPlan(workspaceId, gig.id)) continue;
    if (listGigAttemptsForGig(workspaceId, gig.id).some((a) => a.specialistId === s.id)) continue;
    let res: DispatchGigAttemptResult;
    try {
      res = await (deps.dispatchPaired ?? ((ws: string, id: string) => dispatchGigAttempt(ws, id)))(workspaceId, gig.id);
    } catch {
      // The default never throws; an injected one might. The gig is left as it was.
      res = { ok: false, code: "GIG_NOT_DISPATCHABLE", detail: "threw" };
    }
    if (res.ok) p.executed += 1;
    else p.executeFailed += 1;
  }

  // 3. PLAN-STATUS
  for (const s of personas) {
    const agent = getHiredAgent(s.hiredAgentId, workspaceId);
    if (!agent || agent.status !== "active" || !s.gigId) continue;
    const gig = getGig(workspaceId, s.gigId);
    if (!gig?.workdir) continue;
    const out = await syncGigPlanStatus(workspaceId, gig.id, gig.workdir, deps.planStatus);
    if (out.kind === "updated") p.planGoalsUpdated += out.changed - out.failed;
  }

  // 4. retire - gig personas whose gig ended, then niche specialists with no open work
  for (const s of personas) {
    const agent = getHiredAgent(s.hiredAgentId, workspaceId);
    if (!agent || !ACTIVE_AGENT_STATUSES.includes(agent.status) || !s.gigId) continue;
    const gig = getGig(workspaceId, s.gigId);
    if (!gig) await retireOne(workspaceId, agent, "gig_missing", deps, p);
    else if (GIG_TERMINAL_STATUSES.includes(gig.status)) await retireOne(workspaceId, agent, `gig_${gig.status}`, deps, p);
  }
  const niche = listGigSpecialists(workspaceId).filter((s) => s.gigId === null);
  if (niche.length > 0) {
    const busy = new Set(listGigAttemptsByStatus(workspaceId, GIG_OPEN_ATTEMPT_STATUSES).map((a) => a.specialistId));
    for (const s of niche) {
      if (busy.has(s.id)) continue;
      const agent = getHiredAgent(s.hiredAgentId, workspaceId);
      if (agent && ACTIVE_AGENT_STATUSES.includes(agent.status)) await retireOne(workspaceId, agent, "niche_no_open_work", deps, p);
    }
  }
  return p;
}
