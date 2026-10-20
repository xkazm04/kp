// GET / POST /api/gigs/[id]/report on an isolated DB, in open auth mode, with the gigs root
// in a temp dir: GET serves the report FILE under the sandbox policy (and 404s with a code
// when there is none, or the recorded path is outside the reports root); POST enqueues a
// forced `gig_report` task (202), refuses a gig with no brief (409) and is throttled per IP
// (the 21st call in ten minutes is 429). The `gig_report` runner is REPLACED by a recorder:
// the real one spawns Python (run.test.ts drives it over a fake CLI).
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { getTask } from "../../_lib/db/tasks.ts";
import { createManualGig, setGigBrief, setGigReport } from "../../_lib/db/gigs.ts";
import { REPORT_FIXTURE_BRIEF } from "../../_lib/gigs/__fixtures__/report-facts.ts";
import type { GigReport } from "../../_lib/gigs/types.ts";
import { registerTaskRunner, type ExternalTaskCtx } from "../../_lib/task-external-runners.ts";
import { GET, POST } from "./[id]/report/route.ts";

const WS = DEFAULT_WORKSPACE_ID;
const ROOT = mkdtempSync(path.join(tmpdir(), "kp-report-route-"));
const runs: ExternalTaskCtx[] = [];

before(() => {
  process.env.KP_OFFLINE = "1";
  process.env.KP_TRUSTED_PROXY = "1";
  process.env.KP_GIGS_ROOT = ROOT;
  registerTaskRunner("gig_report", async (ctx) => {
    runs.push(ctx);
    return { status: "skipped", reason: "recorder" };
  });
});

after(() => {
  delete process.env.KP_OFFLINE;
  delete process.env.KP_TRUSTED_PROXY;
  delete process.env.KP_GIGS_ROOT;
  rmSync(ROOT, { recursive: true, force: true });
  cleanupUnitDb();
});

function req(method: string, ip: string): Request {
  return new Request("http://localhost/api/gigs/x/report", { method, headers: { "x-forwarded-for": ip } });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let seq = 0;
function gig(brief = true): string {
  seq += 1;
  const { gig: g } = createManualGig(WS, {
    arena: "freelance",
    url: `https://example.test/report-route/${seq}`,
    title: `Report route ${seq}`,
    bodyText: `Body ${seq}`,
    org: null,
    reward: null,
    deadlineAt: null,
    tags: [],
    suspectReasons: [],
  });
  if (brief) setGigBrief(WS, g.id, REPORT_FIXTURE_BRIEF);
  return g.id;
}

function record(file: string): GigReport {
  return { path: file, stage: "researched", status: "ready", source: "deterministic", model: null, fallbackReason: "no_provider", costUsd: null, generatedAt: "2026-09-30T00:00:00.000Z" };
}

test("GET: 404 GIG_NOT_FOUND, 404 GIG_REPORT_NOT_FOUND before the first report and for a path outside the reports root", async () => {
  const unknown = await GET(req("GET", "198.51.100.1"), params("gig-nope"));
  assert.equal(unknown.status, 404);
  assert.equal(((await unknown.json()) as { code: string }).code, "GIG_NOT_FOUND");
  const id = gig();
  const none = await GET(req("GET", "198.51.100.1"), params(id));
  assert.equal(none.status, 404);
  assert.equal(((await none.json()) as { code: string }).code, "GIG_REPORT_NOT_FOUND");
  const outside = path.join(ROOT, "elsewhere.html");
  writeFileSync(outside, "<p>not a report</p>");
  setGigReport(WS, id, record(outside));
  assert.equal((await GET(req("GET", "198.51.100.1"), params(id))).status, 404);
});

test("GET: 200 serves the file with the sandbox CSP, nosniff and no-store", async () => {
  const id = gig();
  const dir = path.join(ROOT, "_reports", "web");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.html`);
  writeFileSync(file, "<!doctype html><title>r</title><p>the report</p>");
  setGigReport(WS, id, record(file));
  const res = await GET(req("GET", "198.51.100.2"), params(id));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /^sandbox;/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /allow-scripts|allow-same-origin/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(await res.text(), /the report/);
});

test("POST: 404, 409 no_brief, 202 with a forced gig_report task for THIS gig", async () => {
  assert.equal((await POST(req("POST", "198.51.100.3"), params("gig-nope"))).status, 404);
  const bare = gig(false);
  const refused = await POST(req("POST", "198.51.100.3"), params(bare));
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json().then((b: { code: string; reason: string }) => [b.code, b.reason]), ["GIG_ACTION_NOT_ALLOWED", "no_brief"]);
  const id = gig();
  const ok = await POST(req("POST", "198.51.100.3"), params(id));
  assert.equal(ok.status, 202);
  const { taskId } = (await ok.json()) as { taskId: string };
  const task = getTask(taskId, WS);
  assert.equal(task?.kind, "gig_report");
  for (let i = 0; i < 100 && runs.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(runs.at(-1)?.params, { workspaceId: WS, gigId: id, force: true });
});

test("POST: throttled per IP - the 21st call in ten minutes is 429 TOO_MANY_REQUESTS", async () => {
  const id = gig();
  for (let i = 0; i < 20; i++) assert.notEqual((await POST(req("POST", "198.51.100.99"), params(id))).status, 429, `call ${i + 1}`);
  const limited = await POST(req("POST", "198.51.100.99"), params(id));
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as { code: string }).code, "TOO_MANY_REQUESTS");
});
