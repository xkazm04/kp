// C4 — the connector catalog's contract: every row answers exactly one health word, a
// token saved without a probe reads `unverified`, the seal turns every row to `sealed`
// with 0 fetches, and a keyless checkout reads every row `not_configured` without a
// secret value anywhere in the response.
//
// unit-db.ts must stay the first project import.
import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { GET } from "../../api/connect/route.ts";
import { setAtsConnection, deleteAtsConnection, ATS_PROVIDERS } from "../ats/connections-store.ts";
import { setAtsConfig } from "../ats-config-store.ts";
import { setRelayHostLookupForTests } from "../comms.ts";
import { setAtsHostLookupForTests } from "./probes.ts";
import { CONNECTOR_IDS, HEALTH_WORDS, listConnectors, probeConnector, resetConnectMemoryForTests } from "./catalog.ts";

const WS = "default";
const TOKEN = "ats-live-token-do-not-leak-9f3a";
const SIGNING = "relay-signing-secret-do-not-leak-77c1";

const realFetch = globalThis.fetch;
let calls: string[] = [];

function spyFetch(status = 200): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("{}", { status });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  delete process.env.KP_NO_COMMS_EGRESS;
  delete process.env.COMMS_WEBHOOK_URL;
  for (const p of ATS_PROVIDERS) deleteAtsConnection(p);
  resetConnectMemoryForTests();
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  setAtsHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  spyFetch();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  setAtsHostLookupForTests(undefined);
  delete process.env.KP_NO_COMMS_EGRESS;
  delete process.env.COMMS_WEBHOOK_URL;
});
after(() => cleanupUnitDb());

const row = (id: string) => {
  const r = listConnectors(WS).find((c) => c.id === id);
  assert.ok(r, `row ${id}`);
  return r;
};

test("every row answers exactly one health word", () => {
  const rows = listConnectors(WS);
  assert.deepEqual(rows.map((r) => r.id), [...CONNECTOR_IDS]);
  for (const r of rows) {
    assert.equal(HEALTH_WORDS.filter((w) => w === r.health).length, 1, `${r.id} -> ${r.health}`);
  }
});

test("keyless: GET /api/connect reads every row not_configured and carries no secret value", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text) as { connectors: ReturnType<typeof listConnectors> };
  assert.equal(body.connectors.length, CONNECTOR_IDS.length);
  for (const c of body.connectors) {
    assert.equal(c.health, "not_configured", c.id);
    for (const f of c.fields.filter((f) => f.secret)) assert.equal("value" in f, false, `${c.id}.${f.key} carries no value`);
  }
  assert.equal(calls.length, 0);
});

test("a token saved without a probe reads unverified; the secret never rides the row", () => {
  setAtsConnection({
    provider: "recruitee",
    baseUrl: "https://api.recruitee.com",
    apiToken: TOKEN,
    fieldMap: { paths: { externalId: "id", displayName: "name" }, stages: {} },
  });
  const r = row("ats_inbound:recruitee");
  assert.equal(r.health, "unverified");
  assert.equal(r.lastOkAt, null);
  assert.equal(r.fields.find((f) => f.key === "apiToken")?.hasSecret, true);
  assert.equal(JSON.stringify(listConnectors(WS)).includes(TOKEN), false);
});

test("a probe moves the row to connected / failing, and a re-save drops it back to unverified", async () => {
  setAtsConnection({
    provider: "recruitee",
    baseUrl: "https://api.recruitee.com",
    apiToken: TOKEN,
    fieldMap: { paths: { externalId: "id", displayName: "name" }, stages: {} },
  });
  const ok = await probeConnector("ats_inbound:recruitee", WS, new Date("2026-10-22T10:00:00Z"));
  assert.equal(ok.health, "connected");
  assert.equal(ok.lastOkAt, "2026-10-22T10:00:00.000Z");
  assert.equal(calls.length, 1);

  spyFetch(401);
  const bad = await probeConnector("ats_inbound:recruitee", WS, new Date("2026-10-22T11:00:00Z"));
  assert.equal(bad.health, "failing");
  assert.equal(bad.lastFailure?.reason, "HTTP 401");
  assert.equal(bad.lastOkAt, "2026-10-22T10:00:00.000Z", "the earlier success is kept");

  setAtsConnection({ provider: "recruitee", baseUrl: "https://api.recruitee.com", expectedVersion: 1 });
  assert.equal(row("ats_inbound:recruitee").health, "unverified");
});

test("an ATS webhook saved without a probe reads unverified", () => {
  setAtsConfig({ webhookUrl: "https://hooks.example.com/x", webhookSecret: SIGNING, events: ["candidate.hired"] });
  assert.equal(row("ats_webhook").health, "unverified");
  assert.equal(JSON.stringify(listConnectors(WS)).includes(SIGNING), false);
});

test("the relay row follows the env relay and probes through the shared ping", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  assert.equal(row("comms_relay").health, "unverified");
  const r = await probeConnector("comms_relay", WS);
  assert.equal(r.health, "connected");
  assert.deepEqual(calls, ["https://relay.example.test/hook"]);
});

// The guard vets the relay URL only. With fetch's default `redirect: "follow"` a public
// relay answering `307 Location: http://169.254.169.254/…` had undici replay the signed
// POST there and report the internal host's status as the relay's: an SSRF hop plus a
// reachability oracle. This fake follows exactly as undici would unless told "manual".
test("the relay probe never follows a redirect: the hop is a failure, not a second request", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url) !== "https://relay.example.test/hook") return new Response("{}", { status: 200 });
    if (init?.redirect !== "manual") return globalThis.fetch("http://169.254.169.254/latest/meta-data", init);
    return new Response(null, { status: 307, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  }) as typeof fetch;
  const r = await probeConnector("comms_relay", WS);
  assert.deepEqual(calls, ["https://relay.example.test/hook"]);
  assert.equal(r.health, "failing");
  assert.match(r.lastFailure?.reason ?? "", /redirect/);
});

test("under the seal every row reads sealed and probes make 0 fetches", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setAtsConnection({
    provider: "recruitis",
    baseUrl: "https://api.recruitis.io",
    apiToken: TOKEN,
    fieldMap: { paths: { externalId: "id", displayName: "name" }, stages: {} },
  });
  setAtsConfig({ webhookUrl: "https://hooks.example.com/x", events: ["candidate.hired"] });
  process.env.KP_NO_COMMS_EGRESS = "1";
  for (const r of listConnectors(WS)) assert.equal(r.health, "sealed", r.id);
  for (const id of CONNECTOR_IDS) assert.equal((await probeConnector(id, WS)).health, "sealed", id);
  assert.equal(calls.length, 0, `no fetch under the seal, saw: ${calls.join(", ")}`);
});
