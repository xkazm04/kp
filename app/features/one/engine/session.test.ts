// The session rules: cap 3 (the 4th replaces the oldest UNPINNED), pins ≤ 2, one-step
// undo of screen changes, the user's hand supersedes a pending reply, stop restores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentOf, initialSession, positionOf, sessionReducer, type SessionAction, type SessionState } from "./session.ts";
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

const ask = (text: string, ops: Reply["ops"]): SessionAction => ({ type: "submit", input: { text }, reply: reply(ops), dropped: 0 });
const kinds = (s: SessionState) => s.panels.map((p) => p.kind);

test("an answer is captured when its ops apply, not before", () => {
  let s = run(initialSession(), ask("a", [{ op: "show", panel: "needs" }]));
  assert.equal(s.answers.length, 0, "the beat has not ended");
  assert.equal(currentOf(s)?.asked.text, "a", "the pending question is already the one in view");
  s = run(s, { type: "applyPending" });
  assert.equal(s.answers.length, 1);
  assert.deepEqual(positionOf(s), { index: 0, total: 1 });
  assert.deepEqual(currentOf(s)?.panels.map((p) => p.kind), ["needs"]);
});

test("a reply with no screen ops is an answer at once", () => {
  const s = run(initialSession(), ask("hello", []));
  assert.equal(s.answers.length, 1);
  assert.equal(s.cursor, 0);
});

test("stepping back and forward round-trips each answer's arrangement and reply", () => {
  let s = run(
    initialSession(),
    ask("one", [{ op: "show", panel: "needs" }]),
    { type: "applyPending" },
    ask("two", [{ op: "show", panel: "funnel" }]),
    { type: "applyPending" }
  );
  assert.deepEqual(kinds(s), ["needs", "funnel"]);
  assert.equal(s.cursor, 1);
  s = run(s, { type: "stepBack" });
  assert.equal(s.cursor, 0);
  assert.deepEqual(kinds(s), ["needs"], "the first answer's own arrangement");
  assert.equal(currentOf(s)?.asked.text, "one");
  assert.deepEqual(s.lastChange, { key: "stepped", answer: 1, of: 2 });
  s = run(s, { type: "stepForward" });
  assert.deepEqual(kinds(s), ["needs", "funnel"]);
  assert.equal(currentOf(s)?.asked.text, "two");
  s = run(s, { type: "stepForward" });
  assert.equal(s.cursor, 1, "no answer past the last");
});

test("a submit while an older answer is in view appends at the end", () => {
  let s = run(initialSession(), ask("one", [{ op: "show", panel: "needs" }]), { type: "applyPending" }, ask("two", [{ op: "show", panel: "funnel" }]), { type: "applyPending" });
  s = run(s, { type: "stepBack" }, ask("three", [{ op: "show", panel: "outbox" }]), { type: "applyPending" });
  assert.equal(s.answers.length, 3);
  assert.equal(s.cursor, 2);
  assert.deepEqual(s.answers.map((x) => x.asked.text), ["one", "two", "three"]);
  assert.deepEqual(kinds(s), ["needs", "outbox"], "the new answer builds on the arrangement that was in view");
});

test("stepping is navigation: it never lands on the undo stack, and undo still covers screen changes", () => {
  let s = run(initialSession(), ask("one", [{ op: "show", panel: "needs" }]), { type: "applyPending" }, ask("two", [{ op: "show", panel: "funnel" }]), { type: "applyPending" });
  const depth = s.history.length;
  s = run(s, { type: "stepBack" }, { type: "stepForward" });
  assert.equal(s.history.length, depth);
  s = run(s, { type: "close", panelId: s.panels[0].id });
  assert.equal(s.history.length, depth + 1);
  s = run(s, { type: "undo" });
  assert.deepEqual(kinds(s), ["needs", "funnel"]);
  assert.equal(s.lastChange?.key, "undone");
});

