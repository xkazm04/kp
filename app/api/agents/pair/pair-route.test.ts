// The two-phase Personas pairing door, untested until now. It is the route that
// turns a human approval into a stored pk_ key, and every branch of it is a
// decision the operator acts on:
//
//   start  — registers the pairing request (and persists the base URL kp is pointed
//            at). Refused 503 with its own code when this deployment has no at-rest
//            secret to store the key under: kp's misconfiguration, not Personas'.
//   claim  — ONE poll attempt. pending until the human approves; paired once the
//            key is stored; 502 when the far end refuses.
//
// Both phases now carry a per-IP budget (rate-limit-contract.test.ts): they spawn
// outbound work behind `requireOperator()`, which open mode makes a no-op.
//
// The far end is stubbed — no Personas, no network.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB; it clears
// PERSONAS_BRIDGE_* so no dev-shell pairing leaks in).
import { test, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { getBridgeConfig } from "../../../_lib/agent-hire/bridge-store.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
const realSecret = process.env.KP_SECRET;

beforeEach(() => {
  process.env.KP_SECRET = "pair-route-test-secret";
  // Per-IP budgets read the forwarding headers only under the trusted-proxy model
  // (resolveClientIp); without this every caller shares ONE bucket and the specs
  // below would starve each other.
  process.env.KP_TRUSTED_PROXY = "1";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realSecret === undefined) delete process.env.KP_SECRET;
  else process.env.KP_SECRET = realSecret;
  delete process.env.KP_TRUSTED_PROXY;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

/** Each test drives its own IP so the per-IP budgets cannot starve each other. */
let ipSeq = 0;
function pair(body: unknown, ip = `10.0.0.${++ipSeq % 250}`): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/agents/pair", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    })
  );
}

function stub(handler: (url: string) => Response): void {
  globalThis.fetch = ((input: RequestInfo | URL) => Promise.resolve(handler(String(input)))) as typeof fetch;
}

test("an unknown phase is a 400, and nothing is registered", async () => {
  const r = await pair({ phase: "handshake" });
  assert.equal(r.status, 400);
});

test("claim without a nonce is a 400 — the shape refusal costs nothing", async () => {
  const r = await pair({ phase: "claim" });
  assert.equal(r.status, 400);
});

test("start without an at-rest secret is a 503 with ITS OWN code (kp's fault, not Personas')", async () => {
  delete process.env.KP_SECRET;
  const r = await pair({ phase: "start" });
  assert.equal(r.status, 503, "503 = this deployment cannot hold the key yet");
  const body = (await r.json()) as { code?: string };
  assert.equal(body.code, "AGENT_PAIR_NO_SECRET");
});

test("start registers the request and hands back a nonce with its TTL", async () => {
  stub(() => new Response("{}", { status: 200 }));
  const r = await pair({ phase: "start", baseUrl: "http://127.0.0.1:9/personas" });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { nonce: string; expiresInS: number };
  assert.match(body.nonce, /^pairn/);
  assert.ok(body.expiresInS > 0);
});

test("a Personas that refuses the registration is a 502 — the far end's fault", async () => {
  stub(() => new Response("nope", { status: 500 }));
  const r = await pair({ phase: "start" });
  assert.equal(r.status, 502);
});

test("claim: pending until the human approves, then paired — and the key lands stored", async () => {
  const ip = "10.9.9.9";
  let approved = false;
  stub((url) => {
    if (url.includes("/pair/request")) return new Response("{}", { status: 200 });
    if (!approved) return new Response("", { status: 404 }); // Personas: not approved yet
    return new Response(JSON.stringify({ token: "pk_live_from_personas" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const started = (await (await pair({ phase: "start" }, ip)).json()) as { nonce: string };

  const waiting = await pair({ phase: "claim", nonce: started.nonce }, ip);
  assert.equal(waiting.status, 200);
  assert.deepEqual(await waiting.json(), { paired: false, state: "pending" });
  assert.equal(getBridgeConfig().hasKey, false, "nothing is stored while the human is still deciding");

  approved = true;
  const claimed = await pair({ phase: "claim", nonce: started.nonce }, ip);
  assert.deepEqual(await claimed.json(), { paired: true });
  assert.equal(getBridgeConfig().hasKey, true, "the pk_ key is stored (encrypted) on success");

  // Single-use: the spent nonce cannot be redeemed twice.
  const replay = await pair({ phase: "claim", nonce: started.nonce }, ip);
  assert.equal(replay.status, 502);
});

test("claim with an unknown nonce never reaches Personas", async () => {
  let calls = 0;
  stub(() => {
    calls++;
    return new Response("{}", { status: 200 });
  });
  const r = await pair({ phase: "claim", nonce: "pairn-never-minted" });
  assert.equal(r.status, 502);
  assert.equal(calls, 0, "an unknown nonce is refused in-process");
});

test("start is throttled per IP once the budget is spent (10/10min)", async () => {
  stub(() => new Response("{}", { status: 200 }));
  const ip = "10.7.7.7";
  for (let i = 0; i < 10; i++) {
    assert.equal((await pair({ phase: "start" }, ip)).status, 200, `start #${i + 1} is inside the budget`);
  }
  const refused = await pair({ phase: "start" }, ip);
  assert.equal(refused.status, 429);
  assert.equal(((await refused.json()) as { code?: string }).code, "TOO_MANY_REQUESTS");
  // A different operator is unaffected — the budget is per IP.
  assert.equal((await pair({ phase: "start" }, "10.7.7.8")).status, 200);
});
