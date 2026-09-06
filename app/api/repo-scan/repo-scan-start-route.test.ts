// The App-master scan door. Its job here is one thing: a second POST for a
// repository kp is already reading, or read a moment ago, must not pay for a
// second shallow clone plus a second in-repo agent session over the same code.
//
// It used to pay every time — `startRepoScan` minted a row per POST and keyed the
// task by that row's own id, so the dedupe could never fire. The response now
// carries `reused` so the answer is a fact on the wire rather than something the
// caller has to infer from a timestamp.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Point next/server at the shared test shim BEFORE the route loads.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

after(() => {
  delete process.env.KP_APP_MASTER_REPO_ROOTS;
  delete process.env.KP_TRUSTED_PROXY;
  cleanupUnitDb();
});

let allowed = "";
before(() => {
  allowed = mkdtempSync(path.join(tmpdir(), "kp-repo-scan-route-"));
  process.env.KP_APP_MASTER_REPO_ROOTS = allowed;
  process.env.KP_TRUSTED_PROXY = "1";
});

type Route = typeof import("./route.ts");
let route: Route | null = null;
async function handlers(): Promise<Route> {
  route ??= (await import("./route.ts")) as Route;
  return route;
}

/** Each test gets its own client address so the shared in-process limiter's window
 *  from one test cannot refuse the next. */
let ip = 0;
async function post(body: unknown, addr = `10.7.0.${++ip}`) {
  const { POST } = await handlers();
  return POST(
    new Request("http://localhost/api/repo-scan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": addr },
      body: JSON.stringify(body),
    }) as never
  );
}

test("a double-click on Scan is one reading of one repository", async () => {
  const addr = "10.7.1.1";
  const first = (await (await post({ rootPath: allowed }, addr)).json()) as {
    scanId: string;
    taskId: string | null;
    reused: boolean;
  };
  assert.equal(first.reused, false);
  assert.ok(first.scanId && first.taskId);

  const second = (await (await post({ rootPath: allowed }, addr)).json()) as typeof first;
  assert.equal(second.reused, true, "the second POST is handed the run the first one started");
  assert.equal(second.scanId, first.scanId, "…and the SAME row, so the poller watches a row that will finish");
  assert.equal(second.taskId, first.taskId);
});

test("a completed scan is answered with no task to watch", async () => {
  const addr = "10.7.2.1";
  const first = (await (await post({ repoUrl: "https://github.com/acme/reused" }, addr)).json()) as {
    scanId: string;
  };
  const { completeRepoScan, markRepoScanRunning } = await import("../../_lib/db/repo-scans.ts");
  const { DEFAULT_WORKSPACE } = await import("../../_lib/auth/session.ts");
  markRepoScanRunning(first.scanId, DEFAULT_WORKSPACE);
  completeRepoScan(first.scanId, { dossier: { contexts: [] }, source: "heuristic" }, DEFAULT_WORKSPACE);

  const again = (await (await post({ repoUrl: "https://github.com/acme/reused" }, addr)).json()) as {
    scanId: string;
    taskId: string | null;
    reused: boolean;
  };
  assert.equal(again.reused, true);
  assert.equal(again.scanId, first.scanId);
  assert.equal(again.taskId, null, "no run is in flight, and claiming one would be a green lie");
});

test("a refused target answers the operator's own input problem, not a generic failure", async () => {
  const res = await post({ rootPath: "/etc" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.ok(body.error, "the allow-list refusal is the operator's to act on");
});

// --- the measuring caller's door --------------------------------------------
// Coalescing is right for the operator and wrong for the bench: four App-master
// scenarios point at ONE root, so inside the reuse window three of the four were
// handed the first run's dossier and a scan-engine regression could fail only
// one of them. `fresh: true` is the opt-out, and it is gated exactly like every
// other scan — same operator check, same limiter, same allow-list.
test("fresh: true takes its own reading instead of a finished one", async () => {
  const addr = "10.7.3.1";
  const first = (await (await post({ rootPath: allowed }, addr)).json()) as { scanId: string };
  const { completeRepoScan, markRepoScanRunning } = await import("../../_lib/db/repo-scans.ts");
  const { DEFAULT_WORKSPACE } = await import("../../_lib/auth/session.ts");
  markRepoScanRunning(first.scanId, DEFAULT_WORKSPACE);
  completeRepoScan(first.scanId, { dossier: { contexts: [] }, source: "heuristic" }, DEFAULT_WORKSPACE);

  const measured = (await (await post({ rootPath: allowed, fresh: true }, addr)).json()) as {
    scanId: string;
    taskId: string | null;
    reused: boolean;
  };
  assert.equal(measured.reused, false, "the sweep measured the scan rather than copying one");
  assert.notEqual(measured.scanId, first.scanId);
  assert.ok(measured.taskId, "a row with no task is a poll that never finishes");
});

test("fresh does not widen the allow-list", async () => {
  const res = await post({ rootPath: "/etc", fresh: true });
  assert.equal(res.status, 400, "the target gate speaks before `fresh` means anything");
});
