// The dispatch path stops paying a full bridge timeout per call once Personas has been
// failing, and recovers through a single half-open probe.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  BREAKER_COOLDOWN_MS,
  BREAKER_THRESHOLD,
  bridgeCircuitOpen,
  recordBridgeFailure,
  recordBridgeSuccess,
  resetBridgeBreaker,
} from "./bridge-breaker.ts";
import { BRIDGE_CIRCUIT_OPEN_MESSAGE as OPEN_MSG } from "./bridge-breaker.ts";
import { dispatchPersonaRequest } from "./bridge-client.ts";

after(() => cleanupUnitDb());
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetBridgeBreaker();
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
  delete process.env.KP_SECRET;
});

test("opens after the threshold, probes once after the cooldown, closes on success", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) recordBridgeFailure(t0);
  assert.equal(bridgeCircuitOpen(t0), false, "below the threshold stays closed");
  recordBridgeFailure(t0);
  assert.equal(bridgeCircuitOpen(t0 + 1), true);
  assert.equal(bridgeCircuitOpen(t0 + BREAKER_COOLDOWN_MS - 1), true);
  assert.equal(bridgeCircuitOpen(t0 + BREAKER_COOLDOWN_MS), false, "first caller after cooldown is the probe");
  assert.equal(bridgeCircuitOpen(t0 + BREAKER_COOLDOWN_MS), true, "a concurrent caller still fails fast");
  recordBridgeSuccess();
  assert.equal(bridgeCircuitOpen(t0 + BREAKER_COOLDOWN_MS), false);
});

test("a failed probe re-opens for a full cooldown", () => {
  const t0 = 2_000_000;
  for (let i = 0; i < BREAKER_THRESHOLD; i++) recordBridgeFailure(t0);
  assert.equal(bridgeCircuitOpen(t0 + BREAKER_COOLDOWN_MS), false);
  recordBridgeFailure(t0 + BREAKER_COOLDOWN_MS);
  assert.equal(bridgeCircuitOpen(t0 + BREAKER_COOLDOWN_MS + 1), true);
});

test("dispatchPersonaRequest short-circuits without fetching once Personas keeps failing", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9";
  process.env.PERSONAS_BRIDGE_KEY = "pk_test";
  process.env.KP_SECRET = "unit-test-secret";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  }) as typeof fetch;
  const spec = { name: "n" } as never;
  const kp = {} as never;
  for (let i = 0; i < BREAKER_THRESHOLD; i++) await dispatchPersonaRequest(spec, kp, "tok");
  assert.equal(calls, BREAKER_THRESHOLD);
  const fast = await dispatchPersonaRequest(spec, kp, "tok");
  assert.equal(calls, BREAKER_THRESHOLD, "no further network attempt while open");
  assert.deepEqual(fast, { ok: false, error: OPEN_MSG });
});

test("a 401 (Personas answering) never trips the breaker", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9";
  process.env.PERSONAS_BRIDGE_KEY = "pk_test";
  process.env.KP_SECRET = "unit-test-secret";
  globalThis.fetch = (async () => new Response("no", { status: 401 })) as typeof fetch;
  for (let i = 0; i < BREAKER_THRESHOLD + 2; i++) await dispatchPersonaRequest({} as never, {} as never, "tok");
  assert.equal(bridgeCircuitOpen(), false);
});
