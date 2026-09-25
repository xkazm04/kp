// Fixtures for scripts/gigs/dry-run.mjs. The pure helpers are exercised directly;
// the flows run main() with an INJECTED fetch and a no-op sleep, so no test ever
// touches the network or waits. The human-send gate is asserted structurally: no
// request the orchestrator makes is ever the attempt `mark_sent` action.
//
// Run: node scripts/gigs/__tests__/dry-run.test.mjs   (or: node --test <this>)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ARENA,
  DEFAULT_GIG,
  DEFAULT_NICHE,
  EXIT,
  HEADLESS_SECURITY_NOTE,
  findSpecialist,
  formatDeliverable,
  main,
  parseArgs,
  personasStartLines,
  pullState,
  renderEvidenceLine,
  resolveBaseUrl,
  specialistHireReady,
} from "../dry-run.mjs";

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test("parseArgs: defaults", () => {
  const a = parseArgs([]);
  assert.equal(a.gig, DEFAULT_GIG);
  assert.equal(a.arena, DEFAULT_ARENA);
  assert.equal(a.niche, DEFAULT_NICHE);
  assert.equal(a.startPersonas, false);
  assert.equal(a.pairOnly, false);
  assert.equal(a.prepareOnly, false);
  assert.equal(a.noDispatch, false);
  assert.equal(a.timeoutS, 300);
});

test("parseArgs: values and booleans", () => {
  const a = parseArgs(["--gig", "gig-x", "--kp", "http://host:4000", "--arena", "security", "--niche", "web auth", "--timeout-s", "42", "--start-personas", "--no-dispatch"]);
  assert.equal(a.gig, "gig-x");
  assert.equal(a.kp, "http://host:4000");
  assert.equal(a.arena, "security");
  assert.equal(a.niche, "web auth");
  assert.equal(a.timeoutS, 42);
  assert.equal(a.startPersonas, true);
  assert.equal(a.noDispatch, true);
});

