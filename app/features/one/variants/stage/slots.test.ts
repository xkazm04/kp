// The Stage keeps a view in its slot: a close frees a slot without sliding neighbours,
// a replacement lands where the replaced view was, and Undo restores the old seat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignSlots, STAGE_SLOTS } from "./slots.ts";
import { initialSession, sessionReducer, type SessionAction, type SessionState } from "../../engine/session.ts";

const run = (s: SessionState, ...actions: SessionAction[]) => actions.reduce(sessionReducer, s);
const show = (kind: "needs" | "funnel" | "outbox" | "jobDrafts" | "scheduleAhead"): SessionAction => ({ type: "show", kind });

/** Replays the variant's own loop: seat after every step, carrying the memory. */
function seatAll(states: SessionState[]) {
  let memory = {};
  return states.map((s) => {
    const plan = assignSlots(memory, s.panels.map((p) => p.id));
    memory = plan.memory;
    return plan.bySlot;
  });
}

test("the grid is three declared slots, the first one the lead span", () => {
  assert.equal(STAGE_SLOTS.length, 3);
  assert.equal(STAGE_SLOTS[0].span, "lead");
});

test("views fill the slots in reading order", () => {
  assert.deepEqual(assignSlots({}, ["p1", "p2"]).bySlot, ["p1", "p2", null]);
});

test("closing a view frees its slot and its neighbours do not slide", () => {
  const a = run(initialSession(), show("needs"), show("funnel"), show("outbox"));
  const b = run(a, { type: "close", panelId: a.panels[0].id });
  const [, seated] = seatAll([a, b]);
  assert.deepEqual(seated, [null, a.panels[1].id, a.panels[2].id]);
});

test("a new view takes the freed slot", () => {
  const a = run(initialSession(), show("needs"), show("funnel"), show("outbox"));
  const b = run(a, { type: "close", panelId: a.panels[1].id });
  const c = run(b, show("jobDrafts"));
  const [, , seated] = seatAll([a, b, c]);
  assert.equal(seated[0], a.panels[0].id);
  assert.equal(seated[2], a.panels[2].id);
  assert.equal(seated[1], c.panels.at(-1)!.id);
});

test("a fourth view lands in the oldest UNPINNED view's slot; the pinned view stays put", () => {
  const a = run(initialSession(), show("needs"), show("funnel"), show("outbox"));
  const b = run(a, { type: "pin", panelId: a.panels[0].id });
  const c = run(b, show("jobDrafts"));
  const [, , seated] = seatAll([a, b, c]);
  assert.equal(seated[0], a.panels[0].id, "pinned lead keeps slot A");
  assert.equal(seated[2], a.panels[2].id);
  assert.notEqual(seated[1], a.panels[1].id, "the oldest unpinned (slot B) was replaced");
  assert.equal(c.panels.find((p) => p.id === seated[1])?.kind, "jobDrafts");
});

test("Undo puts the stage back exactly — every view in the slot it held", () => {
  const a = run(initialSession(), show("needs"), show("funnel"), show("outbox"));
  const b = run(a, { type: "close", panelId: a.panels[0].id });
  const c = run(b, { type: "undo" });
  const [first, , restored] = seatAll([a, b, c]);
  assert.deepEqual(restored, first);
});

test("a remembered seat that is already taken falls back to the lowest free slot", () => {
  const plan = assignSlots({ p1: 0, p2: 0 }, ["p1", "p2"]);
  assert.deepEqual(plan.bySlot, ["p1", "p2", null]);
});
