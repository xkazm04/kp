// TS ↔ Python lockstep for the two archetype constants that are MIRRORED rather than
// shared.
//
// archetypes.json is genuinely single-sourced — both languages read the same file, which
// is why the fairness-gate desync is structurally impossible. The two numbers that
// GOVERN that file are not: the weight-sum tolerance and the scoring-model vocabulary
// each exist once in TypeScript and once in Python, as literals, with nothing comparing
// them. Both have already drifted once. The tolerance sat at 1e-3 here against Python's
// 1e-6, and that gap was not a rounding allowance but a hole: a vector summing to 0.9995
// passed this validator, was persisted, and then made registry.py raise RuntimeError at
// IMPORT — on every profile_cli / match / analyze / intake spawn, for the whole
// deployment, until someone hand-edited the JSON back. A drift in the model vocabulary
// is the same shape one layer up: a scoringModel this side accepts and Python's contract
// test rejects ships a registry CI refuses to validate.
//
// So read the Python source and pin both. A source read, not an import: there is no
// Python in the node test runner, and the point is precisely to compare the two written
// numbers rather than to re-derive one from the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Line endings normalised: this checkout is CRLF while a worktree may be LF, and
 *  every pattern below is anchored. */
function readPy(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

// The TS side, read as source for the same reason (archetype-registry.ts imports
// node:fs and the constants are module-private by design — exporting them just to test
// them would widen the surface to make the mirror visible).
const TS = readPy("./archetype-registry.ts");

test("the weight-sum tolerance is the SAME number on both sides", () => {
  const py = readPy("../../pipeline/jobfit/registry.py");
  const pyTolerance = /abs\(total - 1\.0\) > (\S+):/.exec(py)?.[1];
  assert.ok(pyTolerance, "registry.py must still guard the weight sum at import — the whole reason this file exists");
  assert.equal(pyTolerance, "1e-6", "if Python's tolerance moved, this test is the place the TS side learns about it");

  const tsTolerance = /^const WEIGHT_SUM_TOLERANCE = (\S+);$/m.exec(TS)?.[1];
  assert.ok(tsTolerance, "archetype-registry.ts must still declare WEIGHT_SUM_TOLERANCE");
  assert.equal(
    tsTolerance,
    pyTolerance,
    "the TS validator must reject exactly what Python's import guard rejects — a looser TS number " +
      "lets a bad vector reach archetypes.json and take every pipeline spawn down",
  );
});

test("the scoring-model vocabulary is the SAME list on both sides", () => {
  // Python's vocabulary is asserted by its contract test rather than declared in
  // registry.py (registry.py consumes the values: `scoringModel == "early_career"`),
  // so the authority to pin against is tests/test_registry.py's frozen set.
  const pyTest = readPy("../../pipeline/jobfit/tests/test_registry.py");
  const raw = /^_VALID_SCORING_MODELS = \{([^}]*)\}$/m.exec(pyTest)?.[1];
  assert.ok(raw, "test_registry.py must still declare _VALID_SCORING_MODELS");
  const pyModels = [...raw.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(pyModels, ["early_career", "experienced"], "the vocabulary itself, pinned so a silent addition is visible here");

  const tsRaw = /^const SCORING_MODELS = \[([^\]]*)\] as const;$/m.exec(TS)?.[1];
  assert.ok(tsRaw, "archetype-registry.ts must still declare SCORING_MODELS");
  const tsModels = [...tsRaw.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    tsModels,
    pyModels,
    "a model this side accepts and Python's contract test rejects ships a registry CI refuses to validate",
  );

  // registry.py must still ROUTE on one of them — otherwise the vocabulary is pinned
  // against a list nothing consumes and this test has gone vacuous.
  const py = readPy("../../pipeline/jobfit/registry.py");
  assert.ok(
    pyModels.some((m) => py.includes(`"${m}"`)),
    "registry.py must still consume a scoringModel value",
  );
});
