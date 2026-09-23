// A GitHub read failure is never scored as candidate behaviour
// (challenge-r04 github-repo-intelligence/A).
//
// runEvaluateSubmission used to read the candidate's repo through a helper that turned
// every failure into null, so a GitHub 403 (the anonymous 60/h limit is kp's own
// infrastructure condition) became commitCount 0 + "no DECISIONS log": 100 - 15 - 25 =
// 60, band "mixed", persisted and fed to the promote gate on penalties nobody observed.
//
// Now an UNREADABLE commit list refuses the evaluation with a coded, retryable error
// BEFORE the Python/LLM evaluation is spawned, and nothing is saved, so the next run
// reads the repo for real instead of re-reading a verdict built on missing data.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPosting, createSubmission, getSubmission, saveDevCase } from "./db/devcase.ts";
import { runEvaluateSubmission } from "./devcase-run.ts";
import { RepoUnreadableError } from "./repo-snapshot.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const WS = "team-unreadable";

function submission(repoRef: string) {
  const kase = saveDevCase({ need: null, analysis: null, role: {}, case: { title: "Ship a rate limiter" } }, WS);
  const posting = createPosting({
    caseId: kase.id,
    channel: "local",
    token: `tok-${Math.random().toString(36).slice(2)}`,
    roleTitle: "Backend engineer",
    caseTitle: "Ship a rate limiter",
  });
  return createSubmission({ postingId: posting.id, candidateRef: "cand-1", repoRef }).submission;
}

test("a throttled commit list refuses the evaluation, codes it retryable, and saves nothing", async () => {
  const sub = submission("https://github.com/octocat/hello");
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    urls.push(String(input));
    return new Response("{}", { status: 403, headers: { "retry-after": "120" } });
  }) as typeof fetch;

  await assert.rejects(runEvaluateSubmission(sub.id), (e: unknown) => {
    assert.ok(e instanceof RepoUnreadableError, `expected RepoUnreadableError, got ${String(e)}`);
    assert.equal(e.code, "REPO_UNREADABLE");
    assert.equal(e.kind, "throttled");
    assert.equal(e.retryable, true);
    assert.equal(e.retryAfterSec, 120);
    return true;
  });
  // The only calls were the two GitHub reads: nothing downstream (no detail fan-out, no
  // evaluation) ran on data that was never received.
  assert.ok(urls.every((u) => u.startsWith("https://api.github.com/")));
  assert.equal(getSubmission(sub.id)?.evaluation ?? null, null, "no zero-commit evaluation may be persisted");
});

test("an unreachable GitHub (network throw) is refused the same way", async () => {
  const sub = submission("octocat/hello");
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(runEvaluateSubmission(sub.id), (e: unknown) => e instanceof RepoUnreadableError && e.kind === "unreachable");
  assert.equal(getSubmission(sub.id)?.evaluation ?? null, null);
});
