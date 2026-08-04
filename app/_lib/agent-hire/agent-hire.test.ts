// Unit coverage for the agent-hire seam pieces that need no Python and no live
// Personas: the report-payload trust boundary, the CLI-envelope parse contract
// (the TS half of the transform), and the connector-catalog fallback.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { parseAgentReport } from "./report-payload.ts";
import { toAgentFitEnvelope } from "./transform-run.ts";
import { BUILTIN_CONNECTOR_CATALOG, fetchConnectorCatalog } from "./bridge-client.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
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
