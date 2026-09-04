// THE SHELL'S HEADERS, PINNED.
//
// Nothing asserted the response contract of the app shell: the security headers
// in next.config.ts, the content-security policy, or the marketing-page exemption
// the pre-paint theme bootstrap in app/layout.tsx carries. A regression in any of
// them ships silently — there is no red build and no visible symptom until a
// browser console (or a penetration test) finds it months later.
//
// Three groups of facts live here, all derived from the real sources rather than
// restated from a doc:
//
//  1. next.config.ts owns the STATIC headers only (HSTS, nosniff, referrer,
//     frame-options, permissions-policy). The CSP is NOT among them any more —
//     it needs a per-request nonce, which a build-time config cannot mint, so it
//     is produced in proxy.ts. Two CSP headers on one response would mean two
//     policies both applying, so the config must carry none.
//
//  2. proxy.ts owns the CSP and the nonce. `script-src` must NOT carry
//     'unsafe-inline' (that was there only for the THEME_INIT inline script,
//     which now carries the nonce), the nonce must be fresh per request, and the
//     origin inventory the connect-src encodes must survive.
//
//  3. The theme bootstrap's exempt list must cover EVERY public page that renders
//     the fixed Spark art direction. That set is derived here by scanning
//     app/<route>/page.tsx for an import of `@/app/landing/…` — the same signal
//     `npm run design:check` uses to exempt the directory. `/market` was missing
//     from the list for as long as the page existed: a dark-preference visitor
//     got `data-theme="dark"` on a document whose 87 literal hexes never move.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const REPO_ROOT = join(import.meta.dirname, "..");

async function configHeaders() {
  const { default: config } = await import("../next.config.ts");
  assert.ok(typeof config.headers === "function", "next.config must define headers()");
  const routes = await config.headers!();
  assert.equal(routes.length, 1, "one global header route");
  assert.equal(routes[0]!.source, "/:path*", "applied to every path");
  return new Map(routes[0]!.headers.map((h) => [h.key, "value" in h ? h.value : ""]));
}

test("next.config ships the static security headers, each with its value", async () => {
  const headers = await configHeaders();
  assert.equal(
    headers.get("Strict-Transport-Security"),
    "max-age=63072000; includeSubDomains; preload"
  );
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Permissions-Policy"), "camera=(), microphone=(self), geolocation=()");
});

test("next.config carries NO content-security policy — the nonce'd one comes from proxy.ts", async () => {
  const headers = await configHeaders();
  assert.equal(headers.get("Content-Security-Policy"), undefined);
  assert.equal(headers.get("Content-Security-Policy-Report-Only"), undefined);
});

test("the CSP nonces script-src instead of allowing every inline script", async () => {
  const { buildCsp } = await import("../proxy.ts");
  const csp = buildCsp("TESTNONCE");
  const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "));
  assert.ok(scriptSrc, "script-src is declared");
  assert.match(scriptSrc!, /'nonce-TESTNONCE'/);
  assert.ok(
    !scriptSrc!.includes("'unsafe-inline'"),
    `script-src must not allow every inline script: ${scriptSrc}`
  );
  // next/font and BrandStyle both emit inline <style>; style-src keeps its
  // allowance deliberately (a style injection is not script execution).
  assert.match(csp, /style-src [^;]*'unsafe-inline'/);
});

test("the CSP keeps the audited origin inventory and the hardening directives", async () => {
  const { buildCsp } = await import("../proxy.ts");
  const csp = buildCsp("n");
  for (const origin of [
    "https://api.elevenlabs.io",
    "wss://api.elevenlabs.io",
    "https://api.openai.com",
    "https://plausible.io",
    "https://*.sentry.io",
  ]) {
    assert.ok(csp.includes(origin), `connect-src keeps ${origin}`);
  }
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // X-Frame-Options: DENY is the legacy half; frame-ancestors is the one a
    // modern browser reads, and it is ignored in report-only — hence recorded
    // here so the enforce flip does not have to rediscover it.
    "frame-ancestors 'none'",
  ]) {
    assert.ok(csp.includes(directive), `CSP keeps ${directive}`);
  }
});

test("the CSP header ships REPORT-ONLY and mints a fresh nonce per request", async () => {
  const { proxy } = await import("../proxy.ts");
  // "next/server.js", with the extension: node's own resolver (this suite runs on
  // node:test + type stripping, no bundler) does not read next's export map the
  // way the compiler does, and the extensionless specifier resolves to a
  // different module instance whose NextRequest has no `nextUrl`.
  const { NextRequest } = await import("next/server.js");
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const res = await proxy(new NextRequest("https://kp.test/?tab=hiring"));
    // Report-only until an owner flips it (docs/architecture/app-structure.md).
    assert.equal(res.headers.get("Content-Security-Policy"), null);
    const value = res.headers.get("Content-Security-Policy-Report-Only");
    assert.ok(value, "every proxied response carries the report-only policy");
    const nonce = /'nonce-([^']+)'/.exec(value!)?.[1];
    assert.ok(nonce && nonce.length >= 16, `a real nonce, got ${nonce}`);
    seen.add(nonce!);
  }
  assert.equal(seen.size, 3, "a nonce is never reused across requests");
});

// Every public route whose page.tsx pulls a component out of `app/landing/` is a
// fixed Spark art direction (literal hexes, no `dark:` variants, exempted from
// design:check). Those documents must never receive `data-theme="dark"`.
function fixedArtRoutes(): string[] {
  const appDir = join(REPO_ROOT, "app");
  const routes: string[] = [];
  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("[")) continue;
    let source: string;
    try {
      source = readFileSync(join(appDir, entry.name, "page.tsx"), "utf8");
    } catch {
      continue; // not a route segment with its own page — nothing to classify
    }
    if (/from "@\/app\/landing\//.test(source)) routes.push(`/${entry.name}`);
  }
  return routes.sort();
}

test("the theme bootstrap exempts every fixed-art marketing page", () => {
  const layout = readFileSync(join(REPO_ROOT, "app", "layout.tsx"), "utf8");
  const declared = /const THEME_FIXED_ART_PATHS = (\[[^\]]*\]);/.exec(layout)?.[1];
  assert.ok(declared, "THEME_FIXED_ART_PATHS is an array literal in app/layout.tsx");
  const exempt: string[] = JSON.parse(declared!.replace(/'/g, '"').replace(/,\s*\]/, "]"));
  const routes = fixedArtRoutes();
  assert.ok(routes.length >= 2, `expected the landing-derived marketing pages, got ${routes}`);
  for (const route of routes) {
    assert.ok(
      exempt.includes(route),
      `THEME_FIXED_ART_PATHS must exempt ${route} (its page renders app/landing/ art): ${exempt}`
    );
  }
  // The bootstrap must actually consume the list, and '/' is the fourth case:
  // the landing for a visitor who has not entered the workspace — the kp_entered
  // cookie is the same signal app/page.tsx's server gate reads.
  const skip = /const THEME_SKIP_DARK = `([\s\S]*?)`;/.exec(layout)?.[1];
  assert.ok(skip, "THEME_SKIP_DARK is a template literal in app/layout.tsx");
  assert.match(skip!, /THEME_FIXED_ART_PATHS/);
  assert.match(skip!, /kp_entered=1/);
});
