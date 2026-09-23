// The voice-screen mint door asks THE send gate before it builds or mints anything
// (challenge-r09 follow-up to comms-locale-optout/A).
//
// Every other candidate-link door (single + bulk scheduling invite, the AI-interview and
// homework arrival hooks) already asks `entryContactability` before it mints. This door
// — behind POST /api/interview/create, the card's "Start interview" — did not: a
// candidate whose consent had lapsed (not yet swept) or who had been erased still got a
// grounded build (model spend), a live /interview/<token> on the recruiter's copy panel,
// and a reserved voice session, while "Send link" on the same parked card answered 409.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store module
// resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { mintAndInviteVoiceScreen } from "./interview-invite.ts";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { listPipelineEventsForEntry } from "./db/pipeline-events.ts";
import { latestInterviewByEntry } from "./db/interviews.ts";
import { ensureDb } from "./db/core.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entry(contact: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `ii-c${seq}`,
    candidateLabel: `Invite Candidate ${seq}`,
    jobId: `ii-job-${seq}`,
    jobTitle: "Invite Suppression Role",
    contact,
  }).entry;
}

async function assertRefusedWithoutMint(entryId: string, workspaceId: string) {
  const eventsBefore = listPipelineEventsForEntry(entryId, 500, workspaceId).length;
  const minted = await mintAndInviteVoiceScreen({ entryId, workspaceId, origin: "http://localhost" });
  assert.deepEqual(minted, { ok: false, refusal: "COMMS_SUPPRESSED" });
  // Nothing minted: no session row exists for the entry, so there is no link to copy
  // and no reservation to hold.
  assert.equal(latestInterviewByEntry(entryId, workspaceId), null, "no interview session was minted");
  // No event: the refusal happens before the invite dispatch, which is what writes one.
  assert.equal(listPipelineEventsForEntry(entryId, 500, workspaceId).length, eventsBefore, "no pipeline event was written");
}

test("a lapsed-but-unswept consent is refused with COMMS_SUPPRESSED before any build or mint", async () => {
  const e = entry("lapsed-invite@example.com");
  ensureDb().prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`).run(
    "2019-01-01T00:00:00.000Z",
    "2020-01-01T00:00:00.000Z",
    e.id
  );
  const reread = getPipelineEntry(e.id)!;
  assert.equal(reread.anonymizedAt ?? null, null, "the window: consent lapsed, the sweep has not run");
  await assertRefusedWithoutMint(e.id, reread.workspaceId);
});

test("an erased candidate is refused with COMMS_SUPPRESSED before any build or mint", async () => {
  const e = entry("erased-invite@example.com");
  ensureDb().prepare(`UPDATE pipeline_entries SET anonymized_at = ? WHERE id = ?`).run("2024-01-01T00:00:00.000Z", e.id);
  const reread = getPipelineEntry(e.id)!;
  await assertRefusedWithoutMint(e.id, reread.workspaceId);
});
