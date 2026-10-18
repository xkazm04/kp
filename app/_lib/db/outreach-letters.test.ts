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
