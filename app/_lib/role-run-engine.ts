import { createHash } from "node:crypto";
import {
  RoleRunTransitionError,
  isLegalRoleRunTransition,
  nextStageFor,
  replayRoleRunChain,
  stageIsGated,
  stageStateOf,
  type CaseAssignmentPayload,
  type InterviewPayload,
  type OfferDraftPayload,
  type RoleRunNextStage,
  type RoleRunStageKind,
  type RoleRunStageStatus,
  type RoleSpecPayload,
  type ScorecardPayload,
  type ScreenPayload,
  type SlatePayload,
} from "./role-run-stages.ts";
import { GATE_STAGE, commitRoleRunGate, type RoleRunGate } from "./role-run-gates.ts";
import {
  appendStageArtifact,
  getRoleRun,
  latestBranchArtifact,
  latestStageArtifact,
  listStageArtifacts,
  setRoleRunStatus,
  type RoleRun,
  type RoleRunStageArtifact,
} from "./db/role-runs.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { getJob } from "./db/jobs.ts";
import { listEntriesForJob } from "./db/pipeline.ts";
import { resolveOfferTtlDays } from "./offer-policy.ts";

// The engine that walks a role run from JD to offer draft (ADR-0011 §1 and §4).
//
// It is NOT an orchestrator that calls seven functions in order. It is a function that
// reads the ledger, works out what each branch is owed NEXT, produces at most one
// artifact per branch, and returns. Calling it again resumes — which is why a crash, a
// restart, the 20-minute pass ceiling and a candidate who answers on Thursday need no
// separate handling: they are all "the last call ended, call it again".
//
// PER-CANDIDATE FAN-OUT (§4). S0 (role spec) and S1 (slate) are run-wide. From S2 every
// artifact belongs to one candidate branch. A branch parked at a gate holds that branch
// only; the other nineteen keep moving. A per-stage barrier would let one unreviewed
// rejection stop a slate of twenty, and that barrier is the reason this is a ledger.

export type StageContext = {
  run: RoleRun;
  kind: RoleRunStageKind;
  /** The candidate this stage is for; null on the run-wide stages S0/S1. */
  branchRef: string | null;
  /** The artifact this stage CONSUMES — the previous stage's output for this branch
   *  (or, for the first per-candidate stage, the run-wide slate). Never in-memory state
   *  handed down from the previous call: a stage reads the ledger, full stop. */
  previous: RoleRunStageArtifact | null;
  workspaceId: string;
  now: number;
};

export type StageOutcome = { status: RoleRunStageStatus; payload: unknown };
export type StageRunner = (ctx: StageContext) => StageOutcome | Promise<StageOutcome>;
export type StageRunners = Record<RoleRunStageKind, StageRunner>;

// --- THE DEFAULT RUNNERS -----------------------------------------------------
//
// Every default runner below is KEYLESS and DETERMINISTIC: it reads rows that already
// exist (jobs, pipeline_entries) and writes references to them. That is a deliberate
// floor, not a placeholder — the two-minute keyless start is a project boundary, so the
// run's SEQUENCING must be demonstrable and testable with no provider configured, and
// the LLM/Python engines (jd-build-run, automation-pass, devcase-orchestrator,
// interview-scorecard) are attached per stage in their own increments by passing a
// different runner for that one kind. The registry is the seam that makes those
// increments independent of each other.
//
// A runner never writes PII: appendStageArtifact enforces ADR-0011 §5 at the write door
// and will throw if one tries.

function hashOf(...parts: (string | number | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 32);
}

/** S0 — JD ingest. Reads the ingested job and records WHAT ROLE this run is for, as a
 *  hash plus the rubric keys the later stages must grade against. `lintFindings` is the
 *  honest record of what the JD does not say: a role with no requirements produces a
 *  rubric with no keys, and every downstream score would otherwise claim a rigour the
 *  source never had. */
