// The analytics module must never put a CANDIDATE CAPABILITY TOKEN on the wire.
//
// The leak this pins: <PlausibleScript /> is mounted in the ROOT layout
// (app/layout.tsx), so it renders on every public candidate surface too —
// /schedule/<token>, /interview/<token>, /status/<token>, /data/<erasureToken>,
// /offer/<token>, /invite/<token>, /skill/<token>. Those tokens ARE the
// credential (no session is involved), and Plausible attaches `u: location.href`
// to every event it sends, pageviews included. With NEXT_PUBLIC_PLAUSIBLE_DOMAIN
// configured — which mvp-passport.json tells the operator to do at deploy — a
// candidate opening their scheduling link handed a working credential to
// plausible.io on first paint, where it lands in the dashboard's page list.
//
// Two halves, ONE list: the script tag ships the prefixes as `data-exclude`
// (no pageview is sent from a matching page), and track() refuses to fire from
// one. This file pins the list AND both consumers of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOKENIZED_PATH_PREFIXES, isTokenizedPath, track } from "./track.ts";

// Every app/<segment>/[token] route directory, spelled out. A new tokenized
// candidate surface that is not in TOKENIZED_PATH_PREFIXES is the regression.
const TOKENIZED_ROUTES = ["/schedule/", "/interview/", "/status/", "/data/", "/offer/", "/invite/", "/skill/"];

test("every tokenized candidate route is excluded from analytics", () => {
  for (const route of TOKENIZED_ROUTES) {
    assert.ok(TOKENIZED_PATH_PREFIXES.includes(route as (typeof TOKENIZED_PATH_PREFIXES)[number]), `${route} is missing`);
    assert.equal(isTokenizedPath(`${route}9f3a7c1e2b4d`), true, `${route}<token> must be excluded`);
  }
  // /apply/<jobId> is not a token in the path, but it carries ?lead=<opaque token>
  // in the query string (app/apply/[id]/page.tsx), which rides along in location.href.
  assert.equal(isTokenizedPath("/apply/job-42"), true, "/apply carries ?lead=<token>");
});

test("workspace and public marketing paths still report", () => {
  for (const p of ["/", "/?tab=hiring", "/market", "/jds/senior-backend-engineer", "/history/q3-hiring"]) {
    assert.equal(isTokenizedPath(p), false, `${p} must keep reporting`);
  }
  // A prefix match, not a substring one: a workspace path that merely mentions a
  // tokenized segment deeper down is not a candidate surface.
  assert.equal(isTokenizedPath("/dashboard/schedule/overview"), false);
});

test("track() is a no-op on a tokenized surface even when Plausible is loaded", () => {
  const calls: string[] = [];
  const g = globalThis as { window?: unknown };
  const hadWindow = "window" in g;
  const previous = g.window;
  g.window = { location: { pathname: "/schedule/9f3a7c1e2b4d" }, plausible: (e: string) => calls.push(e) };
  try {
    track("checkout_started", { item: "growth" });
    assert.deepEqual(calls, [], "no event may be sent from a capability-token page");

    (g.window as { location: { pathname: string } }).location.pathname = "/";
    track("checkout_started", { item: "growth" });
    assert.deepEqual(calls, ["checkout_started"], "the workspace still reports");
  } finally {
    if (hadWindow) g.window = previous;
    else delete g.window;
  }
});

test("the script tag ships the exclusion list and the script build that honours it", () => {
  const src = readFileSync(fileURLToPath(new URL("./plausible.tsx", import.meta.url)), "utf-8");
  // `script.js` ignores data-exclude entirely — only the exclusions build reads it,
  // so the src and the attribute have to move together or the guard is decorative.
  assert.match(src, /src="https:\/\/plausible\.io\/js\/script\.exclusions\.js"/, "must use the exclusions build");
  assert.match(src, /data-exclude=\{EXCLUDED_PAGES\}/, "must pass the exclusion globs");
  assert.match(src, /TOKENIZED_PATH_PREFIXES\.map\(\(prefix\) => `\$\{prefix\}\*`\)/, "globs must derive from the one list");
});
