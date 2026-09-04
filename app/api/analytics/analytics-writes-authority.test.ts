// The three analytics WRITE doors, driven as real handlers on a throwaway SQLite file.
//
// What was true before this file existed:
//
//   POST /api/analytics/spend    had NO gate at all — any valid cookie, at any role,
//                                could rewrite the denominator every cost-per-hire
//                                figure in the metric pack is divided by.
//   POST /api/analytics/targets  the same, for the goal lines and the ROI baseline.
//   POST .../calibration/apply-threshold
//                                was operator-gated, but the operator gate reads no
//                                ROLE (require-operator.ts: valid session + not the
//                                demo workspace), so a `viewer` could move the live
//                                auto-reject floor. And its staleness guard was
//                                OPT-IN — `if (typeof body.suggestedThreshold ===
//                                "number")` — so a POST that simply omitted the field
//                                skipped the comparison and applied whatever the live
//                                recommendation had become.
//
// Every refusal is asserted by CODE, never by prose: the panel resolves
// `errors.<CODE>` in the reader's language (api-contracts.md §1.1).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

// next/server must resolve to the shared test shim BEFORE the routes load — hooks only
// affect later resolutions, hence the dynamic imports below. Without it `connection()`
// is a no-op only by accident of the worktree's node_modules junction.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope; resolve it to a virtual
// module whose cookie jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpAnalyticsTestCookie?: () => string | null }).__kpAnalyticsTestCookie = () => cookieValue;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpAnalyticsTestCookie();
            return { get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined) };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// A signing secret AND an operator password: without the password every caller folds to
// owner (open dev mode) and there is no authority decision left to prove.
process.env.KP_SECRET = "analytics-writes-test-secret";
process.env.KP_OPERATOR_PASSWORD = "analytics-writes-test-password";

const { POST: applyThreshold } = await import("./calibration/apply-threshold/route.ts");
const { POST: setSpend } = await import("./spend/route.ts");
const { POST: setTarget } = await import("./targets/route.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../_lib/auth/session.ts");
const { createPipelineEntry, actOnPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { sealDecisionRecord, SCREEN_WAVE_HOLDOUT_KIND } = await import("../../_lib/decision-record-store.ts");
const { getDecisionConfig } = await import("../../_lib/decision-config-store.ts");
const { effectiveFloor } = await import("../../_lib/decision-config-schema.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
// A family the demo corpus does not use, so the fixture's curve is the fixture's own.
const FAMILY = "life_sciences_research";

const recruiter = createUser({
  orgId: ORG,
  email: "ana.recruiter@csas.cz",
  name: "Ana Recruiter",
  status: "active",
  password: "recruiter-pw-1234",
});
const viewer = createUser({
  orgId: ORG,
  email: "ana.viewer@csas.cz",
  name: "Ana Viewer",
  status: "active",
  password: "viewer-pw-12345",
});
upsertMembership(recruiter.id, DEFAULT_WORKSPACE, "recruiter"); // pipeline:write + read
upsertMembership(viewer.id, DEFAULT_WORKSPACE, "viewer"); // read only

function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(DEFAULT_WORKSPACE, Date.now(), { sub: user.id, org: user.orgId });
}

const post = (url: string, body: unknown): NextRequest =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

// ---- the calibration fixture ---------------------------------------------------
//
// A recommendation must EXIST for the staleness path to be reachable at all, and
// `recommendScreeningThreshold` is honesty-gated: ≥20 decided pairs in scope, a floor
// strictly inside (0,100), and ≥8 CLEAN-ARM pairs in the band just below the floor. The
// default screening floor is 45 and the band width is 10, so:
//   12 spared (holdout-sealed) entries at score 40, all advanced past the gate → the
//      below-floor band [35,45) carries 12 pairs at a 100 % advance rate → "lower to 35"
//    8 entries at score 20, rejected at the gate → the scope reaches 20 decided pairs.
let seq = 0;
function addEntry(matchScore: number) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `ana-c${seq}`,
    candidateLabel: `Analytics Tester ${seq}`,
    roleFamily: FAMILY,
    jobId: `ana-job-${seq}`,
    jobTitle: "Analytics Test Role",
    matchScore,
  });
  return entry;
}
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

before(() => signedInAs(recruiter));

