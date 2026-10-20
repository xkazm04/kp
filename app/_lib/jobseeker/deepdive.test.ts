// deepDivePosting over a scripted Python runner and fake store writes (D.2): the score a
// re-match replaces is kept inside the new payload, the rationale is asked for the SAME
// candidate the matcher scored (profile + preferences), and the stored rationale carries
// the time its inputs were read. No interpreter, no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../testing/unit-db.ts";
import { deepDivePosting, previousScore, type DeepDiveDeps } from "./deepdive.ts";
import type { CliCall, CliRunner } from "./python-cli.ts";
import { EMPTY_PREFERENCES, type JobseekerPosting, type JobseekerProfile } from "./types.ts";

const READ_AT = "2026-09-20T08:00:00.000Z";
const FINISHED_AT = "2026-09-20T08:04:00.000Z";

const profile: JobseekerProfile = {
  id: "jsp-1",
  profile: { displayName: "Seeker", seniority: "junior" },
  preferences: { ...EMPTY_PREFERENCES, seniority: "senior", workModes: ["remote"] },
  cvSourceText: null,
  cvPolishedMd: null,
  cvHash: null,
  createdAt: READ_AT,
  updatedAt: READ_AT,
};

function posting(over: Partial<JobseekerPosting> = {}): JobseekerPosting {
  return {
    id: "jpo-1",
    sourceId: "src",
    externalKey: "k",
    url: "https://jobs.example/1",
    title: "Engineer",
    company: "Example",
    location: "Praha",
    country: "cz",
    workMode: "hybrid",
    postedAt: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    bodyText: "Requirements: TypeScript.",
    jsonld: null,
    contentHash: "h1",
    job: { id: "jpo-1", title: "Engineer" },
    jobSource: "deterministic",
    match: { jobId: "jpo-1", total: 71 },
    matchTotal: 71,
    fitTier: "strong",
    matchVersion: "v",
    matchedAt: "2026-09-19T08:00:00.000Z",
    reasoning: null,
    status: "new",
    dismissReason: null,
    dismissNote: null,
    appliedAt: null,
    firstSeenAt: READ_AT,
    lastSeenAt: READ_AT,
    goneAt: null,
    ...over,
  };
}

/** jobs_cli restructures (llm), match_cli answers `rematchTotal`, reasoning_cli answers llm. */
function runner(calls: CliCall[], rematchTotal: number): CliRunner {
  return async (call) => {
    calls.push(call);
    switch (call.module) {
      case "jobs_cli":
        return { job: { id: "jpo-1", title: "Engineer (LLM)" }, source: "llm" };
      case "match_cli":
        return { matches: [{ jobId: "jpo-1", total: rematchTotal, fitTier: rematchTotal >= 70 ? "strong" : "partial", eligibility: [] }], meta: { koFiltered: 0 } };
      case "reasoning_cli":
        return { jobId: "jpo-1", total: rematchTotal, source: "llm", narrativeLang: "en", promptVersion: "p", reasoning: { verdict: "ok" } };
      default:
        throw new Error(`unscripted ${call.module}`);
    }
  };
}

function writes() {
  const out: { match: { match: Record<string, unknown>; total: number }[]; reasoning: Record<string, unknown>[] } = { match: [], reasoning: [] };
  const deps = (calls: CliCall[], rematchTotal: number): Partial<DeepDiveDeps> => ({
    runCli: runner(calls, rematchTotal),
    setPostingStructure: () => true,
    setPostingMatch: (_id, match, projection) => {
      out.match.push({ match, total: projection.total });
      return true;
    },
    setPostingReasoning: (_id, reasoning) => {
      out.reasoning.push(reasoning);
      return true;
    },
    now: () => FINISHED_AT,
    log: () => undefined,
  });
  return { out, deps };
}

test("a re-match that moves the total keeps the score it replaced inside the new payload", async () => {
  const calls: CliCall[] = [];
  const { out, deps } = writes();
  const outcome = await deepDivePosting(posting(), profile, { inputsAt: READ_AT, deps: deps(calls, 39) });
  assert.equal(outcome.kind, "done");
  assert.equal(out.match.length, 1);
  assert.equal(out.match[0].total, 39);
  assert.deepEqual(out.match[0].match.previous, { total: 71, fitTier: "strong", matchedAt: "2026-09-19T08:00:00.000Z" }, "71 → 39 is on the record");
});

test("a re-match that lands on the same total writes no `previous`", async () => {
  const calls: CliCall[] = [];
  const { out, deps } = writes();
  await deepDivePosting(posting(), profile, { inputsAt: READ_AT, deps: deps(calls, 71) });
  assert.equal(out.match.length, 1);
  assert.equal("previous" in out.match[0].match, false);
});

test("previousScore: null with no stored score or an unmoved one", () => {
  assert.equal(previousScore({ matchTotal: null, fitTier: null, matchedAt: null }, 40), null);
  assert.equal(previousScore({ matchTotal: 40, fitTier: "partial", matchedAt: READ_AT }, 40), null);
  assert.deepEqual(previousScore({ matchTotal: 40, fitTier: "partial", matchedAt: READ_AT }, 55), { total: 40, fitTier: "partial", matchedAt: READ_AT });
});

test("the rationale is asked for the candidate the matcher scored: the profile AND the preferences", async () => {
  const calls: CliCall[] = [];
  const { deps } = writes();
  await deepDivePosting(posting(), profile, { inputsAt: READ_AT, deps: deps(calls, 60) });
  const reasoning = calls.find((c) => c.module === "reasoning_cli")!;
  const match = calls.find((c) => c.module === "match_cli")!;
  assert.deepEqual(reasoning.files["preferences.json"], profile.preferences);
  assert.deepEqual(reasoning.files["preferences.json"], match.files["preferences.json"], "the same overlay the score was computed with");
  const paths = { "profile.json": "P", "preferences.json": "R", "corpus.json": "C" };
  const argv = reasoning.args(paths);
  assert.deepEqual(argv.slice(0, 4), ["--profile-json", "P", "--preferences-json", "R"]);
  assert.ok(argv.includes("--job-id") && argv.includes("jpo-1"));
});

test("the stored rationale carries the time its INPUTS were read, not the time the dive finished", async () => {
  const calls: CliCall[] = [];
  const { out, deps } = writes();
  await deepDivePosting(posting(), profile, { inputsAt: READ_AT, deps: deps(calls, 60) });
  assert.equal(out.reasoning.length, 1);
  assert.equal(out.reasoning[0].reasonedAt, READ_AT, "a preferences edit saved mid-dive must postdate it");
  assert.equal(out.reasoning[0].at, FINISHED_AT);
});
