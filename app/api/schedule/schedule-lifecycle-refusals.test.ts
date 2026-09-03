// THE RECRUITER'S LIFECYCLE ACTIONS ANSWER A CODE, NEVER PROSE
// (/perfect 2026-09-03, schedule-ui-2).
//
// The BOOK path was moved onto refusal codes in wave 7 (schedule-book-refusals.test.ts).
// The twelve OTHER branches of POST/PATCH /api/schedule — cancel, no-show, reschedule,
// accept/decline a proposal, resolve-reconcile, the meeting link — were left answering a
// bare English sentence with no `code`. `useScheduleInviteLifecycle.runAction` resolves
// failures through `useErrorMessage()`, which reads the CODE and correctly ignores the
// server's prose, so every one of those twelve collapsed into the panel's single generic
// toast: "That action didn't go through. Try again." A recruiter whose candidate's
// proposed times had aged into the past and one who clicked cancel on a row another
// operator had already cancelled read the identical sentence, in English, in all four
// locales — and nothing on screen named the remedy either of them needed.
//
// These drive the REAL handler. `currentWorkspace()` reads cookies(), which throws
// outside a request and falls back to the default workspace, so "the caller" here is
// always the default tenant.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

// Point next/server at the test shim BEFORE the route loads — see the sibling
// book-refusals suite for why a junction-linked worktree needs this.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { POST, PATCH } = await import("./route.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { createScheduleInvite, confirmScheduleInvite, setScheduleInviteProposals } = await import(
  "../../_lib/schedule-store.ts"
);
const { proposeSlots } = await import("../../_lib/schedule-slots.ts");
const { REFUSAL_ERRORS } = await import("../../_lib/api-response.ts");

after(() => cleanupUnitDb());

const SLOTS = proposeSlots([], 12);
let seq = 0;

function entryFixture(): { id: string; candidateLabel: string } {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `life-c${seq}`,
    candidateLabel: `Lifecycle Candidate ${seq}`,
    jobId: `life-job-${seq}`,
    jobTitle: "Lifecycle Test Role",
    contact: `life-c${seq}@example.com`,
  });
  return { id: entry.id, candidateLabel: entry.candidateLabel };
}

/** A pending invite (no booking) for a fresh entry. */
function pendingInvite(): string {
  const e = entryFixture();
  return createScheduleInvite({ entryId: e.id, candidateLabel: e.candidateLabel, jobTitle: "Lifecycle Test Role", durationMin: 45 })
    .token;
}

