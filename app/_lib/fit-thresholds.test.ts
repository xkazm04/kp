// The "promising fit" floor is single-sourced (sourcing-campaigns-rediscovery #3):
// the rediscovery admission gate (SCORE_FLOOR) and the Candidates "Pool fit" filter
// both derive from FIT_PROMISING_FLOOR, so tuning one can't silently drift from the
// other. rediscover.ts imports the db barrel (not loadable under this runner), so
// its wiring is checked by source guard; RecruiterCandidates likewise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FIT_PROMISING_FLOOR } from "./fit-thresholds.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(dir, rel), "utf8");

test("FIT_PROMISING_FLOOR is the shared value", () => {
  assert.equal(FIT_PROMISING_FLOOR, 55);
});

test("both surfaces derive from FIT_PROMISING_FLOOR, not a re-hardcoded literal", () => {
  const rediscover = read("rediscover.ts");
  assert.match(rediscover, /SCORE_FLOOR\s*=\s*FIT_PROMISING_FLOOR/, "SCORE_FLOOR must reference the shared floor");
  const recruiter = read("../features/library/jobs/jobsRecruiterCandidatesLogic.ts");
  assert.match(recruiter, /FIT_PROMISING_FLOOR/, "the Pool fit filter must use the shared floor");
  assert.doesNotMatch(recruiter, /POOL_FIT_FLOOR\s*=\s*55/, "the re-hardcoded 55 literal must be gone");
});
