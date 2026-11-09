// The Comms Center resend of an `outreach` row (comms §8a): the original approval covers the
// identical letter to the identical approved recipient, and nothing else. A CORRECTED
// address nobody approved is refused with a code, nothing is sent and the letter is left as
// it is. Drives the REAL handler on a throwaway SQLite file, keyless (a send records as
// `queued` in the local outbox).
// Import the REAL native better-sqlite3 first (never a shim).
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before anything touches db-path.
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { getDevCase, listOutboxFiltered } from "../../../../_lib/db/devcase.ts";
import { createPipelineEntry, recordEntryConsent } from "../../../../_lib/db/pipeline.ts";
import { outreachLetterById, outreachLetterDraft } from "../../../../_lib/db/outreach-letters.ts";
import { approveOutreachLetter, releaseOutreachLetter } from "../../../../_lib/outreach-release.ts";
import { DEFAULT_WORKSPACE_ID as WS } from "../../../../_lib/db/workspaces.ts";

register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const APPROVER = "human:Eva Approver";

async function resend(id: string, recipient?: string): Promise<{ status: number; body: { ok?: boolean; code?: string } }> {
  const { POST } = await import("./route.ts");
  const init: RequestInit = { method: "POST" };
  if (recipient) {
    init.body = JSON.stringify({ recipient });
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await POST(new Request(`http://localhost/api/comms/${id}/resend`, init), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as { ok?: boolean; code?: string } };
}

let seq = 0;
async function releasedOutreach() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `resend-approval-c${seq}`,
    candidateLabel: `Resend Approval ${seq}`,
    jobId: `resend-approval-job-${seq}`,
    jobTitle: "Backend Engineer",
    locale: "en",
    contact: `approved${seq}@example.cz`,
    stage: "Screened",
    workspaceId: WS,
  });
  recordEntryConsent(entry.id, "test", 365, WS);
  const { letter } = outreachLetterDraft({ entryId: entry.id, subject: "A role for you", body: "We'd love to talk.", lang: "en" }, WS);
  assert.ok(approveOutreachLetter(letter.id, { revision: 1, approvedBy: APPROVER }, WS));
  assert.equal((await releaseOutreachLetter(letter.id, WS, APPROVER)).ok, true);
  const [row] = listOutboxFiltered({ ref: entry.id, kind: "outreach" }, WS);
  return { entry, letter, row };
}

before(() => {
  getDevCase("__init__"); // force the full ensureDb() init
});
after(() => cleanupUnitDb());

test("a resend to a CORRECTED address nobody approved is refused, nothing sent, the letter untouched", async () => {
  const { entry, letter, row } = await releasedOutreach();
  const before = outreachLetterById(letter.id, WS)!;
  const out = await resend(row.id, "someone.else@example.cz");
  assert.equal(out.status, 409);
  assert.equal(out.body.code, "OUTREACH_RESEND_NOT_APPROVED");
  assert.equal(listOutboxFiltered({ ref: entry.id, kind: "outreach" }, WS).length, 1, "no second outbox row");
  const afterRow = outreachLetterById(letter.id, WS)!;
  assert.equal(afterRow.state, before.state);
  assert.equal(afterRow.approvedDigest, before.approvedDigest, "the resend never re-opens the letter");
});

test("a resend of the identical letter to the approved address is covered by the original approval", async () => {
  const { entry, row } = await releasedOutreach();
  const out = await resend(row.id);
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  const rows = listOutboxFiltered({ ref: entry.id, kind: "outreach" }, WS);
  assert.equal(rows.length, 2, "one recovery row");
  assert.ok(rows.every((r) => r.recipient === row.recipient), "to the approved address");
});