async function refusal(
  handler: (r: Request) => Promise<Response>,
  body: unknown
): Promise<{ status: number; code: string; error: string }> {
  seq += 1;
  const res = (await handler(
    new Request("http://localhost/api/schedule", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${(seq % 250) + 1}` },
    }) as never
  )) as unknown as Response;
  const parsed = (await res.json()) as { code?: string; error?: string };
  return { status: res.status, code: parsed.code ?? "", error: parsed.error ?? "" };
}

const post = (body: unknown) => refusal(POST as never, body);
const patch = (body: unknown) => refusal(PATCH as never, body);

test("a body with no action refuses with SCHEDULE_ACTION_REQUIRED", async () => {
  const r = await post({});
  assert.equal(r.status, 400);
  assert.equal(r.code, "SCHEDULE_ACTION_REQUIRED");
});

test("an action this route does not perform refuses with SCHEDULE_ACTION_UNKNOWN", async () => {
  const r = await post({ action: "teleport", token: pendingInvite() });
  assert.equal(r.status, 400);
  assert.equal(r.code, "SCHEDULE_ACTION_UNKNOWN");
});

test("a lifecycle action with no token refuses with SCHEDULE_TOKEN_REQUIRED", async () => {
  const r = await post({ action: "cancel" });
  assert.equal(r.status, 400);
  assert.equal(r.code, "SCHEDULE_TOKEN_REQUIRED");
});

test("a token this team's calendar does not hold refuses with SCHEDULE_INVITE_NOT_FOUND", async () => {
  const r = await post({ action: "cancel", token: "no-such-token" });
  assert.equal(r.status, 404);
  assert.equal(r.code, "SCHEDULE_INVITE_NOT_FOUND");
});

test("cancelling an invite that holds no booking refuses with SCHEDULE_CANCEL_NOT_CONFIRMED", async () => {
  const r = await post({ action: "cancel", token: pendingInvite() });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_CANCEL_NOT_CONFIRMED");
});

test("marking a no-show on an unbooked invite refuses with SCHEDULE_NO_SHOW_NOT_CONFIRMED", async () => {
  const r = await post({ action: "no_show", token: pendingInvite() });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_NO_SHOW_NOT_CONFIRMED");
});

test("a reschedule to a time the server would not offer reuses SCHEDULE_SLOT_NOT_OFFERED", async () => {
  // The candidate door's own code, deliberately reused for the identical structural
  // gate on body.slotAt — one vocabulary, not two for the same refusal.
  const r = await post({ action: "reschedule", token: pendingInvite(), slotAt: "1999-01-01T09:00:00.000Z" });
  assert.equal(r.status, 400);
  assert.equal(r.code, "SCHEDULE_SLOT_NOT_OFFERED");
});

test("rescheduling an invite with no booking refuses with SCHEDULE_RESCHEDULE_NOT_CONFIRMED", async () => {
  const r = await post({ action: "reschedule", token: pendingInvite(), slotAt: SLOTS[0].value });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_RESCHEDULE_NOT_CONFIRMED");
});

test("accepting a time the candidate never proposed refuses with SCHEDULE_PROPOSAL_GONE", async () => {
  const r = await post({ action: "accept_proposal", token: pendingInvite(), slotAt: SLOTS[1].value });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_PROPOSAL_GONE");
});

test("declining an invite carrying no proposals refuses with SCHEDULE_NO_PROPOSALS", async () => {
  const r = await post({ action: "decline_proposals", token: pendingInvite() });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_NO_PROPOSALS");
});

test("resolving an invite with no reconcile flag refuses with SCHEDULE_NOTHING_TO_RECONCILE", async () => {
  const token = pendingInvite();
  const slot = SLOTS[2];
  assert.equal(confirmScheduleInvite(token, slot.label, slot.value).ok, true, "the fixture booking must land");
  const r = await post({ action: "resolve_reconcile", token });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_NOTHING_TO_RECONCILE");
});

test("a proposal that has aged into the past refuses with SCHEDULE_PROPOSAL_EXPIRED", async () => {
  // Structurally still on the invite, but no longer an instant the server will book.
  const token = pendingInvite();
  const past = new Date(Date.now() - 72 * 3_600_000).toISOString();
  const stored = setScheduleInviteProposals(token, [{ label: "Long ago", value: past }]);
  assert.ok(stored, "the store must accept the fixture proposal");
  const r = await post({ action: "accept_proposal", token, slotAt: past });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_PROPOSAL_EXPIRED");
});

test("PATCH refuses a non-http(s) meeting link with SCHEDULE_MEETING_URL_INVALID", async () => {
  const token = pendingInvite();
  const r = await patch({ token, meetingUrl: "javascript:alert(1)" });
  assert.equal(r.status, 400);
  assert.equal(r.code, "SCHEDULE_MEETING_URL_INVALID");
});

test("PATCH with no token refuses with SCHEDULE_TOKEN_REQUIRED", async () => {
  const r = await patch({ meetingUrl: "https://meet.example.test/x" });
  assert.equal(r.status, 400);
  assert.equal(r.code, "SCHEDULE_TOKEN_REQUIRED");
});

test("no branch of the recruiter route answers a bare English sentence any more", () => {
  // The regression this direction exists to prevent: a NEW branch added with
  // `NextResponse.json({ error: "…" }, { status: 4xx })` would be invisible to the
  // client's code resolver and paint the generic toast again. The GET's success
  // envelopes are the only NextResponse.json calls the route may keep, and neither
  // carries an `error` key.
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const prose = [...src.matchAll(/NextResponse\.json\(\{\s*error:/g)];
  assert.equal(prose.length, 0, `every refusal must carry a code; found ${prose.length} bare {error} responses`);
});

test("every code the lifecycle branches answer is declared and present in all four catalogs", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const emitted = [...new Set([...src.matchAll(/jsonRefusal\("([A-Z_]+)"/g)].map((m) => m[1]))];
  // The book path contributed 5; the lifecycle branches are the rest.
  assert.ok(emitted.length >= 17, `expected the whole route's refusal vocabulary, found ${emitted.length}`);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8")) as {
      errors: Record<string, string>;
    };
    for (const code of emitted) {
      assert.ok(code in REFUSAL_ERRORS, `${code} is not a declared refusal`);
      assert.equal(typeof catalog.errors[code], "string", `messages/${locale}.json is missing errors.${code}`);
    }
  }
});
