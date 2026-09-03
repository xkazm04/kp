// The operator telemetry read — /api/ops had no route test at all.
//
// Two facts worth a test and untested until now:
//
//   1. the gate. This payload is DEPLOYMENT-wide by construction (unscoped COUNT(*)s
//      over every tenant's jobs/profiles/analyses, the queue across all workspaces, a
//      tail of the shared logs), so the header calls the operator gate an authz
//      decision rather than a tenancy one. The anonymous /api/demo visitor is the
//      caller it exists to refuse, and nothing pinned that.
//   2. the failure vocabulary. Its catch used to answer `error.message` — for a
//      payload built out of better-sqlite3 (the db FILE PATH inside a SQLITE_* text),
//      the seed report (absolute seed paths) and three log tails (the log directory).
//      It now answers `safeJsonError(…, "OPS_STATUS_FAILED")`, and its row is gone
//      from error-response-contract.test.ts's ceiling, so this file is what keeps the
//      code itself honest.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
//   node scripts/run-unit-tests.mjs "app/api/ops/*.test.ts"
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpOpsTestCookie?: () => string | null }).__kpOpsTestCookie = () => cookieValue;
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
            const value = globalThis.__kpOpsTestCookie();
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

// Without an operator password every caller is trusted (open dev) and there is no
// authorization decision left to prove.
process.env.KP_SECRET = "ops-route-test-secret";
process.env.KP_OPERATOR_PASSWORD = "ops-route-test-password";

const { GET } = await import("./route.ts");
const { signSession, DEFAULT_WORKSPACE, DEMO_WORKSPACE } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

type OpsBody = { tables?: Record<string, number>; queue?: unknown; engines?: unknown; error?: string; code?: string };
const bodyOf = async (r: Response): Promise<OpsBody> => (await r.json()) as OpsBody;

test("an anonymous caller gets nothing", async () => {
  cookieValue = null;
  const r = await GET();
  assert.equal(r.status, 401);
  assert.equal((await bodyOf(r)).tables, undefined, "not one deployment-wide count");
});

test("the /api/demo visitor is refused too — a valid signature is not an operator", async () => {
  cookieValue = signSession(DEMO_WORKSPACE, Date.now());
  const r = await GET();
  assert.equal(r.status, 401, "the demo cookie is exactly the caller this gate was built for");
  assert.equal((await bodyOf(r)).tables, undefined);
});

test("an operator gets the telemetry payload", async () => {
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now());
  const r = await GET();
  assert.equal(r.status, 200);
  const body = await bodyOf(r);
  assert.ok(body.tables, "the gate is a gate, not a deletion");
  assert.ok(body.queue);
  assert.ok(body.engines);
});

test("the catch answers a CODE, never the thrown message", () => {
  // Source-level, because the failure needs an unopenable database and this suite runs
  // on a working one. The ratchet in error-response-contract.test.ts no longer carries a
  // row for this route, so without this assertion nothing names the code it must use.
  const src = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
  assert.match(src, /safeJsonError\(error, "api:ops", "OPS_STATUS_FAILED"\)/);
  assert.doesNotMatch(src, /error instanceof Error \? error\.message/, "the raw message must not reach the client again");
});
