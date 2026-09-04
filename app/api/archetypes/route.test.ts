// The archetype registry WRITE doors: who may reach them, and what a refusal says.
//
// These three handlers edit one file per deployment (pipeline/jobfit/archetypes.json —
// the same file the Python scorer re-reads on every spawn), so a write here re-weights,
// renames or retires an archetype for EVERY workspace on the box, and unticking
// `fairnessProtected` on "student" hands the auto-reject wave a cohort every other
// tenant had protected. requireOperator is the gate that makes that operator-only; it
// had no test, so a later edit could drop the two lines and nothing would notice.
//
// The 404/400 split is the other half: `not_found` is the only registry error that is a
// missing thing; everything else is a bad edit the caller can fix. A route that answered
// 400 for both would tell the manager UI to show a validation message for an archetype
// that does not exist.
//
// NO WRITE REACHES THE COMMITTED REGISTRY: registryPath() is process.cwd()-relative, so
// every case runs with cwd pointed at a throwaway tree holding its own archetypes.json.
//
// NON-VACUITY: the 401 body {error:"Unauthorized"} is produced ONLY by requireOperator.
// Without the gate these inputs answer 200/400/404, so every 401 assertion fails.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// next/server's connection() (reached through requireOperator) needs the shared shim.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const REAL_CWD = process.cwd();
const fixtures: string[] = [];

after(() => {
  process.chdir(REAL_CWD);
  delete process.env.KP_OPERATOR_PASSWORD;
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

const BAU = {
  id: "bau",
  label: "Business as usual",
  badge: "BAU",
  fairnessProtected: false,
  scoringModel: "experienced",
  weights: { skills: 0.5, career: 0.35, personal: 0.15 },
  dimensionLabels: { skills: "Skills", career: "Career", personal: "Personal" },
  checklist: [],
};

/** A throwaway repo root with a VALID one-entry registry; chdir into it and answer
 *  the path of its archetypes.json so a test can read back what was written. */
function freshRegistry(): string {
  const root = mkdtempSync(path.join(tmpdir(), "kp-archetypes-route-"));
  fixtures.push(root);
  mkdirSync(path.join(root, "pipeline", "jobfit"), { recursive: true });
  const file = path.join(root, "pipeline", "jobfit", "archetypes.json");
  writeFileSync(file, JSON.stringify({ archetypes: [BAU], detection: {}, commonChecklist: [] }, null, 2), "utf-8");
  process.chdir(root);
  return file;
}

type Collection = typeof import("./route.ts");
type Item = typeof import("./[id]/route.ts");
let collection: Collection | null = null;
let item: Item | null = null;
async function handlers(): Promise<{ collection: Collection; item: Item }> {
  collection ??= (await import("./route.ts")) as Collection;
  item ??= (await import("./[id]/route.ts")) as Item;
  return { collection, item };
}

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
});

test("gated: POST/PUT/PATCH all refuse a non-operator (password set, no session) with 401", async () => {
  const file = freshRegistry();
  const before = readFileSync(file, "utf-8");
  // Password set + no session cookie in scope = the non-operator caller. The anonymous
  // /api/demo session is a valid signature and lands here too (isOperator rejects it).
  process.env.KP_OPERATOR_PASSWORD = "archetypes-route-test-password";
  const { collection: coll, item: one } = await handlers();

  const attempts: Array<[string, () => Promise<Response>]> = [
    ["POST", () => coll.POST(jsonReq("http://localhost/api/archetypes", "POST", { ...BAU, id: "returner" }) as never)],
    ["PUT", () => one.PUT(jsonReq("http://localhost/api/archetypes/bau", "PUT", { label: "Renamed" }) as never, params("bau"))],
    ["PATCH", () => one.PATCH(jsonReq("http://localhost/api/archetypes/bau", "PATCH", { archived: true }) as never, params("bau"))],
  ];
  for (const [name, call] of attempts) {
    const res = await call();
    assert.equal(res.status, 401, `${name} must refuse a non-operator`);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  }
  assert.equal(readFileSync(file, "utf-8"), before, "a refused write must not have touched the registry");
  process.chdir(REAL_CWD);
});

