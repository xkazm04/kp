// The GitHub deep-dive as a STAGE of the analyze task (challenge-r02 analyze-engine/A).
//
// A CV run with a handle used to launch the deep-dive from the browser, beside the
// server task: switching tab aborted it after GitHub and Gemini were already paid, the
// saved report only got it through a client PATCH that needed the hook still mounted,
// and blind mode was a client-side predicate nothing on the server enforced. The stage
// below runs INSIDE the task instead, and these cases pin what it owes:
//
//   - a delivered deep-dive is persisted onto the saved row by the server;
//   - blind mode refuses the stage itself, so a crafted client cannot pair identity
//     with a blind score;
//   - a deep-dive failure is a coded outcome on the result, never a thrown error that
//     could fail (or re-bill) the CV run it rides with;
//   - the TTL cache is honoured both ways (a hit spends nothing; a degraded read is
//     never frozen into it) — the same rule /api/github-analysis applies;
//   - a JD that exists only as a file is read through the extractor, and an unreadable
//     one is said out loud (githubJdDropped) rather than silently dropped.
//
// Pure over injected deps: no network, no Python, no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runGithubStage, type GithubStageDeps } from "./analyze-github-stage.ts";
import { analysisSchema, githubAnalysisSchema, type GithubAnalysis } from "./schemas.ts";
import { GithubAnalysisError } from "./github/client.ts";

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

type Calls = {
  build: { username: string; jd: string }[];
  persist: { slug: string; json: string }[];
  cacheWrites: string[];
  extract: string[];
};

function deps(over: Partial<GithubStageDeps> = {}): { deps: GithubStageDeps; calls: Calls } {
  const calls: Calls = { build: [], persist: [], cacheWrites: [], extract: [] };
  const d: GithubStageDeps = {
    buildGithubAnalysis: async (username, jd) => {
      calls.build.push({ username, jd });
      return GH;
    },
    isTransientlyDegraded: () => false,
    readGithubCache: () => undefined,
    writeGithubCache: (key) => void calls.cacheWrites.push(key),
    extractJdText: async (p) => {
      calls.extract.push(p);
      return "extracted JD text";
    },
    persist: (slug, json) => void calls.persist.push({ slug, json }),
    ...over,
  };
  // Wrap overrides that the case supplies so the call ledger still sees them.
  if (over.buildGithubAnalysis) {
    const inner = over.buildGithubAnalysis;
    d.buildGithubAnalysis = async (u, jd, r) => {
      calls.build.push({ username: u, jd });
      return inner(u, jd, r);
    };
  }
  if (over.extractJdText) {
    const inner = over.extractJdText;
    d.extractJdText = async (p) => {
      calls.extract.push(p);
      return inner(p);
    };
  }
  return { deps: d, calls };
}

const BASE = { requestId: "req-1", savedSlug: "s1" as string | null };

test("a delivered deep-dive is DONE and persisted once onto the saved row, as JSON the schema accepts", async () => {
  const { deps: d, calls } = deps();
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: "x" }, d);
  assert.equal(out.status, "done");
  assert.ok(out.status === "done" && out.analysis.username === "octocat");
  assert.equal(calls.persist.length, 1, "persisted exactly once");
  assert.equal(calls.persist[0].slug, "s1");
  assert.ok(githubAnalysisSchema.safeParse(JSON.parse(calls.persist[0].json)).success, "the stored JSON parses");
});

test("the saved slug may arrive LATER (the CV half persists after the deep-dive lands) and is awaited", async () => {
  const { deps: d, calls } = deps();
  let settle: (s: string | null) => void = () => {};
  const savedSlug = new Promise<string | null>((r) => (settle = r));
  const pending = runGithubStage({ ...BASE, savedSlug, profile: "octocat", blind: false, jdText: "x" }, d);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.persist.length, 0, "nothing is written before the row exists");
  settle("late-slug");
  const out = await pending;
  assert.equal(out.status, "done");
  assert.deepEqual(calls.persist.map((c) => c.slug), ["late-slug"]);
});

test("no saved row (the CV half failed to persist) means no deep-dive write, but the result still delivers", async () => {
  const { deps: d, calls } = deps();
  const out = await runGithubStage({ ...BASE, savedSlug: null, profile: "octocat", blind: false, jdText: "x" }, d);
  assert.equal(out.status, "done");
  assert.equal(calls.persist.length, 0);
});

test("BLIND refuses the stage server-side: skipped, and GitHub is never contacted", async () => {
  const { deps: d, calls } = deps();
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: true, jdText: "x" }, d);
  assert.deepEqual(out, { status: "skipped", reason: "blind" });
  assert.equal(calls.build.length, 0, "buildGithubAnalysis must not run in blind mode");
  assert.equal(calls.extract.length, 0, "nor the JD extractor");
  assert.equal(calls.persist.length, 0, "and nothing identity-bearing is written to the row");
});

