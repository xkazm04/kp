// Pure logic for facts about one gig (facts.ts, untrusted.ts): the deadline, evidence in
// three states, the desk's Approve and Mark sent gates, and invisible characters made visible.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint.ts";
import { deadlineView, deskGate, evidenceState, markSentGate } from "./facts.ts";
import { NOW } from "./fixtures.ts";
import { revealInvisible } from "./untrusted.ts";

test("deadlineView: none, passed, soon (3 days or less), open", () => {
  assert.deepEqual(deadlineView(null, NOW), { state: "none" });
  assert.equal(deadlineView("2026-09-20T00:00:00.000Z", NOW).state, "passed");
  assert.equal(deadlineView("2026-09-26T00:00:00.000Z", NOW).state, "soon");
  assert.equal(deadlineView("2026-10-24T00:00:00.000Z", NOW).state, "open");
  assert.deepEqual(deadlineView("not a date", NOW), { state: "none" });
});

test("evidenceState keeps three states: unverified is not failed", () => {
  assert.equal(evidenceState(true), "passed");
  assert.equal(evidenceState(false), "failed");
  assert.equal(evidenceState(null), "unverified");
});

function finding(id: string, severity: DraftLintFinding["severity"], line: number | null = null): DraftLintFinding {
  return { id, severity, line, messageKey: "doubledWord", params: {} };
}

test("deskGate: blockers first, then the checklist, then unseen warns; info never gates", () => {
  const items = ["a", "b", "disclosure"];
  const findings = [finding("x", "blocker"), finding("w", "warn", 2), finding("i", "info")];
  assert.deepEqual(deskGate(items, {}, findings, new Set()).reason, { kind: "blockers", count: 1 });
  const noBlock = findings.slice(1);
  assert.deepEqual(deskGate(items, { a: true }, noBlock, new Set()).reason, { kind: "checklist", ticked: 1, total: 3 });
  const allTicked = { a: true, b: true, disclosure: true };
  assert.deepEqual(deskGate(items, allTicked, noBlock, new Set()).reason, { kind: "unseen", count: 1 });
  const g = deskGate(items, allTicked, noBlock, new Set(["w"]));
  assert.equal(g.ready, true);
  assert.equal(g.reason, null);
  assert.equal(deskGate(items, { ...allTicked, b: false }, [], new Set()).ready, false);
});

test("markSentGate counts the checklist", () => {
  assert.deepEqual(markSentGate(["a", "disclosure"], { a: true }), { ticked: 1, total: 2, ready: false });
  assert.equal(markSentGate(["a", "disclosure"], { a: true, disclosure: true }).ready, true);
});

test("revealInvisible turns zero-width and direction controls into visible markers", () => {
  const segs = revealInvisible("pay​me‮now");
  assert.deepEqual(segs, [
    { kind: "text", text: "pay" },
    { kind: "invisible", code: "U+200B" },
    { kind: "text", text: "me" },
    { kind: "invisible", code: "U+202E" },
    { kind: "text", text: "now" },
  ]);
  assert.deepEqual(revealInvisible("plain"), [{ kind: "text", text: "plain" }]);
});
