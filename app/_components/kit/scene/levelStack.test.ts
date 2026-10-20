// The level stack's generic half: the root never leaves, a push of a place already on the stack
// returns to it, a breadcrumb pops to its depth, a sideways step keeps its level, a reset needs a
// root; and only the top level is ever in the page flow. The Night Post pins its own grammar on top
// (channels/night/channelsNightNav.test.ts).
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { layerModeAt, levelReduce, type LevelAction, type LevelRules } from "./levelStack.ts";

type E = { level: number; id: string };
const ROOT: readonly E[] = [{ level: 0, id: "home" }];
const RULES: LevelRules<E> = { root: ROOT, same: (a, b) => a.level === b.level && a.id === b.id };
const run = (s: readonly E[], ...acts: LevelAction<E>[]) => acts.reduce((acc, a) => levelReduce(acc, a, RULES), s);
const at = (level: number, id: string): E => ({ level, id });

test("push opens a level over the current one; pop returns; the root never leaves", () => {
  const s = run(ROOT, { type: "push", entry: at(1, "a") }, { type: "push", entry: at(2, "b") });
  assert.deepEqual(s.map((e) => e.level), [0, 1, 2]);
  assert.deepEqual(run(s, { type: "pop" }), [ROOT[0], at(1, "a")]);
  assert.deepEqual(run(s, { type: "pop" }, { type: "pop" }, { type: "pop" }), ROOT, "popping at the root stays at the root");
});

test("a push of a place already on the stack returns to it; pushing level 0 is going home", () => {
  const deep = run(ROOT, { type: "push", entry: at(1, "a") }, { type: "push", entry: at(2, "b") }, { type: "push", entry: at(3, "c") });
  assert.deepEqual(run(deep, { type: "push", entry: at(1, "a") }).map((e) => e.id), ["home", "a"]);
  assert.deepEqual(run(deep, { type: "push", entry: at(0, "elsewhere") }), ROOT);
  assert.equal(run(deep, { type: "push", entry: at(1, "z") }).length, 5, "a different place at a known level stacks");
});

test("popTo is a breadcrumb click, clamped to the stack", () => {
  const s = run(ROOT, { type: "push", entry: at(1, "a") }, { type: "push", entry: at(2, "b") });
  assert.deepEqual(run(s, { type: "popTo", depth: 1 }).map((e) => e.id), ["home", "a"]);
  assert.deepEqual(run(s, { type: "popTo", depth: 0 }), ROOT);
  assert.deepEqual(run(s, { type: "popTo", depth: -4 }), ROOT);
  assert.equal(run(s, { type: "popTo", depth: 9 }).length, 3);
});

test("replaceTop is a sideways step: same level only, never the root", () => {
  const s = run(ROOT, { type: "push", entry: at(1, "a") });
  assert.deepEqual(run(s, { type: "replaceTop", entry: at(1, "b") }).at(-1), at(1, "b"));
  assert.equal(levelReduce(s, { type: "replaceTop", entry: at(2, "b") }, RULES), s, "a sideways step cannot change the level");
  assert.equal(levelReduce(ROOT, { type: "replaceTop", entry: at(0, "x") }, RULES), ROOT, "the root is not replaced");
});

test("a stack without a level-0 root is repaired to the root, by any action", () => {
  assert.deepEqual(run(ROOT, { type: "reset", stack: [at(1, "a")] }), ROOT);
  assert.deepEqual(levelReduce([at(1, "a")], { type: "push", entry: at(1, "b") }, RULES), [ROOT[0], at(1, "b")]);
  const good: E[] = [ROOT[0], at(1, "q")];
  assert.equal(run(ROOT, { type: "reset", stack: good }), good);
});

test("only the top is in the flow; an opening level keeps the one beneath drawn and inert", () => {
  assert.deepEqual([0, 1, 2].map((d) => layerModeAt(d, 2, null)), ["hidden", "hidden", "flow"]);
  assert.deepEqual([0, 1, 2].map((d) => layerModeAt(d, 2, "open")), ["hidden", "under", "entering"]);
  assert.deepEqual([0, 1].map((d) => layerModeAt(d, 1, "close")), ["hidden", "flow"], "the closing level is drawn apart, as `leaving`");
  assert.deepEqual([0, 1].map((d) => layerModeAt(d, 1, "swap")), ["hidden", "swapping"]);
  assert.equal(layerModeAt(0, 0, null), "flow", "the root alone is in the flow");
});
