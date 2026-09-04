import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTHENTICITY_REASON_KINDS, isAuthenticityReasonKind, scoreAuthenticity, type Authenticity } from "./devcase-authenticity.ts";

/** The kinds a verdict fired. The reasons are FINDINGS — `{ kind, params }` the eval
 *  panel renders in the reader's language — so the tests match on the kind, never on a
 *  sentence that now lives in four catalogs. */
const kinds = (a: Authenticity) => a.reasons.map((r) => r.kind);

const base = {
  commitCount: 12,
  bursty: false,
  spanHours: 30,
  decisionsLogPresent: true,
  readBeforeWrite: 0.6,
  iterationPattern: "linear",
};

test("a clean incremental submission scores authentic", () => {
  const a = scoreAuthenticity(base);
  assert.equal(a.score, 100);
  assert.equal(a.band, "authentic");
  assert.deepEqual(a.reasons, []);
});

test("single bulk commit + no decisions log + bursty reads as suspect", () => {
  const a = scoreAuthenticity({
    ...base,
    commitCount: 1,
    decisionsLogPresent: false,
    bursty: true,
    iterationPattern: "big-bang",
    readBeforeWrite: 0.2,
  });
  // 100 -40 -25 -15 -15 -15 = clamped to 0
  assert.equal(a.score, 0);
  assert.equal(a.band, "suspect");
  assert.ok(a.reasons.length >= 4);
});

test("an observed live-session submission with a DECISIONS log is authentic, not penalized for missing commits", () => {
  // The Live Work Surface has no git: commitCount 0, no cadence. Without the
  // observed waiver this scored 100 -15 = 85 (or 60 with no DECISIONS log). With it,
  // the missing-commit penalty is waived because the work was watched edit-by-edit.
  const a = scoreAuthenticity({
    commitCount: 0,
    bursty: null,
    spanHours: null,
    decisionsLogPresent: true,
    readBeforeWrite: 0.6,
    iterationPattern: "linear",
    observed: true,
  });
  assert.equal(a.score, 100);
  assert.equal(a.band, "authentic");
  assert.deepEqual(a.reasons, []);
});

test("an observed bulk paste (no incremental build-up) is held as suspect, not authentic", () => {
  // The exact paste-from-LLM hole: a clean-looking watched session that pasted a whole
  // LLM solution. Without the paste penalty this scored 100 ("authentic"); now -65 -> 35
  // -> "suspect", which the auto-promote gate holds for the ownership-verifying interview.
  const a = scoreAuthenticity({
    commitCount: 0,
    bursty: null,
    spanHours: null,
    decisionsLogPresent: true,
    readBeforeWrite: 0.6,
    iterationPattern: "linear",
    observed: true,
    observedBulkPaste: true,
  });
  assert.equal(a.score, 35);
  assert.equal(a.band, "suspect");
  assert.ok(kinds(a).includes("bulkPaste"));
});

test("observedBulkPaste only fires for observed sessions", () => {
  // A non-observed (git) submission ignores the flag — git history is the real signal there.
  const a = scoreAuthenticity({ ...base, observed: false, observedBulkPaste: true });
  assert.ok(!kinds(a).includes("bulkPaste"));
});

test("observed waiver does not mask a genuinely missing DECISIONS log", () => {
  // Watched, but no DECISIONS log → still docked 25 (the log penalty is real); just
  // not the spurious no-commit penalty. 100 -25 = 75 → still authentic band but the
  // reason is surfaced for the recruiter.
  const a = scoreAuthenticity({
    commitCount: 0,
    bursty: null,
    spanHours: null,
    decisionsLogPresent: false,
    observed: true,
  });
  assert.equal(a.score, 75);
  assert.ok(kinds(a).includes("noDecisionsLog"));
  assert.ok(!kinds(a).includes("noCommitHistory"));
});

test("a single missing signal lands in the mixed band", () => {
  const a = scoreAuthenticity({ ...base, decisionsLogPresent: false });
  assert.equal(a.score, 75);
  assert.equal(a.band, "authentic"); // 75 >= 70
  const b = scoreAuthenticity({ ...base, commitCount: 1 });
  assert.equal(b.score, 60);
  assert.equal(b.band, "mixed"); // 60 in [40,70)
});

test("no readable history is penalized but not as a single bulk commit", () => {
  const a = scoreAuthenticity({ ...base, commitCount: 0 });
  assert.equal(a.score, 85); // -15, not -40
  assert.deepEqual(a.reasons[0], { kind: "noCommitHistory" });
});

test("absent reflection fields don't penalize (older bundles / fallback)", () => {
  const a = scoreAuthenticity({
    commitCount: 8,
    bursty: false,
    spanHours: null,
    decisionsLogPresent: true,
    readBeforeWrite: null,
    iterationPattern: null,
  });
  assert.equal(a.score, 100);
  assert.equal(a.band, "authentic");
});