type Body = { code?: string; recommendation?: { suggestedThreshold: number }; error?: string };
const json = async (r: Response): Promise<Body> => (await r.json()) as Body;

// ---- (a) consent is required, and it is compared ------------------------------

test("apply-threshold refuses a POST that names no suggested threshold", async () => {
  signedInAs(recruiter);
  const res = await applyThreshold(post("/api/analytics/calibration/apply-threshold", { roleFamily: FAMILY }));
  assert.equal(res.status, 400);
  const body = await json(res);
  assert.equal(body.code, "CALIBRATION_SUGGESTION_REQUIRED");
  assert.equal(
    effectiveFloor(getDecisionConfig("screening", DEFAULT_WORKSPACE), FAMILY),
    45,
    "the live floor must not have moved — the whole point of refusing a consent-less apply",
  );
});

test("apply-threshold refuses a stale suggestion and hands back the live recommendation", async () => {
  signedInAs(recruiter);
  const res = await applyThreshold(
    post("/api/analytics/calibration/apply-threshold", { roleFamily: FAMILY, suggestedThreshold: 99 }),
  );
  assert.equal(res.status, 409);
  const body = await json(res);
  assert.equal(body.code, "CALIBRATION_RECOMMENDATION_CHANGED");
  assert.ok(body.recommendation, "the live recommendation rides beside the code as DATA");
  assert.notEqual(body.recommendation!.suggestedThreshold, 99);
});

test("apply-threshold refuses a role family the app does not define", async () => {
  signedInAs(recruiter);
  const res = await applyThreshold(
    post("/api/analytics/calibration/apply-threshold", { roleFamily: "not_a_family", suggestedThreshold: 35 }),
  );
  assert.equal(res.status, 400);
  assert.equal((await json(res)).code, "CALIBRATION_FAMILY_UNKNOWN");
});

// ---- (b) the writes check authority -------------------------------------------

test("a viewer cannot move the auto-reject floor", async () => {
  signedInAs(viewer);
  const res = await applyThreshold(
    post("/api/analytics/calibration/apply-threshold", { roleFamily: FAMILY, suggestedThreshold: 35 }),
  );
  assert.equal(res.status, 403);
  assert.equal((await json(res)).code, "ANALYTICS_POLICY_FORBIDDEN");
});

test("a viewer cannot rewrite channel spend or the analytics targets", async () => {
  signedInAs(viewer);
  const spend = await setSpend(post("/api/analytics/spend", { channel: "linkedin", amountCzk: 1 }));
  assert.equal(spend.status, 403);
  assert.equal((await json(spend)).code, "ANALYTICS_POLICY_FORBIDDEN");

  const target = await setTarget(post("/api/analytics/targets", { metric: "time_to_hire", value: 30 }));
  assert.equal(target.status, 403);
  assert.equal((await json(target)).code, "ANALYTICS_POLICY_FORBIDDEN");
});

test("an unauthenticated caller gets 401, not 403 — there is no seat to blame", async () => {
  signedInAs(null);
  assert.equal((await setSpend(post("/api/analytics/spend", { channel: "linkedin", amountCzk: 1 }))).status, 401);
  assert.equal((await setTarget(post("/api/analytics/targets", { metric: "time_to_hire", value: 30 }))).status, 401);
});

test("a recruiter still writes spend and targets", async () => {
  signedInAs(recruiter);
  assert.equal((await setSpend(post("/api/analytics/spend", { channel: "linkedin", amountCzk: 12345 }))).status, 200);
  assert.equal((await setTarget(post("/api/analytics/targets", { metric: "time_to_hire", value: 30 }))).status, 200);
});

// Last: this one MOVES the family floor, which changes every recommendation above it.
test("a recruiter applying the live suggestion moves the family floor", async () => {
  signedInAs(recruiter);
  const probe = await json(
    await applyThreshold(post("/api/analytics/calibration/apply-threshold", { roleFamily: FAMILY, suggestedThreshold: 99 })),
  );
  const live = probe.recommendation!.suggestedThreshold;
  const res = await applyThreshold(
    post("/api/analytics/calibration/apply-threshold", { roleFamily: FAMILY, suggestedThreshold: live }),
  );
  assert.equal(res.status, 200);
  assert.equal(effectiveFloor(getDecisionConfig("screening", DEFAULT_WORKSPACE), FAMILY), live);
});
