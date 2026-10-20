// challenge-r09 cv-analyze-workspace/B — the pure half of History's triage drawer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AnalysisRow } from "./HistoryTypes";
import {
  afterDecision,
  applyDecision,
  isTypingTarget,
  pruneToFilter,
  shouldApplySave,
  stepTriage,
  triageKey,
  triageProgress,
  triageQueue,
  triageQueueAround,
} from "./historyTriage";

const row = (slug: string, disposition: string | null, decision_note: string | null = null): AnalysisRow => ({
  slug,
  candidate_label: `Candidate ${slug}`,
  jd_slug: "jd-a",
  score: 70,
  role_family: "engineering",
  seniority: "senior",
  created_at: "2026-09-01T00:00:00.000Z",
  disposition,
  decision_note,
});

const fixture = (): AnalysisRow[] => [row("A", null), row("B", "pass", "no k8s"), row("C", null), row("D", "hold")];

test("queue: 'undecided' keeps only the owed rows, 'all' keeps every row, both in display order", () => {
  const rows = fixture();
  assert.deepEqual(triageQueue(rows, "undecided"), ["A", "C"]);
  assert.deepEqual(triageQueue(rows, "all"), ["A", "B", "C", "D"]);
  // a stored '' is the same "no decision" the server's undecided filter matches
  assert.deepEqual(triageQueue([row("E", ""), row("F", "advance")], "undecided"), ["E"]);
});

test("advance after a decision: next owed row, then null (all decided), never a wrap", () => {
  let rows = fixture();
  assert.equal(afterDecision(rows, "A", "undecided"), "C");
  rows = applyDecision(rows, "A", { disposition: "advance", note: "" });
  // computed on the post-decision rows too: the decided row is still the anchor
  assert.equal(afterDecision(rows, "A", "undecided"), "C");
  rows = applyDecision(rows, "C", { disposition: "hold", note: "" });
  assert.equal(afterDecision(rows, "C", "undecided"), null);
  assert.equal(afterDecision(fixture(), "A", "all"), "B");
});

test("applyDecision replaces only the decided row; input and other rows keep their identity", () => {
  const rows = fixture();
  const next = applyDecision(rows, "A", { disposition: "advance", note: "strong k8s" });
  assert.notEqual(next, rows);
  assert.equal(next[0].disposition, "advance");
  assert.equal(next[0].decision_note, "strong k8s");
  assert.equal(rows[0].disposition, null, "input row untouched");
  for (const i of [1, 2, 3]) assert.equal(next[i], rows[i]);
  // an unknown slug, or a decision the row already carries, is the same array
  assert.equal(applyDecision(rows, "ZZ", { disposition: "pass", note: "" }), rows);
  assert.equal(applyDecision(rows, "B", { disposition: "pass", note: "no k8s" }), rows);
});

test("clearing mirrors the store: '' or an unknown disposition nulls both disposition and note", () => {
  for (const disposition of ["", "maybe"]) {
    const next = applyDecision(fixture(), "B", { disposition, note: "x" });
    assert.equal(next[1].disposition, null);
    assert.equal(next[1].decision_note, null);
  }
  // a whitespace note is stored as NULL, a real one trimmed (writeDisposition's rule)
  assert.equal(applyDecision(fixture(), "A", { disposition: "hold", note: "   " })[0].decision_note, null);
  assert.equal(applyDecision(fixture(), "A", { disposition: "hold", note: " later " })[0].decision_note, "later");
});

test("stepTriage walks without wrapping", () => {
  assert.equal(stepTriage(["A", "C"], "C", 1), null);
  assert.equal(stepTriage(["A", "C"], "A", -1), null);
  assert.equal(stepTriage(["A", "C"], "A", 1), "C");
  assert.equal(stepTriage(["A", "C"], "C", -1), "A");
  assert.equal(stepTriage(["A", "C"], "Z", 1), null);
});

test("the drawer's queue keeps the open row in place after it is decided", () => {
  const rows = applyDecision(fixture(), "A", { disposition: "pass", note: "" });
  assert.deepEqual(triageQueueAround(rows, "undecided", "A"), ["A", "C"]);
  assert.deepEqual(triageQueueAround(rows, "undecided", null), ["C"]);
});

test("keys: j/k walk, typing in a field never skips a candidate", () => {
  assert.equal(triageKey("j", false), "next");
  assert.equal(triageKey("k", false), "prev");
  assert.equal(triageKey("j", true), null);
  assert.equal(triageKey("k", true), null);
  assert.equal(triageKey("x", false), null);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" }), false, "ticking a flag is not typing");
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget(null), false);
});

test("progress is honest about the window", () => {
  assert.deepEqual(triageProgress(fixture(), false), { undecided: 2, decided: 2, ofLoaded: false });
  assert.deepEqual(triageProgress(fixture(), true), { undecided: 2, decided: 2, ofLoaded: true });
});

test("a refused save changes nothing: only a 2xx outcome is applied", () => {
  assert.equal(shouldApplySave({ ok: false, code: "DISPOSITION_ACK_REQUIRED" }), false);
  assert.equal(shouldApplySave({ ok: false, code: "FORBIDDEN_CAPABILITY" }), false);
  assert.equal(shouldApplySave({ ok: false, code: null }), false);
  assert.equal(shouldApplySave({ ok: true }), true);
});

test("closing the drawer prunes rows the active decision filter no longer matches", () => {
  const rows = applyDecision(fixture(), "A", { disposition: "pass", note: "" });
  assert.deepEqual(pruneToFilter(rows, "undecided").map((r) => r.slug), ["C"]);
  assert.deepEqual(pruneToFilter(rows, "pass").map((r) => r.slug), ["A", "B"]);
  assert.equal(pruneToFilter(rows, ""), rows, "no decision filter: the list is untouched");
});

test("wiring: the editor reports every settled save, and the drawer applies only through shouldApplySave", () => {
  const editor = readFileSync(new URL("../../../../_components/results/DispositionEditor.tsx", import.meta.url), "utf8");
  assert.match(editor, /onSettled\?: \(outcome: DispositionOutcome\) => void/);
  // the refusal path and the success path both report; the keepalive flush reports too
  assert.ok((editor.match(/onSettledRef\.current\?\.\(/g) ?? []).length >= 3, "save refusal, save success and flush all report");
  const drawer = readFileSync(new URL("./HistoryTriageDrawer.tsx", import.meta.url), "utf8");
  assert.match(drawer, /<DispositionEditor[\s\S]*key=\{/);
  assert.match(drawer, /shouldApplySave\(/);
  // no second write path: the drawer never PATCHes on its own
  assert.doesNotMatch(drawer, /method:\s*"PATCH"/);
  const tab = readFileSync(new URL("./HistoryTab.tsx", import.meta.url), "utf8");
  assert.match(tab, /applyDecision\(/);
  assert.match(tab, /pruneToFilter\(/);
  const table = readFileSync(new URL("./HistoryTable.tsx", import.meta.url), "utf8");
  assert.match(table, /href=\{`\/history\/\$\{row\.slug\}`\}/, "the slug stays a link to the full report");
  assert.match(table, /onDecide\(row\.slug\)/);
});
