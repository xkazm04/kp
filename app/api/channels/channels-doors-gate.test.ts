// The comms/channels ADMINISTRATION doors, driven against the real handlers.
//
// What they were (/perfect wave 27, api-comms):
//
//   POST/PATCH /api/channels/webhooks   — `currentWorkspace()` and nothing else. That
//   DELETE /api/channels/webhooks/[t]     resolves a TENANT, it does not decide
//                                         AUTHORITY: a viewer seat satisfied it exactly
//                                         as well as an owner, and these writes mint a
//                                         permanent PUBLIC ingress token, store a URL +
//                                         secret the clock later fetches on this
//                                         server's behalf, and kill a live lead intake.
//   POST /api/comms/relay/test          — operator-gated but unthrottled: an outbound
//                                         request from this deployment's address to a
//                                         URL the caller can re-point, answered with
//                                         the outcome (an amplifier and a reachability
//                                         oracle in one).
//   GET  /api/comms/capability          — NO auth at all, and not a null answer: it
//                                         states whether this deployment relays
//                                         candidate mail and NAMES the inbound mail
//                                         domain the operator wired up.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the routes load (hooks only affect
// later resolutions — hence the dynamic imports below).
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so `cookies()` throws and the
// auth helpers degrade. These tests are ABOUT that decision, so resolve `next/headers`
// to a virtual module whose jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpChanTestCookie?: () => string | null }).__kpChanTestCookie = () => cookieValue;
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
            const value = globalThis.__kpChanTestCookie();
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
process.env.KP_SECRET = "channels-doors-test-secret";
process.env.KP_OPERATOR_PASSWORD = "channels-doors-test-password";
// The inbound mail domain the capability read must not hand to an anonymous caller.
process.env.EMAIL_INBOUND_DOMAIN = "inbound.kp.test";

const { POST: createReceiver, PATCH: configurePull } = await import("./webhooks/route.ts");
const { DELETE: revokeReceiver } = await import("./webhooks/[token]/route.ts");
const { GET: capabilityRoute } = await import("../comms/capability/route.ts");
const { POST: relayProbe } = await import("../comms/relay/test/route.ts");
const { createChannelWebhook, getActiveChannelWebhook } = await import("../../_lib/db/channels.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default"; // the seeded org the default workspace belongs to

// An owner (holds org:manage) and a recruiter (does not) on the SAME team, so the only
// difference between them is authority — never tenancy.
const owner = createUser({ orgId: ORG, email: "ch.owner@csas.cz", name: "Ch Owner", status: "active", password: "owner-pw-1234" });
const recruiter = createUser({ orgId: ORG, email: "ch.rec@csas.cz", name: "Ch Rec", status: "active", password: "rec-pw-12345" });
upsertMembership(owner.id, DEFAULT_WORKSPACE, "owner");
upsertMembership(recruiter.id, DEFAULT_WORKSPACE, "recruiter");

function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(DEFAULT_WORKSPACE, Date.now(), { sub: user.id, org: user.orgId });
}

/** Each call gets its own client address: the doors are throttled per IP now, and a
 *  shared address would let one test spend another's budget. */
let ip = 0;
const req = (body?: unknown): NextRequest =>
  new Request("http://localhost/api/channels/webhooks", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip % 250}` },
  }) as unknown as NextRequest;

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
const codeOf = async (r: Response) => ((await r.json()) as { code?: string }).code;

before(() => signedInAs(owner));

// ---- the receiver writes ------------------------------------------------------

test("POST refuses a recruiter seat — minting a public ingress token is org administration", async () => {
  signedInAs(recruiter);
  const r = await createReceiver(req({ channel: "boards", jobId: "jd-be" }));
  assert.equal(r.status, 403);
  // The client resolves the CODE, never the server's English string.
  assert.equal(await codeOf(r), "FORBIDDEN_CAPABILITY");
});

test("POST refuses a caller with no session at all", async () => {
  signedInAs(null);
  assert.equal((await createReceiver(req({ channel: "boards", jobId: "jd-be" }))).status, 401);
});

test("PATCH refuses a recruiter — the pull URL and secret are the operator's outbound reach", async () => {
  signedInAs(recruiter);
  const hook = createChannelWebhook({ channel: "boards", jobId: "jd-be" }, DEFAULT_WORKSPACE);
  const r = await configurePull(req({ token: hook.token, pullUrl: "https://ats.example.com/feed" }));
  assert.equal(r.status, 403);
  assert.equal(await codeOf(r), "FORBIDDEN_CAPABILITY");
});

test("DELETE refuses a recruiter, and the receiver is still live afterwards", async () => {
  signedInAs(recruiter);
  const hook = createChannelWebhook({ channel: "email", jobId: "jd-be" }, DEFAULT_WORKSPACE);
  const r = await revokeReceiver(req(), params({ token: hook.token }));
  assert.equal(r.status, 403);
  assert.equal(await codeOf(r), "FORBIDDEN_CAPABILITY");
  assert.ok(getActiveChannelWebhook(hook.token), "a refused revoke must not have killed the intake");
});

test("DELETE succeeds for an owner — the gate is about AUTHORITY, not about blocking the door", async () => {
  signedInAs(owner);
  const hook = createChannelWebhook({ channel: "email", jobId: "jd-be" }, DEFAULT_WORKSPACE);
  const r = await revokeReceiver(req(), params({ token: hook.token }));
  assert.equal(r.status, 200);
  assert.equal(getActiveChannelWebhook(hook.token), null, "an authorized revoke still revokes");
});

test("DELETE answers an unknown token with a CODE, not English prose", async () => {
  signedInAs(owner);
  const r = await revokeReceiver(req(), params({ token: "hook-does-not-exist" }));
  assert.equal(r.status, 404);
  assert.equal(await codeOf(r), "CHANNEL_WEBHOOK_NOT_FOUND");
});

// ---- the outbound probe -------------------------------------------------------

test("the relay probe refuses a recruiter before it resolves (and decrypts) the relay", async () => {
  signedInAs(recruiter);
  const r = await relayProbe(req());
  assert.equal(r.status, 403);
  assert.equal(await codeOf(r), "FORBIDDEN_CAPABILITY");
});

// ---- the capability read ------------------------------------------------------

test("the capability read refuses an anonymous caller — the mail wiring is not public", async () => {
  signedInAs(null);
  const r = await capabilityRoute();
  assert.equal(r.status, 401);
  const body = await r.text();
  assert.ok(!body.includes("inbound.kp.test"), "the inbound mail domain must not leak to a caller with no session");
});

test("the capability read answers a real session, and ONLY the two bits the UI needs", async () => {
  signedInAs(owner);
  const r = await capabilityRoute();
  assert.equal(r.status, 200);
  const body = (await r.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["emailInboundDomain", "relayConfigured"]);
  assert.equal(body.emailInboundDomain, "inbound.kp.test");
  // unit-db.ts clears COMMS_WEBHOOK_URL, and nothing stored a relay config here.
  assert.equal(body.relayConfigured, false);
});
