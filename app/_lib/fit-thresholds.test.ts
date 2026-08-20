// The fit BAND is single-sourced (sourcing-campaigns-rediscovery #3): the rediscovery
// admission gate (SCORE_FLOOR), the Candidates "Pool fit" filter, the group-eval
// low-fit risk and the fit-tier BADGE all derive from fit-thresholds.ts, so tuning one
// floor can't silently drift from the rest. rediscover.ts imports the db barrel (not
// loadable under this runner), so its wiring is checked by source guard; the recruiter
// filter and the badge likewise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR } from "./fit-thresholds.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(dir, rel), "utf8");

test("the band's two floors are the shared values", () => {
  assert.equal(FIT_PROMISING_FLOOR, 55);
  assert.equal(FIT_STRONG_FLOOR, 70);
  assert.ok(FIT_STRONG_FLOOR > FIT_PROMISING_FLOOR, "strong must sit above promising");
});

test("both surfaces derive from FIT_PROMISING_FLOOR, not a re-hardcoded literal", () => {
  const rediscover = read("rediscover.ts");
  assert.match(rediscover, /SCORE_FLOOR\s*=\s*FIT_PROMISING_FLOOR/, "SCORE_FLOOR must reference the shared floor");
  const recruiter = read("../features/library/jobs/jobsRecruiterCandidatesLogic.ts");
  assert.match(recruiter, /FIT_PROMISING_FLOOR/, "the Pool fit filter must use the shared floor");
  assert.doesNotMatch(recruiter, /POOL_FIT_FLOOR\s*=\s*55/, "the re-hardcoded 55 literal must be gone");
});

// The BADGE the recruiter reads must band a bare numeric score on the same scale as
// the gates above. scoreToFitTier used to re-hardcode both 70 and 55, so tuning the
// shared floor would have moved every gate and left the badge on the old scale.
test("the fit-tier badge derives from the shared floors, not re-hardcoded literals", () => {
  const badge = read("../_components/Badge.tsx");
  const start = badge.indexOf("export function scoreToFitTier");
  assert.ok(start >= 0, "scoreToFitTier must exist");
  const fn = badge.slice(start, badge.indexOf("\n}", start));
  assert.match(fn, /score >= FIT_STRONG_FLOOR/, "the strong branch must use the shared floor");
  assert.match(fn, /score >= FIT_PROMISING_FLOOR/, "the promising branch must use the shared floor");
  assert.doesNotMatch(fn, /score >= (70|55)\b/, "the re-hardcoded literals must be gone");
  assert.match(badge, /import \{ FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR \} from "@\/app\/_lib\/fit-thresholds"/);
});
