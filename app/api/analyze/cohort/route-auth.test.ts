// The Cohort Studio doors' auth posture, driven against the REAL handlers.
//
// The four cohort handlers (GET+POST /api/analyze/cohort, GET /api/analyze/cohort/[id],
// GET /api/analyze/cohort/proposal) hold a whole field of candidates' CVs and spend paid
// analyses, so each one re-verifies the session with requireOperator() at the handler — the
// proxy gate is not defence in depth on its own (ADR 0005) — and only then asks the seat.
// This file pins both halves:
//   • no session at all                      → 401 on every door
//   • a demo-sandbox session                 → 401 on every door (identity is not an operator)
//   • a disabled account's still-signed cookie → 401 on every door (offboarding ends access)
//   • a viewer starting a cohort             → 403 FORBIDDEN_CAPABILITY, pipeline:write as data
//   • NON-VACUITY: a viewer may read and a recruiter may reach the POST body check, so the
//     gate is a gate and not a wall.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope; these tests are ABOUT the
// decision the auth helpers make from the cookie jar, so the jar is a virtual module.
const VIRTUAL_HEADERS = "kp-test:next-headers-analyze-cohort";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpCohortTestCookie?: () => string | null }).__kpCohortTestCookie = () => cookieValue;
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
            const value = globalThis.__kpCohortTestCookie();
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

// A signing secret AND an operator password: without the password every caller folds to
// owner (open dev mode, unchanged by this posture) and there is no decision left to prove.
process.env.KP_SECRET = "analyze-cohort-auth-test-secret";
process.env.KP_OPERATOR_PASSWORD = "analyze-cohort-auth-test-password";

const { GET: listCohorts, POST: startCohort } = await import("./route.ts");
const { GET: readCohort } = await import("./[id]/route.ts");
const { GET: proposeCohort } = await import("./proposal/route.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { createUser, setUserStatus } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession, DEMO_WORKSPACE } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-cohort-auth";
const team = createWorkspace("Cohort auth team", ORG);
const mk = (slug: string, role: "recruiter" | "viewer") => {
  const u = createUser({ orgId: ORG, email: `cohort.${slug}@cohort-auth.test`, name: `Cohort ${slug}`, status: "active", password: `cohort-pw-${slug}-1` });
  upsertMembership(u.id, team.id, role);
  return u;
};
const recruiter = mk("recruiter", "recruiter");
const viewer = mk("viewer", "viewer");
const leaver = mk("leaver", "recruiter");

const signedInAs = (user: { id: string; orgId: string } | null): void => {
  cookieValue = user === null ? null : signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
};
const demoSession = (): void => {
  cookieValue = signSession(DEMO_WORKSPACE, Date.now());
};

const get = (url: string) => new Request(url, { method: "GET", headers: { "x-forwarded-for": "10.0.0.7" } });
const post = (body: unknown) =>
  new Request("http://localhost/api/analyze/cohort", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.7" },
  });

type Door = { name: string; call: () => Promise<Response> };
const DOORS: Door[] = [
  { name: "GET /api/analyze/cohort", call: () => listCohorts() },
  { name: "POST /api/analyze/cohort", call: () => startCohort(post({ jdSlug: "backend-dev", members: [] })) },
  { name: "GET /api/analyze/cohort/[id]", call: () => readCohort(get("http://localhost/api/analyze/cohort/c-1"), { params: Promise.resolve({ id: "c-1" }) }) },
  { name: "GET /api/analyze/cohort/proposal", call: () => proposeCohort(get("http://localhost/api/analyze/cohort/proposal?jd=backend-dev")) },
];

for (const door of DOORS) {
  test(`${door.name} answers 401 with no session at all`, async () => {
    signedInAs(null);
    assert.equal((await door.call()).status, 401);
  });

  test(`${door.name} answers 401 to a demo-sandbox session (a signature is not an operator)`, async () => {
    demoSession();
    assert.equal((await door.call()).status, 401);
  });

  test(`${door.name} answers 401 to a disabled account's still-signed cookie`, async () => {
    setUserStatus(leaver.id, "disabled");
    try {
      signedInAs(leaver);
      assert.equal((await door.call()).status, 401, "offboarding must end access at the handler, not only at the proxy");
    } finally {
      setUserStatus(leaver.id, "active");
    }
  });
}

test("POST /api/analyze/cohort refuses a viewer with FORBIDDEN_CAPABILITY (pipeline:write)", async () => {
  signedInAs(viewer);
  const res = await startCohort(post({ jdSlug: "backend-dev", members: [] }));
  assert.equal(res.status, 403, "a viewer seat must not start paid analyses");
  const body = (await res.json()) as { code?: string; capability?: string };
  assert.equal(body.code, "FORBIDDEN_CAPABILITY");
  assert.equal(body.capability, "pipeline:write");
});

// ---- NON-VACUITY: the gate is a gate, not a wall -------------------------------------

test("a viewer reads the recent-cohorts strip", async () => {
  signedInAs(viewer);
  const res = await listCohorts();
  assert.equal(res.status, 200);
});

test("a viewer reaching an unknown cohort is told it is not found, not refused", async () => {
  signedInAs(viewer);
  const res = await readCohort(get("http://localhost/api/analyze/cohort/nope"), { params: Promise.resolve({ id: "nope" }) });
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "COHORT_NOT_FOUND");
});

test("a viewer asking for a proposal on an unknown JD is told it is not found, not refused", async () => {
  signedInAs(viewer);
  const res = await proposeCohort(get("http://localhost/api/analyze/cohort/proposal?jd=no-such-jd"));
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "JD_NOT_FOUND");
});

test("a recruiter passes both gates and meets the body check", async () => {
  signedInAs(recruiter);
  const res = await startCohort(post({ jdSlug: "backend-dev", members: [] }));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "COHORT_REQUEST_INVALID");
});