test("a GitHub throttle is a CODED error outcome with its retry hint — never a throw", async () => {
  const { deps: d, calls } = deps({
    buildGithubAnalysis: async () => {
      throw new GithubAnalysisError("RATE_LIMITED", "GitHub said no", 60);
    },
  });
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: "x" }, d);
  assert.deepEqual(out, { status: "error", code: "RATE_LIMITED", retryAfterSec: 60 });
  assert.equal(calls.persist.length, 0, "a failed deep-dive writes nothing onto the row");
  assert.equal(calls.cacheWrites.length, 0, "and an error is never cached");
});

test("an unclassified throw is ANALYSIS_FAILED, and its raw message never rides the outcome", async () => {
  const { deps: d } = deps({
    buildGithubAnalysis: async () => {
      throw new Error("undici: socket hang up at 10.0.0.1");
    },
  });
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: "x" }, d);
  assert.deepEqual(out, { status: "error", code: "ANALYSIS_FAILED" });
});

test("a cache HIT is done without spending a GitHub call", async () => {
  const { deps: d, calls } = deps({ readGithubCache: () => GH });
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: "x" }, d);
  assert.equal(out.status, "done");
  assert.equal(calls.build.length, 0, "a cached key must not rebuild");
  assert.equal(calls.persist.length, 1, "a cached deep-dive still lands on THIS run's row");
});

test("a transiently-degraded read is delivered but NOT written to the cache (same rule as the door)", async () => {
  const degraded = deps({ isTransientlyDegraded: () => true });
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: "x" }, degraded.deps);
  assert.equal(out.status, "done");
  assert.equal(degraded.calls.cacheWrites.length, 0, "a degraded read must stay retryable");

  const complete = deps();
  await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: "x" }, complete.deps);
  assert.equal(complete.calls.cacheWrites.length, 1, "a complete read IS cached");
});

test("a JD that exists only as a FILE reaches GitHub as the extractor's text", async () => {
  const { deps: d, calls } = deps();
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: null, jdPath: "/w/jd.pdf" }, d);
  assert.equal(out.status, "done");
  assert.deepEqual(calls.extract, ["/w/jd.pdf"]);
  assert.equal(calls.build[0].jd, "extracted JD text");
  assert.ok(out.status === "done" && !out.warning, "a readable JD carries no warning");
});

test("an unreadable JD file with no typed fallback still delivers, WARNED githubJdDropped", async () => {
  const { deps: d, calls } = deps({
    extractJdText: async () => {
      throw new Error("extract_cli exited 1");
    },
  });
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: null, jdPath: "/w/jd.pdf" }, d);
  assert.equal(out.status, "done");
  assert.ok(out.status === "done" && out.warning === "githubJdDropped");
  assert.equal(calls.build[0].jd, "", "the run went JD-blind, and says so");
});

test("an unreadable JD file falls back to the typed text, with no warning", async () => {
  const { deps: d, calls } = deps({ extractJdText: async () => "" });
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: "typed JD", jdPath: "/w/jd.pdf" }, d);
  assert.equal(calls.build[0].jd, "typed JD");
  assert.ok(out.status === "done" && !out.warning);
});

test("an unparseable handle is HANDLE_REQUIRED; an over-long JD is JD_TOO_LONG — both before any spend", async () => {
  const bad = deps();
  assert.deepEqual(await runGithubStage({ ...BASE, profile: "not a handle!", blind: false, jdText: "x" }, bad.deps), {
    status: "error",
    code: "HANDLE_REQUIRED",
  });
  const long = deps();
  assert.deepEqual(
    await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: "a".repeat(20_001) }, long.deps),
    { status: "error", code: "JD_TOO_LONG" },
  );
  assert.equal(bad.calls.build.length + long.calls.build.length, 0);
});

test("a cancelled run spends nothing on the stage", async () => {
  const { deps: d, calls } = deps();
  const ac = new AbortController();
  ac.abort();
  const out = await runGithubStage({ ...BASE, profile: "octocat", blind: false, jdText: "x", signal: ac.signal }, d);
  assert.equal(out.status, "error");
  assert.equal(calls.build.length, 0);
});

// ---- the task result's schema ------------------------------------------------

const ANALYSIS = {
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

test("a task result carrying githubDeepDive parses, and one without it still does (older rows)", () => {
  const withDive = analysisSchema.safeParse({ ...ANALYSIS, githubDeepDive: { status: "done", analysis: GH } });
  assert.ok(withDive.success, withDive.success ? "" : JSON.stringify(withDive.error.issues));
  assert.equal(withDive.data?.githubDeepDive?.status, "done");
  assert.equal(withDive.data?.githubDeepDive?.analysis?.username, "octocat", "the deep-dive survives the client parse");

  const withError = analysisSchema.safeParse({
    ...ANALYSIS,
    githubDeepDive: { status: "error", code: "RATE_LIMITED", retryAfterSec: 60 },
  });
  assert.ok(withError.success);

  const without = analysisSchema.safeParse(ANALYSIS);
  assert.ok(without.success);
  assert.equal(without.data?.githubDeepDive, undefined);
});
