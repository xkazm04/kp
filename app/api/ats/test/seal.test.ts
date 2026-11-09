// C3 — the ATS test probe under the egress seal: 0 fetches, and an answer that says
// 'sealed' apart from "not configured".
//
// unit-db.ts must stay the first project import.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { setAtsConfig } from "../../../_lib/ats-config-store.ts";

after(() => cleanupUnitDb());
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KP_NO_COMMS_EGRESS;
});

test("POST /api/ats/test under the seal: 0 fetches, result 'sealed'", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  process.env.KP_NO_COMMS_EGRESS = "1";
  const res = await POST(new NextRequest("http://localhost/api/ats/test", { method: "POST" }));
  assert.equal(calls.length, 0, `no fetch under the seal, saw: ${calls.join(", ")}`);
  const body = (await res.json()) as { ok: boolean; sealed?: boolean; reason?: string };
  assert.equal(body.ok, false);
  assert.equal(body.sealed, true);
  assert.equal(body.reason, "sealed");
});
