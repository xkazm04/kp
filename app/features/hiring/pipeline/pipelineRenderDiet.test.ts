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
  eventSignature,
  candidateRowEqual,
  entrySignature,
  stageCellSignature,
  agingBucket,
  relativeTimeBucketKey,
} from "./pipelineRenderDiet.ts";
import type { Entry, PipelineEvent } from "@/app/features/shared/pipelineTypes";

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

// Direction 2 — aging that actually ages. The board signature folds the DERIVED
// aging bucket, so a candidate crossing its SLA purely by the clock flips the
// signature (→ setEntries → the amber dot + staleCount update) with NO data change.
const DAY = 86_400_000;

test("agingBucket: fresh below the SLA, aging at/after it; Hired and unparseable read fresh", () => {
  const now = Date.parse("2026-06-01T00:00:00.000Z");
  // Screened SLA is 7 days. 6 days in = fresh; 7 days in = aging.
  const at = (days: number) => makeEntry({ stage: "Screened", stageChangedAt: new Date(now - days * DAY).toISOString() });
  assert.equal(agingBucket(at(6), null, now), 0, "6 days in Screened (SLA 7) is fresh");
  assert.equal(agingBucket(at(7), null, now), 1, "7 days in Screened (SLA 7) is aging");
  assert.equal(agingBucket(makeEntry({ stage: "Hired", stageChangedAt: new Date(now - 99 * DAY).toISOString() }), null, now), 0, "Hired never ages");
  assert.equal(agingBucket(makeEntry({ stageChangedAt: null }), null, now), 0, "no timestamp reads fresh");
  // A per-board override tightens the threshold, so the same card ages sooner.
  assert.equal(agingBucket(at(4), { Screened: 3 }, now), 1, "an override of 3d ages a 4-day-old card");
});

test("boardSignature flips on a pure clock crossing (no data change) and skips when no bucket moved", () => {
  const now0 = Date.parse("2026-06-01T00:00:00.000Z");
  // 6 days into Screened (SLA 7): fresh at now0.
  const e = makeEntry({ stage: "Screened", stageChangedAt: new Date(now0 - 6 * DAY).toISOString() });

  // A quiet poll one hour later: still 6 days in, bucket unchanged → identical
  // signature → setEntries is skipped (no needless render).
  assert.equal(
    boardSignature([e], { now: now0 }),
    boardSignature([e], { now: now0 + 3_600_000 }),
    "a no-change poll where no bucket moved yields the SAME signature"
  );

  // Two days later the card is 8 days in — it crossed the SLA. Same entry object,
  // no data change, yet the signature MUST differ so the aging dot flips.
  assert.notEqual(
    boardSignature([e], { now: now0 }),
    boardSignature([e], { now: now0 + 2 * DAY }),
    "crossing the SLA by the clock alone flips the board signature within one tick"
  );
});

test("relativeTimeBucketKey: day-granular, so sub-day drift is quiet but a day boundary is not", () => {
  const created = "2026-06-01T00:00:00.000Z";
  const t0 = Date.parse(created);
  assert.equal(relativeTimeBucketKey(created, t0 + 2 * DAY), relativeTimeBucketKey(created, t0 + 2 * DAY + 3_600_000), "same day ⇒ same bucket");
  assert.notEqual(relativeTimeBucketKey(created, t0 + 2 * DAY), relativeTimeBucketKey(created, t0 + 3 * DAY), "2d → 3d changes the bucket");
});

test("eventSignature folds the relative-time bucket, so a quiet day boundary changes the feed signature", () => {
  const ev = { id: 1, candidateLabel: "A. N.", jobTitle: "Role", kind: "advanced", toStage: "Interview", detail: null, createdAt: "2026-06-01T00:00:00.000Z" };
  const t0 = Date.parse(ev.createdAt);
  assert.equal(eventSignature(ev, t0 + 2 * DAY), eventSignature(ev, t0 + 2 * DAY + 3_600_000), "same day ⇒ same event signature");
  assert.notEqual(eventSignature(ev, t0 + 2 * DAY), eventSignature(ev, t0 + 3 * DAY), "a day boundary changes the event signature with no new event");
});

