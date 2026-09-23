// The post-commit arrival hook: entering an AI interview step mints the voice
// screen and invites the candidate — now when the plan gates the step `auto`,
// parked for a human when it gates it `human`.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry, setPipelineEntryStage } from "./db/pipeline.ts";
import { listPipelineEventsForEntry } from "./db/pipeline-events.ts";
import { listRecentInterviewSessions } from "./db/interviews.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { runStageEnteredHook } from "./stage-hooks.ts";
import { _resetStageHookInviteForTests, registerStageHookInvite, type StageHookInvite } from "./stage-hooks-invite.ts";
import { registerLateBoundImplementations } from "./late-bound-boot.ts";

after(() => cleanupUnitDb());

// A configured voice provider, so the invite is actually ATTEMPTED and the outbox
// produces a real delivery claim. Nothing leaves the process: with no
// COMMS_WEBHOOK_URL (unit-db clears it) the durable local Outbox is the terminal
// target, which is exactly the `queued` half of the truthful-claim contract.
before(() => {
  process.env.OPENAI_API_KEY = "test-key-not-used-for-any-call";
});

// A three-column board: entry → interview → terminal. Valid per
// validatePipelineStages, and it keeps the interview column's id equal to the
// shipped one so the SHIPPED DEFAULT plan's step still governs it.
const AXIS = {
  stages: [
    { id: "Applied", label: "Applied", role: "entry" },
    { id: "Interview", label: "Interview", role: "interview" },
    { id: "Hired", label: "Hired", role: "terminal" },
  ],
  retired: [],
};

/** Nobody has ever saved a hiring plan here → an AI round runs unattended. */
const WS_UNSAVED = "team-hooks-unsaved";
/** The plan is saved and says a human gates the AI round → held. */
const WS_HUMAN = "team-hooks-human";
/** The plan is saved and says the AI round runs unattended. */
const WS_AUTO = "team-hooks-auto";
/** The plan is saved and the interview column's round is a HUMAN conversation. */
const WS_HUMAN_ROUND = "team-hooks-human-round";

for (const ws of [WS_UNSAVED, WS_HUMAN, WS_AUTO, WS_HUMAN_ROUND]) {
  setDecisionConfig("pipelineStages", AXIS, ws);
}
setDecisionConfig(
  "interviewPlan",
  { steps: [{ stageId: "Interview", gate: "human", rounds: [{ kind: "ai", gate: "human", topN: null }] }] },
  WS_HUMAN
);
setDecisionConfig(
  "interviewPlan",
  { steps: [{ stageId: "Interview", gate: "auto", rounds: [{ kind: "ai", gate: "auto", topN: null }] }] },
  WS_AUTO
);
setDecisionConfig(
  "interviewPlan",
  { steps: [{ stageId: "Interview", gate: "human", rounds: [{ kind: "human", gate: "human", topN: null }] }] },
  WS_HUMAN_ROUND
);

let seq = 0;
function entryAt(workspaceId: string, stage: string, contact: string | null) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `sh-c${seq}`,
    candidateLabel: `Hook Candidate ${seq}`,
    jobId: `sh-job-${seq}`,
    jobTitle: "Hook Test Role",
    contact,
    stage,
    // `student` takes buildGroundedInterview's deterministic early-career branch:
    // a scripted brief, no prep generation, no LLM — so this suite is keyless and
    // fast rather than dependent on whatever CLI the machine happens to have.
    archetype: "student",
    workspaceId,
  }).entry;
}

const kinds = (entryId: string, ws: string) => listPipelineEventsForEntry(entryId, 50, ws).map((e) => e.kind);
const sessionsFor = (entryId: string, ws: string) =>
  listRecentInterviewSessions(ws, 200).filter((s) => s.entryId === entryId);