test("parseArgs: --help", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

test("parseArgs: a missing value throws", () => {
  assert.throws(() => parseArgs(["--gig"]), /needs a value/);
  assert.throws(() => parseArgs(["--gig", "--kp"]), /needs a value/);
});

test("parseArgs: a bad timeout and an unknown flag throw", () => {
  assert.throws(() => parseArgs(["--timeout-s", "nope"]), /positive number/);
  assert.throws(() => parseArgs(["--timeout-s", "-3"]), /positive number/);
  assert.throws(() => parseArgs(["--frobnicate"]), /unknown argument/);
});

test("resolveBaseUrl: flag > env > default, trailing slash trimmed", () => {
  assert.equal(resolveBaseUrl("http://a:1/", {}), "http://a:1");
  assert.equal(resolveBaseUrl(null, { KP_BASE_URL: "http://b:2//" }), "http://b:2");
  assert.equal(resolveBaseUrl(null, {}), "http://localhost:3000");
});

// ---------------------------------------------------------------------------
// personas start command
// ---------------------------------------------------------------------------

test("personasStartLines: carries the exact Windows command and the security caveat", () => {
  const text = personasStartLines().join("\n");
  assert.match(text, /set PERSONAS_HEADLESS_BRIDGE=1 && <path to>\\personas-desktop\.exe/);
  assert.match(text, /npm run tauri dev/);
  assert.match(text, /any local origin can mint a real key/);
});

test("the headless security note names the real risk", () => {
  assert.match(HEADLESS_SECURITY_NOTE, /PERSONAS_HEADLESS_BRIDGE=1/);
  assert.match(HEADLESS_SECURITY_NOTE, /mint a real bridge key/);
});

// ---------------------------------------------------------------------------
// specialist matching + readiness
// ---------------------------------------------------------------------------

test("findSpecialist: matches arena + niche, falls back to arena", () => {
  const list = [
    { spec: { arena: "oss_bounty", niche: "backend" }, hire: {} },
    { spec: { arena: "oss_bounty", niche: "frontend / CSS" }, hire: {} },
  ];
  assert.equal(findSpecialist(list, { arena: "oss_bounty", niche: "frontend / CSS" }).spec.niche, "frontend / CSS");
  // niche not present -> arena fallback picks the first of the arena
  assert.equal(findSpecialist(list, { arena: "oss_bounty", niche: "nope" }).spec.niche, "backend");
  assert.equal(findSpecialist(list, { arena: "security", niche: "x" }), null);
  assert.equal(findSpecialist(null, { arena: "x", niche: "y" }), null);
});

test("specialistHireReady: needs a persona id and a non-terminal status", () => {
  assert.deepEqual(specialistHireReady({ hire: { personaId: "p1", status: "active" } }), { ready: true, reason: "active" });
  assert.deepEqual(specialistHireReady({ hire: { personaId: "p1", status: "onboarding" } }), { ready: true, reason: "onboarding" });
  assert.deepEqual(specialistHireReady({ hire: { personaId: null, status: "dispatched" } }), { ready: false, reason: "no_persona_id" });
  assert.deepEqual(specialistHireReady({ hire: { personaId: "p1", status: "failed" } }), { ready: false, reason: "failed" });
  assert.deepEqual(specialistHireReady({}), { ready: false, reason: "no_hire" });
});

// ---------------------------------------------------------------------------
// the pull-loop state machine
// ---------------------------------------------------------------------------

test("pullState: drafted / failed are terminal, dispatched/running wait", () => {
  const drafted = { attempts: [{ id: "a1", status: "drafted", deliverable: { summary: "x" } }] };
  assert.deepEqual(pullState(drafted, "a1"), { done: true, ok: true, phase: "drafted", attempt: drafted.attempts[0] });

  const failed = { attempts: [{ id: "a1", status: "failed", fallbackReason: "personas_failed" }] };
  assert.equal(pullState(failed, "a1").phase, "failed");
  assert.equal(pullState(failed, "a1").done, true);

  const running = { attempts: [{ id: "a1", status: "running" }] };
  assert.equal(pullState(running, "a1").phase, "waiting");
  assert.equal(pullState(running, "a1").done, false);

  assert.equal(pullState({ attempts: [] }).phase, "none");
  assert.equal(pullState({}).phase, "none");
});

test("pullState: with no attempt id, the latest attempt is the target", () => {
  const view = { attempts: [{ id: "old", status: "failed" }, { id: "new", status: "drafted", deliverable: {} }] };
  assert.equal(pullState(view).attempt.id, "new");
  assert.equal(pullState(view).phase, "drafted");
});

// ---------------------------------------------------------------------------
// the deliverable formatter
// ---------------------------------------------------------------------------

test("renderEvidenceLine: passed is tri-state; null is UNVERIFIED, never a failure", () => {
  assert.match(renderEvidenceLine({ kind: "test", command: "npm test", result: "ok", passed: true }), /\[PASS\]/);
  assert.match(renderEvidenceLine({ kind: "gate", result: "lint red", passed: false }), /\[FAIL\]/);
  const unverified = renderEvidenceLine({ kind: "source", result: "read the spec", passed: null });
  assert.match(unverified, /\[UNVERIFIED\]/);
  assert.doesNotMatch(unverified, /FAIL/);
  // passed absent is also UNVERIFIED, not FAIL
  assert.match(renderEvidenceLine({ kind: "repro", result: "n/a" }), /\[UNVERIFIED\]/);
});

test("formatDeliverable: a drafted deliverable shows summary, evidence, disclosure, confidence, folder", () => {
  const attempt = {
    id: "gatt-1",
    status: "drafted",
    costUsd: 0.42,
    deliverable: {
      summary: "Print stylesheet ships.",
      artifacts: [{ kind: "pr", ref: "branch print-css", title: "Print styles" }],
      evidence: [
        { kind: "test", command: "npm test", result: "green", passed: true },
        { kind: "source", result: "read the issue", passed: null },
      ],
      disclosure: "Prepared with AI assistance, reviewed by me.",
      confidence: 0.8,
    },
  };
  const text = formatDeliverable(attempt, { folder: "/gigs/oss/x" }).join("\n");
  assert.match(text, /summary: Print stylesheet ships\./);
  assert.match(text, /\[PASS\] test/);
  assert.match(text, /\[UNVERIFIED\] source/);
  assert.match(text, /disclosure: Prepared with AI assistance/);
  assert.match(text, /confidence: 0\.8/);
  assert.match(text, /metered cost: \$0\.42/);
  assert.match(text, /gig folder: \/gigs\/oss\/x/);
});

test("formatDeliverable: a failed attempt shows its fallback reason, not a deliverable", () => {
  const text = formatDeliverable({ id: "gatt-2", status: "failed", fallbackReason: "personas_incomplete", costUsd: null }, { folder: "/g" }).join("\n");
  assert.match(text, /Run FAILED/);
  assert.match(text, /reason: personas_incomplete/);
});

// ---------------------------------------------------------------------------
// main() flows, with an injected fetch (no network) and a no-op sleep
// ---------------------------------------------------------------------------

/** A router-style fake fetch. Returns a real Response so kpJson reads status/text.
 *  Records every request so a test can assert what was (and was not) called. */
function fakeKp(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    const key = `${method} ${u.pathname}`;
    calls.push({ key, method, path: u.pathname, body });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: "no route", key }), { status: 404 });
    const { status = 200, json = {} } = handler(body, calls.length);
    return new Response(JSON.stringify(json), { status });
  };
  return { fetch, calls };
}

