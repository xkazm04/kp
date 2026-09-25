// POST /api/gigs/[id]/workspace on an isolated DB, in open auth mode, with the gig folders
// under this run's temp KP_GIGS_ROOT (unit-db.ts). unit-db.ts must be the first project import.
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { createManualGig, getGig } from "../../_lib/db/gigs.ts";
import { gigsRoot } from "../../_lib/gigs/workdir.ts";
import { POST as PREPARE } from "./[id]/workspace/route.ts";

const WS = DEFAULT_WORKSPACE_ID;
const realFetch = globalThis.fetch;

after(() => cleanupUnitDb());
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

function req(ip: string): Request {
  return new Request("http://localhost/api/gigs/x/workspace", { method: "POST", headers: { "x-forwarded-for": ip } });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function gig(n: number) {
  return createManualGig(WS, {
    arena: "freelance",
    url: `https://example.test/brief/${n}`,
    title: `Landing page ${n}`,
    org: null,
    reward: null,
    deadlineAt: null,
    bodyText: "Build a landing page.",
    tags: [],
    suspectReasons: [],
  }).gig;
}

test("404 GIG_NOT_FOUND for an unknown gig", async () => {
  const res = await PREPARE(req("10.0.0.1"), params("gig-nope"));
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code: string }).code, "GIG_NOT_FOUND");
});

test("unpaired: 200 with the folder made and recorded, and the link's reason", async () => {
  const g = gig(1);
  const res = await PREPARE(req("10.0.0.2"), params(g.id));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { gig: { workdir: string; personasProjectId: string | null }; personas: { linked: boolean; reason?: string } };
  assert.deepEqual(body.personas, { linked: false, reason: "personas_unpaired" });
  assert.ok(body.gig.workdir.startsWith(path.join(gigsRoot(), "freelance")));
  assert.ok(existsSync(path.join(body.gig.workdir, "GIG.md")));
  assert.equal(body.gig.personasProjectId, null);
  assert.equal(getGig(WS, g.id)!.workdir, body.gig.workdir);
});

test("paired: the arena workspace and the gig's project are ensured, and the project id is recorded", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  const urls: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    urls.push(String(url));
    const body = JSON.parse(String(init.body)) as { rootPath?: string };
    if (String(url).endsWith("/api/dev/workspaces")) {
      return new Response(JSON.stringify({ success: true, data: { id: "pws-free", name: "Freelance", groupTeamId: null, created: true } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, data: { id: "proj-9", name: "n", rootPath: body.rootPath, workspaceId: "pws-free", created: true } }), { status: 200 });
  }) as typeof fetch;
  const g = gig(2);
  const res = await PREPARE(req("10.0.0.3"), params(g.id));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { gig: { personasProjectId: string }; personas: { linked: boolean; projectId: string } };
  assert.equal(body.personas.linked, true);
  assert.equal(body.personas.projectId, "proj-9");
  assert.equal(body.gig.personasProjectId, "proj-9");
  assert.deepEqual(urls, ["http://127.0.0.1:9420/api/dev/workspaces", "http://127.0.0.1:9420/api/dev/projects"]);
});

test("rate-limited per IP at 20 / 10 min", async () => {
  const g = gig(3);
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await PREPARE(req("10.0.0.9"), params(g.id))).status;
  assert.equal(last, 429);
});
