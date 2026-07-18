// The sim offer-draft salary fallback must be single-sourced from SIM_SALARY, not a
// re-hardcoded [120000, 165000] literal that silently drifts from the demo band the
// same sim publishes (guided-pipeline-simulation #3). The route needs a DB + entry
// to drive, so this source-guards the wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("offer-draft salary fallback derives from SIM_SALARY, not a bare literal", () => {
  assert.match(src, /SIM_SALARY\.suggestedMinimum/, "the fallback must use SIM_SALARY");
  assert.doesNotMatch(src, /\?\?\s*\[\s*120000\s*,\s*165000\s*\]/, "the re-hardcoded band literal must be gone");
});
