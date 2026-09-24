// The /api/gigs doors that reach the task hub or the shared hire tail (tasks.ts,
// mintAndDispatch): the scan enqueue, the KPI read and the specialists doors. Kept apart
// from gigs-routes.test.ts because their import graph is the whole task/hire hub, so a
// break anywhere in that hub fails this file and not the review-desk tests.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { getTask } from "../../_lib/db/tasks.ts";
import { fixtureSentGig, fixtureSpecialist } from "../../_lib/gigs/__fixtures__/sent-gig.ts";
import { recordGigOutcome } from "../../_lib/gigs/outcome.ts";
import { POST as SCAN } from "./scan/route.ts";
import { GET as SPECIALISTS, POST as HIRE } from "./specialists/route.ts";
import { GET as KPI } from "./kpi/route.ts";

const WS = DEFAULT_WORKSPACE_ID;

after(() => {
  delete process.env.KP_OFFLINE;
  cleanupUnitDb();
});

function req(method: string): Request {
  return new Request("http://localhost/api/gigs/scan", { method, headers: { "content-type": "application/json" } });
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

test("POST /api/gigs/scan enqueues a gig_scan task (offline: no egress) and answers 202", async () => {
  process.env.KP_OFFLINE = "1";
  const res = await SCAN(req("POST"));
  assert.equal(res.status, 202);
  const { taskId } = await json<{ taskId: string }>(res);
  let task = getTask(taskId, WS);
  assert.ok(task);
  assert.equal(task!.kind, "gig_scan");
  for (let i = 0; i < 100 && task && (task.status === "queued" || task.status === "running"); i++) {
    await new Promise((r) => setTimeout(r, 50));
    task = getTask(taskId, WS);
  }
  assert.equal(task!.status, "succeeded", JSON.stringify(task));
});

test("GET /api/gigs/kpi and the specialists doors", async () => {
  const spec = fixtureSpecialist(WS, "security");
  const { gig } = fixtureSentGig(WS, spec);
  assert.ok(recordGigOutcome(WS, { gigId: gig.id, attemptId: null, verdict: "rejected", amount: null, currency: null, feedbackText: null, source: "manual" }).ok);
  const kpi = await json<{ byArena: Record<string, { resolved: number }>; disclosureRate: number | null }>(await KPI());
  assert.deepEqual(Object.keys(kpi.byArena).sort(), ["competition", "freelance", "oss_bounty", "security"]);
  assert.ok(kpi.byArena.security.resolved >= 1);
  const specs = await json<{ specialists: { id: string; hire: { status: string; reportToken?: unknown } | null }[] }>(await SPECIALISTS());
  assert.ok(specs.specialists.length > 0);
  for (const s of specs.specialists) {
    assert.ok(s.hire, "every fixture specialist has a hire row");
    assert.equal("reportToken" in (s.hire ?? {}), false, "the report token never leaves");
  }
  const { NextRequest } = await import("next/server");
  const hire = (body: unknown) => new NextRequest("http://localhost/api/gigs/specialists", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  assert.equal(await code(await HIRE(hire({ arena: "chess", niche: "x" }))), "GIG_INPUT_INVALID");
  assert.equal(await code(await HIRE(hire({ arena: "security", niche: "  " }))), "GIG_INPUT_INVALID");
});