const runRoleSpec: StageRunner = (ctx) => {
  const job = getJob(ctx.run.jobId);
  if (!job) {
    // Terminal for the whole run: there is no role to hire for. Recorded as an artifact
    // rather than thrown, because "this run stopped, and here is why" is exactly what
    // the ledger is for.
    return { status: "terminal", payload: { jobId: ctx.run.jobId, roleSpecHash: "", rubricVersion: "0", rubricKeys: [], lintFindings: ["job_not_found"] } satisfies RoleSpecPayload };
  }
  const requirements = Array.isArray(job.requirements) ? job.requirements : [];
  // The rubric keys ARE the job's graded requirements, slugged. Derived from the role
  // rather than from a per-candidate prompt on purpose: the repo already carries one
  // hard-won lesson about unreconciled score producers, and a rubric re-derived per
  // candidate is the same defect one level up.
  const rubricKeys = requirements
    .map((r) => r?.skill)
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim().toLowerCase().replace(/\s+/g, "_"))
    .slice(0, 40);
  const lintFindings: string[] = [];
  if (rubricKeys.length === 0) lintFindings.push("no_graded_requirements");
  if (!job.title?.trim()) lintFindings.push("no_title");

  return {
    status: "complete",
    payload: {
      jobId: ctx.run.jobId,
      roleSpecHash: hashOf(ctx.run.jobId, job.title, rubricKeys.join(",")),
      rubricVersion: "1",
      rubricKeys,
      lintFindings,
    } satisfies RoleSpecPayload,
  };
};

/** The board cap on one slate. The ADR names cost-per-run as unbounded by construction
 *  (S1 fan-out × S2 cost) and calls a ceiling a prerequisite rather than a follow-up.
 *  This is that ceiling, and `truncated` is how the slate says it was applied — a slate
 *  silently cut at twenty reads as "twenty candidates existed". */
export const SLATE_CAP = 20;

/** S1 — sourcing. The slate is the run's branch list, so this is the one stage whose
 *  output decides the SHAPE of everything after it. */
const runSlate: StageRunner = (ctx) => {
  const entries = listEntriesForJob(ctx.run.jobId, ctx.workspaceId);
  const kept = entries.slice(0, SLATE_CAP);
  return {
    status: "complete",
    payload: {
      candidates: kept.map((e) => ({
        candidateRef: e.id,
        // The board records HOW someone arrived in sourceChannel; anything else on the
        // board was put there by a recruiter or by Match, which is the "pool" origin.
        origin: (e.sourceChannel ? "inbound" : "pool") as SlatePayload["candidates"][number]["origin"],
      })),
      truncated: entries.length > kept.length,
    } satisfies SlatePayload,
  };
};

/** The floor a match score must clear to be proposed for advancement. Deliberately the
 *  only number in this module that decides a person's route, and deliberately NOT a
 *  rejection: a low score routes to `hold`, never to `reject_proposed`, because the
 *  repo's fairness gate already establishes that an automated screen must not
 *  auto-reject. `reject_proposed` is reachable only from an explicit board status. */
export const SCREEN_ADVANCE_FLOOR = 60;

/** S2 — screening. Produces a PROPOSAL and parks: the rejection gate. Even a slate with
 *  nothing to reject parks, because "the policy proposes to reject nobody" is still a
 *  decision a human is accountable for under Art. 22 — and a gate that silently
 *  self-clears when the set is empty is a gate whose absence nobody would notice. */
const runScreen: StageRunner = (ctx) => {
  const entryId = ctx.branchRef ?? "";
  const entry = listEntriesForJob(ctx.run.jobId, ctx.workspaceId).find((e) => e.id === entryId) ?? null;
  const score = entry?.matchScore ?? null;
  const withdrawn = entry === null || entry.status === "rejected" || entry.status === "withdrawn";
  const route: ScreenPayload["decisions"][number]["route"] = withdrawn
    ? "reject_proposed"
    : score !== null && score >= SCREEN_ADVANCE_FLOOR
      ? "advance"
      : "hold";
  return {
    status: "awaiting_approval",
    payload: {
      decisions: [
        {
          entryId,
          route,
          matchScore: score,
          reasonCode: withdrawn ? "not_active" : route === "advance" ? "score_above_floor" : "score_below_floor",
          reasonParams: { floor: SCREEN_ADVANCE_FLOOR, score: score ?? -1 },
        },
      ],
      policyVersion: `screen-1@${SCREEN_ADVANCE_FLOOR}`,
      fairnessAlerts: [],
    } satisfies ScreenPayload,
  };
};

/** The default work-sample timebox, in minutes. */
export const CASE_TIMEBOX_MINUTES = 90;

/** S3 — case assignment. Unattended: designing and assigning a work sample is not a
 *  decision the candidate feels as a verdict. `devcaseId` is null until the dev-case
 *  increment attaches the real orchestrator; the seed is recorded either way so the
 *  case a candidate got is reproducible. */
const runCaseAssignment: StageRunner = (ctx) => ({
  status: "complete",
  payload: {
    assignments: [
      {
        entryId: ctx.branchRef ?? "",
        devcaseId: null,
        timeboxMinutes: CASE_TIMEBOX_MINUTES,
        seedRef: hashOf(ctx.run.id, ctx.branchRef, "case"),
      },
    ],
    caseDesignHash: hashOf(ctx.run.jobId, "case-design-1"),
  } satisfies CaseAssignmentPayload,
});

