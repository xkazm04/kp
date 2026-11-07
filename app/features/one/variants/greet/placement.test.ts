import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, GREETING_OWNER, place } from "./placement.ts";

const view = (id: string, pinned = false) => ({ id, pinned });

test("a view opened before any reply belongs to the greeting", () => {
  assert.deepEqual(place({}, ["p1"], null), { p1: GREETING_OWNER });
});

test("new views go to the newest reply; placed ones never move", () => {
  const a = place({}, ["p1"], "t2");
  const b = place(a, ["p1", "p3"], "t4");
  assert.deepEqual(b, { p1: "t2", p3: "t4" });
});

test("no new id → the same object (no re-render churn)", () => {
  const a = place({}, ["p1"], "t2");
  assert.equal(place(a, ["p1"], "t9"), a);
});

test("undo brings an id back under the reply it came from", () => {
  let owners = place({}, ["p1"], "t2");
  owners = place(owners, ["p3"], "t4"); // p1 replaced by p3 at t4
  owners = place(owners, ["p1"], "t6"); // undo restores p1 while t6 is newest
  assert.equal(owners.p1, "t2");
});

test("pinned views leave the conversation; unplaced ones fall back, never vanish", () => {
  const { byOwner, pinned } = arrange([view("p1"), view("p2", true), view("p3")], { p1: "t2" }, "t4");
  assert.deepEqual(pinned.map((p) => p.id), ["p2"]);
  assert.deepEqual(byOwner.t2.map((p) => p.id), ["p1"]);
  assert.deepEqual(byOwner.t4.map((p) => p.id), ["p3"]);
});
