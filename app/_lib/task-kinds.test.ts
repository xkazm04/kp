// The task-kind vocabulary: one literal array every per-kind table is keyed by.
//
// Before this module, "what is a task kind" was answered by the keys of a
// `Record<string, Spec>` in tasks.ts, and three tests regex-parsed that file's text
// to prove the budget, outcome and tenancy tables were exhaustive. The vocabulary is
// now a leaf module (no imports: safe for client bundles and for this runner, which
// cannot import tasks.ts because it pulls better-sqlite3), so the tables are keyed
// `Record<TaskKind, …>` and tsc — not text parsing — names a missing entry.
//
// Runner: node:test, via `npm run test:unit`. The `@ts-expect-error` lines below are
// the typecheck half: `npm run typecheck` is green only while they are compile errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TASK_KINDS, isTaskKind, type TaskKind } from "./task-kinds.ts";
import type { TasksCtx } from "../features/shell/tasks/tasksProviderTypes.ts";

test("isTaskKind accepts exactly the vocabulary", () => {
  assert.equal(isTaskKind("batch_screen"), true);
  assert.equal(isTaskKind("batch_sceen"), false, "a typo is not a kind");
  assert.equal(isTaskKind(undefined), false);
  assert.equal(isTaskKind(null), false);
  assert.equal(isTaskKind(42), false);
  // A late-bound runner with no queue spec (task-external-runners.ts) is NOT a kind.
  assert.equal(isTaskKind("intake_round"), false);
  // Object.prototype members must not read as kinds (`"constructor" in {}` is true).
  assert.equal(isTaskKind("constructor"), false);
  assert.equal(isTaskKind("toString"), false);
  for (const k of TASK_KINDS) assert.equal(isTaskKind(k), true, k);
});

test("the vocabulary is a set of snake_case ids", () => {
  assert.ok(TASK_KINDS.length >= 20, `expected the full queue vocabulary, got ${TASK_KINDS.length}`);
  assert.equal(new Set(TASK_KINDS).size, TASK_KINDS.length, "no kind is listed twice");
  for (const k of TASK_KINDS) assert.match(k, /^[a-z][a-z_]*$/, `${k} is not a snake_case id`);
});

// ---- typecheck fixtures ------------------------------------------------------
// Never executed: the body exists for tsc. A misspelled kind is a compile error both
// against the union and through the provider's `startTask`, which is what the
// ~25 client call sites pass their literals to.
function typeOnlyFixtures(start: TasksCtx["startTask"]): void {
  // @ts-expect-error — 'batch_sceen' is not a TaskKind
  const bad: TaskKind = "batch_sceen";
  // @ts-expect-error — the provider's startTask only accepts a TaskKind
  void start("batch_sceen", {});
  const good: TaskKind = "batch_screen";
  void start(good, {});
  void bad;
}
void typeOnlyFixtures;
