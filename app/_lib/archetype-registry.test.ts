// archetype-registry: structured validation codes + built-in archive protection.
//
// These exercise the PURE paths only — validateArchetype (no I/O) and the built-in
// refusal branch of setArchetypeArchived, which returns BEFORE any registry read/write
// — so the test never mutates the shared archetypes.json on disk.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createArchetype, slotsOnly, validateArchetype, setArchetypeArchived, updateArchetype } from "./archetype-registry.ts";

const valid = {
  label: "Returner",
  scoringModel: "experienced",
  weights: { skills: 0.5, career: 0.35, personal: 0.15 },
  dimensionLabels: { skills: "Skills", career: "Career", personal: "Personal" },
};

test("validateArchetype accepts a well-formed archetype", () => {
  assert.equal(validateArchetype(valid), null);
});

test("validateArchetype returns a structured code + English fallback for a missing label", () => {
  const err = validateArchetype({ ...valid, label: "" });
  assert.equal(err?.code, "label_required");
  assert.match(err!.message, /required/i, "keeps a readable English message for API callers");
});

test("validateArchetype flags a bad weight sum with the sum param", () => {
  const err = validateArchetype({ ...valid, weights: { skills: 0.5, career: 0.3, personal: 0.1 } });
  assert.equal(err?.code, "weights_sum");
  assert.equal(err?.params?.sum, "0.90", "params.sum feeds the localized ICU placeholder");
});

test("validateArchetype names the offending slot for a non-numeric weight", () => {
  const err = validateArchetype({ ...valid, weights: { skills: Number.NaN, career: 0.5, personal: 0.5 } });
  assert.equal(err?.code, "weight_not_number");
  assert.equal(err?.params?.slot, "skills");
});

// ── The weights contract must MIRROR Python's import-time guard ────────────────
// registry.py validates archetypes.json at IMPORT (_validate_archetype_weights) and
// that import runs on EVERY pipeline spawn. Anything this boundary lets through but
// Python refuses does not degrade — it RuntimeErrors every analyze / match / intake /
// profile build on the deployment until the JSON is hand-repaired. So this validator
// must be at least as strict as registry.py on both halves of that guard: the slot
// keys and the 1e-6 sum tolerance.
test("a weight sum Python would refuse is rejected here (the old 1e-3 slack was a hole)", () => {
  // 0.9995: |sum-1| = 5e-4, inside the old 0.001 slack, 500x outside Python's 1e-6.
  const err = validateArchetype({ ...valid, weights: { skills: 0.4995, career: 0.35, personal: 0.15 } });
  assert.equal(err?.code, "weights_sum", "a sub-0.001 miss must not reach archetypes.json");
  assert.equal(err?.params?.sum, "0.999500", "and the message shows enough precision to act on (not '1.00')");
});

test("floating-point noise from the UI's whole-percent weights still passes", () => {
  // The manager UI posts pct/100 for integer percentages summing to 100; the residue is
  // ~1e-16, so tightening to 1e-6 must not reject a legitimate save.
  for (const pct of [[50, 35, 15], [33, 33, 34], [70, 20, 10], [1, 1, 98]]) {
    const weights = { skills: pct[0] / 100, career: pct[1] / 100, personal: pct[2] / 100 };
    assert.equal(validateArchetype({ ...valid, weights }), null, `${pct.join("/")} must save`);
  }
});

test("a NEGATIVE weight is rejected even though it sums to 1.0", () => {
  // {-0.1, 0.6, 0.5} sums to exactly 1.0, so neither the sum check nor Python's import
  // guard catches it — and the scorer then SUBTRACTS the skills dimension.
  const err = validateArchetype({ ...valid, weights: { skills: -0.1, career: 0.6, personal: 0.5 } });
  assert.equal(err?.code, "weight_out_of_range");
  assert.equal(err?.params?.slot, "skills");
});

