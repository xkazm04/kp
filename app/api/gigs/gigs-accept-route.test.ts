// PATCH /api/gigs/[id] accept / process (WP14, the accept loop - gigs/loop.ts) on an isolated
// DB in open auth mode: accept moves new -> qualified AND answers what it queued; research is
// skipped for a current (v4, model) brief, plans for a gig that already has a round; `process`
// is the loop alone for a qualified gig; each refuses the other's status; the research and
// plans buckets refuse a burst before the gig moves.
//
// The real `gig_loop` registration (late-bound-boot.ts, booted by unit-db.ts) enqueues REAL
// task rows; the `gig_research` / `gig_plans` runners are REPLACED by recorders, so no Python
// spawns and no model is reached (KP_OFFLINE too). The research->plans continuation is
// loop.test.ts's (fake enqueuers) and e2e/gig-lifecycle.spec.ts's (the fake model).
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { getTask } from "../../_lib/db/tasks.ts";
import { createManualGig, getGig, setGigBrief, transitionGig } from "../../_lib/db/gigs.ts";
import { createGigPlanRound } from "../../_lib/db/gigs-plans.ts";
import { buildLlmGigBrief, deterministicGigBrief, GIG_BRIEF_PROMPT_VERSION } from "../../_lib/gigs/research.ts";
import { registerTaskRunner } from "../../_lib/task-external-runners.ts";
import type { Gig } from "../../_lib/gigs/types.ts";
import { PATCH } from "./[id]/route.ts";

const WS = DEFAULT_WORKSPACE_ID;

before(() => {
  process.env.KP_OFFLINE = "1";
  process.env.KP_TRUSTED_PROXY = "1";
  registerTaskRunner("gig_research", async () => ({ attempted: 0 }));
  registerTaskRunner("gig_plans", async () => ({ gigs: 0, ready: 0, failed: 0, skipped: [], deferred: [], continuedAs: null }));
});

after(() => {
  delete process.env.KP_OFFLINE;
  delete process.env.KP_TRUSTED_PROXY;
  cleanupUnitDb();
});

let ipSeq = 0;
function req(body: unknown, ip?: string): Request {
  ipSeq += 1;
  return new Request("http://localhost/api/gigs/x", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-forwarded-for": ip ?? `203.0.113.${ipSeq}` },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
type Answer = { gig: Gig; queued: { research: string | null; plans: string | null }; code?: string; gigStatus?: string };
async function patch(id: string, action: string, ip?: string): Promise<{ status: number; body: Answer }> {
  const res = await PATCH(req({ action }, ip), params(id));
  return { status: res.status, body: (await res.json()) as Answer };
}

let seq = 0;
function newGig(qualified = false): Gig {
  seq += 1;
  const { gig } = createManualGig(WS, { arena: "freelance", url: `https://example.test/accept/${seq}`, title: `Listing ${seq}`, bodyText: "Build a small thing.", org: null, reward: null, deadlineAt: null, tags: [], suspectReasons: [] });
  if (gig.status === "new" && !qualified) return gig;
  if (gig.status === "new") {
    const moved = transitionGig(WS, gig.id, { from: "new", to: "qualified" });
    assert.ok(moved.ok);
    return moved.gig;
  }
  assert.equal(gig.status, qualified ? "qualified" : "new");
  return gig;
}
function v4Brief(gig: Gig) {
  const brief = buildLlmGigBrief(
    { category: "Web", title: gig.title, difficulty: "moderate", difficultyReason: "Small", effort: null, challenges: [], summary: "A thing.", asks: [] },
    [],
    { promptVersion: GIG_BRIEF_PROMPT_VERSION, createdAt: "2026-09-30T00:00:00.000Z" }
  );
  assert.ok(setGigBrief(WS, gig.id, brief));
}

test("accept on a New gig with no brief: qualified, research queued first, plans after it", async () => {
  const gig = newGig();
  const { status, body } = await patch(gig.id, "accept");
  assert.equal(status, 200);
  assert.equal(body.gig.status, "qualified");
  assert.equal(body.queued.plans, "after_research");
  const task = getTask(body.queued.research!, WS);
  assert.equal(task?.kind, "gig_research");
  assert.deepEqual(task?.params, { workspaceId: WS, sourceId: null, gigIds: [gig.id], linksByGigId: {}, refresh: true, thenPlans: true });
});

test("accept with a current model brief skips research and queues plans now; a stale brief is researched again", async () => {
  const fresh = newGig();
  v4Brief(fresh);
  const a = await patch(fresh.id, "accept");
  assert.equal(a.body.queued.research, null);
  const plans = getTask(a.body.queued.plans!, WS);
  assert.equal(plans?.kind, "gig_plans");
  assert.deepEqual(plans?.params, { workspaceId: WS, gigIds: [fresh.id] });

  const keyless = newGig();
  assert.ok(setGigBrief(WS, keyless.id, deterministicGigBrief(keyless, [], "no_provider", "2026-09-30T00:00:00.000Z")));
  const b = await patch(keyless.id, "accept");
  assert.ok(b.body.queued.research, "a deterministic brief is not the model's: researched again");
  assert.equal(b.body.queued.plans, "after_research");
});

test("accept on a gig with a plan round queues nothing more; the gig still moves", async () => {
  const gig = newGig();
  v4Brief(gig);
  assert.ok(createGigPlanRound(WS, gig.id, [{ seat: "sonnet", model: "claude-sonnet-5-5", effort: "high" }]));
  const { status, body } = await patch(gig.id, "accept");
  assert.equal(status, 200);
  assert.equal(body.gig.status, "qualified");
  assert.deepEqual(body.queued, { research: null, plans: null });
});

test("process is the loop alone for a qualified gig; accept is New-only and process qualified-only", async () => {
  const qualified = newGig(true);
  const p = await patch(qualified.id, "process");
  assert.equal(p.status, 200);
  assert.equal(p.body.gig.status, "qualified");
  assert.ok(p.body.queued.research);
  assert.equal(p.body.queued.plans, "after_research");

  const wrong = await patch(qualified.id, "accept");
  assert.deepEqual([wrong.status, wrong.body.code, wrong.body.gigStatus], [409, "GIG_ACTION_NOT_ALLOWED", "qualified"]);
  const fresh = newGig();
  const early = await patch(fresh.id, "process");
  assert.deepEqual([early.status, early.body.code, early.body.gigStatus], [409, "GIG_ACTION_NOT_ALLOWED", "new"]);
  assert.equal((await patch("gig-nope", "accept")).status, 404);
});

test("the research and plans buckets refuse a burst BEFORE the gig moves", async () => {
  const ip = "198.51.100.77";
  const gig = newGig(true);
  for (let i = 0; i < 20; i += 1) assert.equal((await patch(gig.id, "process", ip)).status, 200, `call ${i + 1}`);
  const fresh = newGig();
  const refused = await patch(fresh.id, "accept", ip);
  assert.deepEqual([refused.status, refused.body.code], [429, "TOO_MANY_REQUESTS"]);
  assert.equal(getGig(WS, fresh.id)?.status, "new", "a refused accept moves nothing");
});
