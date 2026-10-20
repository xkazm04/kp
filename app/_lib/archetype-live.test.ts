// The live archetype-registry reader (archetype-live.ts) — the server-side read that
// follows pipeline/jobfit/archetypes.json at RUNTIME, the way Python's registry.py does
// on every spawn, instead of the copy app/_lib/archetypes.ts bundled at build time.
//
// Every case runs against a TEMP registry file (setLiveRegistryPathForTest), never the
// checked-in archetypes.json, so nothing here can mutate the deployment's taxonomy.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  archetypeRegistryDigest,
  invalidateLiveRegistry,
  isFairnessProtectedLive,
  liveIsKnownArchetype,
  setLiveRegistryPathForTest,
  UNREADABLE_REGISTRY_DIGEST,
} from "./archetype-live.ts";
import { isFairnessProtected, isKnownArchetype } from "./archetypes.ts";

const BUNDLED_PATH = fileURLToPath(new URL("../../pipeline/jobfit/archetypes.json", import.meta.url));
const BUNDLED = JSON.parse(readFileSync(BUNDLED_PATH, "utf8")) as { archetypes: Record<string, unknown>[] };
const dir = mkdtempSync(path.join(tmpdir(), "kp-archetype-live-"));
const file = path.join(dir, "archetypes.json");

after(() => {
  setLiveRegistryPathForTest(null);
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => setLiveRegistryPathForTest(file));

type Def = Record<string, unknown>;
function opsLead(over: Def = {}): Def {
  return {
    id: "ops_lead",
    label: "Operations lead",
    badge: "Ops lead",
    pythonLabel: "Operations lead",
    fairnessProtected: false,
    scoringModel: "experienced",
    weights: { skills: 0.5, career: 0.35, personal: 0.15 },
    dimensionLabels: { skills: "Skills", career: "Career", personal: "Personal" },
    checklist: [],
    ...over,
  };
}
/** Write a registry = the bundled one, each built-in patched by `patch[id]`, plus `extra`. */
function writeRegistry(extra: Def[] = [], patch: Record<string, Def> = {}): void {
  const reg = structuredClone(BUNDLED);
  reg.archetypes = reg.archetypes.map((a) => ({ ...a, ...(patch[a.id as string] ?? {}) }));
  reg.archetypes.push(...extra);
  writeFileSync(file, `${JSON.stringify(reg, null, 2)}\n`, "utf8");
  invalidateLiveRegistry();
}

test("case 1: a custom archetype registered at runtime is KNOWN to the live reader, while the bundled copy still misses it", () => {
  writeRegistry([opsLead()]);
  assert.equal(liveIsKnownArchetype("ops_lead"), true);
  assert.equal(liveIsKnownArchetype("  OPS_LEAD "), true, "normalized like the bundled gate");
  assert.equal(isKnownArchetype("ops_lead"), false, "the gap this reader closes: the build-time copy never saw it");
  assert.equal(isFairnessProtectedLive("ops_lead"), false, "registered unprotected + experienced -> not shielded");
});

test("case 2: switching a custom archetype's shield ON takes effect on the next read, no restart", () => {
  writeRegistry([opsLead()]);
  assert.equal(isFairnessProtectedLive("ops_lead"), false);
  writeRegistry([opsLead({ fairnessProtected: true })]);
  assert.equal(isFairnessProtectedLive("ops_lead"), true);
});

test("case 2b: the mtime/size memo alone picks up a rewrite (no explicit invalidation)", () => {
  writeRegistry([opsLead()]);
  assert.equal(isFairnessProtectedLive("ops_lead"), false);
  const reg = JSON.parse(readFileSync(file, "utf8")) as { archetypes: Def[] };
  reg.archetypes[reg.archetypes.length - 1].fairnessProtected = true;
  writeFileSync(file, JSON.stringify(reg), "utf8"); // different size than the pretty-printed file
  assert.equal(isFairnessProtectedLive("ops_lead"), true);
});

test("case 2c: the shield keys on scoringModel too - the key Python's automation.py uses for early-career", () => {
  writeRegistry([opsLead({ fairnessProtected: false, scoringModel: "early_career" })]);
  assert.equal(
    isFairnessProtectedLive("ops_lead"),
    true,
    "Python never auto-rejects an early_career-scored archetype; the TS gate must not be looser"
  );
});

test("case 3: the live shield is a UNION with the bundled one - it can only add protection", () => {
  // A hand-edit that strips a built-in's shield in the live file (the manager refuses it,
  // a text editor does not) must not unshield anyone the bundle protects.
  const strip: Record<string, Def> = {};
  for (const a of BUNDLED.archetypes) strip[a.id as string] = { fairnessProtected: false, scoringModel: "experienced" };
  writeRegistry([opsLead({ fairnessProtected: true })], strip);
  const ids = [...BUNDLED.archetypes.map((a) => a.id as string), "unknown", "unrouted", "nope", "", "constructor"];
  for (const id of ids) {
    if (isFairnessProtected(id)) {
      assert.equal(isFairnessProtectedLive(id), true, `${JSON.stringify(id)} is shielded by the bundle and must stay shielded live`);
    }
  }
  assert.equal(isFairnessProtectedLive("student"), true, "protected in the bundle, unprotected in the live file -> still protected");
  assert.equal(isFairnessProtectedLive("nope"), true, "unknown to both -> shielded (fail closed)");
  assert.equal(isFairnessProtectedLive(null), true);
  assert.equal(isFairnessProtectedLive("constructor"), true, "own-key membership, never the prototype chain");
});

test("case 4: an unreadable / invalid registry falls back to the bundled gate and a fixed digest, never throws", () => {
  const cases: [string, () => void][] = [
    ["missing file", () => setLiveRegistryPathForTest(path.join(dir, "does-not-exist.json"))],
    ["invalid JSON", () => { writeFileSync(file, "{ not json", "utf8"); invalidateLiveRegistry(); }],
    ["fails the registry validator", () => writeRegistry([opsLead({ weights: { skills: 0.9, career: 0.9, personal: 0.9 } })])],
  ];
  for (const [what, arrange] of cases) {
    arrange();
    assert.equal(isFairnessProtectedLive("bau"), false, `${what}: bau -> bundled false`);
    assert.equal(isFairnessProtectedLive("student"), true, `${what}: student -> bundled true`);
    assert.equal(isFairnessProtectedLive("nope"), true, `${what}: unknown -> shielded`);
    assert.equal(isFairnessProtectedLive("ops_lead"), true, `${what}: a live-only id cannot be vouched for -> shielded`);
    assert.equal(archetypeRegistryDigest(), UNREADABLE_REGISTRY_DIGEST, `${what}: digest is the sentinel`);
    assert.equal(UNREADABLE_REGISTRY_DIGEST, "unreadable");
    setLiveRegistryPathForTest(file);
  }
});

test("case 5: the digest is content-addressed - stable over identical bytes, moved by a weight edit alone", () => {
  writeRegistry();
  const a = archetypeRegistryDigest();
  invalidateLiveRegistry();
  assert.equal(archetypeRegistryDigest(), a, "two reads of identical bytes");
  assert.match(a, /^[0-9a-f]{40}$/);
  writeRegistry([], { bau: { weights: { skills: 0.6, career: 0.25, personal: 0.15 } } });
  assert.notEqual(archetypeRegistryDigest(), a, "a bau reweight must move the digest");
});
