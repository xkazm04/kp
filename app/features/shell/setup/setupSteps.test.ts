import test from "node:test";
import assert from "node:assert/strict";
import { INITIAL_SETUP, reachedCeiling, relevantSteps, SETUP_STEPS, stepSatisfied, type SetupState } from "./setupSteps";
import { draftFromStored } from "@/app/features/shared/pipelineAxisDraft";
import type { PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import type { Capability } from "@/app/_lib/auth/roles";

// The two gates the whole wizard hangs off — one decides whether Continue is
// live, the other decides which steps a click may open — and neither was pinned.
// Since the intent fork there is a third authority: `relevantSteps`, the sequence
// every index in the wizard is a position in.

const STORED: PipelineStagesRule = {
  stages: [
    { id: "applied", label: "Applied", role: "entry" },
    { id: "interview", label: "Interview", role: "interview" },
    { id: "hired", label: "Hired", role: "terminal" },
  ],
  retired: [],
} as unknown as PipelineStagesRule;

const HIRE: SetupState = { ...INITIAL_SETUP, intent: "hire" };
const SEEK: SetupState = { ...INITIAL_SETUP, intent: "seek" };

function withBoard(over: Partial<SetupState> = {}): SetupState {
  return {
    ...HIRE,
    pipelineLoad: "ready",
    pipeline: { stored: STORED, draft: draftFromStored(STORED), counts: {} },
    ...over,
  };
}

/* ── the intent fork ──────────────────────────────────────────────────────── */

test("the hire path is the journey it always was: welcome → company → team → pipeline → companion → handoff", () => {
  const ids = relevantSteps(HIRE).map((s) => s.id);
  assert.deepEqual(ids, ["welcome", "company", "team", "pipeline", "companion", "handoff"]);
  // …and so is an undecided run: nothing is hidden before the fork is answered.
  assert.deepEqual(relevantSteps(INITIAL_SETUP).map((s) => s.id), ids);
  assert.deepEqual(SETUP_STEPS.map((s) => s.id), ids, "the declared list is the hire sequence");
});

test("a seeker's run is welcome → handoff — no company, team, board or Candi", () => {
  assert.deepEqual(
    relevantSteps(SEEK).map((s) => s.id),
    ["welcome", "handoff"]
  );
  // The indicator count the rail and the phone counter draw is this length.
  assert.equal(relevantSteps(SEEK).length, 2);
});

test("welcome is satisfied only once the intent is answered", () => {
  assert.equal(stepSatisfied("welcome", INITIAL_SETUP), false, "no intent → Continue stays disabled");
  assert.equal(stepSatisfied("welcome", HIRE), true);
  assert.equal(stepSatisfied("welcome", SEEK), true);
});

/* ── the required inputs ──────────────────────────────────────────────────── */

test("the org name is the hiring run's ONE required input after the fork", () => {
  assert.equal(stepSatisfied("company", HIRE), false);
  assert.equal(stepSatisfied("company", { ...HIRE, orgName: "   " }), false, "whitespace is not a name");
  assert.equal(stepSatisfied("company", { ...HIRE, orgName: "Acme" }), true);
});

test("team, companion and handoff are always satisfied — each ships a real default answer", () => {
  for (const id of ["team", "companion", "handoff"] as const) {
    assert.equal(stepSatisfied(id, INITIAL_SETUP), true, id);
  }
});

test("the pipeline gate is a VALIDITY check, not a completeness one", () => {
  // An untouched board is a legitimate answer, so an unloaded/loading axis passes.
  assert.equal(stepSatisfied("pipeline", HIRE), true);
  assert.equal(stepSatisfied("pipeline", { ...HIRE, pipelineLoad: "failed" }), true);
  assert.equal(stepSatisfied("pipeline", withBoard()), true);
});

test("an axis the server would reject cannot be carried to the hand-off", () => {
  const board = withBoard();
  const broken = { ...board.pipeline!, draft: { ...board.pipeline!.draft, stages: [] } };
  assert.equal(stepSatisfied("pipeline", { ...board, pipeline: broken }), false);
});

/* ── the reachable ceiling ────────────────────────────────────────────────── */

test("a satisfied step keeps the whole high-water mark", () => {
  assert.equal(reachedCeiling(4, 1, true), 4);
});

test("clearing a required input REVOKES the steps it bought", () => {
  // Typed the org name, pressed Continue to step 3, came back and cleared it: the
  // rail must not still offer Team/Pipeline/Done, because finishing that way
  // writes no org name at all and the workspace keeps the seed default.
  assert.equal(reachedCeiling(4, 1, false), 1);
});

test("going BACK is never capped — nobody is stranded", () => {
  assert.equal(reachedCeiling(4, 5, false), 4);
  assert.equal(reachedCeiling(0, 0, false), 0);
});

test("every step id in the journey has a satisfaction rule", () => {
  for (const s of SETUP_STEPS) assert.equal(typeof stepSatisfied(s.id, INITIAL_SETUP), "boolean", s.id);
});

/* ── the seat: who is answering ───────────────────────────────────────────── */
// The '/' gate fires per user and a redeemed invite lands on '/', so an invited
// teammate meets this wizard too. A step whose answers need a capability the seat
// does not hold is not asked — and an UNKNOWN seat (the read in flight, or failed)
// is the owner's run, never a smaller one: the server stays the enforcement.

const OWNER_SEAT: Capability[] = ["org:manage", "members:manage", "team:manage", "pipeline:write", "read"];
const ADMIN_SEAT: Capability[] = ["members:manage", "team:manage", "pipeline:write", "read"];
const RECRUITER_SEAT: Capability[] = ["pipeline:write", "read"];
const FULL_RUN = ["welcome", "company", "team", "pipeline", "companion", "handoff"];

test("the owner's hire run is byte-for-byte today's", () => {
  assert.deepEqual(relevantSteps({ ...INITIAL_SETUP, intent: "hire", seat: OWNER_SEAT }).map((s) => s.id), FULL_RUN);
});

test("an unknown seat fails OPEN to today's run", () => {
  assert.deepEqual(relevantSteps({ ...INITIAL_SETUP, intent: "hire", seat: null }).map((s) => s.id), FULL_RUN);
});

test("a recruiter is not asked for the company (org:manage) or the team (members:manage)", () => {
  assert.deepEqual(
    relevantSteps({ ...INITIAL_SETUP, intent: "hire", seat: RECRUITER_SEAT }).map((s) => s.id),
    ["welcome", "pipeline", "companion", "handoff"]
  );
});

test("an admin keeps the team step but not the company: org:manage is owner-only", () => {
  assert.deepEqual(
    relevantSteps({ ...INITIAL_SETUP, intent: "hire", seat: ADMIN_SEAT }).map((s) => s.id),
    ["welcome", "team", "pipeline", "companion", "handoff"]
  );
});
