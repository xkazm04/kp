// Every AI stage of a group evaluation has a STATED deadline, and a stage that did
// not deliver says so on the saved payload.
//
// One evaluation fans out to up to EIGHT Python processes — the recruiter ranker
// (with --weights-llm AND --embeddings, so two provider round-trips inside one
// child), the `group_compare_cli` narrative, and up to GROUP_EVAL_CAP=6 concurrent
// per-candidate reasoning runs. None of them passed a timeout, so each inherited
// python-runner's DEFAULT_TIMEOUT_MS: a ten-minute HANG BACKSTOP its own comment
// calls "not a deadline". A stalled provider parked the modal spinner and a
// background task slot for ten minutes before falling back to a deterministic
// result it could have produced in seconds.
//
// The second half matters as much as the first: every stage degrades SOFT, so an
// evaluation whose ranking, narrative and rationales all fell back was byte-shaped
// exactly like a full AI comparison. `degradedStages` is the truthful-claim rule
// this repo applies to delivery (sent/queued/failed) applied to AI output.
//
// Drives the REAL runGroupEval against a throwaway DB — testing/unit-db.ts MUST be
// the FIRST project import. Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Force every spawn to fail fast (ENOENT) so the suite is hermetic and no LLM,
// network or interpreter is required. Set BEFORE python-runner is loaded.
process.env.PYTHON_CMD = "kp-no-python-for-this-test";
const { runGroupEval, stageSignal, GROUP_EVAL_RANK_TIMEOUT_MS, GROUP_EVAL_COMPARE_TIMEOUT_MS, GROUP_EVAL_REASONING_TIMEOUT_MS } =
  await import("./group-eval-run.ts");

after(() => cleanupUnitDb());

const candidate = (entryId: string, matchScore: number) => ({ entryId, candidateId: null, label: entryId, matchScore });

// ---- the deadline helper ----------------------------------------------------

test("stageSignal aborts on its own deadline, and reports WHICH signal did it", async () => {
  const stage = stageSignal(undefined, 5);
  assert.equal(stage.deadline.aborted, false, "not aborted before the deadline elapses");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(stage.deadline.aborted, true, "the deadline must fire on its own");
  assert.equal(stage.signal.aborted, true, "and it must abort the composed signal the stage passes down");
});

test("stageSignal still honours the caller's cancellation, and keeps the two distinguishable", () => {
  const caller = new AbortController();
  const stage = stageSignal(caller.signal, 60_000);
  caller.abort();
  assert.equal(stage.signal.aborted, true, "a cancelled request must still abort the child");
  assert.equal(
    stage.deadline.aborted,
    false,
    "a caller cancellation must NOT be reported as a timeout — that is the whole reason the deadline is returned separately",
  );
});

test("the three stated deadlines are all well under python-runner's 10-minute hang backstop", () => {
  const BACKSTOP_MS = 600_000;
  for (const [name, ms] of [
    ["ranking", GROUP_EVAL_RANK_TIMEOUT_MS],
    ["comparison", GROUP_EVAL_COMPARE_TIMEOUT_MS],
    ["reasoning", GROUP_EVAL_REASONING_TIMEOUT_MS],
  ] as const) {
    assert.ok(ms > 0, `${name} must state a deadline`);
    assert.ok(ms < BACKSTOP_MS, `${name} (${ms}ms) must be a DEADLINE, not the ${BACKSTOP_MS}ms hang backstop`);
  }
});

// ---- every spawn site actually passes one -----------------------------------

test("every AI stage in group-eval-run passes a stated deadline", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "group-eval-run.ts"),
    "utf-8",
  ).replace(/\r\n/g, "\n"); // this checkout is CRLF; the worktree may be LF

  assert.match(
    src,
    /spawnPython\([\s\S]{0,600}?timeoutMs: stageTimeoutMs\(GROUP_EVAL_COMPARE_TIMEOUT_MS\)/,
    "the compare spawn must hand python-runner an explicit timeoutMs (a SIGKILL, not just an abort)",
  );
  assert.match(src, /rankCandidates\(job, pool, rankStage\.signal\)/, "the ranker must run under the ranking deadline");
  assert.match(src, /runReasoning\(\{ jobId, profileId: c\.candidateId \}, stage\.signal, workspaceId\)/, "each reasoning run must carry its own deadline");
  assert.doesNotMatch(
    src,
    /await (rankCandidates|runGroupCompare)\([^)]*, signal\)/,
    "no AI stage may run on the bare caller signal — that is the deadline-less shape this test exists to prevent",
  );
});

// ---- the honest half --------------------------------------------------------

test("a field whose ranker and narrative both fell back says so on the payload", async () => {
  const res = await runGroupEval({
    roleKey: "role-degraded",
    roleTitle: "Backend Engineer",
    jobId: "no-such-job-so-the-ranker-is-skipped",
    candidates: [candidate("deg-a", 90), candidate("deg-b", 55)],
  });

  const stages = res.degradedStages as { stage: string; reason: string }[] | null;
  assert.ok(stages, "a run whose AI narrative never arrived must not read as a full AI comparison");
  const comparison = stages.find((s) => s.stage === "comparison");
  assert.ok(comparison, `the comparison stage must be disclosed, got ${JSON.stringify(stages)}`);
  assert.equal(comparison.reason, "failed", "a spawn that ENOENTs is a failure, not a timeout");
  assert.equal(res.comparison, null, "and the AI comparison itself is genuinely absent");
});

test("an insufficient-sample field reports no degradation — the narrative was declined, not lost", async () => {
  // The min-cohort floor deliberately never spawns the narrative. That is a policy
  // decision already disclosed as "insufficient sample"; calling it a degraded stage
  // would tell the reader a provider failed when none was asked.
  const res = await runGroupEval({
    roleKey: "role-degraded-solo",
    roleTitle: "Backend Engineer",
    candidates: [candidate("deg-solo", 90)],
  });
  assert.equal(res.robustness, "insufficient_sample");
  assert.equal(res.degradedStages, null, "a declined stage is not a degraded stage");
});
