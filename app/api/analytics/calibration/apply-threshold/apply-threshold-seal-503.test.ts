// The apply-threshold door answers a coded 503 when its decision record cannot be sealed,
// and the live auto-reject floor stays where it was (council robustness-1). The seal runs
// BEFORE the config write, so the retry is not a dead end: nothing moved, the live
// recommendation is unchanged, and the same click seals and applies. Seal failure is the
// REAL one: the chain is keyed, then the key is unset, so every seal throws.
//
// Its own file (own process, own throwaway DB): it breaks the default chain.
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { POST } = await import("./route.ts");
const { createPipelineEntry, actOnPipelineEntry } = await import("../../../../_lib/db/pipeline.ts");
const { listDecisionRecords, sealDecisionRecord, SCREEN_WAVE_HOLDOUT_KIND } = await import("../../../../_lib/decision-record-store.ts");
const { getDecisionConfig } = await import("../../../../_lib/decision-config-store.ts");
const { effectiveFloor } = await import("../../../../_lib/decision-config-schema.ts");
const { DEFAULT_WORKSPACE } = await import("../../../../_lib/auth/session.ts");

const KEY_ENV = "KP_DECISION_HMAC_KEY";
const priorKey = process.env[KEY_ENV];
after(() => {
  if (priorKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = priorKey;
  cleanupUnitDb();
});

// A family the demo corpus does not use, so the curve is this fixture's own.
const FAMILY = "life_sciences_research";

// The same honesty-gated shape analytics-writes-authority.test.ts builds: 12 clean-arm
// entries at 40 all advanced, 8 at 20 rejected → "lower the floor from 45 to 35".
let seq = 0;
function addEntry(matchScore: number) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `seal-c${seq}`,
    candidateLabel: `Seal Tester ${seq}`,
    roleFamily: FAMILY,
    jobId: `seal-job-${seq}`,
    jobTitle: "Threshold Seal Test",
    matchScore,
  }).entry;
}
process.env[KEY_ENV] = "apply-threshold-seal-test-key";
for (let i = 0; i < 12; i += 1) {
  const e = addEntry(40);
  sealDecisionRecord({
    kind: SCREEN_WAVE_HOLDOUT_KIND,
    actor: "auto:screen-wave",
    policyVersion: "screen-wave/test/holdout",
    candidateRef: e.id,
    rationale: "spared for the calibration clean arm",
    reasonCode: "holdout",
    inputs: { holdoutPercent: 5 },
  });
  actOnPipelineEntry(e.id, "accept");
}
for (let i = 0; i < 8; i += 1) actOnPipelineEntry(addEntry(20).id, "reject");

const apply = (): Promise<Response> =>
  POST(
    new Request("http://localhost/api/analytics/calibration/apply-threshold", {
      method: "POST",
      body: JSON.stringify({ roleFamily: FAMILY, suggestedThreshold: 35 }),
      headers: { "content-type": "application/json" },
    }) as never
  ) as unknown as Promise<Response>;

const floor = () => effectiveFloor(getDecisionConfig("screening", DEFAULT_WORKSPACE), FAMILY);
const sealedPolicy = () =>
  listDecisionRecords({ candidateRef: `policy:screening:${DEFAULT_WORKSPACE}:${FAMILY}`, workspaceId: DEFAULT_WORKSPACE }).filter(
    (r) => r.kind === "screening_threshold_adjusted"
  ).length;

test("a failed seal answers the coded 503 and leaves the floor as it was; the retry applies once", async () => {
  assert.equal(floor(), 45, "the fixture starts on the default floor");

  delete process.env[KEY_ENV];
  const refused = await apply();
  assert.equal(refused.status, 503);
  assert.equal(((await refused.json()) as { code?: string }).code, "PIPELINE_DECISION_NOT_SEALED");
  assert.equal(floor(), 45, "the live floor did not move");
  assert.equal(sealedPolicy(), 0);

  process.env[KEY_ENV] = "apply-threshold-seal-test-key";
  const retried = await apply();
  assert.equal(retried.status, 200, "nothing moved, so the same click still applies");
  assert.deepEqual(await retried.json(), { ok: true, previousThreshold: 45, newThreshold: 35, roleFamily: FAMILY });
  assert.equal(floor(), 35);
  assert.equal(sealedPolicy(), 1, "exactly one sealed policy change");
});
