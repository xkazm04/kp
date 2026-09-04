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
const { POST: managePost } = await import("../route.ts");
const { actOnPipelineEntry, createPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { listScheduleInvitesForEntry } = await import("../../../_lib/schedule-store.ts");
const { BULK_INVITE_CAP } = await import("../../../_lib/bulk-invite.ts");
const { proposeSlots, isoToDateSlot } = await import("../../../_lib/schedule-slots.ts");
const { signSession, DEFAULT_WORKSPACE, DEMO_WORKSPACE } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const WS_A = DEFAULT_WORKSPACE; // "workspace" — the historical single tenant
const WS_B = "team-b"; // a second team, the case that was broken outright

/** Sign in as `workspace` (null ⇒ no session cookie at all). */
function signedInAs(workspace: string | null): void {
  // Wave 18a put the invite doors behind pipeline:write. A bare workspace session
  // (no member, no operator marker) holds no capability, so this tenancy test signs
  // the explicit OPERATOR marker: the subject here is which workspace the write lands
  // in, not who may write (write-capability-gate.test.ts owns that question).
  cookieValue = workspace === null ? null : signSession(workspace, Date.now(), { op: true });
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
  const body = (await bulk.json()) as { sent: number; results: { entryId: string; ok: boolean; code?: string }[] };
  assert.equal(body.sent, 0, "no invite may be sent for another team's entry");
  assert.equal(body.results[0].code, "SCHEDULE_BULK_ENTRY_NOT_FOUND");

  assert.equal(invitesFor(foreign.id), 0, "no link may exist for a cross-tenant invite attempt");
});

