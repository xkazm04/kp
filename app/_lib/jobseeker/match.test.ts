// matchChunk's read of the matcher: survivors become MatchedPosting, and — since the seeker
// scan asks with --include-blocked — every KO'd posting of the chunk comes back as a
// BlockedPosting carrying its gate and its as-if MatchResult, so the store can stamp it
// instead of re-sending it every scan. Scripted runner: no interpreter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchChunk, MATCH_VERSION } from "./match.ts";
import type { CliCall, CliRunner } from "./python-cli.ts";
import { EMPTY_PREFERENCES, type JobseekerProfile } from "./types.ts";

const NOW = "2026-09-23T10:00:00.000Z";
const profile: JobseekerProfile = {
  id: "jsp-m",
  profile: { displayName: "Seeker" },
  preferences: { ...EMPTY_PREFERENCES, workModes: ["remote"] },
  cvSourceText: null,
  cvPolishedMd: null,
  cvHash: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function runner(out: Record<string, unknown>, calls: CliCall[]): CliRunner {
  return async (call) => {
    calls.push(call);
    return out;
  };
}

const asIf = (jobId: string) => ({ jobId, total: 78, fitTier: "strong", eligibility: [{ key: "work_mode", state: "flag", detail: "work mode onsite not preferred" }] });

test("matchChunk asks for blocked postings and returns them with gate and as-if result", async () => {
  const calls: CliCall[] = [];
  const out = {
    matches: [{ jobId: "p1", total: 64, fitTier: "promising" }],
    meta: { evaluated: 2, koFiltered: 1, koReasons: [{ key: "work_mode", count: 1 }] },
    blocked: [{ jobId: "p2", koKeys: ["work_mode"], koDetails: ["work mode onsite not preferred"], result: asIf("p2") }],
  };
  const outcome = await matchChunk(
    profile,
    [
      { id: "p1", job: { title: "A" } },
      { id: "p2", job: { title: "B" } },
    ],
    runner(out, calls)
  );
  const args = calls[0].args({ "profile.json": "a", "preferences.json": "b", "corpus.json": "c", "jobs.json": "d" });
  assert.ok(args.includes("--include-blocked"), "the seeker scan always asks for the blocked tail");
  assert.deepEqual(outcome.matched.map((m) => m.id), ["p1"]);
  assert.deepEqual(outcome.blocked, [{ id: "p2", match: asIf("p2"), koKeys: ["work_mode"], koDetails: ["work mode onsite not preferred"] }]);
  assert.equal(outcome.koFiltered, 1);
});

test("matchChunk drops a blocked id outside the chunk and filters ko keys to the vocabulary", async () => {
  const out = {
    matches: [],
    meta: { koFiltered: 3 },
    blocked: [
      { jobId: "stranger", koKeys: ["work_mode"], koDetails: ["x"], result: asIf("stranger") },
      { jobId: "p1", koKeys: ["work_mode", "vibes"], koDetails: ["work mode onsite not preferred", "bad vibes"], result: asIf("p1") },
      { jobId: "p2", koKeys: ["vibes"], koDetails: ["bad vibes"], result: asIf("p2") },
      { jobId: "p3", koKeys: ["language"], koDetails: ["missing required language: German"] },
    ],
  };
  const outcome = await matchChunk(
    profile,
    ["p1", "p2", "p3"].map((id) => ({ id, job: {} })),
    runner(out, [])
  );
  // p1 keeps only its known key (and the detail that belongs to it); p2 has no known key
  // left and p3 no as-if result, so neither is a verdict the store could stamp.
  assert.deepEqual(outcome.blocked, [{ id: "p1", match: asIf("p1"), koKeys: ["work_mode"], koDetails: ["work mode onsite not preferred"] }]);
});

test("MATCH_VERSION moved so every row stored under v2 is re-matched once against the stated targets", () => {
  // v2: KO'd postings gained their gate verdict. v3: the seeker's targetTitles /
  // targetRoleFamilies reach the career score and ride back as targetAlignment.
  assert.equal(MATCH_VERSION, "jobseeker-match-v3");
});
