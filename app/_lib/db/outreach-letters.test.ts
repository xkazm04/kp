// The outreach letter store (comms scope C2): one row per application, a revision the
// approval is bound to, and a message id minted once at draft time.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const {
  outreachLetterApprove,
  outreachLetterByEntry,
  outreachLetterById,
  outreachLetterDraft,
  outreachLetterMarkFailed,
  outreachLetterMarkReleased,
  outreachLetterMarkSuppressed,
} = await import("./outreach-letters.ts");
const { createPipelineEntry } = await import("./pipeline.ts");
const { DEFAULT_WORKSPACE_ID: WS } = await import("./workspaces.ts");

after(() => cleanupUnitDb());

let seq = 0;
function entryId(): string {
  seq += 1;
  return createPipelineEntry({
    candidateId: `c-ol-${seq}`,
    candidateLabel: `Letter Candidate ${seq}`,
    jobId: `job-ol-${seq}`,
    jobTitle: "Backend Engineer",
    stage: "Screened",
    workspaceId: WS,
  }).entry.id;
}

const DRAFT = { subject: "A role for you", body: "We'd love to talk.", lang: "en" };

test("a first draft inserts revision 1 with a message id; a re-draft lands on the same row", () => {
  const id = entryId();
  const first = outreachLetterDraft({ entryId: id, ...DRAFT }, WS);
  assert.equal(first.created, true);
  assert.equal(first.letter.state, "drafted");
  assert.equal(first.letter.revision, 1);
  assert.match(first.letter.messageId, /^msg-/);

  const same = outreachLetterDraft({ entryId: id, ...DRAFT }, WS);
  assert.equal(same.created, false);
  assert.equal(same.changed, false, "an identical text is not an edit");
  assert.equal(same.letter.revision, 1, "…so it does not void a review in progress");

  const edited = outreachLetterDraft({ entryId: id, ...DRAFT, body: "A different letter." }, WS);
  assert.equal(edited.changed, true);
  assert.equal(edited.letter.id, first.letter.id, "one letter per application");
  assert.equal(edited.letter.revision, 2);
  assert.equal(edited.letter.messageId, first.letter.messageId, "the delivery identity never changes");
});

test("approval is bound to the revision the person read", () => {
  const id = entryId();
  const { letter } = outreachLetterDraft({ entryId: id, ...DRAFT }, WS);
  outreachLetterDraft({ entryId: id, ...DRAFT, body: "Edited after render." }, WS);
  assert.equal(outreachLetterApprove(letter.id, { revision: 1, approvedBy: "human:Eva" }, WS), null, "a stale revision writes nothing");
  assert.equal(outreachLetterById(letter.id, WS)!.state, "drafted");

  const approved = outreachLetterApprove(letter.id, { revision: 2, approvedBy: "human:Eva" }, WS);
  assert.equal(approved?.state, "approved");
  assert.equal(approved?.approvedBy, "human:Eva");
  assert.ok(approved?.approvedAt);
  assert.equal(outreachLetterApprove(letter.id, { revision: 2, approvedBy: "human:Petr" }, WS), null, "approved once");
});

test("a late draft after approval is dropped", () => {
  const id = entryId();
  const { letter } = outreachLetterDraft({ entryId: id, ...DRAFT }, WS);
  outreachLetterApprove(letter.id, { revision: 1, approvedBy: "human:Eva" }, WS);
  const late = outreachLetterDraft({ entryId: id, ...DRAFT, body: "Machine rewrote it." }, WS);
  assert.equal(late.changed, false);
  assert.equal(outreachLetterByEntry(id, WS)!.body, DRAFT.body, "the approved text stands");
});

test("approval names a person, never the machine", () => {
  const id = entryId();
  const { letter } = outreachLetterDraft({ entryId: id, ...DRAFT }, WS);
  assert.throws(() => outreachLetterApprove(letter.id, { revision: 1, approvedBy: "auto:outreach" }, WS), /human actor/);
  assert.throws(() => outreachLetterApprove(letter.id, { revision: 1, approvedBy: "human:" }, WS), /human actor/);
});

