// AUTHORITY on the dev-case control room's write doors (/perfect wave 21,
// internal-explorers). Until the Director's operator gate landed this wave these four
// doors carried NO check at all; requireOperator closed the identity half, and this file
// drives the capability half against the REAL handlers on a throwaway SQLite file:
//
//   POST /api/devcase/control  {pause|resume}  — the kill switch is ONE global
//                              dev_control key, so it halts automation for the whole
//                              deployment: `org:manage`, resolved org-wide.
//   POST /api/devcase/control  {reconcile}     — re-enqueues THIS team's orphaned
//                              lifecycles: `pipeline:write`.
//   POST /api/devcase/outcomes {setFloor}      — moves the promote threshold every
//                              future auto-decision is judged against: `org:manage`.
//   POST /api/devcase/outcomes (record)        — a recruiter operation on this team's
//                              outcome corpus: `pipeline:write`.
//   POST /api/devcase/lifecycle/[id]/approve   — signs off an Art. 22 human gate and
//                              publishes a case to a candidate: `pipeline:write`.
//
// Before the gates, every one of these answered 200 to a VIEWER seat.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

// The worktree's node_modules junction makes next/server's `connection()` a no-op, which
// would let these handlers pass on a machine where they must not. Point next/server at
// the shared shim BEFORE the routes load (hooks only affect later resolutions).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so resolve it to a virtual
// module whose cookie jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpCtrlTestCookie?: () => string | null }).__kpCtrlTestCookie = () => cookieValue;
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
            const value = globalThis.__kpCtrlTestCookie();
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
// owner (open dev mode) and there is no authority decision left to prove.
process.env.KP_SECRET = "devcase-control-authz-secret";
process.env.KP_OPERATOR_PASSWORD = "devcase-control-authz-password";

const { POST: controlPost } = await import("./route.ts");
const { POST: outcomesPost } = await import("../outcomes/route.ts");
const { POST: approvePost } = await import("../lifecycle/[id]/approve/route.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const team = createWorkspace("Control team", ORG);

const owner = createUser({ orgId: ORG, email: "ctrl.owner@csas.cz", name: "Ctrl Owner", status: "active", password: "owner-pw-1234" });
const recruiter = createUser({ orgId: ORG, email: "ctrl.rec@csas.cz", name: "Ctrl Recruiter", status: "active", password: "rec-pw-12345" });
const viewer = createUser({ orgId: ORG, email: "ctrl.view@csas.cz", name: "Ctrl Viewer", status: "active", password: "view-pw-1234" });

upsertMembership(owner.id, team.id, "owner");
upsertMembership(recruiter.id, team.id, "recruiter");
upsertMembership(viewer.id, team.id, "viewer");

function signedInAs(user: { id: string; orgId: string }): void {
  cookieValue = signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
}

const post = (url: string, body?: unknown): NextRequest =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

/** Every refusal on these doors must be a CODE, never the server's English prose. */
async function refusal(r: Response): Promise<{ status: number; code?: string; capability?: string }> {
  const body = (await r.json()) as { code?: string; capability?: string };
  return { status: r.status, code: body.code, capability: body.capability };
}

// ---- the kill switch: org:manage ------------------------------------------------

test("a VIEWER may not pause automation — the kill switch is deployment-wide", async () => {
  signedInAs(viewer);
  const r = await refusal(await controlPost(post("/api/devcase/control", { action: "pause" })));
  assert.equal(r.status, 403, "this answered 200 before the gate");
  assert.equal(r.code, "FORBIDDEN_CAPABILITY", "a code, so the room can say it in the reader's language");
  assert.equal(r.capability, "org:manage", "and it names the permission to ask for");
});

test("a RECRUITER may not pause automation either — pipeline:write is not org policy", async () => {
  signedInAs(recruiter);
  assert.equal((await controlPost(post("/api/devcase/control", { action: "pause" }))).status, 403);
});

test("an OWNER may pause and resume", async () => {
  signedInAs(owner);
  const paused = await controlPost(post("/api/devcase/control", { action: "pause" }));
  assert.equal(paused.status, 200);
  assert.equal(((await paused.json()) as { autonomy: string }).autonomy, "paused");
  const resumed = await controlPost(post("/api/devcase/control", { action: "resume" }));
  assert.equal(resumed.status, 200);
  const body = (await resumed.json()) as { autonomy: string; resumed: number; budgetExhausted: boolean };
  assert.equal(body.autonomy, "on");
  assert.equal(typeof body.resumed, "number", "the sweep reports its own numbers — the room renders them");
  assert.equal(body.budgetExhausted, false);
});

// ---- reconcile: pipeline:write ---------------------------------------------------

test("a VIEWER may not reconcile — it re-enqueues agent runs", async () => {
  signedInAs(viewer);
  const r = await refusal(await controlPost(post("/api/devcase/control", { action: "reconcile" })));
  assert.equal(r.status, 403, "this answered 200 before the gate");
  assert.equal(r.capability, "pipeline:write");
});

test("a RECRUITER may reconcile their own team", async () => {
  signedInAs(recruiter);
  assert.equal((await controlPost(post("/api/devcase/control", { action: "reconcile" }))).status, 200);
});

test("an unknown action answers a CODE, not English prose", async () => {
  signedInAs(owner);
  const r = await refusal(await controlPost(post("/api/devcase/control", { action: "detonate" })));
  assert.equal(r.status, 400);
  assert.equal(r.code, "DEVCASE_CONTROL_ACTION_UNKNOWN");
});

// ---- the promote floor: org:manage ----------------------------------------------

test("a RECRUITER may not move the promote floor — it is deployment policy", async () => {
  signedInAs(recruiter);
  const r = await refusal(await outcomesPost(post("/api/devcase/outcomes", { setFloor: 55 })));
  assert.equal(r.status, 403, "this answered 200 before the gate");
  assert.equal(r.capability, "org:manage");
});

test("an OWNER may move the promote floor", async () => {
  signedInAs(owner);
  const r = await outcomesPost(post("/api/devcase/outcomes", { setFloor: 55 }));
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { activeFloor: number }).activeFloor, 55);
});

