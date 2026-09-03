// The bridge status/disconnect door, untested until now. Two properties matter:
//
//   1. the pk_ key is WRITE-ONLY — GET reports whether one exists, never what it is;
//   2. DELETE refuses (409) when the connection comes from PERSONAS_BRIDGE_URL/KEY.
//      Env beats the stored row by design (resolveRelay precedence), so "clearing"
//      the row would leave the deployment paired while the panel showed it
//      disconnected — a lie the operator would act on.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB; it clears
// PERSONAS_BRIDGE_* so no dev-shell pairing leaks in).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { DELETE, GET } from "./route.ts";
import { setBridgeConfig } from "../../../_lib/agent-hire/bridge-store.ts";

// Storing a pk_ key encrypts it at rest (bridge-store → ats-secret).
process.env.KP_SECRET = process.env.KP_SECRET || "bridge-route-test-secret";

after(() => cleanupUnitDb());
afterEach(() => {
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

type BridgeBody = { bridge: { baseUrl: string; hasKey: boolean; paired: boolean; source: string }; error?: string };

test("GET reports the connection without ever carrying the key", async () => {
  const r = await GET();
  assert.equal(r.status, 200);
  const raw = await r.text();
  const body = JSON.parse(raw) as BridgeBody;
  assert.ok(typeof body.bridge.hasKey === "boolean", "presence, not material");
  assert.ok(!/pk_/.test(raw), "no pk_ key may appear anywhere in the response");
});

test("DELETE clears a STORED key and keeps the base URL, so a re-pair is one click", async () => {
  setBridgeConfig({ baseUrl: "http://127.0.0.1:9/personas", apiKey: "pk_stored_secret" });
  assert.equal(((await (await GET()).json()) as BridgeBody).bridge.hasKey, true);

  const r = await DELETE();
  assert.equal(r.status, 200);
  const body = (await r.json()) as BridgeBody;
  assert.equal(body.bridge.hasKey, false, "the key is gone");
  assert.equal(body.bridge.baseUrl, "http://127.0.0.1:9/personas", "the URL the operator typed survives");
});

test("DELETE on an ENV-driven connection is a 409, not a pretend disconnect", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9/personas";
  process.env.PERSONAS_BRIDGE_KEY = "pk_from_env";
  assert.equal(((await (await GET()).json()) as BridgeBody).bridge.source, "env");

  const r = await DELETE();
  assert.equal(r.status, 409, "env beats the stored row — clearing it would disconnect nothing");
  // …and the connection is still live afterwards.
  assert.equal(((await (await GET()).json()) as BridgeBody).bridge.hasKey, true);
});
