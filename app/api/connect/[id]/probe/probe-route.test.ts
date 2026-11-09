// C5 — the connector hub's probe door: under the seal it answers {health:"sealed"} with 0
// fetches, it probes a configured row on request, it never carries a secret value, an
// unknown id is a bare 404, and `smtp` is NEVER probed through it (operator rule,
// 2026-10-28: a probe of smtp is a real letter, which only the owner-pressed Send test sends).
//
// unit-db.ts must stay the first project import.
import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { setAtsConnection, deleteAtsConnection, ATS_PROVIDERS } from "../../../../_lib/ats/connections-store.ts";
import { setSmtpConfig } from "../../../../_lib/comms-smtp-store.ts";
import { setRelayHostLookupForTests } from "../../../../_lib/comms.ts";
import { setAtsHostLookupForTests } from "../../../../_lib/connect/probes.ts";
import { resetConnectMemoryForTests } from "../../../../_lib/connect/catalog.ts";

const TOKEN = "ats-probe-route-token-do-not-leak-51c0";
const SMTP_PASSWORD = "smtp-probe-route-password-do-not-leak-0d2a";

const realFetch = globalThis.fetch;
let calls: string[] = [];

beforeEach(() => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  delete process.env.KP_NO_COMMS_EGRESS;
  delete process.env.COMMS_WEBHOOK_URL;
  for (const p of ATS_PROVIDERS) deleteAtsConnection(p);
  resetConnectMemoryForTests();
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  setAtsHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  setAtsHostLookupForTests(undefined);
  delete process.env.KP_NO_COMMS_EGRESS;
  delete process.env.COMMS_WEBHOOK_URL;
});
after(() => cleanupUnitDb());

let ip = 0;
function probe(id: string) {
  // A fresh client address per call: the limiter is per IP, and these tests are not about it.
  const req = new NextRequest(`http://localhost/api/connect/${encodeURIComponent(id)}/probe`, {
    method: "POST",
    headers: { "x-forwarded-for": `198.51.100.${++ip}` },
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

test("under the seal POST /api/connect/comms_relay/probe answers {health:'sealed'} with 0 fetches", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  process.env.KP_NO_COMMS_EGRESS = "1";
  const res = await probe("comms_relay");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { health: string };
  assert.equal(body.health, "sealed");
  assert.equal(calls.length, 0, `no fetch under the seal, saw: ${calls.join(", ")}`);
});

test("a configured connector is probed on request and the answer carries no secret value", async () => {
  setAtsConnection({ provider: "recruitee", baseUrl: "https://api.recruitee.com", apiToken: TOKEN });
  const res = await probe("ats_inbound:recruitee");
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(TOKEN), "the token never rides the answer");
  const body = JSON.parse(text) as { health: string; connector: { id: string } };
  assert.equal(body.health, "connected");
  assert.equal(body.connector.id, "ats_inbound:recruitee");
  assert.equal(calls.length, 1, "exactly the one probe request");
});

test("keyless: a probe of an unconfigured row reads not_configured and dials nothing", async () => {
  const res = await probe("ats_webhook");
  assert.equal(((await res.json()) as { health: string }).health, "not_configured");
  assert.equal(calls.length, 0);
});

test("an unknown connector id is a bare 404", async () => {
  const res = await probe("ftp");
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

test("smtp is never probed through the hub: no letter, no socket, the Send test door is named", async () => {
  setSmtpConfig({ preset: "seznam", address: "owner@seznam.cz", password: SMTP_PASSWORD });
  let sockets = 0;
  const realConnect = net.connect;
  const realTlsConnect = tls.connect;
  net.connect = ((...a: unknown[]) => (sockets++, (realConnect as (...x: unknown[]) => net.Socket)(...a))) as typeof net.connect;
  tls.connect = ((...a: unknown[]) => (sockets++, (realTlsConnect as (...x: unknown[]) => tls.TLSSocket)(...a))) as typeof tls.connect;
  try {
    const res = await probe("smtp");
    assert.equal(res.status, 409);
    const text = await res.text();
    assert.ok(!text.includes(SMTP_PASSWORD), "the password never rides the answer");
    const body = JSON.parse(text) as { health: string; door: string };
    assert.equal(body.door, "send_test");
    assert.equal(body.health, "unverified", "config-only health: saved, never checked by the hub");
    assert.equal(sockets, 0, "no SMTP socket was opened");
    assert.equal(calls.length, 0);
  } finally {
    net.connect = realConnect;
    tls.connect = realTlsConnect;
  }
});