test("auto gate: entering the AI interview step mints ONE link and invites the candidate", async () => {
  const entry = entryAt(WS_AUTO, "Interview", "auto@example.com");

  const res = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_AUTO });

  assert.equal(res.outcome, "invited");
  // The truthful claim, not a green lie: no relay is configured in this process,
  // so the invite is QUEUED in the durable outbox — never reported as sent.
  assert.equal(res.outcome === "invited" && res.delivery, "queued");
  const sessions = sessionsFor(entry.id, WS_AUTO);
  assert.equal(sessions.length, 1, "exactly one voice-screen session was minted");
  // The invite's ledger row is the dispatcher's own, carrying the Outbox status —
  // this hook adds no vocabulary of its own.
  assert.ok(kinds(entry.id, WS_AUTO).includes("interview_invite_sent"), "the invite is on the candidate timeline");
});

test("re-entering the same step mints no second link", async () => {
  const entry = entryAt(WS_AUTO, "Interview", "repeat@example.com");

  const first = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_AUTO });
  assert.equal(first.outcome, "invited");

  // A second arrival at the SAME step — a re-entry, a retried poll, or the same
  // row touched twice by a bulk move — resolves to the same (entry, stage) key.
  const second = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_AUTO });
  assert.equal(second.outcome, "already_invited");
  const third = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_AUTO });
  assert.equal(third.outcome, "already_invited");

  assert.equal(sessionsFor(entry.id, WS_AUTO).length, 1, "still exactly one link");
});

test("human gate: the invite is HELD — parked for a human, nothing minted, nothing sent", async () => {
  const entry = entryAt(WS_HUMAN, "Interview", "held@example.com");

  const res = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_HUMAN });

  assert.equal(res.outcome, "held");
  assert.equal(sessionsFor(entry.id, WS_HUMAN).length, 0, "no link was minted");
  assert.ok(!kinds(entry.id, WS_HUMAN).includes("interview_invite_sent"), "nothing claims to have been sent");
  // Parked on the existing calendar gate — the Schedule tab's AI-round docket.
  assert.equal(getPipelineEntry(entry.id, WS_HUMAN)?.approvalKind, "calendar");
  // …and a second arrival is still a hold, never a send: holding has no side
  // effect left to repeat, so it is idempotent by construction.
  assert.equal(
    (await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_HUMAN })).outcome,
    "held"
  );
  assert.equal(sessionsFor(entry.id, WS_HUMAN).length, 0);
});

test("an UNSAVED hiring plan treats an AI interview step as auto (the owner's default)", async () => {
  const entry = entryAt(WS_UNSAVED, "Interview", "unsaved@example.com");

  const res = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_UNSAVED });

  // The SHIPPED default plan gates its AI round "human"; this workspace has never
  // saved one, so the hook falls to auto. See effectiveInterviewGate's docblock —
  // the editor still paints "human" for the same unsaved step.
  assert.equal(res.outcome, "invited");
  assert.equal(sessionsFor(entry.id, WS_UNSAVED).length, 1);
});

test("no deliverable address: the invite FAILS on the record and the stage move still stands", async () => {
  const entry = entryAt(WS_AUTO, "Applied", null);

  // The real choke point — the move itself must succeed whatever the hook does.
  const moved = setPipelineEntryStage(entry.id, "Interview", {}, WS_AUTO);
  assert.ok(moved, "the stage move committed");
  assert.equal(moved?.stage, "Interview");

  const res = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_AUTO });
  assert.equal(res.outcome, "failed");
  assert.equal(res.outcome === "failed" && res.reason, "unaddressable");
  assert.equal(sessionsFor(entry.id, WS_AUTO).length, 0, "no minutes were reserved for a link nobody can receive");
  assert.ok(!kinds(entry.id, WS_AUTO).includes("interview_invite_sent"), "nothing claims to have been sent");
  // Failed OPEN, towards the human: the candidate is parked on the AI-round docket
  // rather than dropped out of every queue.
  assert.equal(getPipelineEntry(entry.id, WS_AUTO)?.approvalKind, "calendar");
});