test("score never leaves 0..100", () => {
  const a = scoreAuthenticity({ commitCount: 1, bursty: true, spanHours: 1, decisionsLogPresent: false, readBeforeWrite: 0, iterationPattern: "big-bang" });
  assert.ok(a.score >= 0 && a.score <= 100);
});

test("an unreadable iteration trace costs nothing but is still surfaced", () => {
  // A penalty for the ABSENCE of evidence, on a signal class the red-team round proved
  // fabricable: the candidate whose tooling left no legible trace paid 5 points toward
  // SUSPECT_THRESHOLD while the gamer who manufactures a tidy process paid nothing.
  const a = scoreAuthenticity({ ...base, iterationPattern: "unclear" });
  assert.equal(a.score, 100, "an unreadable iteration pattern must not cost points");
  assert.equal(a.band, "authentic");
  // Still visible to the reviewer — an unreadable signal is a question, not a score.
  assert.ok(kinds(a).includes("unreadableIteration"), "the note must stay in reasons");
});

test("a readable big-bang pattern is still penalized — only ABSENCE is free", () => {
  const a = scoreAuthenticity({ ...base, iterationPattern: "big-bang" });
  assert.equal(a.score, 85);
});

// ── The reasons are findings, not copy (/perfect wave 28) ────────────────────
//
// They used to be English sentences pushed onto a string[], joined into the tooltip of
// an otherwise-translated badge — so an interviewer reading in Czech, German or French
// got the actual evidence in English. These pin the contract that replaced them.

test("every reason a verdict emits is a known kind with numeric params only", () => {
  // One input that fires as many penalties at once as the scorer allows.
  const a = scoreAuthenticity({
    commitCount: 3,
    bursty: true,
    spanHours: 2,
    decisionsLogPresent: false,
    readBeforeWrite: 0.1,
    iterationPattern: "big-bang",
  });
  assert.ok(a.reasons.length >= 5, "the fixture must actually fire several penalties");
  for (const r of a.reasons) {
    assert.ok(isAuthenticityReasonKind(r.kind), `${r.kind} is not in AUTHENTICITY_REASON_KINDS`);
    for (const v of Object.values(r.params ?? {})) {
      assert.equal(typeof v, "number", "params carry numbers the surface formats — never a pre-built sentence");
    }
  }
});

test("the count a 'few commits' reason reports is the real one", () => {
  // The number is the engine's, not the sentence's: the catalog interpolates {n}.
  const a = scoreAuthenticity({ ...base, commitCount: 2 });
  assert.deepEqual(a.reasons.find((r) => r.kind === "fewCommits"), { kind: "fewCommits", params: { n: 2 } });
  const b = scoreAuthenticity({ ...base, commitCount: 3 });
  assert.deepEqual(b.reasons.find((r) => r.kind === "fewCommits"), { kind: "fewCommits", params: { n: 3 } });
});

test("the reason vocabulary is closed and every kind is reachable", () => {
  // Non-vacuity for the guard above: a kind nothing can emit is dead catalog copy, and a
  // kind the guard rejects would be silently dropped by the panel.
  const fired = new Set<string>();
  const cases = [
    { commitCount: 1, bursty: false, spanHours: 1, decisionsLogPresent: true },
    { commitCount: 2, bursty: true, spanHours: 1, decisionsLogPresent: false, readBeforeWrite: 0.1, iterationPattern: "big-bang" },
    { commitCount: 0, bursty: null, spanHours: null, decisionsLogPresent: true },
    { commitCount: 0, bursty: null, spanHours: null, decisionsLogPresent: true, observed: true, observedBulkPaste: true },
    { commitCount: 0, bursty: null, spanHours: null, decisionsLogPresent: true, observed: true, integrityCompromised: true },
    { ...base, iterationPattern: "unclear" },
  ];
  for (const c of cases) for (const r of scoreAuthenticity(c).reasons) fired.add(r.kind);
  assert.deepEqual(
    [...AUTHENTICITY_REASON_KINDS].filter((k) => !fired.has(k)),
    [],
    "a declared kind that no input can produce is dead copy in four catalogs"
  );
});

test("isAuthenticityReasonKind rejects a kind this build does not know", () => {
  // Bundles are persisted: a panel can be handed a kind from an older or newer producer,
  // and it must show nothing rather than a raw key at an interviewer.
  assert.equal(isAuthenticityReasonKind("noDecisionsLog"), true);
  assert.equal(isAuthenticityReasonKind("someFutureTell"), false);
  assert.equal(isAuthenticityReasonKind(undefined), false);
});