function sink() {
  const out = [];
  return { fn: (...a) => out.push(a.join(" ")), out, text: () => out.join("\n") };
}

const HAPPY_ROUTES = {
  "GET /api/agents/bridge": () => ({ json: { bridge: { baseUrl: "http://127.0.0.1:9420", paired: true, hasKey: true } } }),
  [`POST /api/gigs/${DEFAULT_GIG}/workspace`]: () => ({ json: { gig: { workdir: "/gigs/oss/print" }, personas: { linked: true, projectId: "proj-1" } } }),
  "POST /api/gigs/specialists": () => ({ status: 201, json: { reused: false, specialist: { spec: { arena: DEFAULT_ARENA, niche: DEFAULT_NICHE } } } }),
  "GET /api/gigs/specialists": () => ({ json: { specialists: [{ spec: { arena: DEFAULT_ARENA, niche: DEFAULT_NICHE }, hire: { personaId: "p1", status: "active" } }] } }),
  [`POST /api/gigs/${DEFAULT_GIG}/dispatch`]: () => ({ json: { attempt: { id: "gatt-1" }, executionId: "e1" } }),
  "POST /api/gigs/sync": () => ({ json: { synced: 1, attempts: [] } }),
  [`GET /api/gigs/${DEFAULT_GIG}`]: () => ({
    json: {
      attempts: [
        {
          id: "gatt-1",
          status: "drafted",
          costUsd: 0.5,
          deliverable: { summary: "done", artifacts: [], evidence: [{ kind: "test", result: "ok", passed: true }], disclosure: "AI-assisted, reviewed.", confidence: 0.9 },
        },
      ],
    },
  }),
};

