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
function keyFor(profileId: string, jobId: string, lang: string = "en"): string {
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

// ---- The narrative locale actually reaches the engine (MAT1) ----------------
// runReasoning used to derive its engine locale as `requestedLang === "cs" ? "cs" : "en"`,
// so a de/fr request was GENERATED in English and stamped narrativeLang "en" — the
// panel then rendered its honest "shown in English" note for two of the four shipped
// locales. pipeline/jobfit/i18n.py's LANG_NAMES ships en/cs/de/fr and language_directive
// names German and French (pinned Python-side by test_prompt_locale.py::
// test_every_shipped_locale_reaches_the_prompt_as_ITSELF), so the collapse was pure
// loss. These pin the resolution rule from the Node side: the requested locale IS the
// engine locale, and an unsupported value still fails safe to en.
for (const lang of ["de", "fr"] as const) {
  test(`a ${lang} request is generated in ${lang}, not collapsed to English`, async () => {
    const { id } = saveProfile({
      label: `Locale candidate ${lang}`,
      archetype: "bau",
      roleFamily: "software_engineering",
      completeness: 90,
      payload: { skills: ["ts"] },
    });
    const jobId = `job-lang-${lang}`;
    // The slot this locale keys onto (lang has always been a cache axis, so de/fr
    // never shared the en slot — only the GENERATION language was being collapsed).
    storePromptCache(
      keyFor(id, jobId, lang),
      { reasoning: { verdict: "strong", strengths: ["ts"] }, source: "llm" },
      REASONING_PROMPT_VERSION,
      168
    );
    const out = await runReasoning({ jobId, profileId: id, lang });
    assert.equal(out.cached, true, `the ${lang} slot must be the one that is read`);
    assert.equal(
      out.narrativeLang,
      lang,
      `an llm verdict for a ${lang} request is in ${lang} — reporting "en" is the collapse this closes`
    );
  });
}

test("an unsupported lang still fails safe to en (no unknown language reaches the prompt)", async () => {
  const { id } = saveProfile({
    label: "Junk-locale candidate",
    archetype: "bau",
    roleFamily: "software_engineering",
    completeness: 90,
    payload: { skills: ["ts"] },
  });
  const jobId = "job-lang-junk";
  // isLocale rejects "xx", so the request resolves to en and keys onto the en slot.
  storePromptCache(
    keyFor(id, jobId, "en"),
    { reasoning: { verdict: "hold", strengths: [] }, source: "llm" },
    REASONING_PROMPT_VERSION,
    168
  );
  const out = await runReasoning({ jobId, profileId: id, lang: "xx" });
  assert.equal(out.cached, true, "an unknown locale must resolve to the en slot, not its own");
  assert.equal(out.narrativeLang, "en");
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
