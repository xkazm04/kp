// Pins the landed-result layer of the Analyze surface's place restoration
// (challenge-r02 analyze-engine/B): the tab unmounts on every sidebar switch and on
// every New/History peek, and a finished report must come back from its SAVED ROW
// (GET /api/analyses/[slug]) — rebuilt with its persistence receipt so the live
// Add-to-pipeline still works, validated so a corrupt or foreign row never paints a
// half-restored panel.
//
// Runner: Node's built-in test runner with type stripping (no JSX here).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYZE_LAST_RESULT_KEY,
  decideAnalyzeRestore,
  liveAnalysisFromSavedRow,
  settleAnalyzeRestore,
} from "./analyzeSession.ts";
import { deriveAnalyzePipelineAffordance } from "./analyzePipelineRef.ts";
import { githubAnalysisSchema, type GithubAnalysis } from "@/app/_lib/schemas";

const GH: GithubAnalysis = githubAnalysisSchema.parse({
  username: "octocat",
  profileUrl: "https://github.com/octocat",
  summary: "s",
  analyzedAt: "2026-09-23T00:00:00.000Z",
  metrics: {
    publicRepos: 1, followers: 0, totalStars: 0, totalForks: 0,
    activeRepos: 1, recentlyUpdatedRepos: 0, ownedReposAnalyzed: 1,
  },
  languages: [],
  topRepositories: [],
  contributionSignals: [],
  jobFitSignals: { jobDescriptionProvided: true, matchingSkills: [], potentialGaps: [], complexityAssessment: "" },
  limitations: [],
});

// The persisted payload: what persistAnalysis stored (no receipt, no deep-dive).
const PAYLOAD = {
  candidate: {
    name: "Ada L", rawText: "Ada", yearsExperience: 5, currentSeniority: "senior", roleFamily: "backend",
    skills: ["go"], educationLevel: "bachelor", languages: ["en"], traits: [], evidence: [],
  },
  score: { total: 70, experience: 20, skills: 20, roleSeniority: 15, education: 8, traits: 7 },
  salary: {
    currency: "CZK", period: "month", minimum: 1, maximum: 2, midpoint: 1.5, confidence: "medium", rationale: [],
  },
  strengths: [], gaps: [], recommendations: [], explanation: "x", sanityChecks: [],
  metadata: { analysisEngine: "fake", textExtractor: "fake", parsingNotes: [], groundingSources: [] },
};

// The GET /api/analyses/[slug] body, verbatim in shape.
function savedRow(over: Record<string, unknown> = {}) {
  return {
    slug: "ada-abc",
    candidateLabel: "ada_cv.pdf",
    jdSlug: "be-123",
    score: 70,
    roleFamily: "backend",
    seniority: "senior",
    createdAt: "2026-09-23T10:00:00.000Z",
    engine: "llm",
    engineProvider: "claude",
    disposition: null,
    decisionNote: null,
    analysis: PAYLOAD,
    githubAnalysis: null,
    ...over,
  };
}

// ── decideAnalyzeRestore: which layer comes back on mount ──────────────────────

test("a running task outranks a landed result", () => {
  assert.deepEqual(decideAnalyzeRestore({ storedTaskId: "t1", lastSlug: "s1" }), { kind: "resume-task", taskId: "t1" });
});

test("no task + a landed slug reloads the result; neither restores nothing", () => {
  assert.deepEqual(decideAnalyzeRestore({ storedTaskId: null, lastSlug: "s1" }), { kind: "reload-result", slug: "s1" });
  assert.deepEqual(decideAnalyzeRestore({ storedTaskId: null, lastSlug: null }), { kind: "none" });
  // An empty string is not a crumb (a half-written or cleared value).
  assert.deepEqual(decideAnalyzeRestore({ storedTaskId: "", lastSlug: "" }), { kind: "none" });
});

test("the landed-result crumb has its own key, distinct from the task and draft keys", () => {
  assert.equal(typeof ANALYZE_LAST_RESULT_KEY, "string");
  assert.notEqual(ANALYZE_LAST_RESULT_KEY, "kp.analyzeTaskId");
  assert.notEqual(ANALYZE_LAST_RESULT_KEY, "kp.analyzeDraft");
});

