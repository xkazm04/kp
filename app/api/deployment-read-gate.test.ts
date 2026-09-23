// DEPLOYMENT-WIDE READ ratchet — the read-side sibling of route-capability-coverage.
//
// Some reads are deployment-wide BY CONSTRUCTION: coreTableCounts() is five unscoped
// COUNT(*)s over every tenant's rows, countActiveTasks() counts every workspace's
// queue, tailJsonl() tails one shared log set, rateLimitRefusalStats() is one
// process-wide limiter, and the llm_usage ledger (aggregateLlmUsage, listLlmActivity,
// routingHealth) has no org or workspace column at all. Nothing in them CAN be scoped,
// so the only honest gate is on the caller: they must belong to the install's HOME
// org (require-operator.ts `homeOrgReader`).
//
// `requireOperator()` is not that gate. It answers "signed in and not demo", which an
// owner of ANY org satisfies — and on a signup-enabled deployment every stranger who
// registers is the owner of a fresh org (signup-service.ts). The write doors got a
// capability ratchet for exactly this coarseness; the reads had nothing, so each new
// telemetry route re-made the same choice by hand. This file makes it a rule:
//
//   1. a SOURCE ratchet: any app/api/**/route.ts that CALLS one of the readers below
//      must also call requireHomeOrgReader() or isHomeOrgReader(). No allowlist — the
//      tree was brought to zero offenders in the same change;
//   2. behavioural cases for the two llm_usage routes and the /api/llm/config health
//      block, driven against the real handlers with an org-b owner session;
//   3. a source assertion that /diagrams asks the home-org question.
//
// Reach, stated honestly: the scan sees DIRECT calls in route files. A route that
// reaches a reader through a helper module (app/api/palette/preview -> palette-preview's
// resolveActivity) is invisible to it; that one is recorded as a known gap in
// docs/architecture/api-contracts.md §1.2 rather than silently counted as covered.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../_lib/testing/unit-db.ts";

register(new URL("../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpDeployReadCookie?: () => string | null }).__kpDeployReadCookie = () => cookieValue;
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
          export async function cookies() {
            const value = globalThis.__kpDeployReadCookie();
            return { get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined) };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

process.env.KP_SECRET = "deployment-read-gate-test-secret";
process.env.KP_OPERATOR_PASSWORD = "deployment-read-gate-test-password";

after(() => cleanupUnitDb());

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(apiDir, "..", "..");

// ---- 1. the source ratchet --------------------------------------------------

/** Readers whose result is every tenant's by construction. */
export const DEPLOYMENT_READERS = [
  "coreTableCounts",
  "countActiveTasks",
  "aggregateLlmUsage",
  "listLlmActivity",
  "tailJsonl",
  "rateLimitRefusalStats",
  "routingHealth",
] as const;

const READER_CALL = new RegExp(`\\b(${DEPLOYMENT_READERS.join("|")})\\s*\\(`, "g");
const HOME_ORG_GATE = /\b(requireHomeOrgReader|isHomeOrgReader)\s*\(/;

/** Line comments stripped, so a header that NAMES a reader is not a call. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line))
    .join("\n");
}

/** The deployment-wide readers a route source calls without asking the home-org
 *  question; empty when it is gated (or calls none). */
export function ungatedDeploymentReads(src: string): string[] {
  const code = codeOnly(src);
  const called = new Set<string>();
  for (const m of code.matchAll(READER_CALL)) called.add(m[1]);
  if (called.size === 0 || HOME_ORG_GATE.test(code)) return [];
  return [...called].sort();
}

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walkRoutes(p, out);
    } else if (e.name === "route.ts") {
      out.push(p);
    }
  }
  return out;
}

