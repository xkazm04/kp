import test from "node:test";
import assert from "node:assert/strict";
import {
  publishNoteSentences,
  rememberPublishResult,
  lastPublishResult,
  forgetPublishResults,
  receiptNote,
  receiptResumable,
  RESUMABLE_RECEIPT_STATES,
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

test("THE FIX: a BROKEN rediscovery raise is not the silence of a clean zero", () => {
  // raiseRediscoveryAlertsForJob used to swallow a dead ranker into `0`, and the
  // note simply printed no rediscovery line at all — pixel-identical to a go-live
  // that ranked the whole pool and flagged nobody. The recruiter read a complete,
  // green success over a step that never ran.
  const brokenIn = { sourced: 2, silverMedalists: 0, silverMedalistsFailed: true };
  const cleanIn = { sourced: 2, silverMedalists: 0 };
  assert.notDeepEqual(
    publishNoteSentences(brokenIn).sentences,
    publishNoteSentences(cleanIn).sentences,
    "the two must never render identically"
  );
  assert.deepEqual(keys(brokenIn), ["wentLive", "sourced", "silverMedalistsFailed"]);
  assert.equal(publishNoteSentences(brokenIn).tone, "warn", "the role is live, but something it promised did not happen");
  assert.deepEqual(keys(cleanIn), ["wentLive", "sourced"]);
  assert.equal(publishNoteSentences(cleanIn).tone, "ok");
});

test("a failed raise REPLACES the count — a number from a step that never ran is noise", () => {
  const input = { sourced: 1, silverMedalists: 4, silverMedalistsFailed: true };
  assert.equal(keys(input).includes("silverMedalists"), false, "no count line survives alongside the failure");
  assert.deepEqual(keys(input), ["wentLive", "sourced", "silverMedalistsFailed"]);
});

test("sourcing failure still wins the note — it precedes the raise entirely", () => {
  // sourcingWarning returns early, so a publish that broke at sourcing never even
  // reaches the rediscovery line. Pinned so the new branch cannot reorder it.
  const input = { sourcingWarning: "boom", silverMedalistsFailed: true };
  assert.deepEqual(keys(input), ["wentLive", "sourcingFailed"]);
  assert.equal(publishNoteSentences(input).tone, "warn");
});

// ── The durable receipt (challenge-r10 jobs-posting-campaign/A) ───────────────
// A resume re-runs the sweep on a role that is already live. It is NOT the idempotent
// "already live, nothing happened" case, so it must not early-return like one.

test("a resumed sweep leads with the resume and states what it sourced", () => {
  const note = publishNoteSentences({ alreadyPublished: true, resumed: true, sourced: 2 });
  assert.equal(note.tone, "ok");
  assert.deepEqual(note.sentences, [{ key: "resumed" }, { key: "sourced", count: 2 }]);
});

test("an abandoned sweep reads as incomplete, never as a clean go-live", () => {
  const note = publishNoteSentences({ sourced: 0, sourcingAbandoned: true });
  assert.equal(note.tone, "warn");
  assert.deepEqual(keys({ sourced: 0, sourcingAbandoned: true }), ["wentLive", "sourcingIncomplete"]);
});

test("receiptNote: an abandoned receipt is amber, says the sweep did not finish, and offers the resume", () => {
  assert.deepEqual(receiptNote({ state: "abandoned" }), {
    tone: "warn",
    sentences: [{ key: "sourcingIncomplete" }],
    resumable: true,
  });
});

test("receiptNote: each state tells its own truth", () => {
  const done = receiptNote({ state: "done", sourced: 3, skipped: 0, silverMedalists: 1 });
  assert.equal(done.resumable, false);
  assert.equal(done.tone, "ok");
  assert.deepEqual(done.sentences.map((s) => s.key), ["wentLive", "sourced", "silverMedalists"]);

  const failed = receiptNote({ state: "sourcing_failed" });
  assert.deepEqual(failed, { tone: "warn", sentences: [{ key: "sourcingFailed" }], resumable: true });

  const raise = receiptNote({ state: "raise_failed", sourced: 2 });
  assert.equal(raise.resumable, true);
  assert.deepEqual(raise.sentences.map((s) => s.key), ["sourced", "silverMedalistsFailed"]);

  // A run in flight elsewhere (another tab, another recruiter) — not offered, not "done".
  const running = receiptNote({ state: "sourcing" });
  assert.deepEqual(running, { tone: "ok", sentences: [{ key: "sourcingInProgress" }], resumable: false });
  // …unless the server says it died (the stale window is the server's call).
  const dead = receiptNote({ state: "sourcing", resumable: true });
  assert.deepEqual(dead, { tone: "warn", sentences: [{ key: "sourcingIncomplete" }], resumable: true });
});

test("the resumable states are one vocabulary, shared with the store's CAS", () => {
  assert.deepEqual([...RESUMABLE_RECEIPT_STATES].sort(), ["abandoned", "raise_failed", "sourcing_failed"]);
  const now = Date.parse("2026-09-24T12:00:00Z");
  assert.equal(receiptResumable({ state: "sourcing", startedAt: new Date(now - 60_000).toISOString() }, now), false);
  assert.equal(receiptResumable({ state: "sourcing", startedAt: new Date(now - 30 * 60_000).toISOString() }, now), true);
  assert.equal(receiptResumable({ state: "done", startedAt: new Date(now - 30 * 60_000).toISOString() }, now), false);
  assert.equal(receiptResumable({ state: "abandoned", startedAt: new Date(now).toISOString() }, now), true);
});
