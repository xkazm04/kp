import test from "node:test";
import assert from "node:assert/strict";
import {
  publishNoteSentences,
  rememberPublishResult,
  lastPublishResult,
  forgetPublishResults,
} from "./jobsPublishResult.ts";

// POST /api/jobs/[id]/publish answers six facts — sourced, skipped,
// sourcingWarning, silverMedalists, alreadyPublished, reopened — and the UI read
// two of them. So an idempotent re-publish (nothing re-sourced by design) came
// back as "Sourced 0 candidates into the Pipeline.", i.e. a fresh go-live that
// matched nobody, and the rediscovery alerts a genuine go-live raised were never
// mentioned at all. Each fact is now its own sentence.

const keys = (r: Parameters<typeof publishNoteSentences>[0]) =>
  publishNoteSentences(r).sentences.map((s) => s.key);

test("a genuine go-live leads with the transition and states what it sourced", () => {
  const note = publishNoteSentences({ sourced: 3, skipped: 0, silverMedalists: 0 });
  assert.equal(note.tone, "ok");
  assert.deepEqual(note.sentences, [{ key: "wentLive" }, { key: "sourced", count: 3 }]);
});

test("sourcing nobody is stated, not hidden", () => {
  assert.deepEqual(keys({ sourced: 0 }), ["wentLive", "sourced"]);
});

test("an idempotent re-publish says so and does NOT claim it sourced zero", () => {
  // The route skips sourcing entirely when the role is already published, so a
  // `sourced: 0` there is an artifact of the skip — reporting it as a result is
  // the lie this whole direction exists to remove.
  assert.deepEqual(keys({ alreadyPublished: true, sourced: 0, silverMedalists: 0 }), ["alreadyLive"]);
});

test("a reopen leads with the reopen, not with a generic go-live", () => {
  assert.deepEqual(keys({ reopened: 4, sourced: 1 }), ["reopened", "sourced"]);
  assert.equal(publishNoteSentences({ reopened: 4, sourced: 1 }).sentences[0].count, 4);
});

test("skipped candidates and silver-medalist alerts are their own sentences", () => {
  assert.deepEqual(keys({ sourced: 2, skipped: 3, silverMedalists: 5 }), [
    "wentLive",
    "sourced",
    "skipped",
    "silverMedalists",
  ]);
});

test("a broken sourcing step is amber and replaces the sourced claim", () => {
  const note = publishNoteSentences({ sourced: 0, sourcingWarning: "Traceback (most recent call last): ..." });
  assert.equal(note.tone, "warn");
  assert.deepEqual(note.sentences, [{ key: "wentLive" }, { key: "sourcingFailed" }]);
  // The server's prose never reaches a sentence — the client renders codes/keys.
  assert.equal(JSON.stringify(note).includes("Traceback"), false);
});

test("zero counts never mint a sentence of their own", () => {
  assert.deepEqual(keys({ sourced: 1, skipped: 0, silverMedalists: 0, reopened: 0 }), ["wentLive", "sourced"]);
});

test("the last result outlives the modal that produced it, per job", () => {
  forgetPublishResults();
  assert.equal(lastPublishResult("jd-be"), null);
  rememberPublishResult("jd-be", { sourced: 2 });
  rememberPublishResult("jd-fe", { alreadyPublished: true });
  assert.deepEqual(lastPublishResult("jd-be"), { sourced: 2 });
  assert.deepEqual(lastPublishResult("jd-fe"), { alreadyPublished: true });
  assert.equal(lastPublishResult("jd-unknown"), null);
});
