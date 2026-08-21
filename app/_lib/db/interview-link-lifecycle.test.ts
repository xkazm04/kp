// Interview-link lifecycle guards for the candidate-facing voice screen
// (app/interview/[token] + /api/interview/connect read ONE expiry authority).
// Isolated throwaway DB (testing/unit-db.ts must be the FIRST project import).
//
//   #1 — the TTL is defeated by a single Start click: `in_progress` / `failed`
//        sessions used to be exempt, so an abandoned link kept minting real
//        provider minutes long past INTERVIEW_LINK_TTL_DAYS.
//   #2 — an erased transcript ('[]' in place, row still `completed`) must read
//        as ABSENT in the AI-round ledger, exactly as it already does on the
//        per-entry card indicator.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  completeInterviewSession,
  createInterviewSession,
  interviewStatusByEntries,
  INTERVIEW_LINK_TTL_DAYS,
  isInterviewLinkExpired,
  listRecentInterviewSessions,
} from "./interviews.ts";
import { anonymizeEntry, createPipelineEntry } from "./pipeline.ts";

after(() => cleanupUnitDb());

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 86_400_000;
const PAST_TTL = ago((INTERVIEW_LINK_TTL_DAYS + 1) * DAY);
const FRESH = ago(2 * DAY);

test("a link past its TTL is expired in EVERY non-terminal status, not just `created` (#1)", () => {
  // The pre-existing rule: an untaken link dies at the TTL.
  assert.equal(isInterviewLinkExpired({ status: "created", createdAt: PAST_TTL, updatedAt: null }), true);

  // Pre-fix: both of these returned false — one click on Start (or a dropped
  // call) made the emailed credential valid forever, so /connect happily minted
  // billable provider credentials on a month-old abandoned link.
  assert.equal(
    isInterviewLinkExpired({ status: "in_progress", createdAt: PAST_TTL, updatedAt: PAST_TTL }),
    true,
    "an abandoned in_progress session is not a live call — the TTL applies"
  );
  assert.equal(
    isInterviewLinkExpired({ status: "failed", createdAt: PAST_TTL, updatedAt: PAST_TTL }),
    true,
    "'failed' is reconnectable by design, but only while the link itself is valid"
  );
});

test("a call that is LIVE right now outlives the TTL, and terminal states keep their own semantics (#1 guard)", () => {
  // Reconnect mid-conversation on a link that aged past the TTL during the call:
  // updated_at was re-stamped by the connect, so the session is live — never cut
  // a candidate off mid-sentence.
  assert.equal(
    isInterviewLinkExpired({ status: "in_progress", createdAt: PAST_TTL, updatedAt: ago(60_000) }),
    false
  );
  // Terminal rows are answered by their own guards at both call sites.
  assert.equal(isInterviewLinkExpired({ status: "completed", createdAt: PAST_TTL, updatedAt: PAST_TTL }), false);
  assert.equal(isInterviewLinkExpired({ status: "revoked", createdAt: PAST_TTL, updatedAt: PAST_TTL }), false);
  // And a link inside its TTL stays valid in every status.
  for (const status of ["created", "in_progress", "failed"]) {
    assert.equal(isInterviewLinkExpired({ status, createdAt: FRESH, updatedAt: FRESH }), false, status);
  }
});

test("an ERASED transcript reads as absent in the AI-round ledger, like it already does per entry (#2)", () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-erase-iv",
    candidateLabel: "Erasure Person",
    jobId: "job-erase-iv",
    jobTitle: "Data Engineer",
  });
  const session = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    entryId: entry.id,
    candidateLabel: "Erasure Person",
    jobId: "job-erase-iv",
    jobTitle: "Data Engineer",
  });
  completeInterviewSession(session.id, {
    transcript: [
      { role: "interviewer", text: "Please introduce yourself." },
      { role: "candidate", text: "Hi, I'm Erasure Person." },
    ],
  });
  const ledgerRow = () => listRecentInterviewSessions().find((s) => s.id === session.id);
  assert.equal(ledgerRow()?.hasTranscript, true, "a real transcript is present before erasure");

  // GDPR Art. 17: scrubEntryLinkedPii drops transcript_json to '[]' IN PLACE and
  // leaves the row 'completed'.
  anonymizeEntry(entry.id, "erasure");

  // Pre-fix: the ledger's `transcript_json IS NOT NULL` still said true, so the
  // docket card stayed clickable into an evaluation with nothing behind it.
  assert.equal(ledgerRow()?.hasTranscript, false, "the erased transcript reads as absent in the ledger");
  assert.equal(
    interviewStatusByEntries([entry.id])[entry.id]?.hasTranscript,
    false,
    "and the two reads of that one fact still agree"
  );
});
