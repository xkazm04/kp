// The gig plan doors on an isolated DB, in open auth mode (unit-db.ts scrubs the password):
// GET /api/gigs/[id]/plans, POST /api/gigs/[id]/plans, POST /api/gigs/plans and
// POST /api/gigs/[id]/plans/[planId]/accept. Proves the coded refusals, the 202s and what
// they enqueue, that a plan is accepted exactly once per gig, and that a plan id is never
// accepted through a gig it is not of (404, not a cross-gig accept).
//
// The `gig_plans` runner is REPLACED by a recorder before anything is enqueued: these tests
// pin the doors, and the real runner spawns Python per seat (plans.test.ts drives it over
// a fake CLI). KP_OFFLINE is set too, so nothing could reach a model even if it ran.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { getTask } from "../../_lib/db/tasks.ts";
import { createManualGig, setGigBrief } from "../../_lib/db/gigs.ts";
import { createGigPlanRound, getGigPlan, setGigPlanResult } from "../../_lib/db/gigs-plans.ts";
import { deterministicGigBrief } from "../../_lib/gigs/research.ts";
import { planSeatsFor } from "../../_lib/gigs/plan-seats.ts";
import type { GigPlan } from "../../_lib/gigs/types.ts";
import { registerTaskRunner, type ExternalTaskCtx } from "../../_lib/task-external-runners.ts";
import { GET as LIST_PLANS, POST as PROPOSE } from "./[id]/plans/route.ts";
import { POST as ACCEPT } from "./[id]/plans/[planId]/accept/route.ts";
import { POST as PROPOSE_MANY } from "./plans/route.ts";

const WS = DEFAULT_WORKSPACE_ID;
const runs: ExternalTaskCtx[] = [];

before(() => {
  process.env.KP_OFFLINE = "1";
  process.env.KP_TRUSTED_PROXY = "1";
  registerTaskRunner("gig_plans", async (ctx) => {
    runs.push(ctx);
    return { gigs: 0, ready: 0, failed: 0, skipped: [], deferred: [], continuedAs: null };
  });
});

after(() => {
  delete process.env.KP_OFFLINE;
  delete process.env.KP_TRUSTED_PROXY;
  cleanupUnitDb();
});

// A distinct client per request, so the shared 20/10min `gigs-plans` bucket never decides
// a test that is about something else.
let ipSeq = 0;
function req(method: string, body?: unknown): Request {
  ipSeq += 1;
  return new Request("http://localhost/api/gigs/x", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ipSeq}` },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const planParams = (id: string, planId: string) => ({ params: Promise.resolve({ id, planId }) });

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let seq = 0;
function gig(opts: { brief?: boolean } = {}): string {
  seq += 1;
  const { gig: g } = createManualGig(WS, {
    arena: "freelance",
    url: `https://example.test/plans-route/${seq}`,
    title: `Landing page ${seq}`,
    bodyText: `Build a landing page (${seq}).`,
    org: null,
    reward: null,
    deadlineAt: null,
    tags: [],
    suspectReasons: [],
  });
  if (opts.brief !== false) setGigBrief(WS, g.id, deterministicGigBrief(g, [], "no_provider", "2026-09-29T00:00:00.000Z"));
  return g.id;
}

const PLAN: GigPlan = {
  summary: "Build it in three passes.",
  steps: [
    { title: "Sketch", doneWhen: "A wireframe exists." },
    { title: "Build", doneWhen: "The page renders." },
    { title: "Test", doneWhen: "Lighthouse is green." },
    { title: "Ship", doneWhen: "The page is deployed." },
  ],
  decisions: [],
  risks: [],
  effortHours: null,
  questions: [],
};

/** A round with the first seat `ready` (the rest still queued). */
function round(gigId: string) {
  const rows = createGigPlanRound(WS, gigId, planSeatsFor("very_hard").map((s) => ({ seat: s.seat, model: s.model, effort: s.effort })));
  assert.ok(rows && rows.length === 3);
  assert.ok(setGigPlanResult(WS, rows[0].id, { plan: PLAN, fallbackReason: null, costUsd: 0.1, durationMs: 5 }));
  return rows;
}

