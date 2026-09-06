// A late dev-case submission is RECORDED, never refused.
//
// The candidate reads "~2h" on the brief and the server never compared the session's age
// to it, so a recruiter looking at two submissions could not tell a 90-minute attempt
// from an eight-hour one — the two are not the same exercise, and the number that says
// which is which existed nowhere. `over_timebox_minutes` is that number, written once at
// finalize and carried on the submission row.
//
// The three states are deliberately distinct and this file pins all three:
//   null = not measured (a repo-link/webhook submission, or a row predating the column)
//   0    = measured, inside the box
//   n>0  = measured, n minutes over — and the submission still exists, because the
//          timebox is advisory and deleting an hour of someone's work over a clock they
//          were never shown is not a policy this product has.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store resolves).
//
// Runner: npm run test:unit
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { saveDevCase, createPosting, startDevSession, submitDevSession, getSubmission, listSubmissions, createSubmission } =
  await import("./devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("./workspaces.ts");

after(() => cleanupUnitDb());

let n = 0;
function seedPosting(): { token: string; postingId: string } {
  const dc = saveDevCase(
    { need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case", timeboxHours: 2 } },
    DEFAULT_WORKSPACE_ID
  );
  const posting = createPosting({
    caseId: dc.id,
    channel: "link",
    token: `tok-over-timebox-${++n}`,
    roleTitle: "Backend Engineer",
    caseTitle: "API case",
  });
  return { token: posting.token!, postingId: posting.id };
}

test("a submission finalized inside the box records 0, not null", () => {
  const { token, postingId } = seedPosting();
  const session = startDevSession({ token });
  const submission = submitDevSession(session.id, postingId, { candidate: "On time", overTimeboxMinutes: 0 });
  assert.ok(submission, "the session sealed");
  assert.equal(submission!.overTimeboxMinutes, 0, "measured and inside the box is 0, never null");
  assert.equal(getSubmission(submission!.id)?.overTimeboxMinutes, 0, "and it survives the round trip");
});

test("a LATE submission is recorded with its overrun and still exists", () => {
  const { token, postingId } = seedPosting();
  const session = startDevSession({ token });
  // 8h07 on a 2h box: the eight-hour attempt the recruiter could not previously see.
  const submission = submitDevSession(session.id, postingId, { candidate: "Ran long", overTimeboxMinutes: 367 });
  assert.ok(submission, "a late finalize is never refused — the work is done and it is kept");
  assert.equal(submission!.overTimeboxMinutes, 367);
  const listed = listSubmissions(postingId, DEFAULT_WORKSPACE_ID).find((s) => s.id === submission!.id);
  assert.equal(listed?.overTimeboxMinutes, 367, "the recruiter's list read carries it, not just the point read");
  assert.equal(listed?.status, "received", "the overrun is a note on the row, never a rejection");
});

test("a submission with no observed session is NOT measured", () => {
  const { postingId } = seedPosting();
  // The repo-link/webhook path: no session, so no start time, so nothing to compare.
  const { submission } = createSubmission({ postingId, candidateRef: "Repo link", repoRef: "https://example.test/pr/1" });
  assert.equal(submission.overTimeboxMinutes, null, "not measured must stay distinguishable from inside-the-box");
});

test("a repeat finalize does not re-measure — the first seal is the record", () => {
  const { token, postingId } = seedPosting();
  const session = startDevSession({ token });
  const first = submitDevSession(session.id, postingId, { candidate: "Double click", overTimeboxMinutes: 12 });
  const second = submitDevSession(session.id, postingId, { candidate: "Double click", overTimeboxMinutes: 999 });
  assert.equal(second?.id, first?.id, "idempotent: the same submission comes back");
  assert.equal(second?.overTimeboxMinutes, 12, "a retry seconds later must not inflate the recorded overrun");
});
