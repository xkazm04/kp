// POST /api/gigs/[id]/dispatch for a gig with no niche history (one persona per gig): 409
// without an accepted plan, 202 while its persona waits on Personas (a fake bridge answers
// the pairing's dev routes and the persona request), and the run once the hire is active.
// Open auth mode (unit-db.ts scrubs the password). unit-db.ts must be the first project import.
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { updateHiredAgentStatus } from "../../_lib/db/agents.ts";
import { getGig, transitionGig, upsertGigFromRaw } from "../../_lib/db/gigs.ts";
import { listGigAttemptsForGig } from "../../_lib/db/gigs-attempts.ts";
import { getGigSpecialistForGig } from "../../_lib/db/gigs-specialists.ts";
import type { Gig } from "../../_lib/gigs/types.ts";
import { fixtureAcceptedPlan } from "../../_lib/gigs/__fixtures__/accepted-plan.ts";
import { POST as DISPATCH } from "./[id]/dispatch/route.ts";

const WS = DEFAULT_WORKSPACE_ID;
const realFetch = globalThis.fetch;
let paths: string[] = [];

after(() => cleanupUnitDb());
beforeEach(() => {
  paths = [];
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  process.env.AI_REGISTRY_DIR = "/nonexistent-registry-for-this-test";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    paths.push(url.pathname);
    const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/dev/workspaces") return ok({ id: "pws-1", name: body.name, created: true });
    if (url.pathname === "/api/dev/projects") return ok({ id: "proj-1", rootPath: body.rootPath, workspaceId: body.workspaceId, created: true });
    if (/\/milestones$/.test(url.pathname)) {
      const goals = (body.goals as { title: string }[]) ?? [];
      return ok({ milestone: { id: "ms-1", items: goals.map((g, i) => ({ itemKind: "goal", itemId: `g-${i + 1}`, name: g.title })) } });
    }
    if (url.pathname === "/api/kp/persona-requests") return ok({ requestId: "req-1" });
    if (/^\/api\/execute\//.test(url.pathname)) return ok({ execution_id: "exec-1", status: "queued" });
    return new Response("", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
  delete process.env.AI_REGISTRY_DIR;
});

const req = () => new Request("http://localhost/api/gigs/x/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let seq = 0;
function qualifiedGig(): Gig {
  seq += 1;
  const { gig } = upsertGigFromRaw(WS, {
    sourceId: "gsrc-route-pair",
    arena: "security",
    raw: { externalKey: `rp-${seq}`, url: `https://example.test/rp/${seq}`, title: `Route pairing ${seq}`, org: null, reward: null, deadlineAt: null, postedAt: null, bodyText: "x", bodyHtml: null, tags: [] },
    suspectReasons: [],
  });
  assert.ok(transitionGig(WS, gig.id, { from: "new", to: "qualified" }).ok);
  return getGig(WS, gig.id)!;
}

test("409 GIG_PLAN_NOT_ACCEPTED: no accepted plan and no niche history - nothing is dialled", async () => {
  const gig = qualifiedGig();
  const res = await DISPATCH(req(), params(gig.id));
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code: string }).code, "GIG_PLAN_NOT_ACCEPTED");
  assert.deepEqual(paths, []);
});

test("202 pairing pending, then 200 once the persona is active - the same persona, no second hire", async () => {
  const gig = qualifiedGig();
  fixtureAcceptedPlan(WS, gig.id);
  const pending = await DISPATCH(req(), params(gig.id));
  assert.equal(pending.status, 202);
  const body = (await pending.json()) as { pairing: string; specialistId: string };
  const persona = getGigSpecialistForGig(WS, gig.id)!;
  assert.deepEqual(body, { pairing: "pending", specialistId: persona.id });
  assert.equal(getGig(WS, gig.id)!.status, "qualified", "nothing claimed while pending");
  assert.deepEqual(listGigAttemptsForGig(WS, gig.id), []);

  updateHiredAgentStatus(persona.hiredAgentId, "active", { personaId: "persona-route" }, WS);
  paths = [];
  const ran = await DISPATCH(req(), params(gig.id));
  assert.equal(ran.status, 200);
  assert.equal(((await ran.json()) as { executionId: string }).executionId, "exec-1");
  assert.equal(paths.filter((p) => p === "/api/kp/persona-requests").length, 0, "the persona is reused");
  assert.ok(paths.includes("/api/execute/persona-route"));
  assert.equal(getGig(WS, gig.id)!.status, "dispatched");
});