test("a non-finite floor answers a CODE, not the server's English sentence", async () => {
  signedInAs(owner);
  // `1e999` is valid JSON and JSON.parse yields Infinity, so this branch IS reachable
  // from the wire — and typeof Infinity === "number", which is how it used to reach the
  // store, stringify to "Infinity", read back as null and silently revert the floor.
  const raw = new Request("http://localhost/api/devcase/outcomes", {
    method: "POST",
    body: '{"setFloor": 1e999}',
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
  const r = await refusal(await outcomesPost(raw));
  assert.equal(r.status, 400);
  assert.equal(r.code, "DEVCASE_FLOOR_INVALID");
});

test("an invalid outcome answers DEVCASE_OUTCOME_INVALID with the zod issue as DATA", async () => {
  signedInAs(recruiter);
  const res = await outcomesPost(post("/api/devcase/outcomes", { candidateRef: "ada", outcome: "vanished" }));
  const body = (await res.json()) as { code?: string; issue?: string };
  assert.equal(res.status, 400);
  assert.equal(body.code, "DEVCASE_OUTCOME_INVALID");
  assert.equal(typeof body.issue, "string", "the English sentence rides as data, for the log and API consumers");
});

// ---- recording an outcome: pipeline:write ----------------------------------------

test("a VIEWER may not record an outcome — it feeds the floor recommendation", async () => {
  signedInAs(viewer);
  const r = await refusal(await outcomesPost(post("/api/devcase/outcomes", { candidateRef: "ada", outcome: "hired", performance: 4 })));
  assert.equal(r.status, 403, "this answered 200 before the gate");
  assert.equal(r.capability, "pipeline:write");
});

test("a RECRUITER may record an outcome", async () => {
  signedInAs(recruiter);
  assert.equal((await outcomesPost(post("/api/devcase/outcomes", { candidateRef: "ada", outcome: "hired", performance: 4 }))).status, 200);
});

// ---- the Art. 22 gate: pipeline:write --------------------------------------------

test("a VIEWER may not approve an Art. 22 gate", async () => {
  signedInAs(viewer);
  const r = await refusal(await approvePost(post("/api/devcase/lifecycle/lc-does-not-exist/approve"), params({ id: "lc-does-not-exist" })));
  // The capability is asked BEFORE the lookup on purpose: a seat that may not approve
  // must not be able to use this door as an existence oracle for lifecycle ids.
  assert.equal(r.status, 403, "this answered 404 (an oracle) before the gate");
  assert.equal(r.capability, "pipeline:write");
});

test("a RECRUITER passes the gate and reaches the ownership check", async () => {
  signedInAs(recruiter);
  const r = await approvePost(post("/api/devcase/lifecycle/lc-does-not-exist/approve"), params({ id: "lc-does-not-exist" }));
  assert.equal(r.status, 404, "authorized, so the answer is about the lifecycle, not the seat");
});