/** S4 — interview. Drafts the invite and parks: the invite gate. The token is NOT minted
 *  here — `createScheduleInvite` is called by the gate commit, the same asymmetry the
 *  offer stage has. An invite token that exists before a human approved it is an invite
 *  that can leak before it was authorised. */
const runInterview: StageRunner = (ctx) => ({
  status: "awaiting_approval",
  payload: {
    invites: [{ entryId: ctx.branchRef ?? "", inviteRef: null, status: "drafted", slotAt: null, rescheduleCount: 0 }],
  } satisfies InterviewPayload,
});

/** S5 — scorecard. Unattended by decision of ADR-0011: a fourth gate here would turn the
 *  run from "three pauses" into "a supervised pipeline", and the operator accepted the
 *  three-gate list as written on 2026-09-14. The recruiter can still raise a
 *  `scorecard_review` as their OWN escalation; the run does not wait on it. */
const runScorecard: StageRunner = (ctx) => {
  const spec = latestStageArtifact(ctx.run.id, "role_spec", null, ctx.workspaceId);
  const rubric = (spec?.payload as RoleSpecPayload | undefined) ?? null;
  return {
    status: "complete",
    payload: {
      cards: [
        {
          entryId: ctx.branchRef ?? "",
          sessionId: null,
          // "unrated" is the honest verdict with no interview session attached. A
          // default of "hire" or "no_hire" would be a fabricated assessment sealed into
          // an immutable chain — the exact class ADR-0008 forbids.
          recommendation: "unrated",
          rubricVersion: rubric?.rubricVersion ?? "1",
          rubricKeys: rubric?.rubricKeys ?? [],
          source: "ai",
        },
      ],
    } satisfies ScorecardPayload,
  };
};

/** S6 — offer draft. Drafts terms and STOPS. `createOffer` is never called by the run;
 *  it is called by the gate commit (ADR-0011 Consequences). The band is a reference to
 *  the job's own posted range, not a number this stage invents. */
const runOfferDraft: StageRunner = (ctx) => {
  const ttlDays = resolveOfferTtlDays(null);
  return {
    status: "awaiting_approval",
    payload: {
      drafts: [
        {
          entryId: ctx.branchRef ?? "",
          terms: { band: "job_posted_range", currency: "EUR", ttlDays },
          ttlDays,
          rationaleRef: hashOf(ctx.run.id, ctx.branchRef, "offer-rationale"),
        },
      ],
    } satisfies OfferDraftPayload,
  };
};

export const DEFAULT_STAGE_RUNNERS: StageRunners = {
  role_spec: runRoleSpec,
  slate: runSlate,
  screen: runScreen,
  case_assignment: runCaseAssignment,
  interview: runInterview,
  scorecard: runScorecard,
  offer_draft: runOfferDraft,
};

// --- THE PASS ----------------------------------------------------------------

export type AdvanceOptions = {
  runners?: Partial<StageRunners>;
  /** Ceiling on artifacts produced in ONE call. The pass ends cleanly at the ceiling
   *  and the next call picks up exactly where it stopped, which is what keeps a slate of
   *  twenty inside the 20-minute execution ceiling instead of being killed mid-stage. */
  maxStages?: number;
  now?: number;
};

export type AdvanceResult = {
  runId: string;
  status: RoleRun["status"];
  /** What this pass produced, in order. */
  produced: { kind: RoleRunStageKind; branchRef: string | null; status: RoleRunStageStatus }[];
  /** Branches parked on a human, with the gate they are parked at. */
  awaiting: { branchRef: string; gate: RoleRunGate }[];
  /** True when the pass stopped on maxStages rather than because nothing was runnable. */
  ceilingHit: boolean;
};

function gateForStage(kind: RoleRunStageKind): RoleRunGate | null {
  const found = (Object.keys(GATE_STAGE) as RoleRunGate[]).find((g) => GATE_STAGE[g] === kind);
  return found ?? null;
}

/** The candidate branches of a run, read from the slate. Empty until S1 has run. */
function branchesOf(run: RoleRun, workspaceId: string): string[] {
  const slate = latestStageArtifact(run.id, "slate", null, workspaceId);
  if (!slate || slate.status !== "complete") return [];
  const payload = slate.payload as SlatePayload | undefined;
  return (payload?.candidates ?? []).map((c) => c.candidateRef).filter(Boolean);
}

