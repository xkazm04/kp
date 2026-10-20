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
import { ensureDb } from "../../_lib/db/core.ts";
import { createGigSource } from "../../_lib/db/gigs-sources.ts";
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

// A distinct client per request (KP_TRUSTED_PROXY=1 + X-Forwarded-For) so these calls do
// not share the scan door's 6-per-10-minutes bucket with each other or the test above.
let ipSeq = 0;
function scanReq(body?: unknown): Request {
  ipSeq += 1;
  return new Request("http://localhost/api/gigs/scan", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ipSeq}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("POST /api/gigs/scan {sourceId}: unknown 404, paused/disabled 409 with the reason, malformed 400 - nothing enqueued", async () => {
  process.env.KP_OFFLINE = "1";
  process.env.KP_TRUSTED_PROXY = "1";
  try {
    const unknown = await SCAN(scanReq({ sourceId: "gsrc-nope" }));
    assert.equal(unknown.status, 404);
    assert.equal(await code(unknown), "GIG_SOURCE_NOT_FOUND");

    const kaggle = createGigSource(WS, { adapter: "kaggle", arena: "competition", host: "www.kaggle.com", config: {} });
    const paused = await SCAN(scanReq({ sourceId: kaggle.id }));
    assert.equal(paused.status, 409);
    const pausedBody = await json<{ code: string; reason: string }>(paused);
    assert.deepEqual([pausedBody.code, pausedBody.reason], ["GIG_ACTION_NOT_ALLOWED", "terms_review"], "the scan never un-pauses: it refuses");

    const gh = createGigSource(WS, { adapter: "github_bounty", arena: "oss_bounty", host: "api.github.com", config: {} });
    ensureDb().prepare("UPDATE gig_sources SET enabled = 0 WHERE id = ? AND workspace_id = ?").run(gh.id, WS);
    const disabled = await json<{ code: string; reason: string }>(await SCAN(scanReq({ sourceId: gh.id })));
    assert.deepEqual([disabled.code, disabled.reason], ["GIG_ACTION_NOT_ALLOWED", "disabled"]);

    for (const bad of [42, "", "   "]) {
      const res = await SCAN(scanReq({ sourceId: bad }));
      assert.equal(res.status, 400, JSON.stringify(bad));
      const body = await json<{ code: string; field: string }>(res);
      assert.deepEqual([body.code, body.field], ["GIG_INPUT_INVALID", "sourceId"]);
    }
  } finally {
    delete process.env.KP_TRUSTED_PROXY;
  }
});

test("POST /api/gigs/scan {sourceId}: the task runs ONLY that source; two scans of it at once collapse to one task", async () => {
  process.env.KP_OFFLINE = "1";
  process.env.KP_TRUSTED_PROXY = "1";
  try {
    const a = createGigSource(WS, { adapter: "github_bounty", arena: "oss_bounty", host: "api.github.com", config: {} });
    const b = createGigSource(WS, { adapter: "github_bounty", arena: "oss_bounty", host: "api.github.com", config: { label: "other" } });
    const [r1, r2] = await Promise.all([SCAN(scanReq({ sourceId: a.id })), SCAN(scanReq({ sourceId: a.id }))]);
    assert.deepEqual([r1.status, r2.status], [202, 202]);
    const t1 = (await json<{ taskId: string }>(r1)).taskId;
    const t2 = (await json<{ taskId: string }>(r2)).taskId;
    assert.equal(t1, t2, "a double-click on one source is one task");
    const task = getTask(t1, WS);
    assert.equal(task?.dedupeKey, `gig_scan:${WS}:source:${a.id}`);
    assert.equal((task?.params as { sourceId?: string }).sourceId, a.id);

    let done = getTask(t1, WS);
    for (let i = 0; i < 100 && done && (done.status === "queued" || done.status === "running"); i++) {
      await new Promise((r) => setTimeout(r, 50));
      done = getTask(t1, WS);
    }
    assert.equal(done?.status, "succeeded", JSON.stringify(done));
    const summary = done?.result as { sourceId: string; sources: { sourceId: string; outcome: string; reason: string }[] };
    assert.equal(summary.sourceId, a.id);
    assert.deepEqual(summary.sources.map((s) => [s.sourceId, s.outcome, s.reason]), [[a.id, "offline", "offline"]], "only the named source ran");
    assert.ok(!summary.sources.some((s) => s.sourceId === b.id));

    const other = await SCAN(scanReq({ sourceId: b.id }));
    const t3 = (await json<{ taskId: string }>(other)).taskId;
    assert.notEqual(t3, t1, "a different source is its own task");
    // Let it finish: a task still running when the file's `after` drops the DB keeps the
    // process alive for minutes.
    let third = getTask(t3, WS);
    for (let i = 0; i < 100 && third && (third.status === "queued" || third.status === "running"); i++) {
      await new Promise((r) => setTimeout(r, 50));
      third = getTask(t3, WS);
    }
    assert.equal(third?.status, "succeeded", JSON.stringify(third));
  } finally {
    delete process.env.KP_TRUSTED_PROXY;
  }
});
