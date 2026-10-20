// The workforce's places on the kit's level stack (the generic rules are pinned by kit/scene/levelStack.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKFORCE_ROOT, layerKey, stepDrawer, stepWalk, workforceReduce, type WorkforceEntry, type WorkforceStack } from "./workforceNav.ts";

const drawer = (d: "all" | "gigs" | "appmaster" | "other", need: null = null): WorkforceEntry => ({ level: 1, drawer: d, need });
const card = (id: string, walk: string[] = ["a", "b", "c"]): WorkforceEntry => ({ level: 2, id, walk });
const back = (id: string): WorkforceEntry => ({ level: 3, id, walk: [id] });

test("push opens a level; pop returns; the root never leaves", () => {
  let s: WorkforceStack = WORKFORCE_ROOT;
  s = workforceReduce(s, { type: "push", entry: drawer("gigs") });
  s = workforceReduce(s, { type: "push", entry: card("a") });
  s = workforceReduce(s, { type: "push", entry: back("a") });
  assert.deepEqual(s.map((e) => e.level), [0, 1, 2, 3]);
  s = workforceReduce(s, { type: "pop" });
  assert.deepEqual(s.map((e) => e.level), [0, 1, 2]);
  assert.deepEqual(workforceReduce(WORKFORCE_ROOT, { type: "pop" }), WORKFORCE_ROOT);
});

test("a push of a place already on the stack returns to it", () => {
  const s: WorkforceStack = [WORKFORCE_ROOT[0], drawer("gigs"), card("a")];
  assert.deepEqual(workforceReduce(s, { type: "push", entry: drawer("gigs") }).map((e) => e.level), [0, 1]);
  assert.equal(workforceReduce(s, { type: "push", entry: { level: 0 } }).length, 1, "pushing the wheel is going home");
});

test("a sideways step keeps its level; a breadcrumb jumps", () => {
  const s: WorkforceStack = [WORKFORCE_ROOT[0], drawer("gigs"), card("a")];
  assert.deepEqual(workforceReduce(s, { type: "replaceTop", entry: card("b") }).at(-1), card("b"));
  assert.equal(workforceReduce(s, { type: "replaceTop", entry: drawer("other") }), s, "a card cannot become a drawer sideways");
  assert.deepEqual(workforceReduce(s, { type: "popTo", depth: 0 }), WORKFORCE_ROOT);
});

test("walking: cards wrap, one card has nowhere to go, drawers wrap and 'all' has no neighbour", () => {
  assert.equal(stepWalk(["a", "b", "c"], "c", 1), "a");
  assert.equal(stepWalk(["a", "b", "c"], "a", -1), "c");
  assert.equal(stepWalk(["a"], "a", 1), null);
  assert.equal(stepWalk(["a", "b"], "zzz", 1), "a", "a card no longer in the walk falls to its start");
  assert.equal(stepDrawer(["job:1", "gigs", "appmaster"], "appmaster", 1), "job:1");
  assert.equal(stepDrawer(["job:1"], "job:1", 1), null);
  assert.equal(stepDrawer(["job:1", "gigs"], "all", 1), null);
});

test("layer keys: a sideways step remounts, the front and back of one card are one place per depth", () => {
  assert.notEqual(layerKey(card("a"), 2), layerKey(card("b"), 2));
  assert.equal(layerKey(card("a"), 2), layerKey(card("a"), 2));
  assert.notEqual(layerKey(card("a"), 2), layerKey(back("a"), 3));
});
