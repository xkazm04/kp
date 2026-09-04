// WHO MAY RE-POINT THE MODELS. Provider keys and routing pins were written behind
// `requireOperator()` alone - which answers "is there a valid, non-demo session on
// this deployment?", a question every recruiter and viewer also answers yes to. So
// on a password-gated install any seat could:
//
//   PUT    /api/llm/keys    replace the platform credential every model call spends
//                           through (with one the caller controls), or point a
//                           provider at their own OpenAI-compatible server;
//   DELETE /api/llm/keys    remove the deployment's key and stop the product working;
//   PUT    /api/llm/config  re-route ANY use case - screening, scoring, outreach - to
//                           a provider/model of their choosing;
//   DELETE /api/llm/config  unpin one.
//
// `org:manage` is defined in auth/roles.ts as exactly the owner-only band ("billing,
// org profile/settings, delete org"), which is the same authority the billing doors
// ask for and for the same reason: this is deployment-wide spending configuration.
//
// This file drives the REAL handlers on a throwaway SQLite file, in the shim +
// virtual-next/headers pattern of app/api/workspaces/workspaces-route.test.ts.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpLlmTestCookie?: () => string | null }).__kpLlmTestCookie = () => cookieValue;
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
            const value = globalThis.__kpLlmTestCookie();
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
// to owner (open dev mode) and there is no authority decision left to prove. KP_SECRET
// also lets the PUT reach saveProviderKey instead of the encryption-unconfigured 400.
process.env.KP_SECRET = "llm-admin-auth-test-secret";
process.env.KP_OPERATOR_PASSWORD = "llm-admin-auth-test-password";

const { PUT: putKey, DELETE: deleteKey, GET: getKeys } = await import("./route.ts");
const { PUT: putConfig, DELETE: deleteConfig, GET: getConfig } = await import("../config/route.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../../_lib/auth/session.ts");
const { listLlmConfig } = await import("../../../_lib/db/llm.ts");
const { listProviderKeyMeta } = await import("../../../_lib/llm-config.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const owner = createUser({ orgId: ORG, email: "llm.owner@csas.cz", name: "LLM Owner", status: "active", password: "owner-pw-1234" });
const recruiter = createUser({ orgId: ORG, email: "llm.rec@csas.cz", name: "LLM Recruiter", status: "active", password: "rec-pw-12345" });
upsertMembership(owner.id, DEFAULT_WORKSPACE, "owner");
upsertMembership(recruiter.id, DEFAULT_WORKSPACE, "recruiter");

function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(DEFAULT_WORKSPACE, Date.now(), { sub: user.id, org: user.orgId });
}

const req = (body: unknown, method = "PUT"): NextRequest =>
  new Request("http://localhost/api/llm/keys", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

const keyBody = { provider: "openai", scope: "byom", apiKey: "sk-test-key-material" };
const pinBody = { useCase: "match_reasoning", provider: "openai", model: "gpt-4o-mini" };

// ---- The refusal ---------------------------------------------------------------

test("a RECRUITER cannot write a provider key - 403 + MODEL_ADMIN_FORBIDDEN, nothing stored", async () => {
  signedInAs(recruiter);
  const r = await putKey(req(keyBody));
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { code?: string }).code, "MODEL_ADMIN_FORBIDDEN");
  assert.equal(listProviderKeyMeta().length, 0, "the key store is untouched");
});

test("a RECRUITER cannot delete a provider key", async () => {
  signedInAs(recruiter);
  const r = await deleteKey(req({ provider: "openai", scope: "byom" }, "DELETE"));
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { code?: string }).code, "MODEL_ADMIN_FORBIDDEN");
});

test("a RECRUITER cannot re-route a use case - 403, and no pin is written", async () => {
  signedInAs(recruiter);
  const r = await putConfig(req(pinBody));
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { code?: string }).code, "MODEL_ADMIN_FORBIDDEN");
  assert.equal(listLlmConfig().length, 0, "the routing table is untouched");
});

test("a RECRUITER cannot unpin a use case", async () => {
  signedInAs(recruiter);
  const r = await deleteConfig(req({ useCase: "match_reasoning" }, "DELETE"));
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { code?: string }).code, "MODEL_ADMIN_FORBIDDEN");
});

test("a recruiter may still READ both surfaces - this is a write gate, not a wall", async () => {
  signedInAs(recruiter);
  assert.equal((await getKeys()).status, 200);
  assert.equal((await getConfig()).status, 200);
});

// ---- Unauthenticated stays 401, never 403 ---------------------------------------

test("no session at all answers 401 on every write door", async () => {
  signedInAs(null);
  assert.equal((await putKey(req(keyBody))).status, 401);
  assert.equal((await deleteKey(req({ provider: "openai" }, "DELETE"))).status, 401);
  assert.equal((await putConfig(req(pinBody))).status, 401);
  assert.equal((await deleteConfig(req({ useCase: "match_reasoning" }, "DELETE"))).status, 401);
});

// ---- The owner proceeds ---------------------------------------------------------

test("an OWNER writes a key and a pin", async () => {
  signedInAs(owner);
  assert.equal((await putKey(req(keyBody))).status, 200);
  assert.equal(listProviderKeyMeta().length, 1);
  assert.equal((await putConfig(req(pinBody))).status, 200);
  assert.equal(listLlmConfig()[0]?.provider, "openai");
});

// ---- Open mode is unchanged -----------------------------------------------------

test("OPEN MODE (no KP_OPERATOR_PASSWORD) still admits a sessionless caller", async () => {
  const saved = process.env.KP_OPERATOR_PASSWORD;
  delete process.env.KP_OPERATOR_PASSWORD;
  signedInAs(null);
  try {
    // Both gates fold to allow: requireOperator short-circuits, and
    // callerOrgCapabilities returns OWNER_CAPS. A self-hosted single-operator
    // install is exactly as it was. The pin already exists, so this is also the
    // version precondition's "no opinion" path (no expectedUpdatedAt in the body).
    assert.equal((await putConfig(req({ ...pinBody, provider: "gemini" }))).status, 200);
  } finally {
    process.env.KP_OPERATOR_PASSWORD = saved;
  }
});
