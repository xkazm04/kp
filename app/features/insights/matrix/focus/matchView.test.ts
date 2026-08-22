// Pins the "a prior ranking survives a transient re-rank failure" contract
// (job-ui-scan finding #2). The bug was a render gate that checked `error` BEFORE
// `result`, so one failed re-weight replaced the whole ranking with a red line.
//
// Non-vacuity: the first test asserts that with a prior result AND an error the
// view is `results` (error demoted to a banner). A helper that mirrored the
// pre-fix gate (error-first) would return `{ kind: "error" }` here and the
// assertion would fail — which is exactly the destructive behavior we removed.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateOptionsPlaceholder, rankedField, selectMatchView } from "./matchView.ts";

test("a prior ranking survives a re-rank error — the error becomes a non-destructive banner", () => {
  const view = selectMatchView({ hasResult: true, error: "Match failed (500).", loading: false });
  assert.equal(view.kind, "results");
  assert.equal(view.kind === "results" ? view.inlineError : null, "Match failed (500).");
});

test("a prior ranking stays mounted mid re-rank (loading, no error yet)", () => {
  assert.deepEqual(selectMatchView({ hasResult: true, error: null, loading: true }), {
    kind: "results",
    inlineError: null,
  });
});

test("with NO prior ranking, an error owns the full panel", () => {
  assert.deepEqual(selectMatchView({ hasResult: false, error: "Match failed.", loading: false }), {
    kind: "error",
    message: "Match failed.",
  });
});

test("no result, no error, loading → the loading branch", () => {
  assert.deepEqual(selectMatchView({ hasResult: false, error: null, loading: true }), { kind: "loading" });
});

test("nothing yet → the empty chain state", () => {
  assert.deepEqual(selectMatchView({ hasResult: false, error: null, loading: false }), { kind: "empty" });
});

// ---------------------------------------------------------------------------
// rankedField — the "Ranked" chip must not report the display LIMIT as the field.
//
// Non-vacuity: the first case is a real run measured against the committed
// 120-role corpus (a senior CZ/EN engineer: evaluated 120, koFiltered 46,
// survivors 74) with useMatchTabRun's `limit: 25`. The pre-fix header rendered
// `meta.returned ?? matchesLength` — i.e. a bare 25 — so it asserts `total: 74`,
// which the old expression could not produce at all.

test("a limit-truncated ranking reports the survivor field, not just the slice", () => {
  // 120 roles evaluated, 46 knocked out, 74 scored survivors, 25 returned.
  assert.deepEqual(rankedField({ survivors: 74, returned: 25 }, 25), {
    shown: 25,
    total: 74,
  });
});

test("an untruncated ranking claims nothing extra", () => {
  // Everything that survived came back — no "of N" to add.
  assert.deepEqual(rankedField({ survivors: 14, returned: 14 }, 14), { shown: 14, total: null });
  // Defensive: a payload where returned somehow exceeds survivors must not invert.
  assert.deepEqual(rankedField({ survivors: 3, returned: 5 }, 5), { shown: 5, total: null });
});

test("an older payload without `survivors` falls back to the rendered length and stays silent", () => {
  assert.deepEqual(rankedField({}, 9), { shown: 9, total: null });
  assert.deepEqual(rankedField({ returned: 7 }, 7), { shown: 7, total: null });
  // A genuine zero-survivor run is still a number, not a missing value.
  assert.deepEqual(rankedField({ survivors: 0, returned: 0 }, 0), { shown: 0, total: null });
});

// ---------------------------------------------------------------------------
// candidateOptionsPlaceholder — an empty picker may only name a cause it knows.
//
// Non-vacuity: the "failed" case is the one the pre-fix code could not express.
// The old gate was `!optionsLoaded ? loading : rows.length === 0 ? noProfiles`,
// so a 500 from /api/profile (which resolves to a body with no rows) landed on
// "No saved profiles (build one in Profile)". Asserting "failed" here fails
// against that two-branch gate, which has no third outcome.

test("a failed options read is reported as failed, never as an empty account", () => {
  assert.equal(candidateOptionsPlaceholder({ loaded: true, failed: true, count: 0 }), "failed");
});

test("a genuinely empty account still gets the build-one next step", () => {
  assert.equal(candidateOptionsPlaceholder({ loaded: true, failed: false, count: 0 }), "empty");
});

test("in flight beats both — and rows on hand beat everything", () => {
  assert.equal(candidateOptionsPlaceholder({ loaded: false, failed: false, count: 0 }), "loading");
  assert.equal(candidateOptionsPlaceholder({ loaded: false, failed: true, count: 0 }), "loading");
  // Rows present ⇒ no placeholder at all, even if the OTHER list's read failed.
  assert.equal(candidateOptionsPlaceholder({ loaded: true, failed: true, count: 12 }), null);
  assert.equal(candidateOptionsPlaceholder({ loaded: true, failed: false, count: 12 }), null);
});
