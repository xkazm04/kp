// C3 — the relay test probe under the egress seal: 0 fetches, and an answer that says
// 'sealed' apart from "No relay configured".
//
// unit-db.ts must stay the first project import.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";

after(() => cleanupUnitDb());
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KP_NO_COMMS_EGRESS;
  delete process.env.COMMS_WEBHOOK_URL;
});

test("POST /api/comms/relay/test under the seal: 0 fetches, result 'sealed' (not 'No relay configured')", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  process.env.KP_NO_COMMS_EGRESS = "1";
  const res = await POST(new NextRequest("http://localhost/api/comms/relay/test", { method: "POST" }));
  assert.equal(calls.length, 0, `no fetch under the seal, saw: ${calls.join(", ")}`);
  const body = (await res.json()) as { ok: boolean; sealed?: boolean; reason?: string };
  assert.equal(body.ok, false);
  assert.equal(body.sealed, true);
  assert.equal(body.reason, "sealed");
});
