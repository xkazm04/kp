// Pins Direction 1 — "add to pipeline at the moment of intent": the live Analyze
// result must offer the SAME add the saved report does for a JD-tagged run, and an
// HONEST disabled affordance (not a hidden button) for a JD-less or unsaved run.
//
// Runner: Node's built-in test runner with type stripping (no JSX here).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAnalyzePipelineAffordance } from "./analyzePipelineRef.ts";
import type { Analysis } from "@/app/_lib/schemas";

// Minimal Analysis shaped for the fields the helper reads (persistence, score,
// candidate, v2Profile). Cast through unknown — the full generated schema is large
// and irrelevant to this pure decision.
function analysis(over: Record<string, unknown>): Analysis {
  return {
    candidate: { name: "Alice Doe", roleFamily: "Backend", currentSeniority: "Senior" },
    score: { total: 80, experience: 20, skills: 25, roleSeniority: 20, education: 8, traits: 7 },
    ...over,
  } as unknown as Analysis;
}

// ── JD-tagged, persisted run → board-addable, mirroring the report page's ref ──
test("a JD-tagged persisted run yields an add ref matching the saved-report fields", () => {
  const a = analysis({
    persistence: { slug: "alice-abc", createdAt: "2026-07-14T00:00:00Z", candidateLabel: "alice_cv.pdf", jdSlug: "be-123" },
    v2Profile: { archetype: "Builder" },
  });
  const affordance = deriveAnalyzePipelineAffordance(a);
  assert.equal(affordance?.kind, "add");
  if (affordance?.kind !== "add") return;
  const { ref } = affordance;
  assert.equal(ref.candidateId, "alice-abc", "candidateId is the saved analysis slug (the board dedup key)");
  assert.equal(ref.candidateLabel, "alice_cv.pdf", "label matches the persisted one the on-board chip matches by");
  assert.equal(ref.jobId, "be-123", "jobId is the JD slug the board keys lanes on");
  assert.equal(ref.jobTitle, "JD be-123");
  assert.equal(ref.archetype, "Builder", "the detected archetype rides the add, not a hardcoded null");
  assert.equal(ref.roleFamily, "Backend");
  // Reconciled total = component sum (20+25+20+8+7 = 80).
  assert.equal(ref.matchScore, 80);
});

// ── JD-less run → honest disabled 'jdless', never a hidden button ─────────────
test("a persisted run with no JD slug is a disabled 'jdless' affordance", () => {
  const a = analysis({
    persistence: { slug: "bob-xyz", createdAt: "2026-07-14T00:00:00Z", candidateLabel: "bob_cv.pdf", jdSlug: null },
  });
  assert.deepEqual(deriveAnalyzePipelineAffordance(a), { kind: "disabled", reason: "jdless" });
});

// ── Failed persist (null receipt) → disabled 'unsaved' ───────────────────────
test("an unsaved run (null persistence) is a disabled 'unsaved' affordance", () => {
  assert.deepEqual(deriveAnalyzePipelineAffordance(analysis({ persistence: null })), {
    kind: "disabled",
    reason: "unsaved",
  });
  // A receipt with no slug is likewise unaddressable.
  assert.deepEqual(
    deriveAnalyzePipelineAffordance(analysis({ persistence: { createdAt: "x", jdSlug: "be-1" } })),
    { kind: "disabled", reason: "unsaved" },
  );
});

// ── No analysis yet → no affordance at all (nothing to render) ────────────────
test("no analysis yields no affordance", () => {
  assert.equal(deriveAnalyzePipelineAffordance(null), null);
});

// ── Label falls back to the extracted name, then the slug ─────────────────────
test("candidateLabel falls back to the extracted name when the receipt omits a label", () => {
  const a = analysis({
    persistence: { slug: "carol-1", createdAt: "x", jdSlug: "be-9" },
    candidate: { name: "Carol Roe", roleFamily: "Data", currentSeniority: "Mid" },
  });
  const affordance = deriveAnalyzePipelineAffordance(a);
  assert.equal(affordance?.kind === "add" && affordance.ref.candidateLabel, "Carol Roe");
});