async function waitDone(taskId: string) {
  let task = getTask(taskId, WS);
  for (let i = 0; i < 100 && task && (task.status === "queued" || task.status === "running"); i++) {
    await new Promise((r) => setTimeout(r, 20));
    task = getTask(taskId, WS);
  }
  return task;
}

test("GET /api/gigs/[id]/plans: 404 for an unknown gig; the rows of every round otherwise", async () => {
  const unknown = await LIST_PLANS(req("GET"), params("gig-nope"));
  assert.equal(unknown.status, 404);
  assert.equal((await json(unknown)).code, "GIG_NOT_FOUND");
  const id = gig();
  assert.deepEqual((await json<{ plans: unknown[] }>(await LIST_PLANS(req("GET"), params(id)))).plans, []);
  round(id);
  const { plans } = await json<{ plans: { seat: string; status: string; costUsd: number | null }[] }>(await LIST_PLANS(req("GET"), params(id)));
  assert.equal(plans.length, 3);
  assert.deepEqual(plans.map((p) => p.status).sort(), ["queued", "queued", "ready"]);
});

test("POST /api/gigs/[id]/plans: 404, 409 no_brief, 202 with a gig_plans task for THIS gig, 409 once a plan is accepted", async () => {
  const missing = await PROPOSE(req("POST"), params("gig-nope"));
  assert.equal(missing.status, 404);
  assert.equal((await json(missing)).code, "GIG_NOT_FOUND");

  const bare = gig({ brief: false });
  const noBrief = await PROPOSE(req("POST"), params(bare));
  assert.equal(noBrief.status, 409);
  const nb = await json(noBrief);
  assert.deepEqual([nb.code, nb.reason], ["GIG_ACTION_NOT_ALLOWED", "no_brief"]);

  const id = gig();
  const ok = await PROPOSE(req("POST"), params(id));
  assert.equal(ok.status, 202);
  const { taskId } = await json<{ taskId: string }>(ok);
  const task = await waitDone(taskId);
  assert.equal(task?.kind, "gig_plans");
  assert.equal(task?.status, "succeeded", JSON.stringify(task));
  const run = runs.find((r) => Array.isArray(r.params.gigIds) && (r.params.gigIds as string[])[0] === id);
  assert.ok(run, "the runner got this gig");
  assert.deepEqual(run.params.gigIds, [id]);
  assert.equal(run.workspaceId, WS);

  const rows = round(id);
  assert.equal((await ACCEPT(req("POST", {}), planParams(id, rows[0].id))).status, 200);
  const again = await PROPOSE(req("POST"), params(id));
  assert.equal(again.status, 409);
  assert.equal((await json(again)).code, "GIG_PLAN_ALREADY_ACCEPTED");
});

test("POST /api/gigs/plans: 400 GIG_INPUT_INVALID for a bad selection; 202 { taskId, queued } for 1..50 unique ids", async () => {
  const bads: unknown[] = [
    undefined,
    "not json",
    {},
    { gigIds: "g1" },
    { gigIds: [] },
    { gigIds: ["a", "a"] },
    { gigIds: ["a", 3] },
    { gigIds: ["a", "  "] },
    { gigIds: ["x".repeat(201)] },
    { gigIds: Array.from({ length: 51 }, (_, i) => `g${i}`) },
  ];
  for (const body of bads) {
    const res = await PROPOSE_MANY(req("POST", body));
    assert.equal(res.status, 400, JSON.stringify(body)?.slice(0, 60));
    const b = await json(res);
    assert.equal(b.code, "GIG_INPUT_INVALID");
    assert.equal(b.field, "gigIds");
  }
  const ids = [gig(), gig(), "gig-not-mine"];
  const res = await PROPOSE_MANY(req("POST", { gigIds: ids }));
  assert.equal(res.status, 202);
  const { taskId, queued } = await json<{ taskId: string; queued: number }>(res);
  assert.equal(queued, 3, "the runner sorts the selection and reports each skip");
  const task = await waitDone(taskId);
  assert.equal(task?.kind, "gig_plans");
  const run = runs.find((r) => JSON.stringify(r.params.gigIds) === JSON.stringify(ids));
  assert.ok(run);
  assert.equal(run.params.workspaceId, WS, "the tenant rides in params for the dedupe key");

  const fifty = Array.from({ length: 50 }, (_, i) => `g-${i}`);
  assert.equal((await PROPOSE_MANY(req("POST", { gigIds: fifty }))).status, 202);
});

