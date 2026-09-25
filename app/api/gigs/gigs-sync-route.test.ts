// POST /api/gigs/sync on an isolated DB, in open auth mode. The route runs the real
// gigs/sync.ts syncGigAttempts, whose default transport is fetchPersonaExecution over
// the paired bridge - so a "landed" case sets the bridge env and mocks globalThis.fetch
// to answer GET {bridge}/api/executions/{id}. unit-db.ts must be the first project import.
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { getGig, transitionGig, upsertGigFromRaw } from "../../_lib/db/gigs.ts";
import { createGigAttempt, getGigAttempt, setGigAttemptExecutionId } from "../../_lib/db/gigs-attempts.ts";
import type { Gig, GigAttempt } from "../../_lib/gigs/types.ts";
import { POST as SYNC } from "./sync/route.ts";

const WS = DEFAULT_WORKSPACE_ID;
const realFetch = globalThis.fetch;

after(() => cleanupUnitDb());
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

const FENCE = "`".repeat(3);
const GOOD_OUTPUT = [
  "Worked the issue.",
  `${FENCE}kp-deliverable`,
  JSON.stringify({
    version: 1,
    summary: "Print stylesheet ships.",
    draftText: "PR description",
    artifacts: [{ kind: "pr", ref: "branch print-css", title: "Print styles" }],
    evidence: [{ kind: "test", command: "npm test", result: "ok", passed: true }],
    disclosure: "Prepared with AI assistance, reviewed by me.",
    confidence: 0.8,
    questions: [],
  }),
  FENCE,
].join("\n");

let seq = 0;
/** A gig in `dispatched` with one attempt stamped with an execution id. */
function inFlight(executionId = `exec-${seq + 1}`): { gig: Gig; attempt: GigAttempt } {
  seq += 1;
  const { gig } = upsertGigFromRaw(WS, {
    sourceId: "gsrc-s",
    arena: "oss_bounty",
    raw: {
      externalKey: `s-${seq}`,
      url: `https://example.test/s/${seq}`,
      title: `Sync ${seq}`,
      org: null,
      reward: null,
      deadlineAt: null,
      postedAt: null,
      bodyText: "Do it.",
      bodyHtml: null,
      tags: [],
    },
    suspectReasons: [],
  });
  assert.ok(transitionGig(WS, gig.id, { from: "new", to: "qualified" }).ok);
  assert.ok(transitionGig(WS, gig.id, { from: "qualified", to: "dispatched" }).ok);
  const attempt = createGigAttempt(WS, { gigId: gig.id, specialistId: "gspec-s", revisionNote: null })!;
  const stamped = setGigAttemptExecutionId(WS, attempt.id, executionId)!;
  return { gig: getGig(WS, gig.id)!, attempt: stamped };
}

function req(ip: string): Request {
  return new Request("http://localhost/api/gigs/sync", { method: "POST", headers: { "x-forwarded-for": ip } });
}

/** Mock the bridge so GET /api/executions/<id> answers a Personas execution snapshot. */
function pairedBridge(byId: Record<string, { status: string; output_data?: string | null; cost_usd?: number | null }>): void {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  globalThis.fetch = (async (url: string) => {
    const m = /\/api\/executions\/([^/?]+)/.exec(String(url));
    const data = m ? byId[decodeURIComponent(m[1])] : undefined;
    if (!data) return new Response(JSON.stringify({ success: false }), { status: 404 });
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  }) as typeof fetch;
}

test("no in-flight attempts: { synced: 0, attempts: [] }", async () => {
  const res = await SYNC(req("10.1.0.1"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { synced: number; attempts: unknown[] };
  assert.equal(body.synced, 0);
  assert.deepEqual(body.attempts, []);
});

test("a completed execution lands as drafted: synced 1, the moved attempt carries the deliverable", async () => {
  const { gig, attempt } = inFlight("exec-drafted");
  pairedBridge({ "exec-drafted": { status: "completed", output_data: GOOD_OUTPUT, cost_usd: 0.5 } });
  const res = await SYNC(req("10.1.0.2"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { synced: number; attempts: GigAttempt[] };
  assert.equal(body.synced, 1);
  assert.equal(body.attempts.length, 1);
  assert.equal(body.attempts[0].id, attempt.id);
  assert.equal(body.attempts[0].status, "drafted");
  assert.equal(body.attempts[0].deliverable?.summary, "Print stylesheet ships.");
  assert.equal(getGig(WS, gig.id)!.status, "drafted");
});

test("a failed run moves the attempt to failed with its reason", async () => {
  const { gig, attempt } = inFlight("exec-failed");
  pairedBridge({ "exec-failed": { status: "failed", cost_usd: 0.2 } });
  const res = await SYNC(req("10.1.0.3"));
  const body = (await res.json()) as { synced: number; attempts: GigAttempt[] };
  assert.equal(body.synced, 1);
  assert.equal(body.attempts[0].status, "failed");
  assert.equal(body.attempts[0].fallbackReason, "personas_failed");
  assert.equal(getGig(WS, gig.id)!.status, "qualified");
  assert.equal(getGigAttempt(WS, attempt.id)!.status, "failed");
});

test("an unreachable Personas moves nothing: synced 0, the attempt stays dispatched", async () => {
  const { attempt } = inFlight("exec-down");
  // No bridge env: fetchPersonaExecution resolves unpaired -> retryable, nothing lands.
  const res = await SYNC(req("10.1.0.4"));
  const body = (await res.json()) as { synced: number; attempts: unknown[] };
  assert.equal(body.synced, 0);
  assert.deepEqual(body.attempts, []);
  assert.equal(getGigAttempt(WS, attempt.id)!.status, "dispatched");
});

test("rate-limited per IP at 20 / 10 min", async () => {
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await SYNC(req("10.1.0.99"))).status;
  assert.equal(last, 429);
});
