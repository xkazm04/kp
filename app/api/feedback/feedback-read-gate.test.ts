// WHO may read the recruiter feedback inbox.
//
// GET /api/feedback returns 50 rows of colleagues' free-text messages, each carrying
// the author's REPLY ADDRESS (feedback-store.ts stamps `email` from the submitting
// session). It used to require nothing but a session, so on a team deployment every
// viewer, hiring manager and recruiter in the workspace could read all of it. Nothing
// pinned that, and nothing would have noticed the day the gate was added or removed.
//
// The bar is `members:manage` — the capability that already gates the member list and
// the invite list (app/api/org/invites/route.ts), because this is a read OF the people
// in the org. Not `org:manage`: that is owner-only (roles.ts) and would lock out the
// admin who runs /control, which is the wrong bar for a read.
//
// The POST half is a different door with a different rule (any signed-in member may
// FILE feedback) and is deliberately re-asserted here, so a future edit cannot
// "simplify" the two verbs onto one gate and silently close the submit door.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
//   node scripts/run-unit-tests.mjs "app/api/feedback/*.test.ts"
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so resolve it to a virtual
// module whose cookie jar this file drives (org-routes.test.ts pattern).
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpFeedbackTestCookie?: () => string | null }).__kpFeedbackTestCookie = () => cookieValue;
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
            const value = globalThis.__kpFeedbackTestCookie();
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

// A signing secret AND an operator password: without the password every caller folds
// to owner (open dev mode) and there is no authority decision left to prove.
process.env.KP_SECRET = "feedback-gate-test-secret";
process.env.KP_OPERATOR_PASSWORD = "feedback-gate-test-password";

const { GET, POST } = await import("./route.ts");
const { createWorkspace } = await import("../../_lib/db/workspaces.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession } = await import("../../_lib/auth/session.ts");
const { recordFeedback } = await import("../../_lib/feedback-store.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const team = createWorkspace("Feedback gate team", ORG);

const admin = createUser({ orgId: ORG, email: "fb.admin@csas.cz", name: "FB Admin", status: "active", password: "admin-pw-1234" });
const plain = createUser({ orgId: ORG, email: "fb.plain@csas.cz", name: "FB Plain", status: "active", password: "plain-pw-1234" });
const viewer = createUser({ orgId: ORG, email: "fb.viewer@csas.cz", name: "FB Viewer", status: "active", password: "viewer-pw-1234" });

upsertMembership(admin.id, team.id, "admin"); // members:manage
upsertMembership(plain.id, team.id, "recruiter"); // pipeline:write, never members:manage
upsertMembership(viewer.id, team.id, "viewer"); // read only

// The row a leak would hand out: someone else's words AND their address.
recordFeedback({ message: "The pipeline board scrolls oddly.", route: "/?tab=pipeline", email: "someone.else@csas.cz", appVersion: "1.2.3" }, team.id);

function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
}

type FeedbackBody = { feedback?: { message: string; email: string | null }[]; code?: string; error?: string };
const bodyOf = async (r: Response): Promise<FeedbackBody> => (await r.json()) as FeedbackBody;

const submitReq = (): NextRequest =>
  new Request("http://localhost/api/feedback", {
    method: "POST",
    body: JSON.stringify({ message: "A perfectly ordinary report from a recruiter.", route: "/?tab=pipeline" }),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
  }) as unknown as NextRequest;

test("a recruiter cannot read the feedback inbox", async () => {
  signedInAs(plain);
  const r = await GET();
  assert.equal(r.status, 403, "pipeline:write is not permission to read colleagues' reports");
  const body = await bodyOf(r);
  assert.equal(body.feedback, undefined, "not one row, not even a redacted one");
  assert.equal(body.code, "FEEDBACK_READ_FORBIDDEN", "the console renders the CODE, never the server's English");
});

test("a viewer cannot read the feedback inbox either", async () => {
  signedInAs(viewer);
  const r = await GET();
  assert.equal(r.status, 403);
  assert.equal((await bodyOf(r)).code, "FEEDBACK_READ_FORBIDDEN");
});

test("a session-less caller is refused with the same code at 401", async () => {
  signedInAs(null);
  const r = await GET();
  assert.equal(r.status, 401, "unauthenticated is 401, under-privileged is 403 — requireCapability's split");
  assert.equal((await bodyOf(r)).code, "FEEDBACK_READ_FORBIDDEN");
});

test("an admin (members:manage) reads the inbox, addresses included", async () => {
  signedInAs(admin);
  const r = await GET();
  assert.equal(r.status, 200);
  const rows = (await bodyOf(r)).feedback ?? [];
  assert.ok(rows.length >= 1, "the gate is a gate, not a deletion");
  assert.equal(rows[0]?.email, "someone.else@csas.cz", "the reply address is exactly what the gate exists to protect");
});

test("the SUBMIT door stays open to a plain member", async () => {
  signedInAs(plain);
  const r = await POST(submitReq());
  assert.equal(r.status, 200, "filing feedback is not an administrative act — only reading it is");
});