test("POST /api/gigs/[id]/plans/[planId]/accept: once per gig, a ready plan only, never across gigs, a bounded note", async () => {
  const id = gig();
  const other = gig();
  const rows = round(id);
  const otherRows = round(other);

  const missingGig = await ACCEPT(req("POST"), planParams("gig-nope", rows[0].id));
  assert.equal(missingGig.status, 404);
  assert.equal((await json(missingGig)).code, "GIG_NOT_FOUND");
  const missingPlan = await ACCEPT(req("POST"), planParams(id, "gplan-nope"));
  assert.equal(missingPlan.status, 404);
  assert.equal((await json(missingPlan)).code, "GIG_PLAN_NOT_FOUND");
  const crossGig = await ACCEPT(req("POST"), planParams(id, otherRows[0].id));
  assert.equal(crossGig.status, 404, "a plan of another gig is not found through this one");
  assert.equal((await json(crossGig)).code, "GIG_PLAN_NOT_FOUND");
  assert.equal(getGigPlan(WS, otherRows[0].id)?.acceptedAt, null, "and it was not accepted");

  const notReady = await ACCEPT(req("POST"), planParams(id, rows[1].id));
  assert.equal(notReady.status, 409);
  const nr = await json(notReady);
  assert.deepEqual([nr.code, nr.reason], ["GIG_ACTION_NOT_ALLOWED", "not_ready"]);

  for (const note of [42, "x".repeat(2001)]) {
    const bad = await ACCEPT(req("POST", { note }), planParams(id, rows[0].id));
    assert.equal(bad.status, 400);
    const b = await json(bad);
    assert.deepEqual([b.code, b.field], ["GIG_INPUT_INVALID", "note"]);
  }

  const ok = await ACCEPT(req("POST", { note: "  Keep the brand colours.  " }), planParams(id, rows[0].id));
  assert.equal(ok.status, 200);
  const { plan } = await json<{ plan: { id: string; acceptedAt: string | null; note: string | null; plan: GigPlan | null } }>(ok);
  assert.equal(plan.id, rows[0].id);
  assert.ok(plan.acceptedAt);
  assert.equal(plan.note, "Keep the brand colours.");
  assert.deepEqual(plan.plan, PLAN);

  // A second READY seat of the same gig cannot be accepted: one accepted plan per gig.
  assert.ok(setGigPlanResult(WS, rows[2].id, { plan: PLAN, fallbackReason: null, costUsd: null, durationMs: 1 }));
  const second = await ACCEPT(req("POST"), planParams(id, rows[2].id));
  assert.equal(second.status, 409);
  assert.equal((await json(second)).code, "GIG_PLAN_ALREADY_ACCEPTED");
  const repeat = await ACCEPT(req("POST"), planParams(id, rows[0].id));
  assert.equal(repeat.status, 409, "accepting the accepted plan again is not a second acceptance");

  // The other gig still accepts its own, with no body at all.
  const own = await ACCEPT(new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": "198.51.100.250" } }), planParams(other, otherRows[0].id));
  assert.equal(own.status, 200);
  assert.equal((await json<{ plan: { note: string | null } }>(own)).plan.note, null);
});
