// The TS mirror of the role-rubric derivation (role-rubric.ts) against the SAME
// fixture pipeline/jobfit/tests/test_rolerubric.py reads — weights compared
// exactly. A rule changed in one language and not the other fails here or there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { rubricAxisSchema, type RubricAxis } from "./schemas.generated.ts";
import type { RoleBrief } from "./rolespec.ts";
import { deriveRoleRubric } from "./role-rubric.ts";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "pipeline",
  "jobfit",
  "tests",
  "fixtures",
  "role_rubric_cases.json"
);
const { cases } = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  cases: { name: string; brief: RoleBrief; expected: RubricAxis[] }[];
};

test("the fixture carries the cases the Python side is pinned to", () => {
  assert.ok(cases.length >= 5, `expected >=5 parity cases, found ${cases.length}`);
});

for (const c of cases) {
  test(`parity: ${c.name}`, () => {
    assert.deepStrictEqual(deriveRoleRubric(c.brief), c.expected);
  });
}

test("every derived rubric is one the store accepts: schema-valid, unique keys, weights summing to 1", () => {
  for (const c of cases) {
    const axes = deriveRoleRubric(c.brief);
    if (axes.length === 0) continue;
    for (const axis of axes) assert.ok(rubricAxisSchema.safeParse(axis).success, `${c.name}: ${axis.key} fails rubricAxisSchema`);
    assert.equal(new Set(axes.map((a) => a.key)).size, axes.length, `${c.name}: duplicate axis key`);
    assert.ok(axes.every((a) => a.weight >= 0 && a.weight <= 1), `${c.name}: weight outside 0..1`);
    const sum = axes.reduce((s, a) => s + a.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${c.name}: weights sum to ${sum}`);
  }
});

test("a brief read from an older stored blob — missing fields — derives with the schema defaults, not a crash", () => {
  const legacy = { requirements: [{ skill: "Go" }, { kind: "must_have" }], facets: [{ key: "why_now", value: "Launch", importance: "core" }] } as unknown as RoleBrief;
  const axes = deriveRoleRubric(legacy);
  assert.deepEqual(
    axes.map((a) => [a.key, a.kind, a.hardness, a.blocking, a.provenance, a.label]),
    [
      ["req:go", "must_have", "prerequisite", true, "inferred", "Go"],
      ["facet:why_now", "core", "", false, "inferred", "why_now"],
    ]
  );
  assert.deepEqual(deriveRoleRubric({}), []);
});

test("the derivation is order-independent for duplicate rows", () => {
  const rows = [
    { skill: "Czech", kind: "nice_to_have", hardness: "prerequisite", weight: 0.7 },
    { skill: "czech", kind: "must_have", hardness: "learnable", weight: 0.2 },
  ];
  const grading = (axes: RubricAxis[]) => axes.map((a) => [a.key, a.kind, a.hardness, a.weight, a.blocking]);
  const forward = deriveRoleRubric({ requirements: rows } as unknown as RoleBrief);
  const backward = deriveRoleRubric({ requirements: [...rows].reverse() } as unknown as RoleBrief);
  assert.deepEqual(grading(forward), grading(backward));
  assert.deepEqual(grading(forward), [["req:czech", "must_have", "prerequisite", 1, true]]);
});
