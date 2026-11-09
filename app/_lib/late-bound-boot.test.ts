// The boot list of late-bound implementations (late-bound-boot.ts) — the one function
// instrumentation-node.ts calls at server start and unit-db.ts calls per test process.
//
// What is pinned:
//   • COVERAGE — every kind tasks.ts delegates to `externalRunner("…")` is registered
//     here, read off the HANDLERS source so a kind moved onto the seam without a
//     registration fails now rather than as a failed task in production;
//   • WIRING — each registered implementation is the real one, reached with the task's
//     params: the interview kit and letter runners answer their own "not found" for the
//     id the params carried, and the stage hook's door is the real mint (its own
//     "pipeline entry not found"). No Python, no model, no network.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerLateBoundImplementations } from "./late-bound-boot.ts";
import { _resetTaskRunnersForTests, externalRunner, type ExternalTaskCtx } from "./task-external-runners.ts";
import { _resetStageHookInviteForTests, stageHookInvite } from "./stage-hooks-invite.ts";
import { TASK_KINDS } from "./task-kinds.ts";

after(() => cleanupUnitDb());
// The AI voice interview ships off (voice/enabled.ts); these cases exercise it ON.
process.env.KP_VOICE_INTERVIEW = "1";

function ctx(params: Record<string, unknown>, workspaceId = "team-late-bound"): ExternalTaskCtx {
  return { workspaceId, signal: new AbortController().signal, progress: () => {}, params };
}

/** The kinds tasks.ts hands to the late-bound registry — parsed, because importing
 *  tasks.ts is exactly the handler graph this seam keeps light. */
function delegatedKinds(): string[] {
  const src = readFileSync(fileURLToPath(new URL("./tasks.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  return [...new Set([...src.matchAll(/externalRunner\("([a-z_]+)"\)/g)].map((m) => m[1]))].sort();
}

test("every kind tasks.ts delegates to externalRunner is registered by the boot list", () => {
  const kinds = delegatedKinds();
  // Non-vacuity: since 2026-11-09 EVERY kind is on the seam (the runners tasks.ts used to
  // import moved to late-bound-boot.ts `registerQueueRunners`), so the list is the whole
  // TaskKind vocabulary — pinned below against task-kinds.ts as well as spelled out here.
  assert.deepEqual(kinds, [
    "agent_fit", "analyze", "analyze_cohort", "automation", "batch_outreach", "batch_screen", "campaign",
    "companion_digest", "design_artifacts", "evaluate_submission", "gig_plans", "gig_proposal", "gig_report",
    "gig_research", "gig_scan", "group_eval", "interview_kit", "interview_letter", "interview_prep", "jd_build",
    "jobseeker_scan", "lifecycle", "need_analysis", "profile_draft", "reasoning", "repo_scan", "score_entry",
  ]);
  assert.deepEqual(kinds, [...TASK_KINDS].sort(), "every TaskKind delegates to the late-bound registry");
  _resetTaskRunnersForTests();
  for (const kind of kinds) assert.throws(() => externalRunner(kind), /not registered/, `${kind} starts unregistered`);
  registerLateBoundImplementations();
  for (const kind of kinds) assert.equal(typeof externalRunner(kind), "function", `${kind} is registered at boot`);
});

test("the analyze task's GitHub stage is registered at BOOT, not by the route that first uses it", () => {
  // analyze-run.ts reaches the deep-dive by name through this registry. Registered only
  // from /api/analyze, a task replayed after a restart failed the stage (ANALYSIS_FAILED)
  // until someone happened to call that route; boot is where every other runner lives.
  const analyzeRun = readFileSync(fileURLToPath(new URL("./analyze-run.ts", import.meta.url)), "utf8");
  assert.match(analyzeRun, /export const ANALYZE_GITHUB_RUNNER = "analyze_github";/, "the literal below must track the constant");
  _resetTaskRunnersForTests();
  assert.throws(() => externalRunner("analyze_github"), /not registered/);
  registerLateBoundImplementations();
  assert.equal(typeof externalRunner("analyze_github"), "function", "analyze_github is registered at boot");
  const route = readFileSync(fileURLToPath(new URL("../api/analyze/route.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(route, /registerTaskRunner\(/, "the route no longer registers (and so no longer imports the stage)");
});

test("the stage hook's interview-invite door is registered by the boot list", () => {
  _resetStageHookInviteForTests();
  assert.throws(() => stageHookInvite(), /not registered.*instrumentation-node\.ts/);
  registerLateBoundImplementations();
  assert.equal(typeof stageHookInvite(), "function");
});

test("the interview_kit runner is the real one and reads params.jobId", async () => {
  registerLateBoundImplementations();
  await assert.rejects(externalRunner("interview_kit")(ctx({ jobId: "late-bound-no-such-job" })), /job not found: late-bound-no-such-job/);
});

test("the interview_letter runner is the real one and reads params.letterId", async () => {
  registerLateBoundImplementations();
  await assert.rejects(
    externalRunner("interview_letter")(ctx({ letterId: "late-bound-no-such-letter" })),
    /interview letter not found: late-bound-no-such-letter/
  );
});

test("the stage hook's door is the real mint", async () => {
  registerLateBoundImplementations();
  await assert.rejects(stageHookInvite()({ entryId: "late-bound-no-such-entry", workspaceId: "team-late-bound" }), /pipeline entry not found/);
});

test("registering twice replaces rather than throws (the dev server re-runs instrumentation)", () => {
  registerLateBoundImplementations();
  registerLateBoundImplementations();
  assert.equal(typeof externalRunner("interview_kit"), "function");
  assert.equal(typeof stageHookInvite(), "function");
});

test("tasks.ts reaches no runner: its static graph stays the queue, not the engines", async () => {
  // The hub every route that starts or polls a task imports. Until 2026-11-09 its specs
  // imported their runners directly and its graph was 236 first-party modules; with every
  // runner registered at boot it is 43 (scripts/perf/check-budget.mjs, the walker the perf
  // budget uses). A runner imported back into tasks.ts puts ~100+ modules on ~30 routes.
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const budget = new URL("../../scripts/perf/check-budget.mjs", import.meta.url).href;
  const { walkGraph } = (await import(budget)) as {
    walkGraph: (entry: string, root?: string) => { modules: number; files: Set<string> };
  };
  const graph = walkGraph(fileURLToPath(new URL("./tasks.ts", import.meta.url)), repoRoot);
  const rel = [...graph.files].map((f) => path.relative(repoRoot, f).split(path.sep).join("/"));
  assert.ok(rel.includes("app/_lib/task-external-runners.ts"), "self-check: the walk reached the registry leaf");
  const runners = rel.filter((f) => /-run\.ts$|\/automation-|\/devcase-orchestrator\.ts$|\/db\/pipeline\.ts$|\/task-batch-run\.ts$/.test(f));
  assert.deepEqual(runners, [], `a runner (or the pipeline store) is back on tasks.ts's graph: ${runners.join(", ")}`);
  assert.ok(graph.modules <= 60, `tasks.ts reaches ${graph.modules} first-party modules (43 when this was pinned)`);
});
