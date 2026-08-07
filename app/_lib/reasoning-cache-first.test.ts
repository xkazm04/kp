import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";

// A bogus interpreter makes ANY Python spawn fail fast (ENOENT). Set BEFORE
// importing reasoning-run so spawnPython picks it up. Established idiom — see
// group-eval-cohort-run.test.ts. The point: a cache HIT must never reach the
// spawn seam, so with this set a hit still returns cleanly while a MISS throws.
process.env.PYTHON_CMD = "kp-no-python-for-this-test";

const { saveProfile, listCorpusJobs, getJob, storePromptCache } = await import("./db.ts");
const { runReasoning, REASONING_PROMPT_VERSION } = await import("./reasoning-run.ts");
const { resolveMatchInput } = await import("./match-input.ts");
const { reasoningCacheKey } = await import("./reasoning-cache-key.ts");
const { computeCorpusFingerprint } = await import("./automation-cache-key.ts");

after(() => cleanupUnitDb());

// Reconstruct the EXACT key runReasoning computes, from the same primitives, so
// the seeded cache entry is a genuine hit (not a hand-forged hash that drifts).
function keyFor(profileId: string, jobId: string, lang: "en" | "cs" = "en"): string {
  const input = resolveMatchInput({ profileId });
  assert.ok("keyPart" in input, "profile must resolve");
  const corpusJobs = listCorpusJobs();
  return reasoningCacheKey({
    promptVersion: REASONING_PROMPT_VERSION,
    candidateKeyPart: input.keyPart,
    jobId,
    jobPayload: getJob(jobId),
    lang,
    corpusFingerprint: computeCorpusFingerprint(corpusJobs.map((j) => j.id)),
  });
}

test("a cache HIT returns the cached verdict with ZERO Python spawn or serialization", async () => {
  const { id } = saveProfile(
    { label: "Cached candidate", archetype: "bau", roleFamily: "software_engineering", completeness: 90, payload: { skills: ["ts", "react"] } },
    // default workspace — runReasoning defaults to it too
  );
  const jobId = "job-cache-hit";

  // Seed a cacheable (source: "llm") verdict at the exact key.
  const verdict = { reasoning: { verdict: "strong", strengths: ["ts"] }, source: "llm" };
  storePromptCache(keyFor(id, jobId), verdict, REASONING_PROMPT_VERSION, 168);

  // PYTHON_CMD is bogus: if this reached spawnPython it would REJECT and throw.
  // A clean cached return therefore proves the spawn seam was never touched — and
  // since materialization + jobs.json serialization sit AFTER the cache check,
  // they were skipped too.
  const out = await runReasoning({ jobId, profileId: id });
  assert.equal(out.cached, true, "served from cache");
  assert.deepEqual(out.reasoning, verdict.reasoning, "the cached verdict, verbatim");
  assert.equal(out.source, "llm");
});

test("a cache MISS reaches the spawn seam (proving the hit above genuinely skipped it)", async () => {
  const { id } = saveProfile(
    { label: "Uncached candidate", archetype: "bau", roleFamily: "software_engineering", completeness: 90, payload: { skills: ["go"] } },
  );
  // No cache entry for this profile/job → the miss path spawns the bogus
  // interpreter, which rejects. Same inputs shape as the hit test, so the ONLY
  // difference is cache presence — isolating "the cache gates the spawn".
  await assert.rejects(runReasoning({ jobId: "job-cache-miss", profileId: id }), "a miss must attempt the spawn");
});
