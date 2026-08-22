// Unit coverage for the agent-hire seam pieces that need no Python and no live
// Personas: the report-payload trust boundary, the CLI-envelope parse contract
// (the TS half of the transform), and the connector-catalog fallback.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { parseAgentReport } from "./report-payload.ts";
import { toAgentFitEnvelope } from "./transform-run.ts";
import {
  BUILTIN_CONNECTOR_CATALOG,
  dispatchPersonaRequest,
  fetchConnectorCatalog,
  fetchRequestStatus,
} from "./bridge-client.ts";
import { startPairing } from "./pairing.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

test("report payload: bounds and shapes are enforced at the trust boundary", () => {
  const ok = parseAgentReport({
    kind: "execution",
    execId: "run-1",
    costUsd: 0.5,
    tokensIn: 10.6,
    status: "success",
    connectorUses: [{ connector: "gmail", calls: 3 }, { junk: true }, null],
  });
  assert.ok(ok.ok);
  if (ok.ok && ok.report.kind === "execution") {
    assert.equal(ok.report.tokensIn, 11, "counts are rounded to integers");
    assert.deepEqual(ok.report.connectorUses, [{ connector: "gmail", calls: 3 }], "junk connector rows are dropped");
  }

  // Negative / non-finite money can never reach the ledger.
  const dirty = parseAgentReport({ kind: "execution", execId: "e", status: "failure", costUsd: -3, durationMs: Infinity });
  assert.ok(dirty.ok);
  if (dirty.ok && dirty.report.kind === "execution") {
    assert.equal(dirty.report.costUsd, null);
    assert.equal(dirty.report.durationMs, null);
  }

  // A rollup can never claim more outcomes than runs: getAgentAggregates divides
  // successes by runs, so {runs:2, successes:5} rendered "250% success" on the
  // roster and scored a ✓ against the "≥ 90% success" expectation. A reported
  // success implies a run, so runs is corrected upward — and the period's spend,
  // the reason the row exists, still lands.
  const skewed = parseAgentReport({ kind: "rollup", period: "2026-08", runs: 2, successes: 5, failures: 1, costUsd: 1.2 });
  assert.ok(skewed.ok);
  if (skewed.ok && skewed.report.kind === "rollup") {
    assert.equal(skewed.report.runs, 6);
    assert.equal(skewed.report.successes, 5);
    assert.equal(skewed.report.failures, 1);
    assert.ok(skewed.report.successes <= skewed.report.runs, "a success rate can never exceed 100%");
    assert.equal(skewed.report.costUsd, 1.2);
  }
  // A consistent rollup is passed through untouched.
  const consistent = parseAgentReport({ kind: "rollup", period: "2026-08", runs: 41, successes: 39, failures: 2 });
  assert.ok(consistent.ok && consistent.report.kind === "rollup" && consistent.report.runs === 41);

  assert.equal(parseAgentReport({ kind: "rollup", period: "08-2026" }).ok, false, "period must be YYYY-MM[-DD]");
  assert.ok(parseAgentReport({ kind: "rollup", period: "2026-08-04" }).ok, "daily rollups are allowed");
  assert.equal(parseAgentReport([1, 2]).ok, false);
  assert.equal(parseAgentReport({ kind: "lifecycle", event: "paused" }).ok, false, "unknown lifecycle events are rejected");
});

test("transform envelope: a well-formed CLI payload parses; a truncated one fails loudly", () => {
  const good = toAgentFitEnvelope({
    result: {
      fit: { verdict: "unassessed", coverage: [{ item: "SQL", coverage: "assisted", rationale: "r" }], coverageRatio: 0.5 },
      spec: { name: "A", mission: "m", systemPromptDraft: "s", connectors: ["postgres"], maxTurns: null },
      budget: { suggestedMonthlyUsd: 43.48, rule: "2% of salary-band midpoint", salaryBandRef: "40000–60000 CZK/month" },
      metrics: [{ key: "runs_per_week", label: "Runs", target: 5, unit: "runs", direction: "gte" }],
      promptVersion: "agent-fit-v1",
    },
    source: "deterministic",
    perStepSources: { agentFit: "deterministic" },
  });
  assert.equal(good.source, "deterministic");
  assert.equal(good.result.budget.rule, "2% of salary-band midpoint");

  assert.throws(() => toAgentFitEnvelope({ result: { fit: {} } }), /unexpected envelope/);
  assert.throws(() => toAgentFitEnvelope(null), /unexpected envelope/);
});

test("connector catalog: Personas 404 (route not shipped yet) falls back to the built-in list", async () => {
  globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
  const r = await fetchConnectorCatalog();
  assert.equal(r.source, "builtin");
  assert.equal(r.connectors, BUILTIN_CONNECTOR_CATALOG);
  assert.ok(r.connectors.some((c) => c.name === "gmail"));
});

// The bridge target is loopback BY DESIGN, but "by design" describes the URL we
// DIAL — with the default `redirect: "follow"` undici re-dials whatever the answer
// points at, and a 307/308 replays method AND body. The dispatch body carries
// `reportToken`: the ONLY auth on the PUBLIC POST /api/agents/report/[token]
// route, so whoever received that replay could move the agent to Hired and post
// fabricated spend with no session at all. NON-VACUITY: pre-fix `init.redirect`
// is undefined on every one of these calls.
test("bridge calls never FOLLOW a redirect (the dispatch body carries the report token)", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  const inits: (RequestInit | undefined)[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    inits.push(init);
    // What the fetch spec produces for redirect:"manual" — an opaque-redirect
    // response (status 0, ok false), never the redirect target's body.
    return { ok: false, status: 0, type: "opaqueredirect", json: async () => ({}) };
  }) as unknown as typeof fetch;

  const spec = { name: "A", mission: "m", systemPromptDraft: "s", connectors: [], maxBudgetUsd: 10, successMetrics: [] };
  const kp = { baseUrl: "http://localhost:3000", jobId: "job-1", jobTitle: "Role", workspace: "ws-a" };
  const dispatched = await dispatchPersonaRequest(spec, kp, "agrpt-secret-token");
  assert.equal(inits[0]?.redirect, "manual", "the dispatch POST must not follow a 3xx — a 307 replays the report token");
  assert.equal(dispatched.ok, false, "a redirect is not an acceptance of the hire");
  if (!dispatched.ok) assert.match(dispatched.error, /redirect/i);

  const polled = await fetchRequestStatus("pr-1");
  assert.equal(inits[1]?.redirect, "manual");
  assert.equal(polled.ok, false, "…and it is not a status either");

  const started = await startPairing();
  assert.equal(inits[2]?.redirect, "manual", "the pairing request carries the nonce that redeems the pk_ key");
  assert.equal(started.ok, false);

  const catalog = await fetchConnectorCatalog();
  assert.equal(inits[3]?.redirect, "manual");
  assert.equal(catalog.source, "builtin", "a redirecting catalog degrades to the built-in list");
});

test("connector catalog: a live Personas catalog wins over the built-in list", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ connectors: [{ name: "custom-crm", description: "CRM ops" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const r = await fetchConnectorCatalog();
  assert.equal(r.source, "personas");
  assert.deepEqual(r.connectors, [{ name: "custom-crm", description: "CRM ops" }]);
});
