// Every task kind is budgeted, and the classes stay ordered.
//
// POST /api/tasks is one door in front of twenty kinds and carried one bucket
// (120/10min per IP) calibrated for the cheapest of them. The exhaustiveness test
// below is what keeps that from happening again: a kind added to TASK_KINDS without
// a class here is a compile error (and a red test), not a silently generous budget.
//
// Runner: node:test, via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TASK_BUDGETS,
  TASK_BUDGET_CLASS,
  TASK_BUDGET_CLASSES,
  taskBudget,
  taskBudgetClass,
} from "./task-budget.ts";
import { TASK_KINDS } from "./task-kinds.ts";

test("every task kind carries an explicit budget class", () => {
  // The table is `Record<TaskKind, …>`, so tsc already refuses a missing kind; this
  // pins the runtime shape (no stale extra key survives a cast) without parsing the
  // text of tasks.ts, which the previous revision did.
  assert.deepEqual(Object.keys(TASK_BUDGET_CLASS).sort(), [...TASK_KINDS].sort());
  for (const k of TASK_KINDS) {
    assert.ok(TASK_BUDGET_CLASSES.includes(TASK_BUDGET_CLASS[k]), `${k} has a class outside the vocabulary`);
    assert.equal(taskBudgetClass(k), TASK_BUDGET_CLASS[k], `${k} is budgeted by its declared class, not the fallback`);
  }
});

test("an unclassified kind falls to the TIGHTEST budget, never the loosest", () => {
  assert.equal(taskBudgetClass("a_kind_nobody_budgeted"), "agent");
  assert.equal(taskBudget("a_kind_nobody_budgeted").ip.limit, TASK_BUDGETS.agent.ip.limit);
});

test("the classes are strictly ordered, and the expensive ones are capped per workspace", () => {
  // The whole point of the split: cheap > metered > agent, with no ties. A future
  // edit that widens `agent` past `metered` has silently deleted the distinction.
  assert.ok(TASK_BUDGETS.cheap.ip.limit > TASK_BUDGETS.metered.ip.limit);
  assert.ok(TASK_BUDGETS.metered.ip.limit > TASK_BUDGETS.agent.ip.limit);
  // The numbers this direction states, pinned so a widening is deliberate.
  assert.deepEqual(TASK_BUDGETS.cheap, { ip: { limit: 120, windowMs: 600_000 }, workspace: null });
  assert.deepEqual(TASK_BUDGETS.metered, { ip: { limit: 30, windowMs: 600_000 }, workspace: { limit: 90, windowMs: 3_600_000 } });
  assert.deepEqual(TASK_BUDGETS.agent, { ip: { limit: 6, windowMs: 600_000 }, workspace: { limit: 15, windowMs: 3_600_000 } });
  // The per-workspace cap is the half that survives an IP rotation and a shared
  // NAT, so the two spending classes must have one and the cheap class need not.
  assert.equal(TASK_BUDGETS.cheap.workspace, null);
  assert.ok(TASK_BUDGETS.metered.workspace && TASK_BUDGETS.agent.workspace);
  assert.ok(TASK_BUDGETS.metered.workspace.limit > TASK_BUDGETS.agent.workspace.limit);
});

test("the kinds whose cost is unbounded by the request are all `agent`", () => {
  // repo_scan clones a repository; lifecycle runs a whole dev-case orchestration;
  // group_eval reasons over a cohort; batch_screen fires one LLM call per active
  // entry on the board. None of their costs is set by the size of the POST body.
  for (const k of ["repo_scan", "lifecycle", "group_eval", "batch_screen"]) {
    assert.equal(taskBudgetClass(k), "agent", `${k} must not ride a burst budget`);
  }
  // …and the burst path stays cheap, or a 50-card bulk accept starts dropping
  // interview-prep artifacts.
  for (const k of ["automation", "interview_prep", "reasoning"]) {
    assert.equal(taskBudgetClass(k), "cheap", `${k} is the Decisions burst path`);
  }
});
