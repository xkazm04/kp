// Pins the jobs 404/400/empty-pool doors to coded refusals (scan-sweep jobs-api).
// Before: English "Job not found." / interpolated MIN_AD_CHARS / empty-pool note /
// outreach GDPR prose. After: jsonRefusal codes + candidates: [] with no note.
// Runner: node:test via npm run test:unit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(dir, rel), "utf8").replace(/\r\n/g, "\n");

test("jobs 404/400/empty-pool answers are coded refusals, not English prose", () => {
  const getById = read(path.join("[id]", "route.ts"));
  assert.match(getById, /jsonRefusal\("JOB_NOT_FOUND", 404\)/);
  assert.equal(getById.includes("Job not found."), false);

  const ingest = read(path.join("ingest", "route.ts"));
  assert.match(ingest, /jsonRefusal\("JOB_AD_TOO_SHORT", 400\)/);
  assert.match(ingest, /jsonRefusal\("JOB_NOT_FOUND", 404\)/);
  assert.equal(/Provide the full job ad/.test(ingest), false);

  const candidates = read(path.join("[id]", "candidates", "route.ts"));
  assert.match(candidates, /jsonRefusal\("JOB_NOT_FOUND", 404\)/);
  assert.equal(candidates.includes('note: "No saved candidates yet."'), false);
  assert.match(candidates, /candidates: \[\]/);

  const outreach = read(path.join("[id]", "candidates", "outreach", "route.ts"));
  assert.match(outreach, /jsonRefusal\("JOB_NOT_FOUND", 404\)/);
  assert.match(outreach, /jsonRefusal\("OUTREACH_CANDIDATE_REQUIRED", 400\)/);
  assert.match(outreach, /jsonRefusal\("COMMS_SUPPRESSED", 409/);
  assert.equal(outreach.includes("Role not found."), false);
  assert.equal(outreach.includes("candidateId is required."), false);
});
