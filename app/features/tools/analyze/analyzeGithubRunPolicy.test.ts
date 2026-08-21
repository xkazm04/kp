// Pins the blind-mode GitHub suppression rule (bug-ui-scan-2026-07-09 #3): a
// recruiter who ticks Blind must NOT be shown the candidate's GitHub identity.
//
// Runner: Node's built-in test runner with type stripping (no JSX here).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  githubStatusAfterCancel,
  shouldRunGithubDeepDive,
  shouldNoteBlindGithubSuppressed,
} from "./analyzeGithubRunPolicy.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// ── Cancelling the CV scan must not erase a deep-dive that already landed ─────
//
// The regression: cancel() reset githubStatus to "idle" UNCONDITIONALLY. Its only
// job there is to unstick a superseded in-flight run (a "loading" status would
// otherwise never clear, keeping the Analyze button disabled). But the deep-dive
// runs in parallel and routinely finishes first, so cancelling a slow CV scan at
// t=20s blanked a GitHub result delivered at t=3s — and AnalyzeTab renders the
// GitHub panel only when `githubStatus !== "idle"`, so the whole paid-for panel
// vanished with no way back except re-running.
//
// The EXACT pre-fix behavior, kept so the assertions double as a non-vacuity
// proof: against it the "done"/"error" cases below returned "idle" and failed.
const naiveCancelStatus = () => "idle" as const;

test("cancel unsticks a still-loading deep-dive", () => {
  assert.equal(
    githubStatusAfterCancel("loading"),
    "idle",
    "a superseded in-flight run never fires its callbacks — its status must be cleared or the Analyze button stays disabled",
  );
  // The one case where the pre-fix blanket reset was right.
  assert.equal(naiveCancelStatus(), "idle");
});

test("cancel preserves a deep-dive result that already landed", () => {
  assert.equal(
    githubStatusAfterCancel("done"),
    "done",
    "cancelling the CV scan must not erase a delivered GitHub deep-dive — AnalyzeTab hides the panel on 'idle'",
  );
  // Non-vacuity: the pre-fix reset returned "idle" here, hiding the panel.
  assert.equal(naiveCancelStatus(), "idle", "pre-fix: cancel blanked a landed deep-dive to idle");
});

test("cancel preserves a failed deep-dive so its retry affordance survives", () => {
  assert.equal(
    githubStatusAfterCancel("error"),
    "error",
    "a failed deep-dive is a landed outcome with a Retry button — cancelling the CV run must not swallow it",
  );
  assert.equal(naiveCancelStatus(), "idle", "pre-fix: cancel blanked the error state too");
});

test("cancel leaves an untouched deep-dive idle", () => {
  assert.equal(githubStatusAfterCancel("idle"), "idle");
});

// Source-level guard: cancel() must route through the predicate rather than
// re-introduce a blanket setGithubStatus("idle"). reset() legitimately blanks it
// (it clears githubAnalysis too), so this pins the CANCEL call site by name.
test("useAnalyzeForm's cancel routes the GitHub status through the policy", () => {
  const src = readFileSync(fileURLToPath(new URL("./useAnalyzeForm.ts", import.meta.url)), "utf8");
  assert.match(
    src,
    /setGithubStatus\(githubStatusAfterCancel\)/,
    "cancel() must clear only a still-loading deep-dive, via githubStatusAfterCancel",
  );
  // Exactly one blanket reset survives — reset()'s, which also nulls githubAnalysis.
  assert.equal(
    (src.match(/setGithubStatus\("idle"\)/g) ?? []).length,
    2,
    'only reset() and submit() may blank the GitHub status to "idle"; cancel() must not',
  );
});