test("bulk invite WORKS in a non-default workspace (it resolved against the default before)", async () => {
  const own = [entryIn(WS_B), entryIn(WS_B)];
  signedInAs(WS_B);

  const res = await bulkPost(req({ entryIds: own.map((e) => e.id) }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    sent: number;
    delivered: number;
    total: number;
    results: { ok: boolean; dispatched?: boolean; delivery?: string; error?: string }[];
  };
  assert.equal(body.total, 2);
  assert.equal(body.sent, 2, `team B's own cohort must be invitable — got ${JSON.stringify(body.results)}`);

  // REC-10 — the fan-out must report the outbox row's REAL status, not "it didn't
  // throw". Nothing is relayed in this environment (no COMMS_WEBHOOK_URL), so every
  // message is a terminal local-outbox row: the per-entry claim is `queued` and the
  // delivered count is ZERO. Before the fix each entry carried a bare `dispatched:true`
  // and no claim at all, so a relay answering 500 for a whole cohort read as success.
  assert.deepEqual(
    body.results.map((r) => r.delivery),
    ["queued", "queued"],
    "with no relay configured, nothing is 'sent' — the fan-out must say queued per entry"
  );
  assert.equal(body.delivered, 0, "delivered counts relay-confirmed messages, never minted links");

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
  const body = (await bulk.json()) as { sent: number; results: { code?: string }[] };
  assert.equal(body.sent, 0);
  assert.equal(body.results[0].code, "SCHEDULE_BULK_ENTRY_INACTIVE", "the two routes refuse the same input");

  assert.equal(invitesFor(entry.id), 0, "no link may exist for a closed-out candidate");
});

// A SILENT CAP REPORTED AS A TOTAL. coerceBulkEntryIds truncates the submission at
// BULK_INVITE_CAP; the route then reported the truncated list as the whole batch, so a
// cohort larger than the cap ("Select all visible" on a board of 150 actives — exactly the
// high-volume case the endpoint exists for) came back with NO result row for the overflow.
// The bulk bar's failures-stay-selected grammar reads those rows, so the overflow was
// neither counted as a failure nor kept selected: silently deselected under a green
// "100 invited to schedule". The real entries are placed PAST the cap here, so pre-fix they
// are absent from `results` entirely and this test fails on the very first assertion.
test("a cohort larger than the bulk cap reports the overflow instead of dropping it", async () => {
  signedInAs(WS_A);
  const beyond = [entryIn(WS_A), entryIn(WS_A), entryIn(WS_A)];
  // Fill the cap with ids that resolve to nothing (cheap: no mint, no dispatch), then
  // append the real ones so they land in the overflow.
  const filler = Array.from({ length: BULK_INVITE_CAP }, (_, i) => `cap-filler-${i}`);
  const res = await bulkPost(req({ entryIds: [...filler, ...beyond.map((e) => e.id)] }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    sent: number;
    capped: number;
    total: number;
    results: { entryId: string; ok: boolean; code?: string; max?: number }[];
  };

  assert.equal(body.capped, beyond.length, "the request says how many entries it could not take");
  assert.equal(body.total, BULK_INVITE_CAP + beyond.length, "every submitted entry is accounted for");
  for (const e of beyond) {
    const row = body.results.find((r) => r.entryId === e.id);
    assert.ok(row, `entry ${e.id} was dropped silently — it must come back as an explicit refusal`);
    assert.equal(row.ok, false, "an entry past the cap was NOT invited and must not read as one");
    assert.equal(row.code, "SCHEDULE_BULK_OVER_CAP", "and it must say why, so the caller can retry the remainder");
    assert.equal(row.max, BULK_INVITE_CAP, "the bound rides along so the message can name it");
    assert.equal(invitesFor(e.id), 0, "no link is minted past the cap");
  }
});

// The recruiter week grid books through POST /api/schedule (action:"book"), which mints +
// confirms an invite, consumes the slot in the shared pool and writes a calendar event.
// Both invite routes refuse a closed-out candidate; this one did not, and its entry list is
// a client-side snapshot — so a tab left open while a colleague rejected the candidate
// booked them anyway, with approve_event silently no-op'ing (it returns null on a terminal
// entry rather than throwing, so nothing raised needs_reconcile).
test("the recruiter week-grid book refuses a closed-out candidate too", async () => {
  const entry = entryIn(WS_A);
  signedInAs(WS_A);
  actOnPipelineEntry(entry.id, "reject", undefined, undefined, WS_A);

  // A real offerable instant, placed back on the dated grid the recruiter clicks.
  const dateSlot = isoToDateSlot(proposeSlots([], 1)[0].value);
  assert.ok(dateSlot, "expected a bookable grid cell for the fixture");

  const res = await managePost(req({ action: "book", entryId: entry.id, dateSlot }));
  assert.equal(res.status, 409, "a rejected candidate must not be bookable from the grid");
  assert.match((await res.json()).error, /no longer active/);
  assert.equal(invitesFor(entry.id), 0, "no slot may be consumed for a closed-out candidate");
});

// --- every refusal this door answers is a CODE, never an English sentence --------
//
// The bulk bar (usePipelineBulk.bulkInvite) already folded a per-item `code` through
// the same `errors.<CODE>` resolution it uses for /api/pipeline/batch — it just never
// received one. So a Czech recruiter whose cohort was half-refused read one generic
// "some couldn't be invited" line with no reason, and the route's own whole-request
// 400 ("entryIds must be a non-empty array (max 100).") was raw English on the wire.

test("the bulk door answers CODES: the whole-request refusal and every per-entry verdict", async () => {
  signedInAs(WS_A);

  // (1) The whole-request refusal.
  const empty = await bulkPost(req({ entryIds: [] }));
  assert.equal(empty.status, 400);
  const emptyBody = (await empty.json()) as { code?: string; error?: string; max?: number };
  assert.equal(emptyBody.code, "SCHEDULE_BULK_NO_ENTRIES", "an empty selection is refused by code");
  assert.equal(emptyBody.max, BULK_INVITE_CAP, "the cap rides along");

  // (2) Every per-entry code the loop can emit, in one call, so the shape is pinned
  //     together rather than one branch at a time.
  const active = entryIn(WS_A);
  const closed = entryIn(WS_A);
  actOnPipelineEntry(closed.id, "reject", undefined, undefined, WS_A);
  const res = await bulkPost(req({ entryIds: [active.id, closed.id, "no-such-entry"] }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { results: { entryId: string; ok: boolean; code?: string }[] };
  const codeFor = (id: string) => body.results.find((r) => r.entryId === id)?.code;
  assert.equal(codeFor(closed.id), "SCHEDULE_BULK_ENTRY_INACTIVE");
  assert.equal(codeFor("no-such-entry"), "SCHEDULE_BULK_ENTRY_NOT_FOUND");
  assert.equal(body.results.find((r) => r.entryId === active.id)?.ok, true, "the live candidate is still invited");

  // (3) NOTHING on this wire is prose. `error` is gone from the per-entry shape, so a
  //     store message can no longer ride out of the catch (that leak is the reason
  //     app/api/error-response-contract.test.ts is a repo-wide scan rather than a
  //     hand-listed array — both hygiene guards' regexes structurally could not see a
  //     `results.push({ error: err.message })`).
  for (const row of body.results) {
    assert.equal("error" in row, false, `a per-entry row still carries prose: ${JSON.stringify(row)}`);
    if (!row.ok) assert.match(String(row.code), /^SCHEDULE_BULK_/, "every refusal names a resolvable code");
  }
});

test("every SCHEDULE_BULK_* code this route emits is a declared refusal with four catalog entries", async () => {
  const { REFUSAL_ERRORS } = await import("../../../_lib/api-response.ts");
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  // Normalized: this checkout is CRLF while the worktree may be LF.
  const src = readFileSync(path.join(process.cwd(), "app", "api", "schedule", "invite", "bulk", "route.ts"), "utf-8").replace(
    /\r\n/g,
    "\n"
  );
  const used = [...new Set([...src.matchAll(/"(SCHEDULE_BULK_[A-Z_]+)"/g)].map((m) => m[1]))];
  assert.equal(used.length >= 5, true, `expected the route to emit its refusal codes, found ${used.join(", ")}`);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const catalog = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8")) as {
      errors: Record<string, string>;
    };
    for (const code of used) {
      assert.ok(code in REFUSAL_ERRORS, `${code} is emitted but not declared in REFUSAL_ERRORS`);
      assert.ok(catalog.errors[code], `${code} has no ${locale} entry — the board would render nothing`);
    }
  }
});