test("the ratchet flags a route that reads deployment-wide state behind requireOperator() alone", () => {
  for (const reader of ["coreTableCounts", "aggregateLlmUsage", "listLlmActivity", "tailJsonl"]) {
    const src = [
      `import { requireOperator } from "@/app/_lib/auth/require-operator";`,
      `export async function GET() {`,
      `  const denied = await requireOperator(); if (denied) return denied;`,
      `  return Response.json(${reader}(7));`,
      `}`,
    ].join("\n");
    assert.deepEqual(ungatedDeploymentReads(src), [reader], `${reader} behind the coarse gate must be flagged`);
    const gated = src.replace("requireOperator()", "requireHomeOrgReader()");
    assert.deepEqual(ungatedDeploymentReads(gated), [], "the home-org gate clears it");
  }
  assert.deepEqual(ungatedDeploymentReads(`// coreTableCounts() is named in a comment only\nexport async function GET() {}`), []);
});

test("no route in app/api reads deployment-wide state without the home-org gate", () => {
  const routes = walkRoutes(apiDir);
  assert.ok(routes.length > 100, `walked ${routes.length} route files`);
  const offenders: string[] = [];
  let readers = 0;
  for (const file of routes) {
    const src = readFileSync(file, "utf8");
    if (new RegExp(READER_CALL.source).test(codeOnly(src))) readers++;
    const miss = ungatedDeploymentReads(src);
    if (miss.length) offenders.push(`${path.relative(apiDir, file).replaceAll("\\", "/")}: ${miss.join(", ")}`);
  }
  assert.ok(readers >= 5, `the scan must actually see the known readers (saw ${readers})`);
  assert.deepEqual(offenders, [], "a deployment-wide read gated on less than the home org");
});

// ---- 3. /diagrams -------------------------------------------------------------

test("/diagrams asks the home-org question, not the coarse one", () => {
  const src = codeOnly(readFileSync(path.join(repoRoot, "app", "diagrams", "page.tsx"), "utf8"));
  assert.match(src, /if\s*\(\s*!\s*\(\s*await\s+isHomeOrgReader\(\)\s*\)\s*\)\s*notFound\(\)/);
  assert.doesNotMatch(src, /\bisOperator\s*\(/, "the coarse gate must not come back beside it");
});

// ---- 2. behavioural: the llm_usage routes -----------------------------------

const { signSession, DEFAULT_WORKSPACE } = await import("../_lib/auth/session.ts");
const usage = await import("./llm/usage/route.ts");
const activity = await import("./llm/activity/route.ts");
const config = await import("./llm/config/route.ts");
const { NextRequest } = await import("next/server");

const ORG_B_OWNER = () => signSession("ws_org_b", Date.now(), { sub: "usr_b", org: "org-b", role: "owner" });
const HOME_MEMBER = () => signSession(DEFAULT_WORKSPACE, Date.now(), { sub: "usr_h", org: "org-default", role: "recruiter" });
const req = (p: string) => new NextRequest(`http://localhost${p}`);

test("an owner of another org cannot read the llm_usage ledger, aggregate or row by row", async () => {
  cookieValue = ORG_B_OWNER();
  for (const [name, res] of [
    ["usage", await usage.GET(req("/api/llm/usage"))],
    ["activity", await activity.GET(req("/api/llm/activity"))],
  ] as const) {
    assert.equal(res.status, 403, `${name}: every row is another tenant's too`);
    const body = (await res.json()) as { code?: string; rows?: unknown };
    assert.equal(body.code, "FORBIDDEN_CAPABILITY");
    assert.equal(body.rows, undefined);
  }
});

test("a home-org member still reads both", async () => {
  cookieValue = HOME_MEMBER();
  assert.equal((await usage.GET(req("/api/llm/usage"))).status, 200);
  assert.equal((await activity.GET(req("/api/llm/activity"))).status, 200);
});

test("/api/llm/config keeps its pins for another org's owner, and drops the ledger-derived health", async () => {
  cookieValue = ORG_B_OWNER();
  const res = await config.GET();
  assert.equal(res.status, 200, "the routing table is not the ledger");
  const body = (await res.json()) as { rows?: unknown; health?: unknown };
  assert.ok(Array.isArray(body.rows));
  assert.equal("health" in body, false, "health is aggregated from every tenant's llm_usage rows");
  cookieValue = HOME_MEMBER();
  const home = (await (await config.GET()).json()) as { health?: unknown };
  assert.ok(home.health, "the home org keeps the chip");
});
