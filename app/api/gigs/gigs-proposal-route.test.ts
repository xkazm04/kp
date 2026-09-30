// GET / POST /api/gigs/[id]/proposal on an isolated DB, in open auth mode, with the gigs root
// in a temp dir: GET serves the proposal FILE under the report's sandbox policy (and adds an
// attachment disposition with ?download=1; 404s with a code when there is none, or the recorded
// path is outside the proposals root); POST enqueues a `gig_proposal` task (202), refuses a
// build-track gig and a gig with no brief (409 with the reason) and is throttled per IP. The
// plan accept of a FREELANCE gig asks for the proposal; a build-track accept does not. The
// runner and the trigger are REPLACED by recorders: the real ones spawn Python.
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
import { createManualGig, setGigBrief, setGigProposal } from "../../_lib/db/gigs.ts";
import { createGigPlanRound, setGigPlanResult, setGigPlanRunning } from "../../_lib/db/gigs-plans.ts";
import { REPORT_FIXTURE_BRIEF } from "../../_lib/gigs/__fixtures__/report-facts.ts";
import { fixturePlan } from "../../_lib/gigs/__fixtures__/accepted-plan.ts";
import { registerGigProposalEnqueuer } from "../../_lib/gigs/proposal/trigger.ts";
import type { Gig, GigProposal } from "../../_lib/gigs/types.ts";
import { registerTaskRunner, type ExternalTaskCtx } from "../../_lib/task-external-runners.ts";
import { GET, POST } from "./[id]/proposal/route.ts";
import { POST as ACCEPT } from "./[id]/plans/[planId]/accept/route.ts";

const WS = DEFAULT_WORKSPACE_ID;
const ROOT = mkdtempSync(path.join(tmpdir(), "kp-proposal-route-"));
const runs: ExternalTaskCtx[] = [];
const asked: string[] = [];

before(() => {
  process.env.KP_OFFLINE = "1";
  process.env.KP_TRUSTED_PROXY = "1";
  process.env.KP_GIGS_ROOT = ROOT;
  registerTaskRunner("gig_proposal", async (ctx) => {
    runs.push(ctx);
    return { status: "skipped", reason: "recorder" };
  });
  registerGigProposalEnqueuer((_ws, gigId) => {
    asked.push(gigId);
  });
});

after(() => {
  registerGigProposalEnqueuer(null);
  delete process.env.KP_OFFLINE;
  delete process.env.KP_TRUSTED_PROXY;
  delete process.env.KP_GIGS_ROOT;
  rmSync(ROOT, { recursive: true, force: true });
  cleanupUnitDb();
});

function req(method: string, ip: string, query = ""): Request {
  return new Request(`http://localhost/api/gigs/x/proposal${query}`, { method, headers: { "x-forwarded-for": ip } });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let seq = 0;
function gig(opts: { arena?: Gig["arena"]; brief?: boolean } = {}): string {
  seq += 1;
  const { gig: g } = createManualGig(WS, {
    arena: opts.arena ?? "freelance",
    url: `https://example.test/proposal-route/${seq}`,
    title: `Proposal route ${seq}`,
    bodyText: `Body ${seq}`,
    org: null,
    reward: null,
    deadlineAt: null,
    tags: [],
    suspectReasons: [],
  });
  if (opts.brief !== false) setGigBrief(WS, g.id, REPORT_FIXTURE_BRIEF);
  return g.id;
}

function record(file: string): GigProposal {
  return { path: file, status: "ready", source: "deterministic", model: null, fallbackReason: "no_provider", costUsd: null, generatedAt: "2026-09-30T00:00:00.000Z", planId: null, message: "m", questions: [], artifacts: [] };
}

const code = async (res: Response) => ((await res.json()) as { code: string }).code;

test("GET: 404 GIG_NOT_FOUND, 404 GIG_PROPOSAL_NOT_FOUND before the first proposal and for a path outside the root", async () => {
  assert.equal(await code(await GET(req("GET", "198.51.100.1"), params("gig-nope"))), "GIG_NOT_FOUND");
  const id = gig();
  const none = await GET(req("GET", "198.51.100.1"), params(id));
  assert.equal(none.status, 404);
  assert.equal(await code(none), "GIG_PROPOSAL_NOT_FOUND");
  const outside = path.join(ROOT, "_reports", "elsewhere.html");
  mkdirSync(path.dirname(outside), { recursive: true });
  writeFileSync(outside, "<p>not a proposal</p>");
  setGigProposal(WS, id, record(outside));
  assert.equal((await GET(req("GET", "198.51.100.1"), params(id))).status, 404, "a report path is not a proposal");
});

test("GET: 200 under the sandbox policy; ?download=1 adds the attachment disposition", async () => {
  const id = gig();
  const dir = path.join(ROOT, "_proposals", "web");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "2026-09-30-bakery-landing-page-abc123.html");
  writeFileSync(file, "<!doctype html><title>p</title><p>the proposal</p>");
  setGigProposal(WS, id, record(file));
  const res = await GET(req("GET", "198.51.100.2"), params(id));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /^sandbox;/);
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /allow-scripts|allow-same-origin/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-disposition"), null);
  assert.match(await res.text(), /the proposal/);
  const dl = await GET(req("GET", "198.51.100.2", "?download=1"), params(id));
  assert.equal(dl.headers.get("content-disposition"), 'attachment; filename="bakery-landing-page-proposal.html"');
});

