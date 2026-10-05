import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalStack, ATLAS_ROOT, atlasReduce, depthOf, isSetupLens, layerKey, topOf, type AtlasStack } from "./atlasNav";

test("the sky is the root and never leaves", () => {
  assert.deepEqual(atlasReduce(ATLAS_ROOT, { type: "pop" }), ATLAS_ROOT);
  assert.deepEqual(atlasReduce(ATLAS_ROOT, { type: "popTo", depth: 0 }), ATLAS_ROOT);
  assert.deepEqual(atlasReduce([{ level: 0 }, { level: 1, lens: "sieve" }], { type: "push", entry: { level: 0 } }), ATLAS_ROOT);
});

test("a lens opens over the sky, a posting over a lens, and a pop walks back", () => {
  let s: AtlasStack = atlasReduce(ATLAS_ROOT, { type: "push", entry: { level: 1, lens: "evening" } });
  s = atlasReduce(s, { type: "push", entry: { level: 2, id: "p1" } });
  assert.equal(depthOf(s), 2);
  assert.deepEqual(topOf(s), { level: 2, id: "p1" });
  s = atlasReduce(s, { type: "pop" });
  assert.deepEqual(topOf(s), { level: 1, lens: "evening" });
});

test("pushing a place already on the stack returns to it instead of stacking a second one", () => {
  const s: AtlasStack = [{ level: 0 }, { level: 1, lens: "sieve" }, { level: 2, id: "p1" }];
  const back = atlasReduce(s, { type: "push", entry: { level: 1, lens: "sieve" } });
  assert.deepEqual(back, [{ level: 0 }, { level: 1, lens: "sieve" }]);
});

test("a sideways step (the next posting) keeps its level", () => {
  const s: AtlasStack = [{ level: 0 }, { level: 2, id: "p1" }];
  assert.deepEqual(atlasReduce(s, { type: "replaceTop", entry: { level: 2, id: "p2" } }), [{ level: 0 }, { level: 2, id: "p2" }]);
  assert.deepEqual(atlasReduce(s, { type: "replaceTop", entry: { level: 1, lens: "cv" } }), s, "a step never changes the level");
});

test("a deep link lands on the posting over the sky; none lands on the sky", () => {
  assert.deepEqual(arrivalStack("p9"), [{ level: 0 }, { level: 2, id: "p9" }]);
  assert.deepEqual(arrivalStack(null), ATLAS_ROOT);
});

test("layer keys differ per place, and setup lenses are told apart from market lenses", () => {
  assert.notEqual(layerKey({ level: 2, id: "a" }, 1), layerKey({ level: 2, id: "b" }, 1));
  assert.equal(isSetupLens("want"), true);
  assert.equal(isSetupLens("sources"), false);
});
