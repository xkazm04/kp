// The Personas workspace + project calls (personas-places.ts) against an injected fetch - no
// Personas process. unit-db.ts first (the bridge store reads the DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  PERSONAS_MILESTONE_GOALS_PER_CALL,
  addPersonasMilestoneGoals,
  createPersonasMilestone,
  ensurePersonasProject,
  ensurePersonasWorkspace,
  getPersonasMilestone,
  patchPersonasGoal,
  retirePersonasPersona,
} from "./personas-places.ts";

after(() => cleanupUnitDb());
afterEach(() => {
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

function paired(): void {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
}

type Seen = { url: string; init: RequestInit };

function fake(status: number, body: unknown, seen: Seen[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

const PROJECT = { name: "Gig · Landing page", rootPath: "/gigs/freelance/2026-09-24-landing-page-a8f3qz", workspaceId: "pws-1", description: "https://example.test/job/1", techStack: "Web · Landing page" };

test("workspace: POSTs {name, description} with the bearer key, no redirects, and reads the envelope", async () => {
  paired();
  const seen: Seen[] = [];
  const r = await ensurePersonasWorkspace(
    { name: "Freelance", description: "d" },
    { fetchImpl: fake(200, { success: true, data: { id: "pws-1", name: "Freelance", groupTeamId: "gt-9", created: true } }, seen) }
  );
  assert.deepEqual(r, { ok: true, id: "pws-1", name: "Freelance", groupTeamId: "gt-9", created: true });
  assert.equal(seen[0]!.url, "http://127.0.0.1:9420/api/dev/workspaces");
  assert.equal(seen[0]!.init.method, "POST");
  assert.equal(seen[0]!.init.redirect, "manual");
  assert.equal((seen[0]!.init.headers as Record<string, string>).Authorization, "Bearer pk_unit_test");
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), { name: "Freelance", description: "d" });
});

test("workspace: idempotent by name - a second ensure answers the same id with created:false", async () => {
  paired();
  const r = await ensurePersonasWorkspace({ name: "Freelance" }, { fetchImpl: fake(200, { success: true, data: { id: "pws-1", name: "Freelance", groupTeamId: null, created: false } }) });
  assert.ok(r.ok && r.id === "pws-1" && r.created === false && r.groupTeamId === null);
});

test("workspace: 404/405 on the route is personas_route_missing; 401, 403 and 500 keep their own codes", async () => {
  paired();
  for (const [status, reason] of [
    [404, "personas_route_missing"],
    [405, "personas_route_missing"],
    [401, "personas_key_invalid"],
    [403, "personas_scope_missing"],
    [500, "personas_http_500"],
  ] as const) {
    const r = await ensurePersonasWorkspace({ name: "Freelance" }, { fetchImpl: fake(status, "nope") });
    assert.deepEqual(r, { ok: false, reason, status }, String(status));
  }
});

test("unpaired: no request at all", async () => {
  const seen: Seen[] = [];
  assert.deepEqual(await ensurePersonasWorkspace({ name: "Freelance" }, { fetchImpl: fake(200, {}, seen) }), { ok: false, reason: "personas_unpaired" });
  assert.deepEqual(await ensurePersonasProject(PROJECT, { fetchImpl: fake(200, {}, seen) }), { ok: false, reason: "personas_unpaired" });
  assert.equal(seen.length, 0);
});

test("unreachable, a redirect, and an answer with no id are reason codes, never throws", async () => {
  paired();
  const refused = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  assert.deepEqual(await ensurePersonasWorkspace({ name: "x" }, { fetchImpl: refused }), { ok: false, reason: "personas_unreachable" });
  assert.deepEqual(await ensurePersonasProject(PROJECT, { fetchImpl: fake(307, "") }), { ok: false, reason: "personas_redirect" });
  assert.deepEqual(await ensurePersonasProject(PROJECT, { fetchImpl: fake(200, { success: true, data: {} }) }), { ok: false, reason: "personas_bad_response" });
});

test("project: POSTs the full body and reads the project; idempotent on rootPath", async () => {
  paired();
  const seen: Seen[] = [];
  const data = { id: "proj-1", name: PROJECT.name, rootPath: PROJECT.rootPath, workspaceId: "pws-1", created: true };
  const r = await ensurePersonasProject(PROJECT, { fetchImpl: fake(200, { success: true, data }, seen) });
  assert.deepEqual(r, { ok: true, ...data });
  assert.equal(seen[0]!.url, "http://127.0.0.1:9420/api/dev/projects");
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), PROJECT);
  const again = await ensurePersonasProject(PROJECT, { fetchImpl: fake(200, { success: true, data: { ...data, created: false } }) });
  assert.ok(again.ok && again.id === "proj-1" && again.created === false);
});