test("a HUMAN round at the interview step is not this hook's business", async () => {
  const entry = entryAt(WS_HUMAN_ROUND, "Interview", "person@example.com");

  const res = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_HUMAN_ROUND });

  assert.equal(res.outcome, "skipped");
  assert.equal(res.outcome === "skipped" && res.reason, "no_ai_round");
  assert.equal(sessionsFor(entry.id, WS_HUMAN_ROUND).length, 0);
});

test("a non-interview column is not an interview arrival", async () => {
  const entry = entryAt(WS_AUTO, "Applied", "applied@example.com");

  const res = await runStageEnteredHook({ entryId: entry.id, stage: "Applied", workspaceId: WS_AUTO });

  assert.equal(res.outcome, "skipped");
  assert.equal(res.outcome === "skipped" && res.reason, "not_interview_role");
});

test("a candidate who already moved on is not invited to the step they left", async () => {
  const entry = entryAt(WS_AUTO, "Hired", "gone@example.com");

  // The hook runs OUTSIDE the transaction, so a second move can land in the gap.
  // A decision computed for a stage the candidate has left must not be applied.
  const res = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_AUTO });

  assert.equal(res.outcome, "skipped");
  assert.equal(res.outcome === "skipped" && res.reason, "stage_moved");
  assert.equal(sessionsFor(entry.id, WS_AUTO).length, 0);
});

test("an UNREGISTERED mint door is a loud failure: parked for a human, logged by name, never a silent skip", async () => {
  // The mint is late-bound (stage-hooks-invite.ts): instrumentation-node.ts registers it
  // at boot, unit-db.ts does the same for this process. A boot that never registered it
  // must not read as "nothing to do" — the candidate would sit on the column with no
  // link and nobody told.
  const entry = entryAt(WS_AUTO, "Interview", "unregistered@example.com");
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  _resetStageHookInviteForTests();
  try {
    const res = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_AUTO });
    assert.equal(res.outcome, "failed");
    assert.equal(res.outcome === "failed" && res.reason, "error");
  } finally {
    console.error = original;
    registerLateBoundImplementations();
  }
  assert.ok(
    logged.some((line) => line.includes("[stage-hooks]") && line.includes("not registered") && line.includes("instrumentation-node.ts")),
    `the server log names the missing registration, got: ${JSON.stringify(logged)}`
  );
  assert.equal(sessionsFor(entry.id, WS_AUTO).length, 0, "nothing was minted");
  assert.ok(!kinds(entry.id, WS_AUTO).includes("interview_invite_sent"), "nothing claims to have been sent");
  // Failed OPEN, towards the human — the same place every other mint failure lands.
  assert.equal(getPipelineEntry(entry.id, WS_AUTO)?.approvalKind, "calendar");

  // …and once registered again, the same kind of arrival mints as before.
  const next = entryAt(WS_AUTO, "Interview", "reregistered@example.com");
  assert.equal((await runStageEnteredHook({ entryId: next.id, stage: "Interview", workspaceId: WS_AUTO })).outcome, "invited");
});

test("a mint refused by the send gate AFTER the arrival check parks as suppressed, never as a billing miss", async () => {
  // The arrival check reads contactability first; the mint door (8b293dc05) asks the
  // send gate again. If the answer changed between the two reads, the refusal is
  // COMMS_SUPPRESSED and carries no quota — the hook must not read one.
  const entry = entryAt(WS_AUTO, "Interview", "raced@example.com");
  registerStageHookInvite(async () => ({ ok: false, refusal: "COMMS_SUPPRESSED" }) as Awaited<ReturnType<StageHookInvite>>);
  try {
    const res = await runStageEnteredHook({ entryId: entry.id, stage: "Interview", workspaceId: WS_AUTO });
    assert.equal(res.outcome, "failed");
    assert.equal(res.outcome === "failed" && res.reason, "suppressed");
  } finally {
    registerLateBoundImplementations();
  }
  assert.equal(sessionsFor(entry.id, WS_AUTO).length, 0, "nothing was minted");
  assert.equal(getPipelineEntry(entry.id, WS_AUTO)?.approvalKind, "calendar", "parked for a human");
});
