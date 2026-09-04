// The last four dev-case doors ask the SEAT, not just the session.
//
// The sibling of app/api/write-capability-gate.test.ts, narrowed to the four dev-case
// doors that were still on route-capability-coverage.test.ts's ALLOWED list when
// /perfect wave 31 opened. Three of them (`POST /api/devcase`, `/source`, `/submit`)
// asked NOTHING about the caller at all — not even identity presence — so a viewer
// seat could approve a case into the library, spend the sourcing spawn against the
// candidate DB and file a submission on another recruiter's posting. The fourth
// (`/skill-profile`) had `requireOperator`, which answers "is a trusted, non-demo
// session present?" and says yes to a viewer exactly as loudly as to an owner.
//
// All four are recruiter operations, so all four ask `pipeline:write`:
//   • viewer            → 403 FORBIDDEN_CAPABILITY, carrying the capability as data
//   • recruiter / owner → NOT refused by the gate (each door's own 400 is its business)
//   • no session at all  → 401 (requireOperator's answer)
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";

// Point next/server at the shared test shim BEFORE the routes load (hooks only affect
// later resolutions — hence the dynamic imports below).
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope. These tests are ABOUT the
// decision the auth helpers make from the cookie jar, so resolve it to a virtual
// module whose jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpDevcaseCapCookie?: () => string | null }).__kpDevcaseCapCookie = () => cookieValue;
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
            const value = globalThis.__kpDevcaseCapCookie();
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

// A signing secret AND an operator password. Without the password every caller folds
// to owner (open dev mode) and there is no authority decision left to prove — which is
// also the honest statement of the acceptance: OPEN MODE IS UNCHANGED by this work.
process.env.KP_SECRET = "devcase-doors-capability-secret";
process.env.KP_OPERATOR_PASSWORD = "devcase-doors-capability-password";

const { POST: approveCase } = await import("./route.ts");
const { POST: sourceCase } = await import("./source/route.ts");
const { POST: submitCase } = await import("./submit/route.ts");
const { POST: mintProfile } = await import("./skill-profile/route.ts");

const { createWorkspace } = await import("../../_lib/db/workspaces.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession } = await import("../../_lib/auth/session.ts");

after(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
  cleanupUnitDb();
});

const ORG = "org-devcase-caps";
const team = createWorkspace("Devcase caps team", ORG);
const mk = (slug: string, role: "owner" | "recruiter" | "viewer") => {
  const u = createUser({ orgId: ORG, email: `dc.${slug}@caps.test`, name: `DC ${slug}`, status: "active", password: `dc-pw-${slug}-1` });
  upsertMembership(u.id, team.id, role);
  return u;
};
const owner = mk("owner", "owner");
const recruiter = mk("recruiter", "recruiter");
const viewer = mk("viewer", "viewer");

function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
}

// Every body below is DELIBERATELY empty of the door's required field, so a caller who
// gets past the gate stops at that door's own 400 — no case is approved, no Python
// matcher is spawned and no submission is filed by this file.
const req = (): NextRequest =>
  new Request("http://localhost/api/test", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "content-type": "application/json", "x-forwarded-for": "10.9.0.1" },
  }) as unknown as NextRequest;

type Door = { name: string; call: () => Promise<Response> };
const DOORS: Door[] = [
  { name: "POST /api/devcase", call: () => approveCase(req()) },
  { name: "POST /api/devcase/source", call: () => sourceCase(req()) },
  { name: "POST /api/devcase/submit", call: () => submitCase(req()) },
  { name: "POST /api/devcase/skill-profile", call: () => mintProfile(req()) },
];

for (const door of DOORS) {
  test(`${door.name} refuses a viewer with FORBIDDEN_CAPABILITY (pipeline:write)`, async () => {
    signedInAs(viewer);
    const r = await door.call();
    assert.equal(r.status, 403, `${door.name} let a viewer through`);
    const body = (await r.json()) as { code?: string; capability?: string };
    assert.equal(body.code, "FORBIDDEN_CAPABILITY", "the client renders errors.<CODE>, never the server's sentence");
    assert.equal(body.capability, "pipeline:write", "the capability rides as DATA so the UI can name what the seat is missing");
  });

  test(`${door.name} answers 401 with no session at all`, async () => {
    signedInAs(null);
    const r = await door.call();
    assert.equal(r.status, 401, "a caller with no session has nothing to be told about capabilities");
  });

  // NON-VACUITY, twice over: the gate is a gate, not a wall, and `pipeline:write` is
  // the RIGHT capability — a recruiter holds it, so a recruiter must not be refused.
  for (const [label, seat] of [["a recruiter", recruiter], ["an owner", owner]] as const) {
    test(`${door.name} does not refuse ${label}`, async () => {
      signedInAs(seat);
      const r = await door.call();
      assert.notEqual(r.status, 403, `${label} holds pipeline:write`);
      assert.notEqual(r.status, 401);
    });
  }
}
