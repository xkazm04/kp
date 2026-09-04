// EVERY public route that reads a request body reads it under a HARD BYTE CAP.
//
// This is a contract test, not a sample. The route set is DERIVED from
// `isPublicPath` — the same fail-closed predicate the auth gate uses — rather than
// listed here, so a NEW public route inherits the obligation the moment it is added
// to the allow-list. A list would have gone stale the first time someone opened a
// door; that is precisely how twenty of these routes ended up buffering whatever an
// anonymous caller sent while three of them were capped.
//
// Why bytes matter on exactly these routes: they are reachable with no session at
// all, and `request.json()` / `request.text()` buffer the WHOLE body into this
// process's heap before any handler code — before the rate limiter, before the token
// check — gets to run. A content-length check is not a substitute: that header is
// written by the caller, who may omit it (chunked transfer) or simply lie.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isPublicPath } from "../_lib/auth/public-routes.ts";

const API_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * Routes that read no request body at all, or read something `readTextWithLimit`
 * cannot bound. Each one states WHY — an exemption without a reason is how a cap
 * quietly stops being required.
 */
const EXEMPT: Record<string, string> = {
  "/api/auth/logout": "reads no body — it clears the session cookie and redirects",
  "/api/data/[token]":
    "reads no body — the erasure token in the path is the whole request (GDPR Art. 17 one-click link)",
  "/api/extract-text":
    "multipart/form-data, not JSON: the upload is bounded by the route's own file-size gate and the extractor's " +
    "child-process timeout, neither of which readTextWithLimit can express",
};

/** Every `route.ts` under app/api, as [urlPath, absoluteFile]. */
function routeFiles(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry === "route.ts") {
        const rel = path.relative(API_DIR, p).split(path.sep).join("/").replace(/\/?route\.ts$/, "");
        out.push(["/api" + (rel ? "/" + rel : ""), p]);
      }
    }
  })(API_DIR);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

const BODY_VERBS = ["POST", "PUT", "PATCH"];

/** Public routes with a body-taking handler, as [urlPath, source]. */
function publicBodyRoutes(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [url, file] of routeFiles()) {
    // `[id]` / `[token]` are literal in the file path; isPublicPath matches by
    // segment, so a placeholder segment behaves exactly like a real one.
    if (!isPublicPath(url)) continue;
    // CRLF checkout vs LF worktree — normalise before any anchored matching.
    const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    if (!BODY_VERBS.some((v) => new RegExp(`^export (async )?function ${v}\\b`, "m").test(src))) continue;
    out.push([url, src]);
  }
  return out;
}

test("the derived public-route set is non-empty and covers the known candidate doors", () => {
  // Guard the guard: a broken derivation (a renamed export, a changed predicate)
  // would make every assertion below vacuously true.
  const urls = publicBodyRoutes().map(([u]) => u);
  assert.ok(urls.length >= 20, `expected the public write surface, derived ${urls.length}`);
  for (const known of [
    "/api/apply/[id]",
    "/api/auth/login",
    "/api/devcase/session/[id]",
    "/api/interview/connect",
    "/api/offer/[token]",
    "/api/schedule/[token]",
    "/api/status/[token]/nps",
  ]) {
    assert.ok(urls.includes(known), `${known} must be in the derived public write surface`);
  }
});

test("every public body-taking route reads its body through the capped helper", () => {
  const uncapped: string[] = [];
  for (const [url, src] of publicBodyRoutes()) {
    if (url in EXEMPT) continue;
    if (/from "@\/app\/_lib\/request-body"/.test(src)) continue;
    uncapped.push(url);
  }
  assert.deepEqual(
    uncapped,
    [],
    "these PUBLIC routes buffer an unbounded request body — read it through " +
      "readJsonWithLimit / readTextWithLimit (app/_lib/request-body.ts), or add an EXEMPT entry saying why"
  );
});

/** Source with comments removed — these files DESCRIBE the old unbounded read in
 *  prose (that is the point of the comments), so a scan for real code must not see
 *  it. Crude on purpose: a `//` inside a string literal would over-strip, and
 *  over-stripping can only make this check miss, never fire falsely. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("no public route buffers a body with a raw request.json() / request.text()", () => {
  const raw: string[] = [];
  for (const [url, s] of publicBodyRoutes()) {
    const src = code(s);
    if (url in EXEMPT) continue;
    // The cap is worthless if the route ALSO reads the body the old way — and a
    // half-converted route (helper imported, old read left behind) is exactly the
    // shape a mechanical conversion leaves.
    if (/\brequest\.(json|text)\(\)/.test(src) || /\breq\.(json|text)\(\)/.test(src)) raw.push(url);
  }
  assert.deepEqual(raw, [], "an unbounded request.json()/request.text() survives on a public route");
});

test("every exemption names a route that exists and is actually public", () => {
  const urls = new Set(routeFiles().map(([u]) => u));
  for (const [url, why] of Object.entries(EXEMPT)) {
    assert.ok(urls.has(url), `EXEMPT names ${url}, which is not a route`);
    assert.ok(isPublicPath(url), `EXEMPT names ${url}, which is not public — drop the entry`);
    assert.ok(why.length > 20, `the exemption for ${url} must say why, not just that`);
  }
});

test("each capped route declares its cap as a named constant, not a magic number", () => {
  const missing: string[] = [];
  for (const [url, src] of publicBodyRoutes()) {
    if (url in EXEMPT) continue;
    // The cap has to be readable at the call site AND at the top of the file, which
    // is what makes "what does this route accept" answerable without running it.
    if (!/const MAX_[A-Z_]*BYTES = /.test(src)) missing.push(url);
  }
  assert.deepEqual(missing, [], "a cap passed as a literal is a cap nobody can find or review");
});