// ── liveAnalysisFromSavedRow: the saved row -> the live result panel ───────────

test("the saved row rebuilds the persistence receipt, so Add-to-pipeline is 'add' not 'unsaved'", () => {
  const restored = liveAnalysisFromSavedRow(savedRow());
  assert.ok(restored, "a valid saved row restores");
  assert.deepEqual(restored.analysis.persistence, {
    slug: "ada-abc",
    createdAt: "2026-09-23T10:00:00.000Z",
    candidateLabel: "ada_cv.pdf",
    jdSlug: "be-123",
  });
  const affordance = deriveAnalyzePipelineAffordance(restored.analysis, []);
  assert.equal(affordance?.kind, "add");
  assert.equal(restored.githubAnalysis, null);
  // A restored report did no new engine work, but it is not a "served from cache"
  // delivery either — that note describes a run, and nothing ran.
  assert.ok(!restored.analysis.servedFromCache);
});

test("a payload that fails analysisSchema, or a 404 body, restores nothing", () => {
  assert.equal(liveAnalysisFromSavedRow(savedRow({ analysis: { candidate: "not an object" } })), null);
  assert.equal(liveAnalysisFromSavedRow({ error: "Analysis not found.", code: "ANALYSIS_NOT_FOUND" }), null);
  assert.equal(liveAnalysisFromSavedRow(null), null);
  assert.equal(liveAnalysisFromSavedRow("<html>"), null);
  // A body with a valid payload but no slug/createdAt cannot address a row.
  assert.equal(liveAnalysisFromSavedRow(savedRow({ slug: undefined })), null);
});

test("the persisted deep-dive rides through githubAnalysisSchema and onto githubDeepDive", () => {
  const restored = liveAnalysisFromSavedRow(savedRow({ githubAnalysis: GH }));
  assert.ok(restored);
  assert.equal(restored.githubAnalysis?.username, "octocat");
  // The hook hands the restored Analysis to the SAME applyGithubDeepDive a live run
  // uses, so the panel is populated through one path, not a second restore branch.
  assert.equal(restored.analysis.githubDeepDive?.status, "done");
  assert.equal(restored.analysis.githubDeepDive?.analysis?.username, "octocat");
});

test("a corrupt deep-dive is dropped and the analysis kept", () => {
  const restored = liveAnalysisFromSavedRow(savedRow({ githubAnalysis: { username: 42 } }));
  assert.ok(restored, "the CV report must not be lost over a bad GitHub column");
  assert.equal(restored.githubAnalysis, null);
  assert.equal(restored.analysis.githubDeepDive ?? null, null);
  assert.equal(restored.analysis.persistence?.slug, "ada-abc");
});

// ── settleAnalyzeRestore: the fetch's answer -> restored | none (+ crumb fate) ──

test("a slug from a DIFFERENT workspace (404) restores nothing and drops the crumb", () => {
  assert.deepEqual(settleAnalyzeRestore(404, { error: "Analysis not found.", code: "ANALYSIS_NOT_FOUND" }), {
    kind: "none",
    dropCrumb: true,
  });
});

test("a 200 with a valid row restores; a 200 with a corrupt row drops the crumb", () => {
  const ok = settleAnalyzeRestore(200, savedRow({ githubAnalysis: GH }));
  assert.equal(ok.kind, "restored");
  if (ok.kind === "restored") {
    assert.equal(ok.analysis.persistence?.slug, "ada-abc");
    assert.equal(ok.githubAnalysis?.username, "octocat");
  }
  assert.deepEqual(settleAnalyzeRestore(200, savedRow({ analysis: null })), { kind: "none", dropCrumb: true });
});

test("a transient server failure keeps the crumb for the next visit", () => {
  assert.deepEqual(settleAnalyzeRestore(500, { code: "ANALYSIS_LOAD_FAILED" }), { kind: "none", dropCrumb: false });
  assert.deepEqual(settleAnalyzeRestore(503, null), { kind: "none", dropCrumb: false });
});
