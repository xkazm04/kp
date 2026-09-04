// The connector catalog is the Agent-fit tab's one window onto Personas, and it
// had no test. Its whole contract is the DEGRADE: an unpaired or unreachable
// Personas must still serve a usable list, and `source` must say honestly which
// one answered — a built-in list labelled "personas" would tell the operator their
// bridge is working when it is not.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB; it clears
// KP_OPERATOR_PASSWORD → open mode, and PERSONAS_BRIDGE_* so no dev-shell pairing
// leaks in).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { GET } from "./route.ts";

/** The door is per-IP throttled (60/10 min, pinned in rate-limit-contract.test.ts),
 *  so it reads the caller's headers — a handful of calls stays far under. */
const req = () => new NextRequest("http://localhost/api/agents/catalog");

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

type CatalogBody = { connectors: Array<{ name: string; description: string }>; source: string };

test("an unreachable Personas degrades to the built-in list, and SAYS so", async () => {
  globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch;
  const r = await GET(req());
  assert.equal(r.status, 200, "the catalog never fails the tab — the chips must render");
  const body = (await r.json()) as CatalogBody;
  assert.equal(body.source, "builtin");
  assert.ok(body.connectors.length > 0, "the fallback is a real list, not an empty one");
  assert.ok(body.connectors.every((c) => c.name), "every entry is nameable");
});

test("a paired Personas serves ITS catalog, labelled personas", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9/personas";
  process.env.PERSONAS_BRIDGE_KEY = "pk_test";
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ connectors: [{ key: "hubspot", name: "HubSpot", description: "CRM" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )) as typeof fetch;

  const body = (await (await GET(req())).json()) as CatalogBody;
  assert.equal(body.source, "personas");
  assert.deepEqual(body.connectors, [{ name: "HubSpot", description: "CRM" }]);
});

test("a Personas that answers with an EMPTY catalog falls back rather than offering nothing", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9/personas";
  process.env.PERSONAS_BRIDGE_KEY = "pk_test";
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ connectors: [] }), { status: 200, headers: { "content-type": "application/json" } }))) as typeof fetch;

  const body = (await (await GET(req())).json()) as CatalogBody;
  assert.equal(body.source, "builtin", "an empty answer is not a catalog");
  assert.ok(body.connectors.length > 0);
});