test("a hand change while an answer is current is written back into that answer", () => {
  let s = run(initialSession(), ask("one", [{ op: "show", panel: "needs" }]), { type: "applyPending" }, ask("two", [{ op: "show", panel: "funnel" }]), { type: "applyPending" });
  s = run(s, { type: "stepBack" }, { type: "close", panelId: s.panels[0].id }, { type: "stepForward" }, { type: "stepBack" });
  assert.deepEqual(kinds(s), [], "answer one now remembers its closed view");
});

test("answers are capped at 20, oldest dropped, cursor on the newest", () => {
  let s = initialSession();
  for (let i = 0; i < 23; i++) s = run(s, ask(`q${i}`, []));
  assert.equal(s.answers.length, 20);
  assert.equal(s.answers[0].asked.text, "q3");
  assert.equal(s.cursor, 19);
});

test("stepping waits out a pending beat", () => {
  let s = run(initialSession(), ask("one", []), ask("two", [{ op: "show", panel: "needs" }]));
  s = run(s, { type: "stepBack" });
  assert.equal(s.cursor, 0, "unchanged while pending");
});

test("a proposal belongs to the answer it came with, and a hand proposal to the answer in view", () => {
  let s = run(initialSession(), ask("one", [{ op: "propose", act: "wave", params: { mode: "advance", count: "2" } }]));
  assert.equal(currentOf(s)?.proposals.length, 1);
  s = run(s, ask("two", []));
  assert.equal(currentOf(s)?.proposals.length, 0);
  s = run(s, { type: "propose", act: "entryAdvance", params: { entryId: "e" } });
  assert.equal(currentOf(s)?.proposals.length, 1);
  s = run(s, { type: "stepBack" });
  assert.equal(currentOf(s)?.proposals.length, 1, "answer one's own proposal, not answer two's");
  assert.equal(currentOf(s)?.proposals[0].act, "wave");
});

test("the change line carries a view's params, so it can be named by its title", () => {
  let s = run(initialSession(), { type: "show", kind: "pipelineSlice", params: { filter: "aging" } });
  assert.deepEqual(s.lastChange, { key: "shown", panel: "pipelineSlice", params: { filter: "aging" } });
  s = run(s, show("needs"), show("funnel"), show("outbox"));
  assert.deepEqual(s.lastChange, { key: "replaced", panel: "outbox", previous: "pipelineSlice", previousParams: { filter: "aging" } });
});

test("selection is navigation: no undo step, kept across a hand change and a step back, cleared by a new answer", () => {
  const ask = (key: "needsShown" | "funnelShown", panel: "needs" | "funnel"): SessionAction => ({
    type: "submit",
    input: { text: panel },
    reply: { say: { key }, ops: [{ op: "show", panel }], chips: [] },
    dropped: 0,
  });
  let s = run(initialSession(), ask("needsShown", "needs"), { type: "applyPending" }, ask("funnelShown", "funnel"), { type: "applyPending" });
  const undoDepth = s.history.length;
  s = run(s, { type: "select", entry: { entryId: "pe-1", label: "Ana" } });
  assert.deepEqual(s.selected, { entryId: "pe-1", label: "Ana" });
  assert.equal(s.history.length, undoDepth, "selecting is not an undo step");
  assert.equal(run(s, { type: "select", entry: { entryId: "pe-1", label: "Ana" } }), s, "re-selecting the same candidate changes nothing");
  s = run(s, { type: "stepBack" });
  assert.equal(s.selected?.entryId, "pe-1", "a glance at an older answer keeps the tool open");
  s = run(s, show("outbox"), { type: "undo" });
  assert.equal(s.selected?.entryId, "pe-1", "the hand and undo leave it");
  s = run(s, { type: "select", entry: null });
  assert.equal(s.selected, null);
  s = run(s, { type: "select", entry: { entryId: "pe-2", label: "Ben" } }, ask("needsShown", "needs"));
  assert.equal(s.selected, null, "a new answer is a new context");
});
