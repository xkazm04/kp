// Poll-tick render diet (perfect-board) — the content-equality short-circuit and
// the React.memo predicates are PURE, so they are pinned here directly. Together
// they prove the acceptance: a no-change poll produces an IDENTICAL board
// signature (→ setEntries is skipped → no render), and when the board does change,
// candidateRowEqual / stageCellSignature flag exactly the rows that changed.
//
// No DB, no React: entrySignature/provenanceOf read only plain fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardSignature,
  eventsSignature,
  candidateRowEqual,
  entrySignature,
  stageCellSignature,
} from "./pipeline-render-diet.ts";
import type { Entry, PipelineEvent } from "./PipelineTypes.ts";

function makeEntry(over: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    candidateId: "c1",
    candidateLabel: "Ann Novak",
    archetype: "bau",
    roleFamily: "eng",
    jobId: "jd-test",
    jobTitle: "Backend Engineer",
    stage: "Screened",
    matchScore: 72,
    status: "active",
    approvalKind: null,
    approvalDetail: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    stageChangedAt: "2026-01-02T00:00:00.000Z",
    ...over,
  };
}

test("boardSignature: content-equal payloads (distinct objects) share a signature; a field change breaks it", () => {
  const a = [makeEntry(), makeEntry({ id: "e2", candidateLabel: "Bo Li" })];
  // A fresh array of fresh objects — exactly what a no-change poll hands setEntries.
  const b = [makeEntry(), makeEntry({ id: "e2", candidateLabel: "Bo Li" })];
  assert.equal(boardSignature(a), boardSignature(b), "identical content ⇒ identical signature (poll is a no-op)");

  // A real change to any rendered field flips the signature.
  const moved = [makeEntry({ stage: "Interview" }), makeEntry({ id: "e2", candidateLabel: "Bo Li" })];
  assert.notEqual(boardSignature(a), boardSignature(moved), "a stage move changes the signature");

  // Order is significant (the lane layout is order-derived).
  const reordered = [makeEntry({ id: "e2", candidateLabel: "Bo Li" }), makeEntry()];
  assert.notEqual(boardSignature(a), boardSignature(reordered), "reordering changes the signature");
});

test("entrySignature covers the fields the card renders (and only those)", () => {
  const base = makeEntry();
  const same = makeEntry({ candidateId: "OTHER", roleFamily: "OTHER", jobTitle: "Backend Engineer" });
  // candidateId + roleFamily are NOT rendered on the card, so they don't move the signature.
  // (jobTitle isn't on the card row either, but it IS used by reject_below scoping /
  //  the drawer — keep it out of the row signature; the board doesn't render it per card.)
  assert.equal(entrySignature(base), entrySignature(same), "non-rendered fields don't churn the row");

  for (const change of [
    { candidateLabel: "Zed" },
    { archetype: "student" },
    { stage: "Offer" },
    { status: "rejected" },
    { matchScore: 10 },
    { stageChangedAt: "2026-02-02T00:00:00.000Z" },
    { approvalKind: "offer_review" },
    { intakeDegraded: true },
    { intakeDegradedReason: "no cv" },
  ] as Partial<Entry>[]) {
    assert.notEqual(entrySignature(base), entrySignature(makeEntry(change)), `changing ${Object.keys(change)[0]} re-renders the row`);
  }
});

test("candidateRowEqual: equal when content + flags match across distinct objects; unequal on any visible change", () => {
  const p = { entry: makeEntry(), pending: false, stale: false, selectMode: false, selected: false, draggable: true, onActions: () => {}, onMove: () => {} };
  // Fresh entry object + fresh handler closures (what a re-render produces) — still equal.
  const q = { entry: makeEntry(), pending: false, stale: false, selectMode: false, selected: false, draggable: true, onActions: () => {}, onMove: () => {} };
  assert.equal(candidateRowEqual(p, q), true, "a bare re-render (new closures, same data) must NOT reconcile the row");

  assert.equal(candidateRowEqual(p, { ...q, entry: makeEntry({ stage: "Interview" }) }), false, "a stage change re-renders");
  assert.equal(candidateRowEqual(p, { ...q, stale: true }), false, "an aging flip re-renders");
  assert.equal(candidateRowEqual(p, { ...q, selected: true }), false, "a selection change re-renders");
  assert.equal(candidateRowEqual(p, { ...q, onActions: undefined }), false, "losing the actions affordance re-renders");
});

test("stageCellSignature folds stale + selected state, so an SLA/selection change re-renders the cell", () => {
  const entries = [makeEntry(), makeEntry({ id: "e2" })];
  const noneStale = () => false;
  const e1Stale = (e: Entry) => e.id === "e1";
  const noSel: ReadonlySet<string> = new Set();
  const e1Sel: ReadonlySet<string> = new Set(["e1"]);

  const base = stageCellSignature(entries, noneStale, noSel);
  assert.equal(base, stageCellSignature([makeEntry(), makeEntry({ id: "e2" })], noneStale, noSel), "identical cell ⇒ identical signature");
  assert.notEqual(base, stageCellSignature(entries, e1Stale, noSel), "an SLA override that ages e1 re-renders the cell");
  assert.notEqual(base, stageCellSignature(entries, noneStale, e1Sel), "selecting e1 re-renders the cell");
});

test("eventsSignature: identical feed shares a signature; a new event breaks it", () => {
  const ev = (id: number, kind: string): PipelineEvent => ({ id, candidateLabel: "A. N.", jobTitle: "Role", kind, toStage: "Interview", detail: null, createdAt: "2026-01-01T00:00:00.000Z" });
  const a = [ev(2, "advanced"), ev(1, "added")];
  assert.equal(eventsSignature(a), eventsSignature([ev(2, "advanced"), ev(1, "added")]), "same feed ⇒ same signature");
  assert.notEqual(eventsSignature(a), eventsSignature([ev(3, "rejected"), ...a]), "a new event changes the signature");
});
