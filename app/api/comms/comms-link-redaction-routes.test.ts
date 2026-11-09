// A read-only seat reads letters but never the candidate's capability link. Driven as real
// handlers on a throwaway DB; the viewer/recruiter split is a real signed session.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-redaction";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpRedactionTestCookie?: () => string | null }).__kpRedactionTestCookie = () => cookieValue;
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
            const value = globalThis.__kpRedactionTestCookie();
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

process.env.KP_SECRET = "comms-redaction-test-secret";
process.env.KP_OPERATOR_PASSWORD = "comms-redaction-test-password";

const { GET: commsGet } = await import("./route.ts");
const { GET: devcaseGet } = await import("../devcase/comms/route.ts");
const { GET: timelineGet } = await import("../pipeline/[id]/timeline/route.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../_lib/auth/session.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { recordOutbox, getOutboxEntry } = await import("../../_lib/db/devcase.ts");

after(() => cleanupUnitDb());

const TOKEN = "offtok-SECRET-0123456789abcdef";
const LINK = `https://kp.example.com/offer/${TOKEN}?lang=en`;
const BODY = `Dear Ana, your offer: ${LINK}\nErase: /data/${TOKEN}?lang=en`;

const ORG = "org-default";
const recruiter = createUser({ orgId: ORG, email: "r@csas.cz", name: "R", status: "active", password: "recruiter-pw-1234" });
const viewer = createUser({ orgId: ORG, email: "v@csas.cz", name: "V", status: "active", password: "viewer-pw-12345" });
upsertMembership(recruiter.id, DEFAULT_WORKSPACE, "recruiter");
upsertMembership(viewer.id, DEFAULT_WORKSPACE, "viewer");
const as = (u: { id: string; orgId: string }) => {
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: u.id, org: u.orgId });
};

let entryId = "";
let outId = "";
before(() => {
  const { entry } = createPipelineEntry({
    candidateId: "red-c1",
    candidateLabel: "Redaction Tester",
    jobId: "red-job",
    jobTitle: "Redaction Role",
    matchScore: 80,
  });
  entryId = entry.id;
  outId = recordOutbox({
    recipient: "ana@example.com",
    subject: "Your offer",
    body: BODY,
    kind: "offer",
    channel: "email",
    status: "sent",
    ref: entryId,
  }).id;
});

const req = (url: string) => new NextRequest(`http://localhost${url}`) as never;
const ctx = () => ({ params: Promise.resolve({ id: entryId }) });

async function reads(): Promise<string[]> {
  const a = await (await commsGet(req(`/api/comms?entry=${entryId}`))).text();
  const b = await (await devcaseGet(req("/api/devcase/comms?limit=500"))).text();
  const c = await (await timelineGet(req(`/api/pipeline/${entryId}/timeline`), ctx() as never)).text();
  return [a, b, c];
}

test("a viewer's reads carry the letter but no token, on all three routes", async () => {
  as(viewer);
  const out = await reads();
  for (const text of out) {
    assert.ok(text.includes("Dear Ana"), "the letter is still readable");
    assert.ok(!text.includes(TOKEN), "no capability token for a read-only seat");
  }
  // Redaction is on the projection only: the stored row is untouched.
  assert.equal(getOutboxEntry(outId, DEFAULT_WORKSPACE)?.body, BODY);
});

test("a pipeline:write seat still reads the full link on all three routes", async () => {
  as(recruiter);
  for (const text of await reads()) assert.ok(text.includes(TOKEN), "writer sees the full link: " + text.slice(0, 300));
});