test("release transitions start only from an approved (or retryable) letter", () => {
  const id = entryId();
  const { letter } = outreachLetterDraft({ entryId: id, ...DRAFT }, WS);
  assert.equal(outreachLetterMarkReleased(letter.id, WS), null, "a draft nobody approved cannot be released");
  outreachLetterApprove(letter.id, { revision: 1, approvedBy: "human:Eva" }, WS);
  assert.equal(outreachLetterMarkFailed(letter.id, WS)?.state, "delivery_failed");
  assert.equal(outreachLetterMarkSuppressed(letter.id, WS)?.state, "suppressed");
  const released = outreachLetterMarkReleased(letter.id, WS);
  assert.equal(released?.state, "released");
  assert.ok(released?.releasedAt);
  assert.equal(outreachLetterMarkFailed(letter.id, WS), null, "released is terminal");
});

const { outreachLetterListByState } = await import("./outreach-letters.ts");

test("the waiting list holds one state, oldest first, leaves erased rows out and carries no body", async () => {
  const before = outreachLetterListByState("drafted", 200, WS).letters.map((l) => l.id);
  const first = outreachLetterDraft({ entryId: entryId(), ...DRAFT }, WS).letter;
  const second = outreachLetterDraft({ entryId: entryId(), ...DRAFT }, WS).letter;
  const approved = outreachLetterDraft({ entryId: entryId(), ...DRAFT }, WS).letter;
  outreachLetterApprove(approved.id, { revision: approved.revision, approvedBy: "human:Ana" }, WS);
  const erased = outreachLetterDraft({ entryId: entryId(), ...DRAFT }, WS).letter;
  const { ensureDb } = await import("./core.ts");
  ensureDb().prepare(`UPDATE outreach_letters SET subject = NULL, body = NULL, erased_at = ? WHERE id = ? AND workspace_id = ?`).run(new Date().toISOString(), erased.id, WS);

  const { letters, truncated } = outreachLetterListByState("drafted", 200, WS);
  const fresh = letters.filter((l) => !before.includes(l.id)).map((l) => l.id);
  assert.deepEqual(fresh, [first.id, second.id], "oldest first; the approved and the erased are not here");
  assert.equal(truncated, false);
  const row = letters.find((l) => l.id === first.id)!;
  assert.equal(row.candidateLabel.startsWith("Letter Candidate"), true);
  assert.equal(row.jobTitle, "Backend Engineer");
  assert.equal("body" in row, false);
  assert.deepEqual(outreachLetterListByState("approved", 200, WS).letters.map((l) => l.id).includes(approved.id), true);

  const capped = outreachLetterListByState("drafted", 1, WS);
  assert.equal(capped.letters.length, 1);
  assert.equal(capped.truncated, true, "one past the cap is read so the answer can say there is more");
  assert.equal(outreachLetterListByState("drafted", 200, "team-nobody").letters.length, 0, "scoped to the team");
});

test("letters sharing one created_at come back in draft order, not in id order", async () => {
  const { ensureDb } = await import("./core.ts");
  const N = 20;
  const drafted = Array.from({ length: N }, () => outreachLetterDraft({ entryId: entryId(), ...DRAFT }, WS).letter.id);
  // Same created_at AND ids that sort AGAINST insertion order: the worst case a random id can
  // produce, made deterministic (no clock speed, no sleeps).
  const tied = drafted.map((_, i) => `ol-tie-${String(N - i).padStart(3, "0")}`);
  const stamp = ensureDb().prepare(`UPDATE outreach_letters SET id = ?, created_at = ? WHERE id = ? AND workspace_id = ?`);
  drafted.forEach((id, i) => stamp.run(tied[i], "2026-01-01T00:00:00.000Z", id, WS));

  const ours = new Set(tied);
  const listed = outreachLetterListByState("drafted", 200, WS).letters.map((l) => l.id).filter((id) => ours.has(id));
  assert.deepEqual(listed, tied, "a created_at tie falls back to insertion order (rowid), never to the id");
});
