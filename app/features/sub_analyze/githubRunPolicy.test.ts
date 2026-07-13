// Pins the blind-mode GitHub suppression rule (bug-ui-scan-2026-07-09 #3): a
// recruiter who ticks Blind must NOT be shown the candidate's GitHub identity.
//
// Runner: Node's built-in test runner with type stripping (no JSX here).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRunGithubDeepDive, shouldNoteBlindGithubSuppressed } from "./githubRunPolicy.ts";

// The EXACT pre-fix launch condition: launchGithubRun bailed only on `!hasGithub`
// and otherwise ran, wholly ignoring `blind`. Kept here so the assertions double
// as a non-vacuity proof — against the pre-fix code the CV+GitHub+blind case
// launched (identity leaked), so the `=== false` assertion below would have failed.
function naiveWouldRun(hasGithub: boolean): boolean {
  return hasGithub;
}

// ── The regression: blind + a GitHub handle must SUPPRESS the deep-dive ───────
test("blind mode suppresses the GitHub deep-dive even with a handle supplied", () => {
  assert.equal(
    shouldRunGithubDeepDive({ hasGithub: true, blind: true }),
    false,
    "the deep-dive must not run in blind mode — it would reveal redacted identity",
  );
  // Non-vacuity: the pre-fix condition launched it (identity leaked beside a
  // blind-scored CV), so this exact case is where the fix diverges.
  assert.equal(naiveWouldRun(true), true, "pre-fix: a GitHub handle always launched the deep-dive");
});

// ── Non-blind + a handle still runs (unchanged behavior) ─────────────────────
test("non-blind mode with a handle runs the deep-dive", () => {
  assert.equal(shouldRunGithubDeepDive({ hasGithub: true, blind: false }), true);
});

// ── No handle never runs, blind or not ───────────────────────────────────────
test("no GitHub handle never runs", () => {
  assert.equal(shouldRunGithubDeepDive({ hasGithub: false, blind: false }), false);
  assert.equal(shouldRunGithubDeepDive({ hasGithub: false, blind: true }), false);
});

// ── The "hidden in blind mode" note shows exactly when a handle is suppressed ─
test("the suppression note shows only when a handle is present AND blind is on", () => {
  assert.equal(shouldNoteBlindGithubSuppressed({ hasGithub: true, blind: true }), true);
  assert.equal(shouldNoteBlindGithubSuppressed({ hasGithub: true, blind: false }), false, "no note when the deep-dive will actually run");
  assert.equal(shouldNoteBlindGithubSuppressed({ hasGithub: false, blind: true }), false, "no note when there's no handle to suppress");
});
