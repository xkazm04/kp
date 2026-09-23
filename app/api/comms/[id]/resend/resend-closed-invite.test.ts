// The recovery door must not hand out a DEAD apply link.
//
// A `case_invite` letter carries the posting's apply link in its body
// (dispatchCaseInvite -> `${base}/devcase/apply/<token>?lang=..`). The resend route
// re-dispatches a stored body verbatim, so once the recruiter stopped that posting's
// intake (closeCaseIntake, or the lifecycle's Close) a resend mailed the candidate a
// link that answers 410 - the one surface still breaking the "no dead links handed
// out" invariant challenge-r09 devcase-lifecycle/B established everywhere else.
//
// Drives the REAL handler on a throwaway SQLite file; with no relay configured every
// accepted send records as `queued`.
// Import the REAL native better-sqlite3 first (never a shim).
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path.
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import {
  createPosting,
  getDevCase,
  listOutboxFiltered,
  recordOutbox,
  setPostingStatus,
} from "../../../../_lib/db/devcase.ts";

register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

type ResendBody = { ok?: boolean; code?: string; entry?: { status?: string } };

async function resend(id: string): Promise<{ status: number; body: ResendBody }> {
  const { POST } = await import("./route.ts");
  const request = new Request(`http://localhost/api/comms/${id}/resend`, { method: "POST" });
  const res = await POST(request, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as ResendBody };
}

let seq = 0;
function posting() {
  seq += 1;
  return createPosting({
    caseId: `case-resend-closed-${seq}`,
    channel: "local",
    token: `tokresend${seq}0123456789abcdef`,
    roleTitle: "Backend Engineer",
    caseTitle: "Queue worker",
  });
}

/** A dead-lettered letter of `kind` whose body carries `token`'s apply link, shaped the
 *  way dispatchCaseInvite writes it (absolute link, locale pinned). */
function deadLetter(kind: string, token: string) {
  return recordOutbox({
    recipient: "candidate@example.com",
    subject: "Your assignment for Backend Engineer",
    body: `Hi Jana,\n\nOpen the assignment here: https://studio.example.com/devcase/apply/${token}?lang=en\n\nThe team`,
    kind,
    channel: "email",
    status: "failed",
    ref: null,
    failureDetail: "http 503",
  });
}

const recoveriesOf = (original: { id: string; kind: string | null }) =>
  listOutboxFiltered({ ref: original.id, kind: original.kind ?? undefined }).filter((m) => m.id !== original.id);

before(() => {
  getDevCase("__init__"); // force the full ensureDb() init
});
after(() => cleanupUnitDb());

test("a case_invite whose posting was CLOSED is refused with POSTING_CLOSED, and nothing is sent", async () => {
  const p = posting();
  const original = deadLetter("case_invite", p.token ?? "");
  assert.equal(setPostingStatus(p.id, "closed"), true);

  const res = await resend(original.id);
  // NON-VACUITY: pre-fix this answered 200 and re-mailed the 410 link.
  assert.equal(res.status, 410, "the link the letter carries is gone");
  assert.equal(res.body.code, "POSTING_CLOSED", "the reader localizes the refusal off the code");
  assert.equal(res.body.ok, undefined);
  assert.equal(recoveriesOf(original).length, 0, "no recovery row: nothing was sent or queued");
});

test("a case_invite whose posting no longer exists is refused the same way", async () => {
  const original = deadLetter("case_invite", "tokresendvanished0123456789abcdef");
  const res = await resend(original.id);
  assert.equal(res.status, 410, "a token no posting answers to is a dead link too");
  assert.equal(res.body.code, "POSTING_CLOSED");
  assert.equal(recoveriesOf(original).length, 0);
});

test("a case_invite whose posting is still OPEN re-sends exactly as before", async () => {
  const p = posting();
  const original = deadLetter("case_invite", p.token ?? "");
  const res = await resend(original.id);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.entry?.status, "queued", "keyless: recorded on the local outbox");
  assert.equal(recoveriesOf(original).length, 1);
});

test("other letter kinds are not read for a posting link, even one naming a closed posting", async () => {
  const p = posting();
  setPostingStatus(p.id, "closed");
  const original = deadLetter("rejection", p.token ?? "");
  const res = await resend(original.id);
  assert.equal(res.status, 200, "the posting gate is the case_invite's, nobody else's");
  assert.equal(recoveriesOf(original).length, 1);
});
