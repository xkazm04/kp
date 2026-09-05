// The App-master scan detail route is a PUBLIC-shaped read of a private row: the
// operator's browser polls it every second while a clone plus an in-repo agent
// session runs over a codebase nobody else is allowed to see.
//
// It used to answer `{ ...rest }` — a SPREAD of the row with two fields removed.
// A spread is an allow-list written backwards: every column added to `repo_scans`
// later is on the wire by default, and one already was. `error` carries the last
// 200 bytes of git's stderr for a clone failure (`repo-scan-run.ts`, "clone_failed"),
// which for a private remote is host, branch and auth chatter — and NOTHING renders
// it: the panel reads `errorCode` and resolves the copy in the reader's language
// (`scanStateFor`, jdsIntakeLogic.ts). `workspace_id` rode out the same way.
//
// So the projection is now an explicit list, the shape the repo law already
// demands of candidate/token routes, and this file pins it: what is ON the wire,
// what is NOT, and that another tenant's scan is a 404 rather than a 403.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Point next/server at the shared test shim BEFORE the route loads (hooks only
// affect later resolutions — hence the dynamic imports below).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

after(() => cleanupUnitDb());

type Route = typeof import("./route.ts");
let route: Route | null = null;
async function handlers(): Promise<Route> {
  route ??= (await import("./route.ts")) as Route;
  return route;
}

async function get(id: string) {
  const { GET } = await handlers();
  const req = new Request(`http://localhost/api/repo-scan/${id}`) as never;
  return GET(req, { params: Promise.resolve({ id }) });
}

/** The tenant `currentWorkspace()` resolves to outside a request scope: `cookies()`
 *  throws, so the route reads the default workspace. That is the tenant these
 *  fixtures are written into; the "other tenant" rows use a different one. */
async function defaultWorkspace(): Promise<string> {
  const { DEFAULT_WORKSPACE } = await import("../../../_lib/auth/session.ts");
  return DEFAULT_WORKSPACE;
}

const DOSSIER = { size: { files: 3, sourceFiles: 2, contexts: 1 }, contexts: [], declaredGates: [] };

test("a failed scan puts its CODE on the wire and git's stderr nowhere near it", async () => {
  const ws = await defaultWorkspace();
  const { createRepoScan, failRepoScan, markRepoScanRunning } = await import("../../../_lib/db/repo-scans.ts");
  const row = createRepoScan({ repoUrl: "https://github.com/acme/private" }, ws);
  markRepoScanRunning(row.id, ws);
  // The exact shape repo-scan-run.ts builds for a clone failure: git's last 200
  // stderr bytes, which for a private remote name the host and the auth method.
  failRepoScan(
    row.id,
    "Could not clone the repository (git exited 128). fatal: could not read Username for 'https://git.internal.acme.example': terminal prompts disabled",
    "clone_failed",
    ws
  );

  const res = await get(row.id);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scan: Record<string, unknown> };
  assert.equal(body.scan.errorCode, "clone_failed", "the code the panel renders in the reader's language");
  assert.ok(!("error" in body.scan), "git's stderr is a server-log fact, never a wire fact");
  assert.ok(!("workspaceId" in body.scan), "the tenant id is the session's, not the payload's");
  assert.ok(!("rootPath" in body.scan), "the server's resolved filesystem path stays server-side");
  assert.ok(!("fallbackReason" in body.scan), "the raw diagnostic line stays server-side");
  assert.equal(
    JSON.stringify(body).includes("git.internal.acme.example"),
    false,
    "no part of the response may quote the remote's stderr"
  );
});

test("the projection is an explicit list, so a new column is off the wire by default", async () => {
  const ws = await defaultWorkspace();
  const { createRepoScan, markRepoScanRunning, completeRepoScan } = await import("../../../_lib/db/repo-scans.ts");
  const row = createRepoScan({ rootPath: "/srv/apps/thing" }, ws);
  markRepoScanRunning(row.id, ws);
  completeRepoScan(
    row.id,
    { dossier: DOSSIER, source: "heuristic", fallbackReason: "TimeoutError: agent took too long", fallbackClass: "agent_timeout" },
    ws
  );

  const res = await get(row.id);
  const body = (await res.json()) as { scan: Record<string, unknown> };
  assert.deepEqual(
    Object.keys(body.scan).sort(),
    ["createdAt", "dossier", "errorCode", "fallbackClass", "id", "isLocal", "repoUrl", "source", "status", "updatedAt"],
    "the wire shape is enumerated here; widening it is a decision, not a side effect of a migration"
  );
  assert.equal(body.scan.isLocal, true, "a local scan is disclosed as local without echoing the path");
  assert.equal(body.scan.fallbackClass, "agent_timeout");
  assert.equal(body.scan.source, "heuristic");
});

test("another tenant's scan is indistinguishable from one that never existed", async () => {
  const { createRepoScan } = await import("../../../_lib/db/repo-scans.ts");
  const row = createRepoScan({ repoUrl: "https://github.com/other/repo" }, "ws-someone-else");
  const res = await get(row.id);
  assert.equal(res.status, 404, "a scan id must not be a bearer token for another team's repo");
  const missing = await get("rscan_does_not_exist");
  assert.equal(missing.status, 404);
});
