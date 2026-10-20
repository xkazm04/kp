// PLAN-STATUS (plan-status.ts): the strict parse, the no-regress merge, and one gig's sync
// pass against a temp folder and a fake goal-patch transport. unit-db.ts first.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { transitionGig, upsertGigFromRaw } from "../db/gigs.ts";
import { getAcceptedGigPlan, setGigPlanProgress } from "../db/gigs-plans.ts";
import { GIG_PLAN_STATUS_FILE, GIG_PLAN_STATUS_WORDS, gigContractFileMarkdown } from "./contract.ts";
import {
  GIG_PLAN_STATUS_MAX_BYTES,
  applyPlanStatus,
  buildGigPlanAssignment,
  initialPlanProgress,
  parsePlanStatus,
  planGoalKey,
  readPlanStatusFile,
  syncGigPlanStatus,
} from "./plan-status.ts";
import { GIG_GOAL_STATUSES, type GigGoalStatus, type GigPlanProgress } from "./types.ts";
import { fixtureAcceptedPlan } from "./__fixtures__/accepted-plan.ts";

const TMP = mkdtempSync(path.join(tmpdir(), "kp-plan-status-"));
after(() => {
  rmSync(TMP, { recursive: true, force: true });
  cleanupUnitDb();
});

const WS = "ws-gig-plan-status";
const NOW = "2026-09-29T12:00:00.000Z";

function progress(ids: (string | null)[]): GigPlanProgress {
  return initialPlanProgress(ids.length, "ms-1", ids, null, "2026-09-29T10:00:00.000Z");
}

test("the contract's status words are the store's goal statuses, and the folder contract states the file", () => {
  assert.deepEqual([...GIG_PLAN_STATUS_WORDS], [...GIG_GOAL_STATUSES]);
  const md = gigContractFileMarkdown("security");
  assert.ok(md.includes(`## Plan status (kp-plan-status.v1)`));
  assert.ok(md.includes(GIG_PLAN_STATUS_FILE));
  assert.ok(md.indexOf("## Plan status") < md.indexOf("## Deliverable contract ("), "the plan section precedes the deliverable contract");
});

test("parse: strict - unknown ids and bad statuses skipped, progress clamped, junk is no update", () => {
  const keys = new Set(["g-1", "g-2", "step-3"]);
  const report = parsePlanStatus(
    JSON.stringify({
      goals: [
        { goalId: "g-1", status: "done", progress: 140, note: "  Finished \n cleanly. " },
        { goalId: "g-2", status: "paused", progress: 10 },
        { goalId: "g-9", status: "done", progress: 100 },
        { goalId: "step-3", status: "in-progress", progress: 33.6 },
        { goalId: "g-1", status: "open", progress: 0 },
      ],
    }),
    keys
  )!;
  assert.deepEqual([...report.keys()], ["g-1", "step-3"]);
  assert.deepEqual(report.get("g-1"), { status: "done", progress: 100, note: "Finished cleanly." });
  assert.deepEqual(report.get("step-3"), { status: "in-progress", progress: 34, note: null });
  assert.equal(parsePlanStatus("{not json", keys), null);
  assert.equal(parsePlanStatus(JSON.stringify([{ goalId: "g-1" }]), keys), null);
  assert.equal(parsePlanStatus(JSON.stringify({ goals: "all done" }), keys), null);
  assert.deepEqual(parsePlanStatus(JSON.stringify({ goals: [{ goalId: "g-1", status: "done" }] }), keys)!.get("g-1")?.progress, 100, "done without a number reads 100");
});

