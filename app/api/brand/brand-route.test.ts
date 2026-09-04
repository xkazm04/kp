// The brand write door. Before this file it had no limiter, no body cap, and it
// answered `{ error: "Failed to save branding." }` — an English sentence rendered
// verbatim by the editor in every locale. Worse, a bad accent or logo was silently
// dropped to null behind a 200, so the operator was told their brand had been
// applied when it had not.
//
// This drives the REAL handlers on a throwaway SQLite file, in OPEN mode
// (KP_OPERATOR_PASSWORD unset → requireOperator allows and never touches
// next/headers), which is exactly the deployment where the limiter is the only bound.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Point next/server at the shared test shim BEFORE the route loads (hooks only
// affect later resolutions — hence the dynamic import inside the loader below).
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

after(() => {
  delete process.env.KP_TRUSTED_PROXY;
  cleanupUnitDb();
});

type Route = typeof import("./route.ts");
let route: Route | null = null;
async function handlers(): Promise<Route> {
  route ??= (await import("./route.ts")) as Route;
  return route;
}

/** Each test gets its own client address so the shared in-process limiter's window
 *  from one test cannot refuse the next. */
let ip = 0;
function put(body: unknown, addr = `10.9.0.${++ip}`): Request {
  return new Request("http://localhost/api/brand", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-forwarded-for": addr },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
  // Without a trusted proxy hop, clientIpFrom deliberately collapses EVERY caller
  // into one shared bucket (rate-limit.ts, "THE TRAP"), so per-IP behavior is only
  // observable when a hop is trusted. That is the configuration the key is written
  // for; the shared-bucket default is a documented deployment residual, not this
  // route's contract.
  process.env.KP_TRUSTED_PROXY = "1";
});

test("PUT stores a legible accent and answers with its derived dark twin", async () => {
  const { PUT } = await handlers();
  const { deriveDarkAccent } = await import("../../_lib/brand-config.ts");
  const res = await PUT(put({ displayName: "Acme", accentColor: "#0057B8", logoUrl: "https://cdn.acme/l.png" }) as never);
  assert.equal(res.status, 200);
  const saved = (await res.json()) as { accentColor: string; accentDark: string };
  assert.equal(saved.accentColor, "#0057b8");
  // The whole point of the wire shape: two themes, two values.
  assert.equal(saved.accentDark, deriveDarkAccent("#0057b8"));
  assert.notEqual(saved.accentDark, saved.accentColor);
});

test("PUT REFUSES a bad accent with a code naming the reason — never a silent 200", async () => {
  const { PUT } = await handlers();
  const cases = [
    // Not a color at all (and the CSS-injection shape, which must never be stored).
    ["chartreuse", "BRAND_ACCENT_INVALID"],
    ["#000; } body { display:none", "BRAND_ACCENT_INVALID"],
    // Valid hex, unusable in Studio Light: white button text and focus rings vanish.
    ["#ffff88", "BRAND_ACCENT_ILLEGIBLE_LIGHT"],
    // Valid hex, fine in Studio Light (21:1 on white), no Spark Dark twin inside the
    // lift cap — the refusal NAMES the theme, because the fix is a different color,
    // not a darker one.
    ["#000000", "BRAND_ACCENT_ILLEGIBLE_DARK"],
  ] as const;
  for (const [accentColor, code] of cases) {
    const res = await PUT(put({ accentColor }) as never);
    assert.equal(res.status, 400, `${accentColor} must be refused`);
    const body = (await res.json()) as { code?: string; error?: string };
    assert.equal(body.code, code, `${accentColor} → ${code}`);
    assert.ok(body.error, "the canonical English rides along for logs/API consumers");
  }
});

test("PUT REFUSES a logo the store would have nulled behind a green Saved", async () => {
  const { PUT } = await handlers();
  const { MAX_LOGO_URL } = await import("../../_lib/brand-config.ts");
  for (const logoUrl of [
    "javascript:alert(1)",
    "http://cdn.acme/l.png",
    `https://cdn.acme/l.png?sig=${"a".repeat(MAX_LOGO_URL)}`,
  ]) {
    const res = await PUT(put({ logoUrl }) as never);
    assert.equal(res.status, 400, `${logoUrl.slice(0, 40)} must be refused`);
    assert.equal(((await res.json()) as { code?: string }).code, "BRAND_LOGO_INVALID");
  }
  // Clearing the logo is not a refusal — it is how an operator removes one.
  const cleared = await PUT(put({ logoUrl: "" }) as never);
  assert.equal(cleared.status, 200);
  assert.equal(((await cleared.json()) as { logoUrl: string | null }).logoUrl, null);
});

test("PUT caps the body on the bytes READ, not on content-length", async () => {
  const { PUT } = await handlers();
  // A body far past the 4 KB cap, sent with NO content-length the route can trust:
  // the guard has to be the byte counter inside readJsonWithLimit.
  const huge = JSON.stringify({ displayName: "x".repeat(20_000) });
  const res = await PUT(put(huge) as never);
  assert.equal(res.status, 413);
  const body = (await res.json()) as { code?: string; maxBytes?: number };
  assert.equal(body.code, "PAYLOAD_TOO_LARGE");
  assert.equal(body.maxBytes, 4_000, "the cap rides along as data, not inside a sentence");
});

test("PUT is throttled per IP, and the 31st hit in the window is refused", async () => {
  const { PUT } = await handlers();
  const addr = "10.9.9.9";
  for (let i = 0; i < 30; i++) {
    const ok = await PUT(put({ displayName: `n${i}` }, addr) as never);
    assert.equal(ok.status, 200, `hit ${i + 1} of 30 must pass`);
  }
  const refused = await PUT(put({ displayName: "over" }, addr) as never);
  assert.equal(refused.status, 429);
  assert.equal(((await refused.json()) as { code?: string }).code, "TOO_MANY_REQUESTS");
  // A DIFFERENT caller still gets served — the budget is per client, not global.
  const other = await PUT(put({ displayName: "other" }) as never);
  assert.equal(other.status, 200);
});

test("GET answers the effective brand, both theme values included", async () => {
  const { GET, PUT } = await handlers();
  await PUT(put({ displayName: "Acme", accentColor: "#0057b8", logoUrl: "" }) as never);
  const res = await GET();
  assert.equal(res.status, 200);
  const brand = (await res.json()) as { displayName: string; accentColor: string; accentDark: string };
  assert.equal(brand.displayName, "Acme");
  assert.equal(brand.accentColor, "#0057b8");
  assert.ok(brand.accentDark && brand.accentDark !== brand.accentColor);
});

test("the route answers CODES — no handler forwards a raw sentence any more", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // The two English sentences the handlers used to hand the client verbatim.
  assert.ok(!src.includes("Failed to save branding."), "the save 500 must not carry prose");
  assert.ok(!src.includes("Failed to load branding."), "the load 500 must not carry prose");
  assert.ok(src.includes('safeJsonError(error, "api:brand:put", "BRAND_SAVE_FAILED")'));
  assert.ok(src.includes('safeJsonError(error, "api:brand:get", "BRAND_LOAD_FAILED")'));
  // The limiter must sit AFTER the operator gate (a rejected caller spends nothing)
  // and BEFORE the body read (an oversized body is never buffered on a throttled
  // caller). Order in the source is the contract; rate-limit-contract.test.ts pins
  // the key and the limit.
  assert.ok(src.indexOf("requireOperator()") < src.indexOf("rateLimit(`brand:"));
  assert.ok(src.indexOf("rateLimit(`brand:") < src.indexOf("await readJsonWithLimit"));
});