test("the READ stays open — gating it would blank the profile pickers for no security gain", async () => {
  freshRegistry();
  process.env.KP_OPERATOR_PASSWORD = "archetypes-route-test-password";
  const { collection: coll } = await handlers();
  const res = await coll.GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { archetypes: Array<{ id: string }> };
  assert.deepEqual(body.archetypes.map((a) => a.id), ["bau"]);
  process.chdir(REAL_CWD);
});

test("open mode (no operator password) serves the local operator — dev stays open", async () => {
  const file = freshRegistry();
  const { item: one } = await handlers();
  const res = await one.PUT(jsonReq("http://localhost/api/archetypes/bau", "PUT", { label: "Renamed" }) as never, params("bau"));
  assert.equal(res.status, 200);
  assert.match(readFileSync(file, "utf-8"), /Renamed/, "the edit really lands on disk");
  process.chdir(REAL_CWD);
});

test("404 is reserved for a MISSING archetype; every other refusal is a 400", async () => {
  freshRegistry();
  const { collection: coll, item: one } = await handlers();

  // not_found -> 404 on both item handlers.
  const missing: Array<[string, () => Promise<Response>]> = [
    ["PUT", () => one.PUT(jsonReq("http://localhost/api/archetypes/ghost", "PUT", { label: "X" }) as never, params("ghost"))],
    ["PATCH", () => one.PATCH(jsonReq("http://localhost/api/archetypes/ghost", "PATCH", { archived: true }) as never, params("ghost"))],
  ];
  for (const [name, call] of missing) {
    const res = await call();
    assert.equal(res.status, 404, `${name} on an unknown id is a missing THING, not a bad edit`);
    assert.equal(((await res.json()) as { code?: string }).code, "not_found");
  }

  // A bad edit of an archetype that DOES exist -> 400 with the code the manager localizes.
  const badWeights = await one.PUT(
    jsonReq("http://localhost/api/archetypes/bau", "PUT", { weights: { skills: 0.5, career: 0.3, personal: 0.1 } }) as never,
    params("bau"),
  );
  assert.equal(badWeights.status, 400);
  assert.equal(((await badWeights.json()) as { code?: string }).code, "weights_sum");

  // A malformed archive flag is refused before the registry is even read.
  const badFlag = await one.PATCH(
    jsonReq("http://localhost/api/archetypes/bau", "PATCH", { archived: "yes" }) as never,
    params("bau"),
  );
  assert.equal(badFlag.status, 400);
  assert.equal(((await badFlag.json()) as { code?: string }).code, "archived_invalid");

  // A create with a bad id is client-fixable input, so 400, never 404.
  const badId = await coll.POST(jsonReq("http://localhost/api/archetypes", "POST", { ...BAU, id: "9lives" }) as never);
  assert.equal(badId.status, 400);
  assert.equal(((await badId.json()) as { code?: string }).code, "id_invalid");
  process.chdir(REAL_CWD);
});

test("a broken registry file answers a CODE at the write doors, not a parser message", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kp-archetypes-route-"));
  fixtures.push(root);
  mkdirSync(path.join(root, "pipeline", "jobfit"), { recursive: true });
  writeFileSync(path.join(root, "pipeline", "jobfit", "archetypes.json"), "{ not json", "utf-8");
  process.chdir(root);
  const { item: one } = await handlers();
  const res = await one.PUT(jsonReq("http://localhost/api/archetypes/bau", "PUT", { label: "X" }) as never, params("bau"));
  assert.equal(res.status, 400, "a broken file is not a 500 with the parser's text in it");
  const body = (await res.json()) as { code?: string; error?: string };
  assert.equal(body.code, "registry_invalid");
  assert.ok(!body.error?.includes(root), "the deployment's absolute path must not reach the client");
  process.chdir(REAL_CWD);
});