test("main: the happy path runs to a drafted deliverable, exit 0, and NEVER sends", async () => {
  const { fetch, calls } = fakeKp(HAPPY_ROUTES);
  const log = sink();
  const code = await main([], { env: {}, log: log.fn, err: log.fn, fetch, sleep: async () => {} });
  assert.equal(code, EXIT.OK);
  assert.match(log.text(), /Drafted and on the review desk\. Nothing was sent\./);
  assert.match(log.text(), /summary: done/);

  // THE HUMAN-SEND GATE: no request is ever the review door or a mark_sent action.
  const paths = calls.map((c) => c.path);
  assert.ok(!paths.some((p) => /\/gigs\/attempts\//.test(p)), "the orchestrator must never call the attempt review door");
  const bodies = JSON.stringify(calls.map((c) => c.body));
  assert.ok(!bodies.includes("mark_sent"), "no request body carries the mark_sent action");
  assert.ok(!bodies.includes("approve"), "no request body approves an attempt");
  // It did dispatch, sync and read the gig.
  assert.ok(calls.some((c) => c.key === `POST /api/gigs/${DEFAULT_GIG}/dispatch`));
  assert.ok(calls.some((c) => c.key === "POST /api/gigs/sync"));
});

test("main: unpaired without --start-personas prints the start command and exits 3", async () => {
  const { fetch, calls } = fakeKp({
    "GET /api/agents/bridge": () => ({ json: { bridge: { baseUrl: "http://127.0.0.1:9420", paired: false } } }),
  });
  const log = sink();
  const code = await main([], { env: {}, log: log.fn, err: log.fn, fetch, sleep: async () => {} });
  assert.equal(code, EXIT.PREFLIGHT);
  assert.match(log.text(), /set PERSONAS_HEADLESS_BRIDGE=1 && <path to>\\personas-desktop\.exe/);
  // Nothing past preflight ran: no workspace, no hire, no dispatch.
  assert.ok(!calls.some((c) => c.path.includes("/workspace")));
  assert.ok(!calls.some((c) => c.path === "/api/gigs/specialists"));
});

test("main: kp unreachable (fetch throws) exits 1", async () => {
  const fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const log = sink();
  const code = await main([], { env: {}, log: log.fn, err: log.fn, fetch, sleep: async () => {} });
  assert.equal(code, EXIT.FAIL);
  assert.match(log.text(), /kp is not reachable/);
});

test("main: --pair-only stops after a paired preflight (no workspace call)", async () => {
  const { fetch, calls } = fakeKp(HAPPY_ROUTES);
  const log = sink();
  const code = await main(["--pair-only"], { env: {}, log: log.fn, err: log.fn, fetch, sleep: async () => {} });
  assert.equal(code, EXIT.OK);
  assert.ok(!calls.some((c) => c.path.includes("/workspace")), "--pair-only must not prepare the workspace");
});

test("main: --no-dispatch stops after the specialist is ready (no dispatch call)", async () => {
  const { fetch, calls } = fakeKp(HAPPY_ROUTES);
  const log = sink();
  const code = await main(["--no-dispatch"], { env: {}, log: log.fn, err: log.fn, fetch, sleep: async () => {} });
  assert.equal(code, EXIT.OK);
  assert.ok(!calls.some((c) => c.path.endsWith("/dispatch")), "--no-dispatch must not dispatch");
  assert.ok(calls.some((c) => c.path === "/api/gigs/specialists"), "…but it does hire the specialist");
});

test("main: a failed run exits 1 and prints the fallback reason", async () => {
  const routes = {
    ...HAPPY_ROUTES,
    [`GET /api/gigs/${DEFAULT_GIG}`]: () => ({ json: { attempts: [{ id: "gatt-1", status: "failed", fallbackReason: "personas_failed", costUsd: 0.1 }] } }),
  };
  const { fetch } = fakeKp(routes);
  const log = sink();
  const code = await main([], { env: {}, log: log.fn, err: log.fn, fetch, sleep: async () => {} });
  assert.equal(code, EXIT.FAIL);
  assert.match(log.text(), /reason: personas_failed/);
});

test("main: --help prints usage and exits 0 without any request", async () => {
  const { fetch, calls } = fakeKp({});
  const log = sink();
  const code = await main(["--help"], { env: {}, log: log.fn, err: log.fn, fetch, sleep: async () => {} });
  assert.equal(code, EXIT.OK);
  assert.equal(calls.length, 0);
  assert.match(log.text(), /usage: node scripts\/gigs\/dry-run\.mjs/);
});