test("apply: only moved goals change, and a reported `open` never undoes progress", () => {
  const current = progress(["g-1", "g-2", null]);
  current.goals[1] = { ...current.goals[1]!, status: "in-progress", progress: 50 };
  const report = parsePlanStatus(
    JSON.stringify({
      goals: [
        { goalId: "g-1", status: "open", progress: 0 },
        { goalId: "g-2", status: "open", progress: 0 },
        { goalId: "step-3", status: "blocked", progress: 20, note: "Waiting on access." },
      ],
    }),
    new Set(current.goals.map(planGoalKey))
  )!;
  const { next, changed } = applyPlanStatus(current, report, NOW);
  assert.deepEqual(changed.map((g) => g.stepIndex), [2], "g-1 was already open (unchanged); g-2 does not regress");
  assert.equal(next.goals[1]!.status, "in-progress");
  assert.deepEqual(next.goals[2], { stepIndex: 2, goalId: null, status: "blocked", progress: 20, note: "Waiting on access." });
  assert.equal(next.updatedAt, NOW);
  const same = applyPlanStatus(next, report, "later");
  assert.equal(same.changed.length, 0);
  assert.equal(same.next, next, "nothing moved: the same object, no new timestamp");
});

test("the assignment's plan: steps carry the Personas goal id, else step-<n>", () => {
  const plan = {
    plan: { summary: "S", steps: [{ title: "A", doneWhen: "a" }, { title: "B", doneWhen: "b" }], decisions: [], risks: [], effortHours: null, questions: [] },
    progress: progress(["g-1", null]),
    note: "N",
  };
  const a = buildGigPlanAssignment(plan)!;
  assert.deepEqual(a.steps, [
    { goalId: "g-1", title: "A", doneWhen: "a" },
    { goalId: "step-2", title: "B", doneWhen: "b" },
  ]);
  assert.equal(a.note, "N");
  assert.equal(a.statusFile, "PLAN-STATUS.json");
  assert.equal(buildGigPlanAssignment({ ...plan, plan: null }), null);
});

test("the file is read only when it is a regular file under the cap", () => {
  const dir = mkdtempSync(path.join(TMP, "read-"));
  assert.equal(readPlanStatusFile(dir), null, "absent");
  writeFileSync(path.join(dir, GIG_PLAN_STATUS_FILE), "x".repeat(GIG_PLAN_STATUS_MAX_BYTES + 1));
  assert.equal(readPlanStatusFile(dir), null, "oversized");
  writeFileSync(path.join(dir, GIG_PLAN_STATUS_FILE), "{}");
  assert.equal(readPlanStatusFile(dir), "{}");
});

let seq = 0;
function pairedGig(ids: (string | null)[] = ["goal-1", "goal-2", "goal-3"]): { gigId: string; workdir: string; planId: string } {
  seq += 1;
  const { gig } = upsertGigFromRaw(WS, {
    sourceId: "gsrc-ps",
    arena: "security",
    raw: { externalKey: `ps-${seq}`, url: `https://example.test/ps/${seq}`, title: `Plan status ${seq}`, org: null, reward: null, deadlineAt: null, postedAt: null, bodyText: "x", bodyHtml: null, tags: [] },
    suspectReasons: [],
  });
  assert.ok(transitionGig(WS, gig.id, { from: "new", to: "qualified" }).ok);
  const plan = fixtureAcceptedPlan(WS, gig.id);
  setGigPlanProgress(WS, plan.id, progress(ids));
  return { gigId: gig.id, workdir: mkdtempSync(path.join(TMP, `gig-${seq}-`)), planId: plan.id };
}

function fakePatch(fail: Set<string> = new Set()): { calls: { goalId: string; status: GigGoalStatus; progress: number }[]; patchGoal: (id: string, p: { status: GigGoalStatus; progress: number }) => Promise<{ ok: true } | { ok: false; reason: "personas_unreachable" }> } {
  const calls: { goalId: string; status: GigGoalStatus; progress: number }[] = [];
  return {
    calls,
    patchGoal: async (goalId, p) => {
      calls.push({ goalId, ...p });
      return fail.has(goalId) ? { ok: false, reason: "personas_unreachable" } : { ok: true };
    },
  };
}

const writeStatus = (dir: string, goals: unknown[]) => writeFileSync(path.join(dir, GIG_PLAN_STATUS_FILE), JSON.stringify({ goals }));