test("project: 409 is a conflict, 404 naming the workspace is workspace_not_found, a bare 404 is the route, 400 a bad path", async () => {
  paired();
  assert.deepEqual(await ensurePersonasProject(PROJECT, { fetchImpl: fake(409, { success: false, error: "project_in_other_workspace" }) }), {
    ok: false,
    reason: "personas_project_conflict",
    status: 409,
  });
  assert.deepEqual(await ensurePersonasProject(PROJECT, { fetchImpl: fake(404, { success: false, error: "workspace_not_found" }) }), {
    ok: false,
    reason: "personas_workspace_not_found",
    status: 404,
  });
  assert.deepEqual(await ensurePersonasProject(PROJECT, { fetchImpl: fake(404, "Not Found") }), { ok: false, reason: "personas_route_missing", status: 404 });
  assert.deepEqual(await ensurePersonasProject(PROJECT, { fetchImpl: fake(400, { success: false, error: "rootPath must be absolute" }) }), {
    ok: false,
    reason: "personas_bad_path",
    status: 400,
  });
});

test("project: optional fields are omitted when absent, never sent as null", async () => {
  paired();
  const seen: Seen[] = [];
  await ensurePersonasProject({ name: "Gig · x", rootPath: "/gigs/x", workspaceId: null, techStack: null }, { fetchImpl: fake(200, { id: "p", created: false }, seen) });
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), { name: "Gig · x", rootPath: "/gigs/x" });
});

// ---------------------------------------------------------------------------
// The milestone, its goals, and the persona's retirement (gig-mastery S2)
// ---------------------------------------------------------------------------

test("milestone: POSTs name/goal/description/goals (<= 8) and reads the goal ids from milestone.items", async () => {
  paired();
  const seen: Seen[] = [];
  const goals = Array.from({ length: 9 }, (_, i) => ({ title: `${i + 1}. Step`, description: "Done when: x" }));
  const r = await createPersonasMilestone(
    "proj-1",
    { name: "Gig title", goal: "Short goal", description: "The summary.", goals },
    {
      fetchImpl: fake(
        200,
        {
          success: true,
          data: {
            project: {},
            milestone: { id: "ms-1", items: [{ itemKind: "goal", itemId: "g-1", name: "1. Step" }, { itemKind: "use_case", itemId: "uc-1", name: "UC" }] },
            goals: { created: 1, bound: 0 },
          },
        },
        seen
      ),
    }
  );
  assert.deepEqual(r, { ok: true, milestoneId: "ms-1", goals: [{ id: "g-1", title: "1. Step" }] });
  assert.equal(seen[0]!.url, "http://127.0.0.1:9420/api/dev/projects/proj-1/milestones");
  const body = JSON.parse(String(seen[0]!.init.body)) as { goals: unknown[]; name: string; goal: string };
  assert.equal(body.goals.length, PERSONAS_MILESTONE_GOALS_PER_CALL, "Personas refuses more than eight goals per call");
  assert.equal(body.name, "Gig title");
  assert.equal(body.goal, "Short goal");
});

