import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAutomationCacheKey, type AutomationKeyInput } from "./automation-cache-key.ts";
import { buildAutomationArgv } from "./automation-run.ts";

test("Case 6: computeAutomationCacheKey folds jobJson axis for non-rematch tasks", () => {
  const base: AutomationKeyInput = {
    version: "prep-v1",
    task: "prep",
    candidateId: "cand-1",
    profileJson: JSON.stringify({ name: "Ada" }),
    jobId: "job-1",
    stage: "Screened",
    notes: "",
    jobJson: JSON.stringify({ id: "job-1", title: "Backend Engineer", salaryBand: [100000, 150000] }),
  };

  const key1 = computeAutomationCacheKey(base);
  const keySame = computeAutomationCacheKey({ ...base, jobJson: JSON.stringify({ id: "job-1", title: "Backend Engineer", salaryBand: [100000, 150000] }) });
  assert.equal(key1, keySame, "Byte-identical jobJson must produce the exact same cache key");

  const keyChanged = computeAutomationCacheKey({
    ...base,
    jobJson: JSON.stringify({ id: "job-1", title: "Backend Engineer", salaryBand: [110000, 160000] }),
  });
  assert.notEqual(key1, keyChanged, "Changed jobJson must produce a different cache key");

  const keyNoJobJson = computeAutomationCacheKey({
    ...base,
    jobJson: undefined,
  });
  assert.notEqual(key1, keyNoJobJson, "Omitting jobJson must produce a different cache key");

  // For task 'rematch', jobJson axis is ignored (corpusFingerprint covers it)
  const rematchBase: AutomationKeyInput = {
    ...base,
    task: "rematch",
    version: "rematch-v1",
    corpusFingerprint: "fingerprint-abc",
  };
  const rematch1 = computeAutomationCacheKey({
    ...rematchBase,
    jobJson: JSON.stringify({ id: "job-1", title: "Title A" }),
  });
  const rematch2 = computeAutomationCacheKey({
    ...rematchBase,
    jobJson: JSON.stringify({ id: "job-1", title: "Title B" }),
  });
  assert.equal(rematch1, rematch2, "Task rematch must ignore jobJson axis");
});

test("Case 7: buildAutomationArgv produces correct argv for all tasks", () => {
  const tasks = ["screen", "prep", "scorecard", "outreach", "rejection", "offer"] as const;
  for (const t of tasks) {
    const argvWithJob = buildAutomationArgv({
      task: t,
      profilePath: "/tmp/profile.json",
      jobId: "jd-123",
      jobJsonPath: "/tmp/job.json",
    });
    assert.ok(argvWithJob.includes("--job-id") && argvWithJob[argvWithJob.indexOf("--job-id") + 1] === "jd-123");
    assert.ok(argvWithJob.includes("--job-json") && argvWithJob[argvWithJob.indexOf("--job-json") + 1] === "/tmp/job.json");

    const argvWithoutJobJson = buildAutomationArgv({
      task: t,
      profilePath: "/tmp/profile.json",
      jobId: "jd-123",
      jobJsonPath: null,
    });
    assert.ok(argvWithoutJobJson.includes("--job-id") && argvWithoutJobJson[argvWithoutJobJson.indexOf("--job-id") + 1] === "jd-123");
    assert.ok(!argvWithoutJobJson.includes("--job-json"), `Task ${t} without jobJsonPath must not include --job-json`);
  }

  // task 'rematch': has --current-job-id and --jobs, no --job-json
  const rematchArgv = buildAutomationArgv({
    task: "rematch",
    profilePath: "/tmp/profile.json",
    jobId: "jd-current",
    jobsPath: "/tmp/jobs.json",
    jobJsonPath: "/tmp/job.json",
  });
  assert.ok(rematchArgv.includes("--current-job-id") && rematchArgv[rematchArgv.indexOf("--current-job-id") + 1] === "jd-current");
  assert.ok(rematchArgv.includes("--jobs") && rematchArgv[rematchArgv.indexOf("--jobs") + 1] === "/tmp/jobs.json");
  assert.ok(!rematchArgv.includes("--job-json"), "rematch must never push --job-json");
});
