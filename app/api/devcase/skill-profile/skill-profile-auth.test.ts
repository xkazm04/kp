// The Durable Skill Profile mint is a RECRUITER act, and it was ungated.
//
// `POST /api/devcase/skill-profile` takes ONE argument — a submission id — and is not
// read-only: when the evaluation has moved it REVOKES the live credential and reissues
// under a new token, breaking every /skill link the candidate already shared. Until
// /perfect wave 23 the handler itself asked nothing about the caller; it leaned entirely
// on `proxy.ts` refusing non-public /api paths, which is exactly the single-gate posture
// this repo's convention tells a sensitive write not to take ("sensitive routes
// re-verify via requireOperator (defense in depth)"). The submission id was, at the same
// time, printed at the candidate on their own thank-you screen.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store loads).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// `next/headers` needs a Next request scope, and `next/server` resolves to two module
// identities through a worktree's node_modules junction. Redirect both BEFORE the route
// is dynamically imported — the require-operator.test.ts harness, narrowed to what this
// route touches.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
const NEXT_SERVER_SHIM = new URL("../../../_lib/testing/next-server-shim.mjs", import.meta.url).href;
let cookieValue: string | null = null;
(globalThis as { __kpSkillProfileCookie?: () => string | null }).__kpSkillProfileCookie = () => cookieValue;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    if (specifier === "next/server") return { url: NEXT_SERVER_SHIM, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpSkillProfileCookie();
            return {
              get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined),
              set: () => {},
            };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

process.env.KP_SECRET = "skill-profile-auth-test-secret";

const { POST } = await import("./route.ts");
const { signSession } = await import("../../../_lib/auth/session.ts");
const { saveDevCase, createPosting, createSubmission } = await import("../../../_lib/db/devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");

after(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
  cleanupUnitDb();
});

function mintReq(submissionId: string): Request {
  return new Request("http://localhost/api/devcase/skill-profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ submissionId }),
  });
}

function seedSubmission(): string {
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } }, DEFAULT_WORKSPACE_ID);
  const posting = createPosting({
    caseId: dc.id,
    channel: "link",
    token: `tok-skill-${Math.random().toString(36).slice(2)}`,
    roleTitle: "Backend Engineer",
    caseTitle: "API case",
  });
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: "Ada",
    repoRef: "https://example.test/ada",
  });
  return submission.id;
}

test("a caller with no operator session cannot mint a credential", async () => {
  process.env.KP_OPERATOR_PASSWORD = "operator-test-password";
  cookieValue = null;
  const submissionId = seedSubmission();

  const res = await POST(mintReq(submissionId));
  // Pre-fix the handler asked nothing about the caller: this reached the store and
  // answered 404/409 from `issueSkillProfile` — i.e. the mint ran, and on an EVALUATED
  // submission it would have handed back the credential's access token.
  assert.equal(res.status, 401, "the mint re-verifies the operator itself, not just at the proxy");
  assert.deepEqual(await res.json(), { error: "Unauthorized" }, "the shared 401 envelope");
});

test("a valid operator session still reaches the store (the gate is not over-broad)", async () => {
  process.env.KP_OPERATOR_PASSWORD = "operator-test-password";
  cookieValue = signSession(DEFAULT_WORKSPACE_ID, Date.now(), { op: true });
  const submissionId = seedSubmission();

  const res = await POST(mintReq(submissionId));
  // An UNEVALUATED submission is refused by the store with 409 — which is the point:
  // the request got past the gate and was judged on its merits.
  assert.equal(res.status, 409, "the operator is let through to the store's own refusal");
});
