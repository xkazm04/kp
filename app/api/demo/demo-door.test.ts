// The public demo door tells the truth about what it can deliver.
//
// GET /api/demo used to mint an anonymous "demo"-workspace session on a gated
// deploy and land the prospect on `/?sim=auto`. That session cannot run the walk:
// `resolveCaller()` maps a DEMO_WORKSPACE session to `{ authed: false, caps:
// EMPTY_CAPS }`, so the walk's first write (POST /api/jds/save, `jd:write`)
// answers 401 — and nothing seeds the demo tenant, so even a permitted walk would
// source nobody. The tour narrated four confident steps and then died.
//
// So the gated deploy refuses HERE, with a code the landing renders, and only the
// OPEN deploy (where the proxy passes through and the caller folds to owner) still
// lands on the run. Two reasons, because they are two different operator answers:
// DEMO_DISABLED (flip KP_DEMO_ENABLED) vs DEMO_NOT_PROVISIONED (nothing to flip —
// the demo tenant has no capabilities and no corpus).
//
// Pure route: no DB, no next/headers. The handler only reads env + the request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { GET } = await import("./route.ts");
const { NextRequest } = await import("next/server");

// A distinct IP per case: the door is per-IP rate limited (12 / 10 min) and the
// limiter is process-global, so sharing one would leak between cases.
let ip = 0;
function call(env: Record<string, string | undefined>) {
  for (const key of ["KP_SECRET", "KP_DEMO_ENABLED", "KP_MULTI_WORKSPACE"]) delete process.env[key];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  const req = new NextRequest("http://localhost:3000/api/demo", {
    headers: { "x-forwarded-for": `10.0.0.${++ip}` },
  });
  return GET(req);
}

function location(res: Response): string {
  const raw = res.headers.get("location") ?? "";
  return raw.replace(/^https?:\/\/[^/]+/, "");
}

test("open deploy (no KP_SECRET): the run is reachable and no cookie is minted", async () => {
  const res = await call({});
  assert.equal(res.status, 307);
  assert.equal(location(res), "/?sim=auto", "an open deploy still lands on the auto-starting run");
  assert.equal(res.headers.get("set-cookie"), null, "signSession() would throw without the secret — nothing to set");
});

test("gated + demo ENABLED: refused as not provisioned, never minted", async () => {
  const res = await call({ KP_SECRET: "demo-door-secret", KP_DEMO_ENABLED: "1" });
  assert.equal(location(res), "/?demo=unavailable&code=DEMO_NOT_PROVISIONED");
  assert.equal(
    res.headers.get("set-cookie"),
    null,
    "the session the walk cannot use must not be minted: EMPTY_CAPS 401s at /api/jds/save"
  );
});

test("gated + demo DISABLED: refused with the reason the operator can act on", async () => {
  const res = await call({ KP_SECRET: "demo-door-secret" });
  assert.equal(location(res), "/?demo=unavailable&code=DEMO_DISABLED");
  assert.equal(res.headers.get("set-cookie"), null);
});

test("KP_MULTI_WORKSPACE alone reaches the same refusal, not a mint", async () => {
  // demoSessionAllowed() is true under multi-workspace, which used to be a mint.
  const res = await call({ KP_SECRET: "demo-door-secret", KP_MULTI_WORKSPACE: "1" });
  assert.equal(location(res), "/?demo=unavailable&code=DEMO_NOT_PROVISIONED");
  assert.equal(res.headers.get("set-cookie"), null);
});

test("the rate limit still fires before any of it", async () => {
  const headers = { "x-forwarded-for": "10.9.9.9" };
  let last: Response | null = null;
  for (let i = 0; i < 14; i++) {
    last = await GET(new NextRequest("http://localhost:3000/api/demo", { headers }));
  }
  assert.equal(last!.status, 429, "the 13th call in the window is refused");
});
