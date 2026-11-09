// THE RE-SEND SEAMS OF AN APPROVED OUTREACH LETTER (comms §8a). The release is not the only
// door that puts a stored `outreach` row on the wire: the Comms Center resend
// (app/api/comms/[id]/resend/route.ts, driven in resend-outreach-approval.test.ts) and the
// backlog flush (comms-backlog.ts, driven here) re-send the outbox row verbatim. The rule
// both enforce (outreach-approval.ts outreachResendRefusal): the identical letter to the
// identical approved recipient is covered by the original approval; any other address, or
// a letter whose approval was since cleared, is not.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry, recordEntryConsent } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { ensureDb } from "./db/core.ts";
import { outreachLetterDraft } from "./db/outreach-letters.ts";
import { approveOutreachLetter, releaseOutreachLetter } from "./outreach-release.ts";
import { outreachApprovalDigest, outreachResendRefusal } from "./outreach-approval.ts";
import { confirmBacklogSend } from "./comms-backlog.ts";
import { setRelayHostLookupForTests } from "./comms.ts";
import { setEgressTransportForTests } from "./pinned-request.ts";
import { DEFAULT_WORKSPACE_ID as WS } from "./db/workspaces.ts";

after(() => cleanupUnitDb());
afterEach(() => {
  setEgressTransportForTests(undefined);
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
});

const APPROVER = "human:Eva Approver";

function relay() {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  const posts: string[] = [];
  setEgressTransportForTests(async (_url, init) => {
    posts.push(String(init.body));
    return new Response(null, { status: 200 });
  });
  return posts;
}

let seq = 0;
/** An approved letter released keyless: one `queued` outreach row in the local outbox. */
async function queuedOutreach() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `resend-gate-c${seq}`,
    candidateLabel: `Resend Candidate ${seq}`,
    jobId: `resend-gate-job-${seq}`,
    jobTitle: "Backend Engineer",
    locale: "en",
    contact: `resend${seq}@example.cz`,
    stage: "Screened",
    workspaceId: WS,
  });
  recordEntryConsent(entry.id, "test", 365, WS);
  const { letter } = outreachLetterDraft({ entryId: entry.id, subject: "A role for you", body: "We'd love to talk.", lang: "en" }, WS);
  assert.ok(approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS));
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(out.ok, true, "a keyless release records the approved letter as queued");
  const [row] = listOutboxFiltered({ ref: entry.id, kind: "outreach" }, WS);
  assert.equal(row.status, "queued");
  assert.equal(row.channel, "outbox");
  return { entry, letter, row };
}

test("the predicate: identical letter to the approved recipient passes; anything else is refused", () => {
  const base = { letterId: "ol_1", messageId: "msg_1", recipient: "a@example.cz", subject: "S", body: "B", lang: "en" };
  const letter = {
    id: "ol_1", entryId: "e1", state: "released", subject: "S", body: "B", lang: "en", messageId: "msg_1",
    approvedBy: APPROVER, approvedDigest: outreachApprovalDigest(base), erasedAt: null,
  };
  const row = { ref: "e1", messageId: "msg_1" };
  assert.equal(outreachResendRefusal(letter, row, "a@example.cz"), null, "the original approval covers the identical re-send");
  const refused = "OUTREACH_RESEND_NOT_APPROVED";
  assert.equal(outreachResendRefusal(letter, row, "corrected@example.cz"), refused, "a corrected address nobody approved");
  assert.equal(outreachResendRefusal(letter, { ...row, messageId: "msg_2" }, "a@example.cz"), refused, "another message");
  assert.equal(outreachResendRefusal(letter, { ...row, ref: "e2" }, "a@example.cz"), refused, "another application");
  assert.equal(outreachResendRefusal({ ...letter, approvedBy: null, approvedDigest: null }, row, "a@example.cz"), refused, "approval cleared");
  assert.equal(outreachResendRefusal({ ...letter, approvedBy: "human:recruiter" }, row, "a@example.cz"), refused, "role token");
  assert.equal(outreachResendRefusal({ ...letter, erasedAt: "2026-01-01" }, row, "a@example.cz"), refused, "erased");
  assert.equal(outreachResendRefusal(null, row, "a@example.cz"), refused, "no letter: a pre-approval outreach row");
});

test("BACKLOG: a queued approved letter to its approved recipient is sent on confirmation", async () => {
  const { row } = await queuedOutreach();
  const posts = relay();
  const [result] = await confirmBacklogSend(WS, [row.id], "human:Test Owner");
  assert.equal(result.outcome, "sent");
  assert.equal(posts.length, 1, "exactly one relay POST");
});

test("BACKLOG: a queued letter whose approval was since cleared is skipped as not_approved, nothing sent", async () => {
  const { letter, row } = await queuedOutreach();
  ensureDb().prepare(`UPDATE outreach_letters SET approved_by = NULL, approved_digest = NULL WHERE id = ?`).run(letter.id);
  const posts = relay();
  const [result] = await confirmBacklogSend(WS, [row.id], "human:Test Owner");
  assert.deepEqual(result, { id: row.id, outcome: "skipped", reason: "not_approved", detail: undefined });
  assert.equal(posts.length, 0, "no relay POST");
});
