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
//   1. the VERDICT stays public — ok / db / seeds / clock and the status code, which is
//      all an uptime monitor needs and carries no tenant detail;
//   2. the DETAIL rides isOperator() — and is OMITTED rather than blanked, because an
//      empty `degradedReasons` beside a 503 would be a confident lie.
//
// `engines` MOVED from (1) to (2) deliberately (/perfect wave 17, api-workspace). This
// file used to bless it as public with the note "the shell + demo read it" — but the
// signed-in shell IS trusted by isOperator(), so that argument only ever covered the
// anonymous case, and what the anonymous case receives is SECRET PRESENCE: whether this
// box has a Gemini key configured, and whether a `claude` CLI is installed on it.
// That is reconnaissance — which credential is worth attacking, and whether the LLM
// path is a local process on this host rather than a cloud call — and no uptime monitor
// has ever needed it. It is not a degradedReason either (engine-preflight.ts: running
// keyless is a designed mode), so removing it from the public half changes no verdict
// and no status code. A demo/anonymous surface that read it now renders its honest
// "engine status unknown" third state (useEngineAvailability.ts) instead of a fact it
// was never entitled to.
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
  config?: string;
  configIssues?: { phase: string; scope: string; workspaceId: string }[];
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
  // The deployment's business volume, queue, failure paths — and which provider
  // credentials this host carries — gone.
  assert.equal(body.engines, undefined, "secret PRESENCE is not a public readiness fact — see the header");
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
  assert.equal(body.engines, undefined, "…including the engine map");
  assert.equal(body.db, "ok", "…and still gets a usable readiness verdict");
});

test("a signed-in operator still gets the full payload", async () => {
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now());
  const body = await probe();
  assert.equal(typeof body.engines?.gemini, "boolean", "the shell's engine read is trusted, so it is unchanged");
  assert.equal(typeof body.engines?.claudeCli, "boolean");
  assert.ok(body.tables, "the detail is gated, not deleted");
  for (const t of ["jobs", "profiles", "pipeline_entries", "analyses", "tasks"]) {
    assert.equal(typeof body.tables?.[t], "number", `tables.${t} must survive for the operator view`);
  }
  assert.equal(typeof body.queue?.queued, "number");
  assert.ok(Array.isArray(body.degradedReasons));
});

// ---- the decision-config health ledger (wave 41 D1) --------------------------------
//
// A stored decision-config row that will not parse falls back to the CODE DEFAULT, which
// means the workspace's auto-reject rules are not in force while the settings panel shows
// the shipped defaults as if they had been chosen. `decision-config-store.ts` records each
// one, and this route is where that record becomes visible — a ledger nothing renders does
// not exist.
//
// The SAME split as everything else here: the verdict (`ok`, `config`, the status code) is
// public, the reason is not. A config reason names a WORKSPACE ID, so it is strictly more
// sensitive than the counts already gated — it tells an anonymous caller a tenant exists.

const { getDecisionConfig, __resetDecisionConfigHealth } = await import("../../_lib/decision-config-store.ts");
const { UNIT_DB_PATH } = await import("../../_lib/testing/unit-db.ts");
const { default: Database } = await import("better-sqlite3");

/** Put one unreadable row in the store and read it, so the ledger holds exactly one issue. */
function recordOneConfigIssue(workspaceId: string): void {
  getDecisionConfig("screening", workspaceId); // materialize the table
  __resetDecisionConfigHealth();
  const raw = new Database(UNIT_DB_PATH);
  raw.prepare(`DELETE FROM decision_config WHERE phase = ? AND workspace_id = ?`).run("screening", workspaceId);
  raw
    .prepare(`INSERT INTO decision_config (phase, config_json, updated_at, workspace_id) VALUES (?, ?, ?, ?)`)
    .run("screening", "{not json", new Date().toISOString(), workspaceId);
  raw.close();
  getDecisionConfig("screening", workspaceId);
}

test("a corrupt config row degrades the probe, and the reason stays behind the gate", async () => {
  const ws = "ws-health-corrupt";
  recordOneConfigIssue(ws);
  try {
    cookieValue = null;
    const anon = await probe();
    // The VERDICT is public: a named sub-check, so the monitor is told WHICH thing broke.
    assert.equal(anon.config, "degraded", "the public verdict names the failing sub-check");
    assert.equal(anon.ok, false, "rules that are not in force are not a healthy deployment");
    // The DETAIL is not. The reason carries a workspace id; the sample carries the parse error.
    assert.equal(anon.degradedReasons, undefined, "omitted, never blanked to a lying []");
    assert.equal(anon.configIssues, undefined, "a tenant id is not a public readiness fact");

    cookieValue = signSession(DEFAULT_WORKSPACE, Date.now());
    const op = await probe();
    assert.equal(op.config, "degraded");
    assert.ok(
      op.degradedReasons?.some((r) => r === `decision-config:screening unreadable (team ${ws})`),
      `the operator's reason names the phase, the tier and the workspace — got ${JSON.stringify(op.degradedReasons)}`
    );
    assert.equal(op.configIssues?.[0]?.phase, "screening", "the ledger sample rides the same gate as the counts");
    assert.equal(op.configIssues?.[0]?.scope, "team");
  } finally {
    __resetDecisionConfigHealth();
  }
});

test("a healthy config store says so and adds no reason", async () => {
  __resetDecisionConfigHealth();
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now());
  const body = await probe();
  assert.equal(body.config, "ok");
  assert.equal(
    body.degradedReasons?.some((r) => r.startsWith("decision-config:")),
    false,
    "a clean ledger must not manufacture a reason"
  );
  assert.deepEqual(body.configIssues, [], "an empty sample, not a missing key — the operator can tell the two apart");
});
