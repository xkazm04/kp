// POST /api/devcase/[id]/intake - the stop door (challenge-r09 devcase-lifecycle/B).
//
// A case published from the assignment detail (no lifecycle) had no way to stop intake:
// the only close was the lifecycle's, and the detail's own comment recorded the deferral.
// This door flips the case's OPEN postings to closed - the same write the lifecycle
// close makes - inside one IMMEDIATE transaction that first re-reads the case's newest
// lifecycle and refuses while a running lifecycle owns intake (its Close wraps the
// submitters up; this door notifies nobody). The UPDATE re-asserts status = 'open', so a
// repeat is a zero-change no-op with no second audit row. A reopen is an ordinary
// publish, which now asks the same seat the stop does.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { register, registerHooks } from "node:module";

register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope; the seat decision under test is
// made from the cookie jar, so the jar is driven from here.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpDevcaseIntakeCookie?: () => string | null }).__kpDevcaseIntakeCookie = () => cookieValue;
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
            const value = globalThis.__kpDevcaseIntakeCookie();
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

// A password, so seats are real: without it every caller folds to owner (open mode).
process.env.KP_SECRET = "devcase-intake-secret";
process.env.KP_OPERATOR_PASSWORD = "devcase-intake-password";

const { POST: STOP } = await import("./route.ts");
const { POST: PUBLISH } = await import("../../publish/route.ts");
const { POST: INBOUND } = await import("../../inbound/route.ts");
const { saveDevCase, createPosting, createLifecycle, updateLifecycle, getPosting, getDevCase, listPostings } = await import(
  "../../../../_lib/db/devcase.ts"
);
const { ensureDb } = await import("../../../../_lib/db/core.ts");
const { createWorkspace } = await import("../../../../_lib/db/workspaces.ts");
const { createUser } = await import("../../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../../_lib/db/memberships.ts");
const { signSession } = await import("../../../../_lib/auth/session.ts");

after(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
  cleanupUnitDb();
});

const ORG = "org-devcase-intake";
const team = createWorkspace("Intake team", ORG);
const other = createWorkspace("Other intake team", "org-devcase-intake-other");
const mk = (slug: string, role: "owner" | "recruiter" | "viewer") => {
  const u = createUser({ orgId: ORG, email: `in.${slug}@intake.test`, name: `IN ${slug}`, status: "active", password: `in-pw-${slug}-1` });
  upsertMembership(u.id, team.id, role);
  return u;
};
const recruiter = mk("recruiter", "recruiter");
const viewer = mk("viewer", "viewer");

function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
}

const design = (title: string) => ({ need: { title }, analysis: null, role: { title: "Backend engineer" }, case: { title } });
let tokenN = 0;
function publishedCase(title: string, ws = team.id): { caseId: string; postingId: string; token: string } {
  const caseId = saveDevCase(design(title), ws).id;
  const token = `tok-intake-${++tokenN}`;
  const posting = createPosting({ caseId, channel: "local", token, roleTitle: "Backend engineer", caseTitle: title });
  return { caseId, postingId: posting.id, token };
}

const stopReq = (action: unknown = "stop") =>
  new Request("http://localhost/api/devcase/x/intake", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.7.0.1" },
    body: JSON.stringify({ action }),
  });
const stop = (caseId: string, action?: unknown) => STOP(stopReq(action), { params: Promise.resolve({ id: caseId }) });
const publish = (caseId: string) =>
  PUBLISH(
    new Request("http://localhost/api/devcase/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId }),
    }) as never
  );
function inbound(token: string) {
  const url = `http://localhost/api/devcase/inbound?token=${encodeURIComponent(token)}`;
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidate: "ada", repoRef: "https://example.test/ada", contact: "ada@example.test" }),
  });
  Object.defineProperty(req, "nextUrl", { value: new URL(url) });
  return INBOUND(req as never);
}
const auditRows = (caseId: string) =>
  ensureDb().prepare(`SELECT actor, action, ref FROM dev_audit WHERE action = 'intake_stopped' AND ref = ?`).all(caseId) as Array<{
    actor: string;
    action: string;
    ref: string;
  }>;

const manual = publishedCase("Manual live assignment");

