// The invite routes email candidates — prove they are OPERATOR-GATED and TENANTED.
//
// Both `/api/schedule/invite` and `/api/schedule/invite/bulk` used to call
// `getPipelineEntry(entryId)` with no workspace argument and with no
// `requireOperator()`, so:
//   - in a NON-DEFAULT workspace every row resolved against DEFAULT_WORKSPACE_ID and
//     404'd — bulk invite was silently broken for any team but the first; and
//   - in the default workspace an ungated session could fan a single call out to
//     BULK_INVITE_CAP (100) candidate emails.
// This file drives the REAL handlers on a throwaway SQLite file and pins all three
// halves: the refusal, the cross-tenant miss, and the non-default workspace SUCCESS.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the routes load (hooks only affect
// later resolutions — hence the dynamic imports below). Without it the handlers' own
// NextResponse.json is undefined in a junction-linked worktree.
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so `cookies()` throws and
// BOTH auth helpers degrade (currentWorkspace → the default workspace, isOperator →
// false). That degradation is precisely what the assertions below need to control, so
// resolve `next/headers` to a virtual module whose jar this file drives. In-thread
// (registerHooks) so the swap is visible to the dynamic imports on the next lines.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
/** The cookie value `cookies()` will serve, or null for a session-less caller. */
let cookieValue: string | null = null;
(globalThis as { __kpInviteTestCookie?: () => string | null }).__kpInviteTestCookie = () => cookieValue;
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
            const value = globalThis.__kpInviteTestCookie();
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

// A signing secret (signSession/verifySession) and an operator password — the gate is a
// deliberate no-op in open mode, so without the password there is nothing to prove.
process.env.KP_SECRET = "invite-gate-tenancy-test-secret";
process.env.KP_OPERATOR_PASSWORD = "invite-gate-tenancy-test-password";

const { POST: invitePost } = await import("./route.ts");
const { POST: bulkPost } = await import("./bulk/route.ts");
const { actOnPipelineEntry, createPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { listScheduleInvitesForEntry } = await import("../../../_lib/schedule-store.ts");
const { signSession, DEFAULT_WORKSPACE, DEMO_WORKSPACE } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const WS_A = DEFAULT_WORKSPACE; // "workspace" — the historical single tenant
const WS_B = "team-b"; // a second team, the case that was broken outright

/** Sign in as `workspace` (null ⇒ no session cookie at all). */
function signedInAs(workspace: string | null): void {
  cookieValue = workspace === null ? null : signSession(workspace);
}

const req = (body: unknown): NextRequest =>
  new Request("http://localhost/api/schedule/invite", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${ipSeq++}` },
  }) as unknown as NextRequest;
// A fresh client IP per call: the per-IP throttle is shared process state and these
// tests must fail on AUTH, never on a 429 they provoked themselves.
let ipSeq = 1;

let seq = 0;
function entryIn(workspaceId: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `inv-c${seq}`,
    candidateLabel: `Invite Candidate ${seq}`,
    jobId: `inv-job-${seq}`,
    jobTitle: "Invite Test Role",
    contact: `inv-c${seq}@example.com`,
    workspaceId,
  }).entry;
}

/** Invites actually minted for an entry, across BOTH tenants — so a leak shows up. */
function invitesFor(entryId: string): number {
  return listScheduleInvitesForEntry(entryId, WS_A).length + listScheduleInvitesForEntry(entryId, WS_B).length;
}

before(() => signedInAs(WS_A));

test("an ungated session cannot fan out invite emails — single and bulk both refuse", async () => {
  const entry = entryIn(WS_A);

  signedInAs(null); // no session at all
  const single = await invitePost(req({ entryId: entry.id }));
  assert.equal(single.status, 401, "a session-less caller must not mint an invite");
  const bulk = await bulkPost(req({ entryIds: [entry.id] }));
  assert.equal(bulk.status, 401, "a session-less caller must not fan out a cohort invite");

  // The anonymous public-demo cookie is a VALID signature but is not an operator —
  // the exact hole requireOperator closes (it must not satisfy an operator route).
  signedInAs(DEMO_WORKSPACE);
  assert.equal((await invitePost(req({ entryId: entry.id }))).status, 401, "a demo session is not an operator");
  assert.equal((await bulkPost(req({ entryIds: [entry.id] }))).status, 401, "a demo session is not an operator");

  assert.equal(invitesFor(entry.id), 0, "not one link may be minted by a refused caller");
});

test("workspace B cannot invite workspace A's entry (single or bulk)", async () => {
  const foreign = entryIn(WS_A);
  signedInAs(WS_B);

  const single = await invitePost(req({ entryId: foreign.id }));
  assert.equal(single.status, 404, "another team's entry must not resolve");

  const bulk = await bulkPost(req({ entryIds: [foreign.id] }));
  assert.equal(bulk.status, 200, "the bulk route reports per-entry outcomes rather than failing the batch");
  const body = (await bulk.json()) as { sent: number; results: { entryId: string; ok: boolean; error?: string }[] };
  assert.equal(body.sent, 0, "no invite may be sent for another team's entry");
  assert.equal(body.results[0].error, "not found");

  assert.equal(invitesFor(foreign.id), 0, "no link may exist for a cross-tenant invite attempt");
});

test("bulk invite WORKS in a non-default workspace (it resolved against the default before)", async () => {
  const own = [entryIn(WS_B), entryIn(WS_B)];
  signedInAs(WS_B);

  const res = await bulkPost(req({ entryIds: own.map((e) => e.id) }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sent: number; total: number; results: { ok: boolean; error?: string }[] };
  assert.equal(body.total, 2);
  assert.equal(body.sent, 2, `team B's own cohort must be invitable — got ${JSON.stringify(body.results)}`);

  for (const e of own) {
    const mine = listScheduleInvitesForEntry(e.id, WS_B);
    assert.equal(mine.length, 1, "one live link per entry, stamped with the inviting team");
    assert.equal(listScheduleInvitesForEntry(e.id, WS_A).length, 0, "and nothing leaks into the default workspace");
  }

  // The single route is fixed by the same change — prove it on team B's own entry too.
  const solo = entryIn(WS_B);
  const single = await invitePost(req({ entryId: solo.id }));
  assert.equal(single.status, 200, "the single invite route works in a non-default workspace as well");
  assert.equal(listScheduleInvitesForEntry(solo.id, WS_B).length, 1);
});

test("a closed-out candidate is never invited — single and bulk agree", async () => {
  // The bulk route has always refused a terminal entry; the single route did not, so a
  // stale drawer (the candidate was rejected in another tab) still minted a link and
  // dispatched an interview invitation to someone the pipeline had closed out.
  const entry = entryIn(WS_A);
  signedInAs(WS_A);
  actOnPipelineEntry(entry.id, "reject", undefined, undefined, WS_A);

  const single = await invitePost(req({ entryId: entry.id }));
  assert.equal(single.status, 409, "a rejected candidate must not be sent an interview invite");
  const bulk = await bulkPost(req({ entryIds: [entry.id] }));
  const body = (await bulk.json()) as { sent: number; results: { error?: string }[] };
  assert.equal(body.sent, 0);
  assert.equal(body.results[0].error, "not active", "the two routes refuse the same input");

  assert.equal(invitesFor(entry.id), 0, "no link may exist for a closed-out candidate");
});
