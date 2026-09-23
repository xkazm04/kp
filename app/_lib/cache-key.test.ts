// Pins the cache-key serialization contract (idea-c2c4b498): different inputs
// must never produce the same digest. The old key concatenated fields with
// literal markers (`|jdt=`, `|cot=`, …) and no length framing, so content that
// itself contained a marker could shift bytes across a field boundary and
// collide — serving one candidate's analysis for a different input. The fix
// length-frames every field; these tests lock that two inputs which differ only
// in WHERE a marker falls stay distinct.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCacheKey, PROMPT_VERSION, type CacheKeyInput } from "./cache-key.ts";

const base: CacheKeyInput = {
  cvBytes: Buffer.from("cv-bytes"),
  jobDescriptionText: "",
  jobDescriptionFileBytes: null,
  companyText: "",
  companyFileBytes: null,
  grounding: false,
  lang: "en",
};

test("identical inputs hash identically (cache stays usable)", () => {
  assert.equal(computeCacheKey({ ...base }), computeCacheKey({ ...base }));
});

test("the boundary collision is gone: marker in JD text vs separate company input", () => {
  // Under the old delimiter-only scheme these two produced a byte-identical
  // pre-hash stream and collided:
  //   A: jdt = "p|jdf=|cot=q", company = ""
  //   B: jdt = "p",            company = "q|jdf=|cot="
  // Both used to serialize to `…|jdt=p|jdf=|cot=q|jdf=|cot=|cof=|cv=…`.
  const a = computeCacheKey({ ...base, jobDescriptionText: "p|jdf=|cot=q", companyText: "" });
  const b = computeCacheKey({ ...base, jobDescriptionText: "p", companyText: "q|jdf=|cot=" });
  assert.notEqual(a, b);
});

test("moving one character across the JD/company boundary changes the key", () => {
  const a = computeCacheKey({ ...base, jobDescriptionText: "ab", companyText: "" });
  const b = computeCacheKey({ ...base, jobDescriptionText: "a", companyText: "b" });
  assert.notEqual(a, b);
});

test("each field independently affects the key", () => {
  const k0 = computeCacheKey({ ...base });
  assert.notEqual(k0, computeCacheKey({ ...base, jobDescriptionText: "jd" }));
  assert.notEqual(k0, computeCacheKey({ ...base, companyText: "co" }));
  assert.notEqual(k0, computeCacheKey({ ...base, cvBytes: Buffer.from("other") }));
  assert.notEqual(k0, computeCacheKey({ ...base, jobDescriptionFileBytes: Buffer.from("file") }));
  assert.notEqual(k0, computeCacheKey({ ...base, companyFileBytes: Buffer.from("file") }));
  assert.notEqual(k0, computeCacheKey({ ...base, grounding: true }));
  // The output locale is part of the key: an en analysis must not be served for
  // a cs request (it would show English narrative under a Czech UI).
  assert.notEqual(k0, computeCacheKey({ ...base, lang: "cs" }));
});

test("text content equal to a file's bytes does not collide across the text/file boundary", () => {
  const a = computeCacheKey({ ...base, jobDescriptionText: "shared", jobDescriptionFileBytes: null });
  const b = computeCacheKey({ ...base, jobDescriptionText: "", jobDescriptionFileBytes: Buffer.from("shared") });
  assert.notEqual(a, b);
});

test("leading/trailing whitespace in text fields is normalized (trim is part of the key)", () => {
  assert.equal(
    computeCacheKey({ ...base, jobDescriptionText: "  jd  " }),
    computeCacheKey({ ...base, jobDescriptionText: "jd" })
  );
});

test("PROMPT_VERSION is bumped to retire the old (pre-i18n) keys", () => {
  // Adding `lang` to the key must invalidate prior cache entries; the version is
  // how lookupPromptCache rejects them.
  assert.ok(PROMPT_VERSION.startsWith("v7-"), `expected a v7 prompt version, got ${PROMPT_VERSION}`);
});