test("stop on a manual live case closes its open posting, the link answers 410, one audit row", async () => {
  signedInAs(recruiter);
  const r = await stop(manual.caseId);
  assert.equal(r.status, 200);
  const body = (await r.json()) as { closed?: number };
  assert.equal(body.closed, 1);
  assert.equal(getPosting(manual.postingId)?.status, "closed");
  const applied = await inbound(manual.token);
  assert.equal(applied.status, 410);
  assert.equal(((await applied.json()) as { code?: string }).code, "POSTING_CLOSED");
  const rows = auditRows(manual.caseId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "human");
});

test("a repeat stop re-writes nothing: {closed:0}, and no second audit row", async () => {
  signedInAs(recruiter);
  const r = await stop(manual.caseId);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { closed?: number }).closed, 0);
  assert.equal(auditRows(manual.caseId).length, 1);
});

test("a case whose lifecycle is still collecting: 409 DEVCASE_INTAKE_LIFECYCLE_OWNS, posting stays open", async () => {
  signedInAs(recruiter);
  const run = publishedCase("Lifecycle-run assignment");
  const lc = createLifecycle({ title: "run" }, true, "en", team.id);
  updateLifecycle(lc.id, { caseId: run.caseId, stage: "collecting" });
  const r = await stop(run.caseId);
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { code?: string }).code, "DEVCASE_INTAKE_LIFECYCLE_OWNS");
  assert.equal(getPosting(run.postingId)?.status, "open");
  assert.equal(auditRows(run.caseId).length, 0);
  // The detail reads the same lifecycle stage the door refused on (getDevCase).
  assert.equal(getDevCase(run.caseId)?.lifecycleStage, "collecting");
  assert.equal(getDevCase(manual.caseId)?.lifecycleStage, null);
});

test("another team's case answers the same 404 an unknown id does, and its posting stays open", async () => {
  signedInAs(recruiter);
  const foreign = publishedCase("Their assignment", other.id);
  const r = await stop(foreign.caseId);
  assert.equal(r.status, 404);
  assert.equal(((await r.json()) as { code?: string }).code, "DEVCASE_CASE_NOT_FOUND");
  const unknown = await stop("dc-does-not-exist");
  assert.equal(unknown.status, 404);
  assert.equal(getPosting(foreign.postingId)?.status, "open");
});

test("an action this door does not know is refused, coded", async () => {
  signedInAs(recruiter);
  const r = await stop(manual.caseId, "delete");
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as { code?: string }).code, "DEVCASE_INTAKE_ACTION_UNKNOWN");
});

test("a viewer seat may neither stop nor publish (reopen): 403 FORBIDDEN_CAPABILITY", async () => {
  const live = publishedCase("Viewer-probed assignment");
  signedInAs(viewer);
  for (const [name, call] of [
    ["stop", () => stop(live.caseId)],
    ["publish", () => publish(live.caseId)],
  ] as const) {
    const r = await call();
    assert.equal(r.status, 403, `${name} let a viewer through`);
    const body = (await r.json()) as { code?: string; capability?: string };
    assert.equal(body.code, "FORBIDDEN_CAPABILITY");
    assert.equal(body.capability, "pipeline:write");
  }
  assert.equal(getPosting(live.postingId)?.status, "open");
  const ratchet = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "route-capability-coverage.test.ts"),
    "utf8"
  );
  assert.ok(!ratchet.includes(`["devcase/publish/route.ts"`), "the publish door is judged: its ALLOWED line is gone");
});

test("after a stop, publish is a reopen: a fresh token, and the stopped one stays 410", async () => {
  signedInAs(recruiter);
  const r = await publish(manual.caseId);
  assert.equal(r.status, 200);
  const body = (await r.json()) as { alreadyPublished?: boolean; posting?: { token?: string; status?: string } };
  assert.equal(body.alreadyPublished, false);
  assert.ok(body.posting?.token && body.posting.token !== manual.token, "reopen mints a new link");
  assert.equal(body.posting?.status, "open");
  assert.equal((await inbound(manual.token)).status, 410, "the old link stays dead");
  const mine = listPostings(team.id).filter((p) => p.caseId === manual.caseId);
  assert.deepEqual(mine.map((p) => p.status).sort(), ["closed", "open"]);
});