// Direction 3 — signature compute diet. The per-entry signature is identity-cached
// (WeakMap) so keystroke re-renders do no JSON work for unchanged entries, while the
// time-varying aging bucket lives OUTSIDE the cache so a clock flip is never masked.
test("entrySignature is identity-stable, and the cache never masks a bucket flip", () => {
  const e = makeEntry({ stage: "Screened", stageChangedAt: new Date(Date.parse("2026-06-01T00:00:00.000Z") - 6 * DAY).toISOString() });
  // Same object → the cached static signature is byte-stable across calls.
  assert.equal(entrySignature(e), entrySignature(e), "repeat calls on one object return the same cached string");
  // The aging bucket is folded by boardSignature OUTSIDE the cache, so advancing the
  // clock past the SLA changes the board signature for the SAME cached entry object.
  const now0 = Date.parse("2026-06-01T00:00:00.000Z");
  assert.notEqual(boardSignature([e], { now: now0 }), boardSignature([e], { now: now0 + 2 * DAY }), "a cached entry still ages when the clock crosses its SLA");
  // Distinct objects with identical content still agree (cache doesn't cause drift).
  assert.equal(entrySignature(makeEntry()), entrySignature(makeEntry()), "content-equal distinct objects share a signature");
});

test("eventsSignature: identical feed shares a signature; a new event breaks it", () => {
  const ev = (id: number, kind: string): PipelineEvent => ({ id, candidateLabel: "A. N.", jobTitle: "Role", kind, toStage: "Interview", detail: null, createdAt: "2026-01-01T00:00:00.000Z" });
  const a = [ev(2, "advanced"), ev(1, "added")];
  assert.equal(eventsSignature(a), eventsSignature([ev(2, "advanced"), ev(1, "added")]), "same feed ⇒ same signature");
  assert.notEqual(eventsSignature(a), eventsSignature([ev(3, "rejected"), ...a]), "a new event changes the signature");
});

// The board's per-tick cost, pinned as a shape rather than as a stopwatch number.
// boardSignature runs over EVERY entry on EVERY 30s poll, so a per-entry cost that
// quietly became super-linear (a nested scan, a re-stringify, a find over the axis)
// would show up as a board that stutters on the big workspaces and nowhere else.
// The absolute budget is generous on purpose — this guards against an O(n²)
// regression, not against a slow CI box.
function boardOf(n: number): Entry[] {
  return Array.from({ length: n }, (_, i) =>
    makeEntry({
      id: `e${i}`,
      candidateId: `c${i}`,
      candidateLabel: `Candidate ${i}`,
      stage: i % 2 ? "Interview" : "Screened",
      matchScore: i % 100,
    })
  );
}

function msFor(entries: Entry[], now: number): number {
  const t0 = performance.now();
  boardSignature(entries, { now });
  return performance.now() - t0;
}

test("boardSignature: stays O(n) over a 2000-entry board, inside the documented budget", () => {
  const now = Date.parse("2026-02-01T00:00:00.000Z");
  // Warm the JIT on throwaway boards so the measurement below is steady state.
  for (let i = 0; i < 3; i++) msFor(boardOf(200), now);

  const small = boardOf(250);
  const large = boardOf(2000); // fresh objects: the signature cache is cold for both

  const tSmall = Math.max(msFor(small, now), 0.05);
  const tLarge = msFor(large, now);

  // Budget: the whole 2000-entry tick, cold cache, under 100ms.
  assert.ok(tLarge < 100, `2000-entry boardSignature took ${tLarge.toFixed(1)}ms (budget 100ms)`);
  // Shape: 8× the entries must not cost anywhere near 8² × the time. A generous 24×
  // ceiling (3× the linear factor) still fails loudly on a quadratic loop, which at
  // this size would be ~64× or worse.
  assert.ok(
    tLarge < tSmall * 24,
    `8× the entries cost ${(tLarge / tSmall).toFixed(1)}× the time — linear would be ~8×`
  );
  // And the output is exactly one record per entry: nothing is re-walked.
  assert.equal(boardSignature(large, { now }).split("\n").length - 1, 2000);
});

test("boardSignature: a second tick over the SAME objects reuses the cached per-entry work", () => {
  const now = Date.parse("2026-02-01T00:00:00.000Z");
  const entries = boardOf(2000);
  const cold = msFor(entries, now);
  const warm = msFor(entries, now);
  assert.ok(warm <= cold + 5, `warm tick ${warm.toFixed(1)}ms should not exceed cold ${cold.toFixed(1)}ms`);
  assert.equal(boardSignature(entries, { now }), boardSignature(entries, { now }), "stable across ticks");
});
