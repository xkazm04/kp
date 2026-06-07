// Single-source-of-truth contract for the profile taxonomy dropdowns
// (idea-ba28f11b). EVIDENCE_KINDS / SKILL_LEVELS / PROVENANCE are generated from
// the Python taxonomy (pipeline/jobfit/{profile,taxonomy}.py via codegen.py) and
// re-exported by ProfileTypes (that re-export wiring is checked by `tsc`). This
// pins the runtime half of the contract: the editor's default row picks are
// members of the generated lists, so a freshly added skill/evidence row can't
// score zero downstream against the Python provenance weights.
//
// Imports use relative paths (not the `@/` alias) so they resolve under Node's
// built-in test runner, which has no tsconfig-path loader — `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { EVIDENCE_KINDS, SKILL_LEVELS, PROVENANCE } from "../../_lib/taxonomy.generated.ts";
import { SKILL_FALLBACK, EVIDENCE_FALLBACK } from "./ProfileForm.ts";

test("the generated lists are non-empty (a blank dropdown is a generation failure)", () => {
  assert.ok(EVIDENCE_KINDS.length > 0);
  assert.ok(SKILL_LEVELS.length > 0);
  assert.ok(PROVENANCE.length > 0);
});

test("the editor's default row picks are valid taxonomy members", () => {
  // SKILL_FALLBACK / EVIDENCE_FALLBACK seed a blank row; their picks must be
  // selectable values or the very first row a recruiter sees scores against an
  // unknown provenance/kind. Mirrors hydrate()'s "working" / "self_declared" /
  // "project" defaults.
  for (const row of SKILL_FALLBACK) {
    assert.ok(SKILL_LEVELS.includes(row.level), `unknown skill level ${row.level}`);
    assert.ok(PROVENANCE.includes(row.provenance), `unknown provenance ${row.provenance}`);
  }
  for (const row of EVIDENCE_FALLBACK) {
    assert.ok(EVIDENCE_KINDS.includes(row.kind), `unknown evidence kind ${row.kind}`);
  }
});
