// POST /api/analytics/targets against a CUSTOMISED board, driven as a real handler on
// a throwaway SQLite file.
//
// What was true before this file existed: the route validated `metric` against the
// SHIPPED five stage names, while the funnel and the goals editor render the
// workspace's own axis. A team that added a "Tech round" column saw a goal field for
// it and every save answered a raw English 400 ("Invalid metric.") with no code, so
// the editor could only print its generic saved-failed line, forever. And the read
// side turned every stored non-reserved row into a conversion goal, so a goal for a
// column the team had retired rode the payload as a phantom stage.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// No KP_OPERATOR_PASSWORD: open dev mode folds every caller to owner. Authority is
// analytics-writes-authority.test.ts's subject; this file's is the key space.
const { POST: setTarget } = await import("./route.ts");
const { GET: readAnalytics } = await import("../route.ts");
const { setDecisionConfig } = await import("../../../_lib/decision-config-store.ts");
const { PIPELINE_STAGES_DEFAULT } = await import("../../../_lib/decision-config-schema.ts");
const { createPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { listAnalyticsTargets, RESERVED_TARGET_KEYS: DB_RESERVED } = await import("../../../_lib/db/analytics.ts");
const { RESERVED_TARGET_KEYS, RESERVED_TARGET_SPECS } = await import("../../../_lib/analytics-target-keys.ts");
const { localizedSaveFailure } = await import("../../../features/insights/analytics/analyticsSaveFailure.ts");

after(() => {
  setDecisionConfig("pipelineStages", PIPELINE_STAGES_DEFAULT as unknown as Record<string, unknown>, undefined, "team");
  cleanupUnitDb();
});

const stage = (id: string, role: string) => ({ id, label: id, role });
const LIVE_WITH_TECH = [
  stage("Accepted", "entry"),
  stage("Screened", "screening"),
  stage("Interview", "interview"),
  stage("Tech round", "custom"),
  stage("Offer", "offer"),
  stage("Hired", "terminal"),
];
const CUSTOM = { stages: LIVE_WITH_TECH, retired: [] };
const INTERVIEW_RETIRED = {
  stages: LIVE_WITH_TECH.filter((s) => s.id !== "Interview"),
  retired: [stage("Interview", "interview")],
};
const useAxis = (axis: Record<string, unknown>) => setDecisionConfig("pipelineStages", axis, undefined, "team");

const post = (body: unknown): NextRequest =>
  new Request("http://localhost/api/analytics/targets", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

type Payload = { targets: { conversion: Record<string, number>; timeToHireDays: number | null } };
const readTargets = async (): Promise<Payload["targets"]> =>
  ((await (await readAnalytics(new Request("http://localhost/api/analytics"))).json()) as Payload).targets;

createPipelineEntry({
  candidateId: "axis-c1",
  candidateLabel: "Axis Tester",
  jobId: "axis-job-1",
  jobTitle: "Axis Test Role",
  matchScore: 70,
  sourceChannel: "linkedin",
});

async function refusal(body: unknown): Promise<{ status: number; code?: string }> {
  const res = await setTarget(post(body));
  const json = (await res.json()) as { code?: string };
  return { status: res.status, code: json.code };
}

test("an ADDED live column is goal-able, and the payload carries its goal", async () => {
  useAxis(CUSTOM);
  const res = await setTarget(post({ metric: "Tech round", value: 40 }));
  assert.equal(res.status, 200);
  assert.equal((await readTargets()).conversion["Tech round"], 40);
});

test("a RETIRED column and an unknown metric are refused with a code", async () => {
  useAxis(CUSTOM);
  assert.equal((await setTarget(post({ metric: "Interview", value: 55 }))).status, 200, "fixture: Interview is live here");
  useAxis(INTERVIEW_RETIRED);
  assert.deepEqual(await refusal({ metric: "Interview", value: 40 }), { status: 400, code: "ANALYTICS_TARGET_UNKNOWN_METRIC" });
  assert.deepEqual(await refusal({ metric: "bogus", value: 40 }), { status: 400, code: "ANALYTICS_TARGET_UNKNOWN_METRIC" });
});

test("the entry column is not a goal key", async () => {
  useAxis(CUSTOM);
  assert.deepEqual(await refusal({ metric: "Accepted", value: 40 }), { status: 400, code: "ANALYTICS_TARGET_UNKNOWN_METRIC" });
});

test("ceilings come from the registry and refuse with a code", async () => {
  useAxis(CUSTOM);
  const out = { status: 400, code: "ANALYTICS_TARGET_OUT_OF_RANGE" };
  assert.deepEqual(await refusal({ metric: "Offer", value: 140 }), out);
  assert.deepEqual(await refusal({ metric: "time_to_hire", value: 4000 }), out);
  assert.equal((await setTarget(post({ metric: "manual_hours_per_hire", value: 1000 }))).status, 200);
  assert.deepEqual(await refusal({ metric: "recruiter_hourly_czk", value: 1_000_001 }), out);
  assert.deepEqual(await refusal({ metric: "Offer", value: -3 }), out);
});

test("read side: a retired column's goal is withheld from the payload, kept in the table, and returns unchanged", async () => {
  useAxis(CUSTOM);
  assert.equal((await setTarget(post({ metric: "Interview", value: 55 }))).status, 200);
  useAxis(INTERVIEW_RETIRED);
  const withheld = await readTargets();
  assert.equal("Interview" in withheld.conversion, false, "a goal for a column nobody draws must not ride the payload as a phantom stage");
  assert.equal(withheld.conversion["Tech round"], 40);
  assert.equal(listAnalyticsTargets().get("Interview"), 55, "the stored row stays: retiring a column is not deleting its goal");
  useAxis(CUSTOM);
  assert.equal((await readTargets()).conversion.Interview, 55, "un-retiring the column brings the goal back unchanged");
});

test("one vocabulary: db/analytics.ts RESERVED_TARGET_KEYS is the registry's reserved set", () => {
  assert.deepEqual([...DB_RESERVED].sort(), [...RESERVED_TARGET_KEYS].sort());
  assert.deepEqual([...DB_RESERVED].sort(), Object.keys(RESERVED_TARGET_SPECS).sort());
});

test("both refusal codes resolve in all four catalogs through the editor's save-failure fold", async () => {
  useAxis(CUSTOM);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const catalog = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8")) as {
      errors: Record<string, string>;
    };
    const resolve = ((payload, fallback) => {
      const code = payload?.code;
      return code && catalog.errors[code] ? catalog.errors[code] : fallback;
    }) as Parameters<typeof localizedSaveFailure>[1];
    for (const [body, code] of [
      [{ metric: "bogus", value: 1 }, "ANALYTICS_TARGET_UNKNOWN_METRIC"],
      [{ metric: "Offer", value: 140 }, "ANALYTICS_TARGET_OUT_OF_RANGE"],
    ] as const) {
      const failure = await localizedSaveFailure(await setTarget(post(body)), resolve, "FALLBACK");
      assert.ok(catalog.errors[code], `${locale}: errors.${code} missing`);
      assert.equal(failure.message, catalog.errors[code], `${locale}: ${code} must resolve, not fall back`);
    }
  }
});
