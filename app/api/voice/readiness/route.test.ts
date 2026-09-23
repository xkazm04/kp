// challenge-r09 voice-provider-io/B, case 7: the /api/voice/readiness door.
//
//   - no home-org session -> 401 (requireHomeOrgReader; the body {error:"Unauthorized"}
//     is produced only by that gate);
//   - the probe is POST-only, IP-limited to 6 per 10 minutes (7th -> 429 TOO_MANY_REQUESTS);
//   - KP_OFFLINE refuses the probe up front (503 VOICE_READINESS_OFFLINE) and the GET
//     says so, so the strip can disable the button instead of offering a door that 503s;
//   - a 200 body is a PROJECTION: never the minted clientSecret, signedUrl or callsUrl;
//   - an unexpected throw answers VOICE_READINESS_FAILED through safeJsonError.
//
// Keyless: provider fetches are stubbed by URL. unit-db.ts must stay the first project
// import (isolated throwaway DB).
import { test, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

after(() => cleanupUnitDb());

const VARS = [
  "KP_OPERATOR_PASSWORD",
  "KP_OFFLINE",
  "KP_TRUSTED_PROXY",
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_AGENT_ID",
  "ELEVENLABS_BASE_URL",
];
function env(values: Record<string, string>) {
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, { KP_TRUSTED_PROXY: "1" }, values);
}
afterEach(() => {
  mock.restoreAll();
  for (const k of VARS) delete process.env[k];
});

type Route = typeof import("./route.ts");
let route: Route | null = null;
const handlers = async () => (route ??= (await import("./route.ts")) as Route);

let ipSeq = 0;
const post = (ip = `203.0.113.${++ipSeq}`) =>
  new Request("http://localhost/api/voice/readiness", { method: "POST", headers: { "x-forwarded-for": ip } });

const SECRET = "ek_readiness_SECRET_value";
const SIGNED = "wss://voice.example/signed?token=SIGNED_url_value";

function stubProviders() {
  mock.method(globalThis, "fetch", async (url: unknown) => {
    const u = String(url);
    if (u.includes("client_secrets")) {
      return new Response(JSON.stringify({ value: SECRET, expires_at: Math.floor(Date.now() / 1000) + 120 }), { status: 200 });
    }
    if (u.includes("get-signed-url")) return new Response(JSON.stringify({ signed_url: SIGNED }), { status: 200 });
    throw new TypeError(`unexpected fetch ${u}`);
  });
}

test("no home-org session: GET and POST answer 401 before anything is read or minted", async () => {
  env({ KP_OPERATOR_PASSWORD: "pw", OPENAI_API_KEY: "sk" });
  const minted = mock.method(globalThis, "fetch", async () => {
    throw new Error("must not mint");
  });
  const { GET, POST } = await handlers();
  const g = await GET();
  assert.equal(g.status, 401);
  assert.deepEqual(await g.json(), { error: "Unauthorized" });
  const p = await POST(post());
  assert.equal(p.status, 401);
  assert.equal(minted.mock.callCount(), 0);
});

test("a 200 probe body carries verdicts, never the minted credential", async () => {
  env({ OPENAI_API_KEY: "sk", ELEVENLABS_API_KEY: "xi", ELEVENLABS_AGENT_ID: "agent-x" });
  stubProviders();
  const { POST } = await handlers();
  const res = await POST(post());
  assert.equal(res.status, 200);
  const body = await res.json();
  const text = JSON.stringify(body);
  for (const leak of [SECRET, SIGNED, "https://api.openai.com/v1/realtime/calls"]) {
    assert.ok(!text.includes(leak), `the body must not carry ${leak}`);
  }
  const states = Object.fromEntries(body.providers.map((r: { provider: string; state: string }) => [r.provider, r.state]));
  assert.deepEqual(states, { openai: "ready", elevenlabs: "ready" });
});

test("GET is cheap: it reports the remembered verdicts and mints nothing", async () => {
  env({ OPENAI_API_KEY: "sk", ELEVENLABS_API_KEY: "xi", ELEVENLABS_AGENT_ID: "agent-x" });
  const minted = mock.method(globalThis, "fetch", async () => {
    throw new Error("a GET must not mint");
  });
  const { GET } = await handlers();
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(minted.mock.callCount(), 0);
  assert.equal(body.offline, false);
  assert.equal(body.canProbe, true);
  assert.ok(Array.isArray(body.providers) && body.providers.length === 2);
});

test("the 7th probe from one IP inside 10 minutes is refused 429 TOO_MANY_REQUESTS", async () => {
  env({}); // nothing configured: every row is absent, so no mint is spent on the way
  const { POST } = await handlers();
  const ip = "198.51.100.77";
  for (let i = 1; i <= 6; i++) assert.equal((await POST(post(ip))).status, 200, `probe ${i} is admitted`);
  const refused = await POST(post(ip));
  assert.equal(refused.status, 429);
  assert.equal((await refused.json()).code, "TOO_MANY_REQUESTS");
  assert.equal((await POST(post("198.51.100.78"))).status, 200, "another IP has its own budget");
});

test("KP_OFFLINE refuses the probe (503) and the GET tells the strip so", async () => {
  env({ KP_OFFLINE: "1", OPENAI_API_KEY: "sk" });
  const minted = mock.method(globalThis, "fetch", async () => {
    throw new Error("offline must not mint");
  });
  const { GET, POST } = await handlers();
  const p = await POST(post());
  assert.equal(p.status, 503);
  assert.equal((await p.json()).code, "VOICE_READINESS_OFFLINE");
  const g = await GET();
  assert.equal((await g.json()).offline, true);
  assert.equal(minted.mock.callCount(), 0);
});

test("an unexpected throw answers VOICE_READINESS_FAILED, not the raw message", async () => {
  env({});
  const { ensureDb } = await import("../../../_lib/db/core.ts");
  const { GET } = await handlers();
  const quiet = mock.method(console, "error", () => {});
  ensureDb().close(); // the failover read now throws "The database connection is not open"
  const res = await GET();
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.code, "VOICE_READINESS_FAILED");
  assert.ok(!JSON.stringify(body).includes("not open"), "the raw error stays in the server log");
  assert.ok(quiet.mock.callCount() >= 1);
});
