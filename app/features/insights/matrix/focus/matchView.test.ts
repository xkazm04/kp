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
import { selectMatchView } from "./matchView.ts";

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