test("POST: 404, 409 build_track, 409 no_brief, 202 with a gig_proposal task for THIS gig", async () => {
  assert.equal((await POST(req("POST", "198.51.100.3"), params("gig-nope"))).status, 404);
  const bounty = gig({ arena: "oss_bounty" });
  const b = await POST(req("POST", "198.51.100.3"), params(bounty));
  assert.equal(b.status, 409);
  assert.deepEqual(await b.json().then((x: { code: string; reason: string }) => [x.code, x.reason]), ["GIG_ACTION_NOT_ALLOWED", "build_track"]);
  const bare = gig({ brief: false });
  const n = await POST(req("POST", "198.51.100.3"), params(bare));
  assert.deepEqual([n.status, await n.json().then((x: { reason: string }) => x.reason)], [409, "no_brief"]);
  const id = gig();
  const ok = await POST(req("POST", "198.51.100.3"), params(id));
  assert.equal(ok.status, 202);
  const { taskId } = (await ok.json()) as { taskId: string };
  assert.equal(getTask(taskId, WS)?.kind, "gig_proposal");
  for (let i = 0; i < 100 && runs.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(runs.at(-1)?.params, { workspaceId: WS, gigId: id });
});

test("POST: throttled per IP - the 21st call in ten minutes is 429 TOO_MANY_REQUESTS", async () => {
  const id = gig();
  for (let i = 0; i < 20; i++) assert.notEqual((await POST(req("POST", "198.51.100.99"), params(id))).status, 429, `call ${i + 1}`);
  const limited = await POST(req("POST", "198.51.100.99"), params(id));
  assert.equal(limited.status, 429);
  assert.equal(await code(limited), "TOO_MANY_REQUESTS");
});

test("plan accept: a freelance gig asks for its proposal; a build-track gig does not", async () => {
  const accept = async (arena: Gig["arena"]) => {
    const id = gig({ arena });
    const [row] = createGigPlanRound(WS, id, [{ seat: "sonnet", model: "claude-sonnet-5-5", effort: "high" }])!;
    assert.ok(setGigPlanRunning(WS, row.id));
    assert.ok(setGigPlanResult(WS, row.id, { plan: fixturePlan(4), fallbackReason: null, costUsd: 0.01, durationMs: 10 }));
    const res = await ACCEPT(new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": "198.51.100.5" }, body: "{}" }), { params: Promise.resolve({ id, planId: row.id }) });
    assert.equal(res.status, 200);
    return id;
  };
  const bid = await accept("freelance");
  assert.deepEqual(asked, [bid]);
  await accept("oss_bounty");
  assert.deepEqual(asked, [bid], "the build track is unchanged: no proposal");
});