test("slotsOnly drops a foreign slot key Python's import guard would reject", () => {
  assert.deepEqual(
    slotsOnly<number>({ skills: 0.5, career: 0.35, personal: 0.15, culture: 0.2 }),
    { skills: 0.5, career: 0.35, personal: 0.15 },
    "a 4th dimension can never reach archetypes.json"
  );
  // A missing slot stays missing — validateArchetype names it, which is actionable.
  assert.deepEqual(slotsOnly<number>({ skills: 0.5, career: 0.5 }), { skills: 0.5, career: 0.5 });
  for (const junk of ["nope", 3, null, undefined, [0.5, 0.35, 0.15]]) {
    assert.equal(slotsOnly<number>(junk), undefined, `${JSON.stringify(junk)} is not a slot map`);
  }
});

// ── The unrouted sentinels are not registrable ids ─────────────────────────────
// app/_lib/archetypes.ts derives the fairness gate from registry MEMBERSHIP:
// isFairnessProtected("unknown") is true only because "unknown" is not a known id.
// Registering it would strip that shield from every unrouted candidate deployment-wide.
// The refusal returns BEFORE serializeWrite, so this never touches archetypes.json.
test("createArchetype refuses the unrouted sentinel ids (no disk write)", async () => {
  for (const id of ["unknown", "unrouted", "UNKNOWN"]) {
    const result = await createArchetype({ id, ...valid });
    assert.ok("error" in result, `'${id}' must not become a registry entry`);
    assert.equal(result.error.code, "id_reserved");
  }
});

test("setArchetypeArchived refuses a built-in archetype with an honest reason (no disk write)", async () => {
  const result = await setArchetypeArchived("bau", true);
  assert.ok("error" in result, "built-in archetypes are protected");
  assert.equal(result.error.code, "archive_builtin");
  assert.equal(result.error.params?.id, "bau");
});

// A built-in's fairness shield can't be edited away (candidate-profile-job-matching
// #1). These hit the guard which returns BEFORE any registry write (the rejection
// path), so like the archive test they never mutate archetypes.json. "student" is a
// built-in, fairness-protected, early_career archetype in the committed registry.
test("updateArchetype refuses to strip a built-in's fairnessProtected flag (no disk write)", async () => {
  const result = await updateArchetype("student", { fairnessProtected: false });
  assert.ok("error" in result, "the fairness shield edit is refused");
  assert.equal(result.error.code, "edit_builtin_shield");
  assert.equal(result.error.params?.id, "student");
});

test("updateArchetype refuses to change a built-in's scoringModel (no disk write)", async () => {
  const result = await updateArchetype("student", { scoringModel: "experienced" });
  assert.ok("error" in result, "re-ranking students on the experienced model is refused");
  assert.equal(result.error.code, "edit_builtin_shield");
});

// ── READING the registry validates it, exactly as WRITING it does ──────────────
//
// readRegistry was `JSON.parse(raw) as Registry` — a cast, which asserts nothing at
// runtime — while Python's reader validates the SAME file at import and raises
// RuntimeError on the same invariant (registry.py::_validate_archetype_weights). The
// file is meant to be hand-editable (it is checked in, and the whole taxonomy is data),
// so a hand-edited archetypes.json passed silently here and took every pipeline spawn
// down there: analyze, match, intake and profile-build, for the whole deployment.
//
// These drive the real read path against a hand-broken registry by pointing cwd at a
// throwaway tree — registryPath() is process.cwd()-relative — so nothing touches the
// committed file and no write can escape the fixture.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { ArchetypeRegistryError, listArchetypes } from "./archetype-registry.ts";

const REAL_CWD = process.cwd();
const fixtures: string[] = [];