test("sync: patches only the changed goals, ignores unknown ids, and records what landed", async () => {
  const { gigId, workdir } = pairedGig();
  writeStatus(workdir, [
    { goalId: "goal-1", status: "done", progress: 100, note: "Reproduced." },
    { goalId: "goal-2", status: "open", progress: 0 },
    { goalId: "goal-99", status: "done", progress: 100 },
  ]);
  const t = fakePatch();
  const out = await syncGigPlanStatus(WS, gigId, workdir, { patchGoal: t.patchGoal, now: () => new Date(NOW) });
  assert.deepEqual(out, { kind: "updated", changed: 1, patched: 1, failed: 0 });
  assert.deepEqual(t.calls, [{ goalId: "goal-1", status: "done", progress: 100 }], "goal-2 did not move; goal-99 is not this plan's");
  const goals = getAcceptedGigPlan(WS, gigId)!.progress!.goals;
  assert.deepEqual(goals[0], { stepIndex: 0, goalId: "goal-1", status: "done", progress: 100, note: "Reproduced." });
  assert.equal(goals[1]!.status, "open");

  // A second pass over the same file changes nothing and patches nothing.
  const again = await syncGigPlanStatus(WS, gigId, workdir, { patchGoal: t.patchGoal });
  assert.deepEqual(again, { kind: "unchanged" });
  assert.equal(t.calls.length, 1);
});

test("sync: a missing or unparseable file is no update; a refused patch is retried next pass", async () => {
  const { gigId, workdir } = pairedGig();
  const t = fakePatch(new Set(["goal-2"]));
  assert.deepEqual(await syncGigPlanStatus(WS, gigId, workdir, { patchGoal: t.patchGoal }), { kind: "no_file" });
  writeFileSync(path.join(workdir, GIG_PLAN_STATUS_FILE), "{ half written");
  assert.deepEqual(await syncGigPlanStatus(WS, gigId, workdir, { patchGoal: t.patchGoal }), { kind: "unparseable" });
  assert.equal(t.calls.length, 0);
  assert.ok(getAcceptedGigPlan(WS, gigId)!.progress!.goals.every((g) => g.status === "open"), "nothing was reset or invented");

  writeStatus(workdir, [
    { goalId: "goal-1", status: "in-progress", progress: 30 },
    { goalId: "goal-2", status: "blocked", progress: 10, note: "No access." },
  ]);
  const out = await syncGigPlanStatus(WS, gigId, workdir, { patchGoal: t.patchGoal });
  assert.deepEqual(out, { kind: "updated", changed: 2, patched: 1, failed: 1 });
  const goals = getAcceptedGigPlan(WS, gigId)!.progress!.goals;
  assert.equal(goals[0]!.status, "in-progress");
  assert.equal(goals[1]!.status, "open", "Personas refused it: not recorded, so the next pass tries again");
  const retry = await syncGigPlanStatus(WS, gigId, workdir, { patchGoal: fakePatch().patchGoal });
  assert.deepEqual(retry, { kind: "updated", changed: 1, patched: 1, failed: 0 });
});

test("sync: a goal with no Personas id (the milestone degraded) is tracked locally and never patched", async () => {
  const { gigId, workdir } = pairedGig([null, null, null]);
  writeStatus(workdir, [{ goalId: "step-2", status: "done", progress: 100 }]);
  const t = fakePatch();
  const out = await syncGigPlanStatus(WS, gigId, workdir, { patchGoal: t.patchGoal });
  assert.deepEqual(out, { kind: "updated", changed: 1, patched: 0, failed: 0 });
  assert.equal(t.calls.length, 0);
  assert.equal(getAcceptedGigPlan(WS, gigId)!.progress!.goals[1]!.status, "done");
  assert.deepEqual(await syncGigPlanStatus(WS, "gig-no-plan", workdir, {}), { kind: "no_plan" });
});
