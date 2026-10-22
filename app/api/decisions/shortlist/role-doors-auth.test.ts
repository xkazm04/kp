// The two role doors under /api/decisions that carry candidate data per role: the role
// decision view (GET role-view) and the human-set shortlist (GET/POST shortlist). Both call
// requireOperator at the handler like the rest of /api/decisions/*, and the shortlist write
// additionally needs the recruiter seat (pipeline:write) and takes its actor from the
// session, never from the body.
//
// Drives the REAL handlers on a throwaway SQLite file. unit-db.ts must stay the FIRST
// project import. Run: node scripts/run-unit-tests.mjs "app/api/decisions/shortlist/*.test.ts"
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope: resolve it to a virtual module
// whose cookie jar this file drives, since the tests are about the authority decision.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpRoleDoorsTestCookie?: () => string | null }).__kpRoleDoorsTestCookie = () => cookieValue;
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
            const value = globalThis.__kpRoleDoorsTestCookie();
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
process.env.KP_SECRET = "role-doors-test-secret";
process.env.KP_OPERATOR_PASSWORD = "role-doors-test-password";

const { GET: roleViewGet } = await import("../role-view/route.ts");
const { GET: shortlistGet, POST: shortlistPost } = await import("./route.ts");
const { createPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const recruiter = createUser({ orgId: ORG, email: "rd.recruiter@csas.cz", name: "Rec", status: "active", password: "rec-pw-1234" });
const viewer = createUser({ orgId: ORG, email: "rd.viewer@csas.cz", name: "View", status: "active", password: "view-pw-1234" });
upsertMembership(recruiter.id, DEFAULT_WORKSPACE, "recruiter");
upsertMembership(viewer.id, DEFAULT_WORKSPACE, "viewer");

function seat(user: { id: string; orgId: string } | null) {
  cookieValue = user === null ? null : signSession(DEFAULT_WORKSPACE, Date.now(), { sub: user.id, org: user.orgId });
}

const JOB = "job-role-doors";
const entry = createPipelineEntry({
  candidateId: `c-rd-${process.pid}`,
  candidateLabel: "Ada",
  jobId: JOB,
  jobTitle: "Role",
  stage: "Interview",
  workspaceId: DEFAULT_WORKSPACE,
}).entry;

const roleViewReq = (job = JOB) => new Request(`http://localhost/api/decisions/role-view?job=${job}`);
const shortlistReq = (job = JOB) => new Request(`http://localhost/api/decisions/shortlist?job=${job}`);
const markReq = (body: unknown) =>
  new Request("http://localhost/api/decisions/shortlist", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

test("no operator session: every role door answers 401", async () => {
  seat(null);
  for (const [name, call] of [
    ["GET role-view", () => roleViewGet(roleViewReq())],
    ["GET shortlist", () => shortlistGet(shortlistReq())],
    ["POST shortlist", () => shortlistPost(markReq({ job: JOB, entryId: entry.id, state: "shortlisted" }))],
  ] as const) {
    const res = await call();
    assert.equal(res.status, 401, `${name} must 401 without a session`);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  }
});

test("a recruiter session reads the role view and the shortlist", async () => {
  seat(recruiter);
  const view = await roleViewGet(roleViewReq());
  assert.equal(view.status, 200);
  const missing = await roleViewGet(new Request("http://localhost/api/decisions/role-view"));
  assert.equal(missing.status, 400);
  assert.equal(((await missing.json()) as { code?: string }).code, "ROLE_VIEW_JOB_REQUIRED");

  const list = await shortlistGet(shortlistReq());
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(((await list.json()) as { rows: unknown[] }).rows));
});

test("a recruiter sets a mark; the actor comes from the session, not the body", async () => {
  seat(recruiter);
  const res = await shortlistPost(markReq({ job: JOB, entryId: entry.id, state: "shortlisted", actor: "human:Mallory" }));
  assert.equal(res.status, 200);
  const row = ((await res.json()) as { row: { entryId: string; state: string; setBy: string } }).row;
  assert.equal(row.entryId, entry.id);
  assert.equal(row.state, "shortlisted");
  assert.notEqual(row.setBy, "human:Mallory");

  const list = (await (await shortlistGet(shortlistReq())).json()) as { rows: Array<{ entryId: string }> };
  assert.deepEqual(list.rows.map((r) => r.entryId), [entry.id]);

  const bad = await shortlistPost(markReq({ job: JOB, entryId: entry.id, state: "bogus" }));
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { code?: string }).code, "SHORTLIST_REQUEST_INVALID");
  const unknown = await shortlistPost(markReq({ job: JOB, entryId: "nope", state: "chosen" }));
  assert.equal(unknown.status, 404);
  assert.equal(((await unknown.json()) as { code?: string }).code, "SHORTLIST_ENTRY_UNKNOWN");
});

test("a viewer may read but a shortlist write needs pipeline:write", async () => {
  seat(viewer);
  assert.equal((await roleViewGet(roleViewReq())).status, 200);
  assert.equal((await shortlistGet(shortlistReq())).status, 200);
  const res = await shortlistPost(markReq({ job: JOB, entryId: entry.id, state: "chosen" }));
  assert.equal(res.status, 403);
  const body = (await res.json()) as { code?: string; capability?: string };
  assert.equal(body.code, "FORBIDDEN_CAPABILITY");
  assert.equal(body.capability, "pipeline:write");
});
