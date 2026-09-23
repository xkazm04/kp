// The invite doors ask the SEND GATE before they mint (challenge-r09
// comms-locale-optout/A).
//
// A candidate whose consent has lapsed but who has not yet been swept by
// `anonymizeExpiredConsents` still carries a contact. Both invite doors used to ask only
// `status` (+ addressability for the bulk door), MINT a live /schedule/<token>, and only
// then hand the letter to `sendComm` — whose gate threw `CommsSuppressedError` into a
// swallowed catch. The link existed, the recruiter could copy it, the single route
// answered 200 with the token and the bulk route counted it in `sent`.
//
// Drives the REAL handlers on a throwaway SQLite file. unit-db.ts must stay the first
// project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope — serve a virtual module whose
// cookie jar this file drives (the same harness invite-gate-tenancy.test.ts uses).
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpSuppressionTestCookie?: () => string | null }).__kpSuppressionTestCookie = () => cookieValue;
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
            const value = globalThis.__kpSuppressionTestCookie();
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

process.env.KP_SECRET = "invite-suppression-gate-test-secret";
process.env.KP_OPERATOR_PASSWORD = "invite-suppression-gate-test-password";

const { POST: invitePost } = await import("./route.ts");
const { POST: bulkPost } = await import("./bulk/route.ts");
const { createPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { ensureDb } = await import("../../../_lib/db/core.ts");
const { listScheduleInvitesForEntry } = await import("../../../_lib/schedule-store.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const WS = DEFAULT_WORKSPACE;
before(() => {
  cookieValue = signSession(WS, Date.now(), { op: true });
});

let ipSeq = 1;
const req = (body: unknown): NextRequest =>
  new Request("http://localhost/api/schedule/invite", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${ipSeq++}` },
  }) as unknown as NextRequest;

let seq = 0;
/** An active, addressable candidate. */
function liveEntry() {
  seq += 1;
  return createPipelineEntry({
    candidateId: `sup-c${seq}`,
    candidateLabel: `Suppression Candidate ${seq}`,
    jobId: `sup-job-${seq}`,
    jobTitle: "Suppression Test Role",
    contact: `sup-c${seq}@example.com`,
    workspaceId: WS,
  }).entry;
}
/** Active, contact still on the row, consent lapsed, NOT yet anonymized by the sweep. */
function lapsedEntry() {
  const e = liveEntry();
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`)
    .run("2019-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", e.id);
  return e;
}
const invitesFor = (entryId: string) => listScheduleInvitesForEntry(entryId, WS).length;

test("case 4: bulk — a lapsed-consent entry is refused with COMMS_SUPPRESSED, no token, not counted in sent", async () => {
  const a = liveEntry();
  const b = lapsedEntry();

  const res = await bulkPost(req({ entryIds: [a.id, b.id] }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    sent: number;
    results: { entryId: string; ok: boolean; token?: string; code?: string }[];
  };
  const rowA = body.results.find((r) => r.entryId === a.id);
  const rowB = body.results.find((r) => r.entryId === b.id);
  assert.equal(rowA?.ok, true, "the consenting candidate is invited");
  assert.equal(rowB?.ok, false, "the lapsed-consent candidate is NOT invited");
  assert.equal(rowB?.code, "COMMS_SUPPRESSED", "…and the row says why, in the one code every surface resolves");
  assert.equal(rowB?.token, undefined, "no token rides back for a person the send gate refuses");
  assert.equal(body.sent, 1, "the count claims only the invite that could legally go out");
  assert.equal(invitesFor(a.id), 1);
  assert.equal(invitesFor(b.id), 0, "no live scheduling link exists for the suppressed candidate");
});

test("case 5: single — a lapsed-consent entry answers 409 COMMS_SUPPRESSED and mints nothing", async () => {
  const b = lapsedEntry();
  const res = await invitePost(req({ entryId: b.id }));
  assert.equal(res.status, 409);
  const body = (await res.json()) as { code?: string; token?: string };
  assert.equal(body.code, "COMMS_SUPPRESSED");
  assert.equal(body.token, undefined);
  assert.equal(invitesFor(b.id), 0, "the refusal happens BEFORE createScheduleInvite");

  // The consenting sibling is unaffected.
  const a = liveEntry();
  const ok = await invitePost(req({ entryId: a.id }));
  assert.equal(ok.status, 200);
  assert.equal(invitesFor(a.id), 1);
});

test("single — an unaddressable (name-only) candidate still gets a link for the copy panel", async () => {
  // The pre-mint gate refuses only what the send gate refuses. A person with no address
  // is not suppressed: the drawer's copy panel is the manual fallback the route promises.
  seq += 1;
  const e = createPipelineEntry({
    candidateId: `sup-c${seq}`,
    candidateLabel: `Name Only ${seq}`,
    jobId: `sup-job-${seq}`,
    jobTitle: "Suppression Test Role",
    contact: null,
    workspaceId: WS,
  }).entry;
  const res = await invitePost(req({ entryId: e.id }));
  assert.equal(res.status, 200);
  assert.equal(invitesFor(e.id), 1);
});
