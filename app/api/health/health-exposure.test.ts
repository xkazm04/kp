// What the PUBLIC readiness probe may say to a caller with no session.
//
// /api/health is on the public allow-list (public-routes.ts PUBLIC_API_EXACT), so on a
// password-protected deployment it answers anyone on the internet. It used to answer
// them with `tables` — coreTableCounts(), a deployment-wide `SELECT COUNT(*)` over
// jobs/profiles/pipeline_entries/analyses/tasks — plus the queue depth and, on a seed
// failure, an absolute server filesystem path inside degradedReasons. /api/ops gates
// that exact payload behind requireOperator() with the reason spelled out in its
// header ("any signed-in member of ANY workspace, plus the anonymous /api/demo
// visitor, could read off … how many candidates and analyses every other team on the
// box has"), so handing the same numbers to a caller with NO session was strictly
// worse than the case that gate was built for.
//
// Two invariants:
//   1. the VERDICT stays public — ok / db / seeds / clock / engines and the status
//      code, which is all an uptime monitor needs and carries no tenant detail;
//   2. the DETAIL rides isOperator() — and is OMITTED rather than blanked, because an
//      empty `degradedReasons` beside a 503 would be a confident lie.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the route loads (hooks only affect
// later resolutions — hence the dynamic import below).
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so resolve it to a virtual
// module whose cookie jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpHealthTestCookie?: () => string | null }).__kpHealthTestCookie = () => cookieValue;
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
            const value = globalThis.__kpHealthTestCookie();
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

// Password mode: without an operator password every caller is trusted (open dev) and
// there is no exposure decision left to prove.
process.env.KP_SECRET = "health-route-test-secret";
process.env.KP_OPERATOR_PASSWORD = "health-route-test-password";

const { GET } = await import("./route.ts");
const { signSession, DEFAULT_WORKSPACE, DEMO_WORKSPACE } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

type HealthBody = {
  ok?: boolean;
  db?: string;
  seeds?: string;
  clock?: string;
  engines?: { gemini: boolean; claudeCli: boolean };
  tables?: Record<string, number>;
  queue?: { running: number; queued: number };
  degradedReasons?: string[];
};

async function probe(): Promise<HealthBody> {
  return (await (await GET()).json()) as HealthBody;
}

test("an ANONYMOUS caller gets the verdict and no deployment detail", async () => {
  cookieValue = null;
  const body = await probe();
  // The verdict a monitor gates on — still there.
  assert.equal(typeof body.ok, "boolean");
  assert.equal(body.db, "ok");
  assert.ok(body.seeds === "ok" || body.seeds === "degraded");
  assert.equal(typeof body.clock, "string");
  assert.equal(typeof body.engines?.gemini, "boolean", "engine preflight stays public (the shell + demo read it)");
  // The deployment's business volume, queue and failure paths — gone.
  assert.equal(body.tables, undefined, "row counts across every tenant must not reach an anonymous caller");
  assert.equal(body.queue, undefined, "queue depth counts every tenant's runs");
  assert.equal(
    body.degradedReasons,
    undefined,
    "a seed reason quotes an absolute server path — omitted, never blanked to a lying []"
  );
});

test("the anonymous demo session is not an operator either", async () => {
  cookieValue = signSession(DEMO_WORKSPACE, Date.now());
  const body = await probe();
  assert.equal(body.tables, undefined, "the /api/demo visitor is exactly the caller /api/ops refuses");
  assert.equal(body.db, "ok", "…and still gets a usable readiness verdict");
});

test("a signed-in operator still gets the full payload", async () => {
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now());
  const body = await probe();
  assert.ok(body.tables, "the detail is gated, not deleted");
  for (const t of ["jobs", "profiles", "pipeline_entries", "analyses", "tasks"]) {
    assert.equal(typeof body.tables?.[t], "number", `tables.${t} must survive for the operator view`);
  }
  assert.equal(typeof body.queue?.queued, "number");
  assert.ok(Array.isArray(body.degradedReasons));
});