/** What a chain is owed next — `branchRef` null for the run-wide chain. The resume rule
 *  itself is nextStageFor in role-run-stages.ts, a pure read over the artifact rows;
 *  this only hands it the ledger. No bookkeeping column, no in-memory cursor. */
function resumeRead(run: RoleRun, branchRef: string | null, workspaceId: string): RoleRunNextStage {
  return nextStageFor(listStageArtifacts(run.id, workspaceId), branchRef);
}

/** Advance a run by up to `maxStages` artifacts and return. Idempotent in the sense that
 *  matters: calling it on a run whose every branch is parked produces nothing and
 *  changes nothing. */
export async function advanceRoleRun(
  runId: string,
  opts: AdvanceOptions = {},
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<AdvanceResult> {
  const run = getRoleRun(runId, workspaceId);
  if (!run) throw new Error(`role run ${runId} does not exist in this workspace`);

  const runners: StageRunners = { ...DEFAULT_STAGE_RUNNERS, ...(opts.runners ?? {}) };
  const maxStages = Math.max(1, opts.maxStages ?? 200);
  const now = opts.now ?? Date.now();
  const produced: AdvanceResult["produced"] = [];
  let ceilingHit = false;

  const runStage = async (kind: RoleRunStageKind, branchRef: string | null, previous: RoleRunStageArtifact | null) => {
    const outcome = await runners[kind]({ run, kind, branchRef, previous, workspaceId, now });
    // The runner seam is where the richer engines attach, so it is also where a gate
    // could be skipped: a screen runner that returns `complete` has rejected nobody and
    // advanced everybody without a human. The transition table is checked against the
    // chain as it stands NOW (re-read, not remembered) and a forbidden row is never
    // written.
    const { head } = replayRoleRunChain(listStageArtifacts(run.id, workspaceId), branchRef);
    const state = stageStateOf({ kind, status: outcome.status });
    if (!isLegalRoleRunTransition(head, state)) throw new RoleRunTransitionError(head, state, branchRef);
    const artifact = appendStageArtifact(
      { runId: run.id, kind, branchRef, status: outcome.status, payload: outcome.payload },
      workspaceId
    );
    produced.push({ kind, branchRef, status: artifact.status });
    return artifact;
  };

  const cancelled = (): AdvanceResult => {
    // A terminal run-wide artifact (no job, for instance) ends the run: there are no
    // branches to fan out to, and re-running S0 every pass would just re-fail.
    setRoleRunStatus(run.id, "cancelled", workspaceId);
    return { runId: run.id, status: "cancelled", produced, awaiting: [], ceilingHit };
  };

  if (run.status === "running") {
    // --- run-wide stages, in order, at most once each -------------------------
    for (let next = resumeRead(run, null, workspaceId); ; next = resumeRead(run, null, workspaceId)) {
      if (next.action === "done" && next.reason === "run_terminal") return cancelled();
      if (next.action !== "produce") break;
      if (produced.length >= maxStages) {
        ceilingHit = true;
        break;
      }
      const previous = next.kind === "slate" ? latestStageArtifact(run.id, "role_spec", null, workspaceId) : null;
      await runStage(next.kind, null, previous);
    }

    // --- per-candidate branches ----------------------------------------------
    //
    // ROUND-ROBIN, not branch-by-branch: one pass gives every branch its next stage
    // before giving any branch a second one. A depth-first walk would spend a whole
    // pass carrying candidate #1 to the offer gate while #2..#20 sat at S2, which is
    // the per-stage barrier this design exists to avoid, just rotated ninety degrees.
    const branches = branchesOf(run, workspaceId);
    let movedThisRound = true;
    while (movedThisRound && produced.length < maxStages) {
      movedThisRound = false;
      for (const branchRef of branches) {
        if (produced.length >= maxStages) {
          ceilingHit = true;
          break;
        }
        const next = resumeRead(run, branchRef, workspaceId);
        // Parked, over, or a chain whose rows cannot be true: this pass does not touch it.
        if (next.action !== "produce") continue;
        const previous = latestBranchArtifact(run.id, branchRef, workspaceId) ?? latestStageArtifact(run.id, "slate", null, workspaceId);
        await runStage(next.kind, branchRef, previous);
        movedThisRound = true;
      }
    }
  }

  // --- where the run stands now ----------------------------------------------
  // Read through the same resume rule the pass used, so "where a branch stands" and
  // "what a branch is owed" can never be two answers.
  const branches = branchesOf(run, workspaceId);
  const artifacts = listStageArtifacts(run.id, workspaceId);
  const awaiting: AdvanceResult["awaiting"] = [];
  let allTerminal = branches.length > 0;
  for (const branchRef of branches) {
    const next = nextStageFor(artifacts, branchRef);
    if (next.action === "await_gate") {
      const gate = gateForStage(next.kind);
      if (gate) awaiting.push({ branchRef, gate });
    }
    // Terminal means the candidacy is over: resolved at a gate that ended it, or an
    // approved offer (a hired branch). Anything else is still owed something.
    if (!(next.action === "done" && (next.reason === "branch_terminal" || next.reason === "offer_approved"))) {
      allTerminal = false;
    }
  }

  // §4: a run is complete when every BRANCH is terminal, not when every branch reached
  // S6. A slate of twenty where nineteen were rejected and one was hired is a finished
  // run, and reading it as unfinished would leave it in the recruiter's queue forever.
  const status = allTerminal && run.status === "running" ? (setRoleRunStatus(run.id, "complete", workspaceId)?.status ?? "complete") : (getRoleRun(run.id, workspaceId)?.status ?? run.status);

  return { runId: run.id, status, produced, awaiting, ceilingHit };
}

// --- THE GATE COMMIT ---------------------------------------------------------

export type GateDecision = "approved" | "declined";

export type CommitGateInput = {
  runId: string;
  branchRef: string;
  gate: RoleRunGate;
  decision: GateDecision;
  policyVersion: string;
  subjectRefs: string[];
  token: string | null | undefined;
  approver: string | null | undefined;
  now?: number;
};

/** Resolve a parked branch with a human's decision.
 *
 *  The approval is verified and SPENT first (commitRoleRunGate), so a replayed request
 *  cannot re-resolve the branch. Only then is the resolution appended — as a NEW
 *  artifact of the same kind, never as an edit of the parked one. The parked artifact is
 *  the record that a human was asked; overwriting it would erase the question and leave
 *  only the answer.
 *
 *  An `approved` rejection gate is terminal for the branch when the screen proposed a
 *  rejection, and lets it proceed otherwise — approving a screen means approving WHAT IT
 *  PROPOSED, not "advance this person regardless". */
export function commitRoleRunStageGate(
  input: CommitGateInput,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleRunStageArtifact {
  const run = getRoleRun(input.runId, workspaceId);
  if (!run) throw new Error(`role run ${input.runId} does not exist in this workspace`);

  const kind = GATE_STAGE[input.gate];
  const parked = latestStageArtifact(input.runId, kind, input.branchRef, workspaceId);
  // The branch's HEAD must be this gate, not merely some artifact of this kind: the
  // resolution is only a legal next row from `<kind>:awaiting_approval`. Checked before
  // the approval is spent, so a refused commit does not burn the recruiter's token.
  const { head } = replayRoleRunChain(listStageArtifacts(input.runId, workspaceId), input.branchRef);
  if (!parked || parked.status !== "awaiting_approval" || head !== stageStateOf(parked)) {
    throw new Error(`branch ${input.branchRef} is not parked at the ${input.gate} gate`);
  }

  commitRoleRunGate({
    runId: input.runId,
    gate: input.gate,
    policyVersion: input.policyVersion,
    subjectRefs: input.subjectRefs,
    token: input.token,
    approver: input.approver,
    now: input.now,
  });

  const proposedRejection =
    input.gate === "rejection" &&
    ((parked.payload as ScreenPayload | undefined)?.decisions ?? []).some((d) => d.route === "reject_proposed");

  // declined at ANY gate ends the branch: a recruiter who declines an invite or an offer
  // has ended that candidacy, and a recruiter who declines a proposed rejection is
  // handled by `proposedRejection` being false on the approve path instead.
  const status: RoleRunStageStatus =
    input.decision === "declined" ? "terminal" : proposedRejection ? "terminal" : "complete";

  return appendStageArtifact(
    {
      runId: input.runId,
      kind,
      branchRef: input.branchRef,
      status,
      payload: {
        ...(typeof parked.payload === "object" && parked.payload !== null ? parked.payload : {}),
        gate: input.gate,
        decision: input.decision,
        // The approver is recorded as a HASH, not as a name: ADR-0011 §5 bans names from
        // the ledger, and it bans them for the recruiter too. The sealed decision record
        // (sealDecisionRecord) is where the attributable identity lives.
        approverRef: hashOf(input.approver ?? ""),
        decidedAt: new Date(input.now ?? Date.now()).toISOString(),
      },
    },
    workspaceId
  );
}

/** Whether a stage kind parks on a human — re-exported so a caller needs one import. */
export { stageIsGated };
