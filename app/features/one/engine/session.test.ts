// The session rules: cap 3 (the 4th replaces the oldest UNPINNED), pins ≤ 2, one-step
// undo of screen changes, the user's hand supersedes a pending reply, stop restores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSession, sessionReducer, type SessionAction, type SessionState } from "./session.ts";
import type { Reply } from "../types.ts";

const run = (s: SessionState, ...actions: SessionAction[]) => actions.reduce(sessionReducer, s);
const show = (kind: "needs" | "funnel" | "outbox" | "jobDrafts" | "scheduleAhead", params?: Record<string, string>): SessionAction => ({ type: "show", kind, params });
const reply = (ops: Reply["ops"]): Reply => ({ say: { key: "needsShown" }, ops, chips: [] });

test("a fourth view replaces the oldest unpinned one, in its slot, and says which", () => {
  let s = run(initialSession(), show("needs"), show("funnel"), show("outbox"));
  const first = s.panels[0].id;
  s = run(s, { type: "pin", panelId: first }, show("jobDrafts"));
  assert.deepEqual(s.panels.map((p) => p.kind), ["needs", "jobDrafts", "outbox"]);
  assert.deepEqual(s.lastChange, { key: "replaced", panel: "jobDrafts", previous: "funnel" });
});

test("showing a view already on screen focuses it instead of duplicating it", () => {
  const s = run(initialSession(), show("needs"), show("funnel"), show("needs"));
  assert.equal(s.panels.length, 2);
  assert.equal(s.focusId, s.panels[0].id);
  assert.equal(s.lastChange?.key, "focused");
});

test("pins are capped at two, said on the change line", () => {
  let s = run(initialSession(), show("needs"), show("funnel"), show("outbox"));
  s = run(s, { type: "pin", panelId: s.panels[0].id }, { type: "pin", panelId: s.panels[1].id }, { type: "pin", panelId: s.panels[2].id });
  assert.equal(s.panels.filter((p) => p.pinned).length, 2);
  assert.equal(s.lastChange?.key, "pinLimit");
});

test("undo restores exactly the arrangement before the last step", () => {
  let s = run(initialSession(), show("needs"), show("funnel"));
  const before = s.panels.map((p) => p.id);
  s = run(s, { type: "close", panelId: s.panels[0].id });
  assert.equal(s.panels.length, 1);
  s = run(s, { type: "undo" });
  assert.deepEqual(s.panels.map((p) => p.id), before);
  assert.equal(s.lastChange?.key, "undone");
});

test("a reply's ops wait; applying them is a group of undoable steps", () => {
  let s = run(initialSession(), { type: "submit", input: { text: "x" }, reply: reply([{ op: "show", panel: "needs" }, { op: "show", panel: "funnel" }]), dropped: 0 });
  assert.equal(s.panels.length, 0, "nothing moves before the beat");
  assert.equal(s.turns.length, 2);
  s = run(s, { type: "applyPending" });
  assert.equal(s.panels.length, 2);
  s = run(s, { type: "undo" });
  assert.equal(s.panels.length, 1, "one step back at a time");
});

test("the user's hand supersedes a pending reply: the ops drop, and the line says so", () => {
  let s = run(initialSession(), show("needs"));
  s = run(s, { type: "submit", input: { text: "x" }, reply: reply([{ op: "show", panel: "funnel" }]), dropped: 0 });
  s = run(s, { type: "pin", panelId: s.panels[0].id }, { type: "applyPending" });
  assert.deepEqual(s.panels.map((p) => p.kind), ["needs"]);
  assert.equal(s.lastChange?.key, "pinned");
  assert.equal(s.lastChange?.droppedPending, true);
});

test("stop drops pending ops and restores the screen from before the turn", () => {
  let s = run(initialSession(), show("needs"));
  s = run(s, { type: "submit", input: { text: "x" }, reply: reply([{ op: "show", panel: "funnel" }]), dropped: 0 }, { type: "stop" }, { type: "applyPending" });
  assert.deepEqual(s.panels.map((p) => p.kind), ["needs"]);
  assert.equal(s.lastChange?.key, "stopped");
});

test("proposals land with the turn and survive the user's hand; navigate becomes a link", () => {
  let s = run(initialSession(), show("needs"));
  s = run(s, {
    type: "submit",
    input: { text: "x" },
    reply: reply([{ op: "propose", act: "wave", params: { mode: "advance", count: "2" } }, { op: "navigate", tab: "pipeline" }]),
    dropped: 0,
  });
  assert.equal(s.proposals.length, 1);
  assert.equal(s.pending, null, "neither propose nor navigate is a pending screen change");
  const one = s.turns[1];
  assert.ok(one.who === "one" && one.links.length === 1);
  s = run(s, { type: "close", panelId: s.panels[0].id });
  assert.equal(s.proposals.length, 1);
});
