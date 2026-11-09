// The one validation door: unknown → dropped and counted; a stray act field drops the
// whole act; an invented entry id drops; a figure in the conductor's words is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReply } from "./validate.ts";

const say = { key: "needsShown" };

test("unknown verbs, panels, acts and tabs are dropped and counted", () => {
  const { reply, dropped } = validateReply({
    say,
    chips: ["needs", "nope", "needs"],
    ops: [
      { op: "show", panel: "needs" },
      { op: "resize", panel: "needs" },
      { op: "show", panel: "ledger" },
      { op: "propose", act: "fireEveryone", params: {} },
      { op: "navigate", tab: "nowhere" },
    ],
  });
  assert.deepEqual(reply.ops, [{ op: "show", panel: "needs" }]);
  assert.deepEqual(reply.chips, ["needs"]);
  assert.equal(dropped, 4);
});

test("more than 4 ops: the rest are dropped", () => {
  const ops = Array.from({ length: 6 }, () => ({ op: "show", panel: "funnel" }));
  const { reply, dropped } = validateReply({ say, chips: [], ops });
  assert.equal(reply.ops.length, 4);
  assert.equal(dropped, 2);
});

test("a proposal with a field its act does not declare is dropped WHOLE", () => {
  const { reply, dropped } = validateReply({
    say,
    chips: [],
    ops: [{ op: "propose", act: "wave", params: { mode: "reject", threshold: "40", amount: "1" } }],
  });
  assert.deepEqual(reply.ops, []);
  assert.equal(dropped, 1);
});

test("an entry act bound to an id the user was never shown is dropped", () => {
  const op = { op: "propose", act: "entryReject", params: { entryId: "e9", expectedStage: "Screened" } };
  assert.equal(validateReply({ say, chips: [], ops: [op] }).dropped, 1);
  assert.equal(validateReply({ say, chips: [], ops: [op] }, { knownEntryIds: new Set(["e9"]) }).dropped, 0);
});

test("a figure in the say values is refused: the say falls back, no values carried", () => {
  const { reply, dropped } = validateReply({ say: { key: "needsShown", values: { n: "12 candidates" } }, chips: [], ops: [] });
  assert.deepEqual(reply.say, { key: "notYet" });
  assert.equal(reply.fallback, true);
  assert.equal(dropped, 1);
});

test("focus on a panel not on screen is dropped", () => {
  const r = validateReply({ say, chips: [], ops: [{ op: "focus", panelId: "p9" }] }, { panelIds: new Set(["p1"]) });
  assert.equal(r.dropped, 1);
});
