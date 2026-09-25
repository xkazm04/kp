// The Personas workspace + project calls (personas-places.ts) against an injected fetch - no
// Personas process. unit-db.ts first (the bridge store reads the DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ensurePersonasProject, ensurePersonasWorkspace } from "./personas-places.ts";

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