test("milestone: a JSON 404 names the project, an empty 404 is an older Personas, a 400 keeps its status", async () => {
  paired();
  assert.deepEqual(await createPersonasMilestone("p", { name: "n", goals: [] }, { fetchImpl: fake(404, { success: false, error: "project not found" }) }), {
    ok: false,
    reason: "personas_workspace_not_found",
    status: 404,
  });
  assert.deepEqual(await createPersonasMilestone("p", { name: "n", goals: [] }, { fetchImpl: fake(404, "") }), { ok: false, reason: "personas_route_missing", status: 404 });
  assert.deepEqual(await createPersonasMilestone("p", { name: "n", goals: [] }, { fetchImpl: fake(400, { success: false, error: "bad" }) }), { ok: false, reason: "personas_http_400", status: 400 });
});

test("goals: add posts to the milestone; get reads its goal members back", async () => {
  paired();
  const seen: Seen[] = [];
  assert.deepEqual(await addPersonasMilestoneGoals("ms-1", [{ title: "9. Step" }], { fetchImpl: fake(200, { success: true, data: { milestoneId: "ms-1", created: 1, bound: 0 } }, seen) }), { ok: true });
  assert.equal(seen[0]!.url, "http://127.0.0.1:9420/api/dev/milestones/ms-1/goals");
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), { goals: [{ title: "9. Step" }] });
  const got = await getPersonasMilestone("ms-1", { fetchImpl: fake(200, { success: true, data: { project: {}, milestone: { id: "ms-1", items: [{ itemKind: "goal", itemId: "g-9", name: "9. Step" }] } } }, seen) });
  assert.deepEqual(got, { ok: true, milestoneId: "ms-1", goals: [{ id: "g-9", title: "9. Step" }] });
  assert.equal(seen[1]!.init.method, "GET");
  assert.equal(seen[1]!.init.body, undefined, "a GET carries no body");
});

test("goal patch: status and a clamped progress, nothing else", async () => {
  paired();
  const seen: Seen[] = [];
  assert.deepEqual(await patchPersonasGoal("g-1", { status: "in-progress", progress: 140.4 }, { fetchImpl: fake(200, { success: true, data: { id: "g-1" } }, seen) }), { ok: true });
  assert.equal(seen[0]!.url, "http://127.0.0.1:9420/api/dev/goals/g-1");
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), { status: "in-progress", progress: 100 });
});

test("retire: 200 retired (and already), 403 not ours, a JSON 404 the persona is gone, an empty 404 an older Personas", async () => {
  paired();
  const seen: Seen[] = [];
  assert.deepEqual(await retirePersonasPersona("per-1", { fetchImpl: fake(200, { success: true, data: { retired: true } }, seen) }), { ok: true, already: false });
  assert.equal(seen[0]!.url, "http://127.0.0.1:9420/api/kp/personas/per-1/retire");
  assert.equal(seen[0]!.init.method, "POST");
  assert.deepEqual(await retirePersonasPersona("per-1", { fetchImpl: fake(200, { success: true, data: { retired: true, already: true } }) }), { ok: true, already: true });
  assert.deepEqual(await retirePersonasPersona("per-1", { fetchImpl: fake(403, { success: false, error: "not yours" }) }), { ok: false, reason: "personas_not_ours", status: 403 });
  assert.deepEqual(await retirePersonasPersona("per-1", { fetchImpl: fake(404, { success: false, error: "persona not found" }) }), { ok: false, reason: "personas_persona_missing", status: 404 });
  assert.deepEqual(await retirePersonasPersona("per-1", { fetchImpl: fake(404, "") }), { ok: false, reason: "personas_route_missing", status: 404 });
  assert.deepEqual(await retirePersonasPersona("per-1", { fetchImpl: fake(200, { success: true, data: {} }) }), { ok: false, reason: "personas_bad_response" });
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
  assert.deepEqual(await retirePersonasPersona("per-1", { fetchImpl: fake(200, {}) }), { ok: false, reason: "personas_unpaired" });
});
