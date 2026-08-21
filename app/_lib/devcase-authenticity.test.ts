import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAuthenticity } from "./devcase-authenticity.ts";

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
  assert.ok(a.reasons.some((r) => r.includes("bulk paste")));
});

test("observedBulkPaste only fires for observed sessions", () => {
  // A non-observed (git) submission ignores the flag — git history is the real signal there.
  const a = scoreAuthenticity({ ...base, observed: false, observedBulkPaste: true });
  assert.ok(!a.reasons.some((r) => r.includes("bulk paste")));
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
  assert.ok(a.reasons.includes("Mandated DECISIONS log is missing."));
  assert.ok(!a.reasons.includes("No readable commit history."));
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
  assert.match(a.reasons[0], /No readable commit history/);
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
  assert.ok(
    a.reasons.some((r) => /Iteration pattern couldn't be read/.test(r)),
    "the note must stay in reasons"
  );
});

test("a readable big-bang pattern is still penalized — only ABSENCE is free", () => {
  const a = scoreAuthenticity({ ...base, iterationPattern: "big-bang" });
  assert.equal(a.score, 85);
});
