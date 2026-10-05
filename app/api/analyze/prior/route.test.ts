import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-analyze-prior";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpPriorTestCookie?: () => string | null }).__kpPriorTestCookie = () => cookieValue;
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
            const value = globalThis.__kpPriorTestCookie();
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

process.env.KP_SECRET = "analyze-prior-test-secret";
process.env.KP_OPERATOR_PASSWORD = "analyze-prior-test-password";

const { GET } = await import("./route.ts");
const { saveAnalysis, setAnalysisDisposition, listAnalysesPage } = await import("../../../_lib/db/analyses.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-prior";
const recruiter = createUser({
  orgId: ORG,
  email: "recruiter.prior@csas.cz",
  name: "Prior Recruiter",
  status: "active",
  password: "rec-prior-pw-123",
});
const WS_A = DEFAULT_WORKSPACE;
const WS_B = "team-prior-b";

upsertMembership(recruiter.id, WS_A, "recruiter");
upsertMembership(recruiter.id, WS_B, "recruiter");

function signedInAs(ws: string = WS_A): void {
  cookieValue = signSession(ws, Date.now(), { sub: recruiter.id, org: ORG });
}

function clearSession(): void {
  cookieValue = null;
}

const getPrior = (url: string) =>
  GET(new Request(url, { method: "GET" }) as unknown as NextRequest);

test("GET /api/analyze/prior returns 401 when operator password is set and session is absent", async () => {
  clearSession();
  const hash = "a".repeat(64);
  const res = await getPrior(`http://localhost/api/analyze/prior?cv=${hash}&jd=backend-dev`);
  assert.equal(res.status, 401);
});

test("GET /api/analyze/prior returns rows with disposition and isolates tenancy", async () => {
  signedInAs(WS_A);
  const hashA = "1".repeat(64);
  const hashB = "2".repeat(64);

  // Seed in workspace A
  const sA = saveAnalysis(
    {
      candidateLabel: "Alice in A",
      jdSlug: "backend-dev",
      score: 88,
      roleFamily: "engineering",
      seniority: "senior",
      payload: {},
      cvHash: hashA,
    },
    WS_A
  );
  setAnalysisDisposition(sA.slug, "advance", "Good candidate", WS_A);

  // Seed in workspace B
  const sB = saveAnalysis(
    {
      candidateLabel: "Bob in B",
      jdSlug: "backend-dev",
      score: 75,
      roleFamily: "engineering",
      seniority: "mid",
      payload: {},
      cvHash: hashB,
    },
    WS_B
  );
  setAnalysisDisposition(sB.slug, "pass", "Not enough exp", WS_B);

  // Query as workspace A for both hashes
  const res = await getPrior(
    `http://localhost/api/analyze/prior?cv=${hashA}&cv=${hashB}&jd=backend-dev`
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; rows: Array<{ slug: string; disposition: string | null; cv_hash: string }> };
  assert.equal(body.ok, true);
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].slug, sA.slug);
  assert.equal(body.rows[0].disposition, "advance");
  assert.equal(body.rows[0].cv_hash, hashA);

  // Query as workspace B for both hashes
  signedInAs(WS_B);
  const resB = await getPrior(
    `http://localhost/api/analyze/prior?cv=${hashA}&cv=${hashB}&jd=backend-dev`
  );
  assert.equal(resB.status, 200);
  const bodyB = (await resB.json()) as { ok: boolean; rows: Array<{ slug: string; disposition: string | null; cv_hash: string }> };
  assert.equal(bodyB.ok, true);
  assert.equal(bodyB.rows.length, 1);
  assert.equal(bodyB.rows[0].slug, sB.slug);
  assert.equal(bodyB.rows[0].disposition, "pass");
  assert.equal(bodyB.rows[0].cv_hash, hashB);
});

test("Characterization of the premise: older pass preserved while listAnalysesPage shows newer undecided row", async () => {
  signedInAs(WS_A);
  const hashC = "3".repeat(64);

  // 1. Seed (h, backend-dev) with disposition 'pass'
  const older = saveAnalysis(
    {
      candidateLabel: "Charlie",
      jdSlug: "backend-dev",
      score: 80,
      roleFamily: "engineering",
      seniority: "senior",
      payload: {},
      cvHash: hashC,
    },
    WS_A
  );
  setAnalysisDisposition(older.slug, "pass", "Passed in round 1", WS_A);

  // 2. Save a second (h, backend-dev) row (no disposition set)
  const newer = saveAnalysis(
    {
      candidateLabel: "Charlie re-run",
      jdSlug: "backend-dev",
      score: 85,
      roleFamily: "engineering",
      seniority: "senior",
      payload: {},
      cvHash: hashC,
    },
    WS_A
  );

  // 3. listAnalysesPage returns the NEWER row only, with disposition null (RES5 regression premise)
  const page = listAnalysesPage({ limit: 10 }, WS_A);
  const matchingGroup = page.rows.filter((r) => r.cv_hash === hashC && r.jd_slug === "backend-dev");
  assert.equal(matchingGroup.length, 1, "listAnalysesPage collapses by cv_hash + jd_slug to the newest row");
  assert.equal(matchingGroup[0].slug, newer.slug, "the kept row in History is the newer run");
  assert.equal(matchingGroup[0].disposition, null, "History shows the candidate as undecided");

  // 4. prior-runs route returns BOTH rows, naming the pass and its older slug
  const res = await getPrior(`http://localhost/api/analyze/prior?cv=${hashC}&jd=backend-dev`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; rows: Array<{ slug: string; disposition: string | null }> };
  assert.equal(body.ok, true);
  assert.equal(body.rows.length, 2);
  const decidedRow = body.rows.find((r) => r.disposition === "pass");
  assert.ok(decidedRow, "the prior-runs answer still finds the decided row");
  assert.equal(decidedRow.slug, older.slug);
});
