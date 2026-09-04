// The command palette's search door, which had no test of any kind.
//
// One hit is five `LIKE '%q%'` scans (app/_lib/db/analytics.ts searchEntities):
// leading wildcards, so no index applies and each is a full walk of profiles /
// pipeline_entries / jds / jobs / analyses. It is the most expensive read per byte of
// input in the app, it is reachable unauthenticated in open mode, and it carried no
// limiter at all. What this file pins:
//
//   1. a sub-minimum query is served free — it runs no SQL, and the palette sends one
//      on every deletion keystroke, so charging for it would spend the whole window on
//      the cheapest possible request;
//   2. the limiter refuses with the shared CODE (the palette resolves errors.
//      TOO_MANY_REQUESTS in the reader's language, never the server's English); and
//   3. a hit is a well-formed result list, so the throttle sits BESIDE the feature
//      rather than on top of it.
//
// rate-limit-contract.test.ts pins the call site's key/limit/order in the SOURCE;
// this file drives the real handler.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
//   node scripts/run-unit-tests.mjs "app/api/search/*.test.ts"
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope — currentWorkspace() reads
// the cookie jar. Open mode (no operator password), so it resolves to the default
// workspace; this file is about the throttle, not about authority.
const VIRTUAL_HEADERS = "kp-test:next-headers";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() { return { get: () => undefined }; }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// clientIpFrom IGNORES x-forwarded-for unless kp is declared to sit behind a proxy —
// otherwise the header is attacker-supplied and every caller shares SHARED_CLIENT_KEY
// (see the note on clientIpFrom). Declare one hop so this file can drive DISTINCT
// clients; the route's comment explains why the budget is sized for the other case,
// where the single shared bucket is the whole deployment.
process.env.KP_TRUSTED_PROXY = "1";

const { GET } = await import("./route.ts");

after(() => cleanupUnitDb());

// The route's own budget. Kept as literals rather than imported: a test that reads
// the constant it is checking would follow a widened limit silently.
const LIMIT = 3000;

type SearchBody = { results?: { type: string; id: string }[]; code?: string; error?: string };

/** Each test gets its own client IP, so the in-process limiter windows never bleed
 *  between tests (the limiter is a module-level map keyed by `search:<ip>`). */
function req(q: string, ip: string): Request {
  return new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`, {
    headers: { "x-forwarded-for": ip },
  });
}

const bodyOf = async (r: Response): Promise<SearchBody> => (await r.json()) as SearchBody;

test("a query shorter than the minimum is served, and costs nothing", async () => {
  const ip = "203.0.113.11";
  for (let i = 0; i < LIMIT + 20; i++) {
    const r = await GET(req("a", ip));
    assert.equal(r.status, 200, `hit ${i} of a sub-minimum query must never be throttled`);
    assert.deepEqual((await bodyOf(r)).results, []);
  }
  // …and the window is still completely unspent for a real query.
  assert.equal((await GET(req("engineer", ip))).status, 200);
});

test("a real query answers a result list", async () => {
  const r = await GET(req("engineer", "203.0.113.12"));
  assert.equal(r.status, 200);
  assert.ok(Array.isArray((await bodyOf(r)).results), "the shape the palette maps to deep links");
});

test("the per-IP window closes on the 3001st scan-bearing query", async () => {
  const ip = "203.0.113.13";
  for (let i = 0; i < LIMIT; i++) {
    assert.equal((await GET(req(`q${i}`, ip))).status, 200, `hit ${i + 1} is inside the budget`);
  }
  const refused = await GET(req("one too many", ip));
  assert.equal(refused.status, 429);
  const body = await bodyOf(refused);
  assert.equal(body.code, "TOO_MANY_REQUESTS", "the palette paints errors.TOO_MANY_REQUESTS, not this string");
  assert.equal(body.results, undefined, "a refusal is not an empty result set — the palette must not read it as 'no matches'");
});

test("the throttle is per client, not global", async () => {
  // The previous test spent one IP's whole window; a second client is unaffected. (On
  // a deployment with no declared proxy there IS only one bucket — which is precisely
  // why the ceiling is 3000 and not 300.)
  assert.equal((await GET(req("engineer", "203.0.113.14"))).status, 200);
});
