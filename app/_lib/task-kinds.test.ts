// The task-kind vocabulary: one literal array every per-kind table is keyed by.
//
// Before this module, "what is a task kind" was answered by the keys of a
// `Record<string, Spec>` in tasks.ts, and three tests regex-parsed that file's text
// to prove the budget, outcome and tenancy tables were exhaustive. The vocabulary is
// now a leaf module (no imports: safe for client bundles and for this runner, which
// cannot import tasks.ts because it pulls better-sqlite3), so the tables are keyed
// `Record<TaskKind, …>` and tsc — not text parsing — names a missing entry.
//
// Runner: node:test, via `npm run test:unit`. The conditional-type fixtures below are
// the typecheck half: `npm run typecheck` is green only while every `Assert` below holds.
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
// Checked by tsc, never executed. A misspelled kind must be rejected both by the union
// and by the provider's `startTask`, which is what the ~25 client call sites pass
// their literals to. Written as conditional types rather than `@ts-expect-error`
// directives, which ts-debt.json ratchets: if TaskKind ever widens back to `string`,
// `Assert<false>` below is the compile error.
type Assert<T extends true> = T;
type StartKind = Parameters<TasksCtx["startTask"]>[0];
export type TypoIsNotAKind = Assert<"batch_sceen" extends TaskKind ? false : true>;
export type StartRejectsATypo = Assert<"batch_sceen" extends StartKind ? false : true>;
export type RealKindIsAccepted = Assert<"batch_screen" extends StartKind ? true : false>;
