// ROLE_FAMILY_SLUGS is the TS half of the role-family vocabulary, and it is a
// HAND-MAINTAINED mirror of data/taxonomy.json::role_families — the same file
// pipeline/jobfit/taxonomy.py reads to build ROLE_FAMILIES. The Python half is
// already pinned to that file (pipeline/jobfit/tests/test_taxonomy_contract.py
// ::test_module_role_families_match_data). The TS half was NOT pinned to anything,
// so the two could drift silently: adding a family to the taxonomy and forgetting
// the TS list would leave that family invisible to every TS consumer, and dropping
// one would leave a phantom slug in dropdowns.
//
// That drift is now load-bearing rather than merely untidy: interview-rubric.ts's
// `rubricCoverage` decides whether a role family is CANONICAL (base rubric is the
// intended rubric — stay silent) or UNRECOGNIZED (a data anomaly — say so) by
// membership in this list. A stale mirror would make a real family look like an
// anomaly to a recruiter, or hide a genuine one.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ROLE_FAMILY_SLUGS, ROLE_FAMILY_LABELS, DEFAULT_ROLE_FAMILY } from "@/app/_lib/role-families.ts";

// app/_lib/ -> repo root is two levels up.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function canonicalFamilies(): string[] {
  const raw = readFileSync(path.join(ROOT, "data", "taxonomy.json"), "utf8");
  const taxonomy = JSON.parse(raw) as { role_families?: Record<string, string> };
  return Object.keys(taxonomy.role_families ?? {});
}

test("ROLE_FAMILY_SLUGS is exactly data/taxonomy.json::role_families", () => {
  const expected = canonicalFamilies().sort();
  assert.ok(expected.length > 0, "data/taxonomy.json::role_families must be a non-empty object");
  // Widened to string[]: ROLE_FAMILY_SLUGS is a literal-union tuple and we compare
  // it against plain keys read off disk.
  const actual: string[] = [...ROLE_FAMILY_SLUGS].sort();
  const missing = expected.filter((f) => !actual.includes(f));
  const extra = actual.filter((f) => !expected.includes(f));
  assert.deepEqual(
    missing,
    [],
    `app/_lib/role-families.ts is missing ${missing.join(", ")} — those families exist in the ` +
      `canonical taxonomy but are invisible to every TS consumer (and rubricCoverage would ` +
      `report them as unrecognized data anomalies).`
  );
  assert.deepEqual(
    extra,
    [],
    `app/_lib/role-families.ts has ${extra.join(", ")}, which data/taxonomy.json does not define.`
  );
});

test("every canonical family has an English fallback label and the default is canonical", () => {
  for (const family of ROLE_FAMILY_SLUGS) {
    assert.ok(ROLE_FAMILY_LABELS[family]?.trim(), `ROLE_FAMILY_LABELS is missing ${family}`);
  }
  assert.deepEqual(
    Object.keys(ROLE_FAMILY_LABELS).sort(),
    ([...ROLE_FAMILY_SLUGS] as string[]).sort(),
    "ROLE_FAMILY_LABELS must cover exactly the canonical families — no orphans, no gaps"
  );
  assert.ok(
    (ROLE_FAMILY_SLUGS as readonly string[]).includes(DEFAULT_ROLE_FAMILY),
    "DEFAULT_ROLE_FAMILY must itself be a canonical family"
  );
});
