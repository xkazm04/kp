// Pins the intake-form collapse/error invariant behind the Analyze tab
// (bug-ui-scan-2026-07-09 #1): a failed CV analysis must always be reachable,
// even when a parallel GitHub deep-dive succeeded.
//
// The CV error is rendered ONLY inside the EXPANDED form's aria-live slot; the
// collapsed view has no error slot. The form auto-expands exactly when the view
// is `idle`. So "the recruiter can see the CV error" reduces to: on a CV error,
// `idle` must be true (form re-expands) regardless of the GitHub run — which is
// precisely what deriveCollapseDecision guarantees and this file locks in.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCollapseDecision } from "./analyzeCollapse.ts";

// The exact PRE-FIX predicate AnalyzeTab used for hasResult (no cvError term).
// Kept here so the assertions below double as a non-vacuity proof: the fixed
// helper must DIVERGE from this on the bug case and AGREE with it elsewhere.
// Against the pre-fix code the CV-error+GitHub-done case yields idle=false, so
// every assertion that idle===true would have failed.
function naiveIdle(s: {
  isAnalyzing: boolean;
  hasAnalysis: boolean;
  githubStatus: "idle" | "loading" | "done" | "error";
}): boolean {
  const hasResult = s.hasAnalysis || s.githubStatus !== "idle";
  return !s.isAnalyzing && !hasResult;
}

// ── The regression: CV error + GitHub success must surface the error ─────────
test("CV error while a GitHub run succeeded re-expands the form (error is not swallowed)", () => {
  const d = deriveCollapseDecision({
    isAnalyzing: false, // onError dropped isLoading/isCompleting
    hasAnalysis: false, // the CV pipeline produced no analysis
    githubStatus: "done", // the parallel deep-dive succeeded
    cvError: true, // result.error is set
  });
  assert.equal(d.hasResult, false, "a CV error must not count as a result");
  assert.equal(
    d.idle,
    true,
    "idle must be true so the form re-expands and its error slot shows result.error",
  );
  // Non-vacuity: the pre-fix formula kept the form collapsed (error swallowed).
  assert.equal(
    naiveIdle({ isAnalyzing: false, hasAnalysis: false, githubStatus: "done" }),
    false,
    "pre-fix: GitHub success pinned the form collapsed with no error anywhere",
  );
});

// ── Happy path: both succeed → stay collapsed, both result panels shown ───────
test("CV analysis + GitHub both succeed → form stays collapsed for the result panels", () => {
  const d = deriveCollapseDecision({
    isAnalyzing: false,
    hasAnalysis: true,
    githubStatus: "done",
    cvError: false,
  });
  assert.equal(d.hasResult, true);
  assert.equal(d.idle, false, "a successful CV+GitHub run keeps the form collapsed");
});

// ── The simple path that already worked (masked the bug): CV-only error ──────
test("CV-only error (no GitHub) re-expands the form", () => {
  const d = deriveCollapseDecision({
    isAnalyzing: false,
    hasAnalysis: false,
    githubStatus: "idle",
    cvError: true,
  });
  assert.equal(d.idle, true, "with no GitHub run the form already re-expanded to show the error");
});

// ── CV error while GitHub is still loading also surfaces the error ───────────
test("CV error while GitHub is still loading re-expands the form", () => {
  const d = deriveCollapseDecision({
    isAnalyzing: false,
    hasAnalysis: false,
    githubStatus: "loading",
    cvError: true,
  });
  assert.equal(d.idle, true, "a live GitHub run must not suppress a CV error either");
});

// ── GitHub-only run (GH3): no CV, no error → collapsed for the deep-dive panel ─
test("GitHub-only run collapses the form for the standalone deep-dive panel", () => {
  const d = deriveCollapseDecision({
    isAnalyzing: false,
    hasAnalysis: false,
    githubStatus: "done",
    cvError: false,
  });
  assert.equal(d.hasResult, true);
  assert.equal(d.idle, false, "a GitHub-only result still counts, keeping the form collapsed");
});

// ── GitHub-only FAILURE surfaces in the GitHub panel, not the form ───────────
test("GitHub-only failure keeps the form collapsed (its error shows in the GitHub panel)", () => {
  const d = deriveCollapseDecision({
    isAnalyzing: false,
    hasAnalysis: false,
    githubStatus: "error", // GitHub failed; the CV never ran, so cvError is false
    cvError: false,
  });
  assert.equal(d.idle, false, "a GitHub error is shown by GithubAnalysisPanel, not the form slot");
});

// ── CV-only success collapses (unchanged) ────────────────────────────────────
test("CV-only success collapses the form for the result panel", () => {
  const d = deriveCollapseDecision({
    isAnalyzing: false,
    hasAnalysis: true,
    githubStatus: "idle",
    cvError: false,
  });
  assert.equal(d.idle, false);
});

// ── Leading edge: while analyzing the form is never idle (stays collapsed) ────
test("while the CV run is in flight the form is not idle", () => {
  const d = deriveCollapseDecision({
    isAnalyzing: true,
    hasAnalysis: false,
    githubStatus: "loading",
    cvError: false,
  });
  assert.equal(d.idle, false, "an in-flight run keeps the form collapsed behind the progress panel");
});

// ── Empty/settled: nothing ran → idle (form expanded) ────────────────────────
test("a fresh, settled form is idle (expanded)", () => {
  const d = deriveCollapseDecision({
    isAnalyzing: false,
    hasAnalysis: false,
    githubStatus: "idle",
    cvError: false,
  });
  assert.equal(d.idle, true);
});