test("structured job context distinguishes the key; its absence keeps the legacy key (role-intake Phase 0)", () => {
  const without = computeCacheKey({ ...base, jobDescriptionText: "jd" });
  const withStruct = computeCacheKey({ ...base, jobDescriptionText: "jd", jobStructureJson: '{"id":"jd-x"}' });
  // A structured-job run must not be served for a prose-only run…
  assert.notEqual(without, withStruct);
  // …and editing the structure (re-ingest) must invalidate.
  assert.notEqual(withStruct, computeCacheKey({ ...base, jobDescriptionText: "jd", jobStructureJson: '{"id":"jd-y"}' }));
  // Append-only contract: absent and empty behave like the pre-field key, so the
  // existing cache stays valid for runs without a structured job.
  assert.equal(without, computeCacheKey({ ...base, jobDescriptionText: "jd", jobStructureJson: "" }));
});

// The analysis Python reads pipeline/jobfit/archetypes.json on every spawn (registry.py
// at import): the v2 profile's archetype routing (detect rules), its confidence and
// needs-review threshold, the early-career set and the per-archetype checklist weights
// all come from it. The file is editable at runtime (archetype manager), so a key that
// ignores it serves an analysis scored under the pre-edit registry. These cases run the
// REAL registry readers (archetype-registry-file.ts, archetype-live.ts) against a temp
// copy of the registry.
test("the live archetype-registry digest is an axis: an edited registry misses, an unchanged one hits", async () => {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { fileURLToPath } = await import("node:url");
  const { archetypeRegistryDigest, invalidateLiveRegistry, setLiveRegistryPathForTest } = await import(
    "./archetype-live.ts"
  );
  // What analyze-run.ts actually keys on: the import-free leaf beside archetype-live.
  const { archetypeRegistryFileDigest } = await import("./archetype-registry-file.ts");
  const bundledPath = fileURLToPath(new URL("../../pipeline/jobfit/archetypes.json", import.meta.url));
  const bundled = JSON.parse(readFileSync(bundledPath, "utf8")) as {
    archetypes: { weights: Record<string, number> }[];
  };
  const dir = mkdtempSync(path.join(tmpdir(), "kp-cache-key-registry-"));
  const file = path.join(dir, "archetypes.json");
  const write = (reg: unknown): void => {
    writeFileSync(file, `${JSON.stringify(reg, null, 2)}\n`, "utf8");
    invalidateLiveRegistry();
  };
  const key = (): string => {
    const digest = archetypeRegistryFileDigest();
    // ONE registry, one digest: the leaf the analyze key reads agrees with the live
    // reader the matrix key reads, for any file Python can import.
    assert.equal(digest, archetypeRegistryDigest());
    return computeCacheKey({ ...base, archetypeRegistryDigest: digest });
  };
  try {
    setLiveRegistryPathForTest(file);
    write(bundled);
    const before = key();
    // Unchanged registry -> same key (the cache stays usable).
    assert.equal(key(), before);
    // A weight edit (swap two dimensions, so the weights still sum to 1.0 and the
    // registry validates) -> a different key: the stale analysis must miss.
    const edited = structuredClone(bundled);
    const w = edited.archetypes[0].weights;
    [w.skills, w.career] = [w.career, w.skills];
    write(edited);
    const after = key();
    assert.notEqual(after, before);
    // Reverting restores the original key.
    write(bundled);
    assert.equal(key(), before);
  } finally {
    setLiveRegistryPathForTest(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the registry digest is appended only when set, so a digest-less caller keeps its key", () => {
  const k0 = computeCacheKey({ ...base });
  assert.equal(k0, computeCacheKey({ ...base, archetypeRegistryDigest: "" }));
  assert.notEqual(k0, computeCacheKey({ ...base, archetypeRegistryDigest: "d0" }));
  assert.notEqual(
    computeCacheKey({ ...base, archetypeRegistryDigest: "a" }),
    computeCacheKey({ ...base, archetypeRegistryDigest: "b" })
  );
  // Framed behind its own marker: a digest cannot be confused with a structured job.
  assert.notEqual(
    computeCacheKey({ ...base, jobStructureJson: "x" }),
    computeCacheKey({ ...base, archetypeRegistryDigest: "x" })
  );
});
