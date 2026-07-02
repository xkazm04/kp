// Pins the /api/decisions/* auth contract (backlog #30 / SD-L1-010): the sealed
// decision chain, the reconsider queue, the decision rules, the group evals and
// the screen wave all carry (or act on) real candidate adverse-action data, so
// every handler re-verifies the operator session — exactly the
// /api/automation/[task] convention. requireOperator's semantics match proxy.ts:
// open mode (no KP_OPERATOR_PASSWORD) stays open for local dev; password set
// with no valid operator session → 401 (including the anonymous demo session,
// which the proxy alone would wave through).
//
// Candidate-facing token flows are NOT routed through /api/decisions/*: the
// candidate's own surfaces (/api/status/[token], /api/data/[token],
// /api/offer/[token]) stay on the proxy's public allow-list — asserted below so
// this gate can never silently strand them.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts first project import).
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET as recordsGet } from "./records/route.ts";
import { GET as reconsiderGet } from "./reconsider/route.ts";
import { GET as configGet, POST as configPost } from "./config/route.ts";
import { GET as groupEvalGet } from "./group-eval/route.ts";
import { POST as screenWavePost } from "./screen-wave/route.ts";

after(() => cleanupUnitDb());
afterEach(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
});

function jsonPost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

test("gated deploy: every /api/decisions/* handler refuses an unauthenticated call with 401", async () => {
  // Password set + no session cookie in scope = the unauthenticated caller.
  process.env.KP_OPERATOR_PASSWORD = "unit-test-password";

  const attempts: Array<[string, () => Promise<Response>]> = [
    ["GET records", () => recordsGet(new Request("http://localhost/api/decisions/records"))],
    ["GET records?candidate=", () => recordsGet(new Request("http://localhost/api/decisions/records?candidate=pe-001"))],
    ["GET reconsider", () => reconsiderGet()],
    ["GET config", () => configGet()],
    ["POST config", () => configPost(jsonPost("http://localhost/api/decisions/config", { phase: "screening", config: {} }))],
    ["GET group-eval", () => groupEvalGet(new NextRequest("http://localhost/api/decisions/group-eval?role=job-1"))],
    ["POST screen-wave", () => screenWavePost(jsonPost("http://localhost/api/decisions/screen-wave", { jobId: "job-1", dryRun: true }))],
  ];
  for (const [name, call] of attempts) {
    const res = await call();
    assert.equal(res.status, 401, `${name} must 401 without an operator session`);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  }
});

test("open mode (no operator password): the read routes still serve the local operator", async () => {
  // Matches proxy.ts semantics: KP_OPERATOR_PASSWORD unset = trusted local dev.
  const records = await recordsGet(new Request("http://localhost/api/decisions/records"));
  assert.equal(records.status, 200);
  const recordsBody = (await records.json()) as { records: unknown[]; chain: { ok: boolean } };
  assert.ok(Array.isArray(recordsBody.records));
  assert.equal(typeof recordsBody.chain?.ok, "boolean", "the tamper-evidence verdict still rides along");

  const reconsider = await reconsiderGet();
  assert.equal(reconsider.status, 200);
  assert.ok(Array.isArray(((await reconsider.json()) as { items: unknown[] }).items));

  const config = await configGet();
  assert.equal(config.status, 200);

  const groupEval = await groupEvalGet(new NextRequest("http://localhost/api/decisions/group-eval?role=job-1"));
  assert.equal(groupEval.status, 200);
});

test("proxy allow-list: /api/decisions is NOT public; the candidate token surfaces still are", () => {
  const src = readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");
  assert.ok(!src.includes("/api/decisions"), "no /api/decisions path may sit on the public allow-list");
  // The candidate Art.22-adjacent token flows keep their public routes — the
  // decisions gate must never be 'fixed' by stranding these instead.
  assert.ok(src.includes('"/api/status/"'), "candidate status token API stays public");
  assert.ok(src.includes('"/api/offer/"'), "candidate offer accept/decline token API stays public");
  assert.ok(src.includes('"/api/apply/"'), "candidate apply API stays public");
});