after(() => {
  process.chdir(REAL_CWD);
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repo root whose pipeline/jobfit/archetypes.json holds `contents`
 *  verbatim (a string, so a NON-JSON file is expressible), and chdir into it. */
function withRegistryFile(contents: string): void {
  const root = mkdtempSync(nodePath.join(tmpdir(), "kp-archetype-registry-"));
  fixtures.push(root);
  mkdirSync(nodePath.join(root, "pipeline", "jobfit"), { recursive: true });
  writeFileSync(nodePath.join(root, "pipeline", "jobfit", "archetypes.json"), contents, "utf-8");
  process.chdir(root);
}

/** A registry that is structurally fine but carries ONE broken archetype. */
function registryWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    archetypes: [{ id: "bau", label: "BAU", badge: "BAU", fairnessProtected: false, checklist: [], ...valid, ...overrides }],
  });
}

test("a write against a registry whose weights do not sum to 1.0 is REFUSED, not merged", async () => {
  // The exact defect Python fails at import on: 0.9995 — inside the old 1e-3 TS
  // allowance, outside Python's 1e-6 — and now outside both.
  withRegistryFile(registryWith({ weights: { skills: 0.4995, career: 0.35, personal: 0.15 } }));
  const result = await updateArchetype("bau", { label: "Renamed" });
  assert.ok("error" in result, "a broken file must never be read, merged and written back");
  assert.equal(result.error.code, "registry_invalid");
  assert.match(result.error.message, /archetypes\.json/, "the message names the file the operator must fix");
  assert.match(result.error.message, /'bau'/, "…and the archetype inside it");
  process.chdir(REAL_CWD);
});

test("a registry with a negative weight is refused on READ by the writers' own validator", async () => {
  // {-0.1, 0.6, 0.5} sums to 1.0, so it passes Python's import guard too — and inverts
  // the skills dimension in the scorer. Reading through validateArchetype catches it.
  withRegistryFile(registryWith({ weights: { skills: -0.1, career: 0.6, personal: 0.5 } }));
  const result = await createArchetype({ id: "returner", ...valid });
  assert.ok("error" in result);
  assert.equal(result.error.code, "registry_invalid");
  process.chdir(REAL_CWD);
});

test("a registry that is not JSON at all answers a code, never the parser's message", async () => {
  withRegistryFile("{ this is not json");
  const result = await setArchetypeArchived("custom_one", true);
  assert.ok("error" in result);
  assert.equal(result.error.code, "registry_invalid");
  assert.doesNotMatch(result.error.message, /position|token|Unexpected/i, "the parser's own text is not the answer");
  process.chdir(REAL_CWD);
});

test("a registry with no `archetypes` array is refused rather than treated as empty", async () => {
  withRegistryFile(JSON.stringify({ detection: {} }));
  const result = await updateArchetype("bau", { label: "Renamed" });
  assert.ok("error" in result);
  assert.equal(result.error.code, "registry_invalid");
  process.chdir(REAL_CWD);
});

test("a MISSING registry answers registry_unreadable and never the absolute path fs threw", async () => {
  const root = mkdtempSync(nodePath.join(tmpdir(), "kp-archetype-registry-"));
  fixtures.push(root);
  process.chdir(root);
  const result = await updateArchetype("bau", { label: "Renamed" });
  assert.ok("error" in result);
  assert.equal(result.error.code, "registry_unreadable");
  assert.ok(!result.error.message.includes(root), "the deployment's absolute path must not reach the client");
  process.chdir(REAL_CWD);
});

test("the READ door throws a typed, client-safe error — the GET route's 500 stays leak-free", async () => {
  withRegistryFile(registryWith({ weights: { skills: 0.4995, career: 0.35, personal: 0.15 } }));
  await assert.rejects(
    () => listArchetypes(),
    (err: unknown) => {
      assert.ok(err instanceof ArchetypeRegistryError, "listArchetypes keeps its array return type and throws instead");
      assert.equal(err.code, "registry_invalid");
      // Client-safe BY CONSTRUCTION: the repo-relative file name, never the cwd.
      assert.ok(!err.message.includes(process.cwd()));
      return true;
    },
  );
  process.chdir(REAL_CWD);
});
