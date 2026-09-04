// Import the REAL native better-sqlite3 first (never a shim), so every store call
// below opens a genuine on-disk SQLite file.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path
// (distribution → db → db-path). It also clears COMMS_WEBHOOK_URL, so sendComm uses
// the local OutboxChannel (records a "queued" row; no network). Keep it first.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { getAdapter, intakeSubmission, LocalDistributionAdapter, UnknownChannelError } from "./distribution.ts";
import { createPosting, createSubmission, listOutboxFiltered } from "./db.ts";

// bug-ui-scan-2026-07-09 shared-utility-libraries #4 + #5.
//
// #4 — the acknowledgement was gated on the one-shot `created` insert flag, so a
// first attempt whose sendComm threw persisted the submission but dropped the ack,
// and the candidate's retry (created === false) returned before sendComm and dropped
// it FOREVER. The fix drives the ack off a durable marker (an acknowledgement outbox
// row for the submission), so a retry that finds an existing-but-unacked row re-sends.
//
// #5 — getAdapter silently mapped an UNKNOWN channel to the local stub, so a typo'd /
// unimplemented channel published a local posting and answered as if it had succeeded.
// It now throws UnknownChannelError for an unregistered channel; local stays the
// no-argument default.
//
// Real DB (the store's own connection on a throwaway file). Full ensureDb() init runs
// on the first store call in before().

/** Count the acknowledgement outbox rows recorded for a submission. */
function ackCount(submissionId: string): number {
  return listOutboxFiltered({ ref: submissionId, kind: "acknowledgement", limit: 50 }).length;
}

let seq = 0;
/** A fresh OPEN local posting to submit against. */
function freshPosting(role = "Backend Developer") {
  seq += 1;
  return createPosting({
    caseId: `dc-test-${seq}`,
    channel: "local",
    token: `tok-test-${seq}`,
    roleTitle: role,
    caseTitle: "Take-home case",
  });
}

before(() => {
  // Force the full ensureDb() init (creates dev_postings / dev_submissions / dev_outbox).
  listOutboxFiltered({ limit: 1 });
});

after(() => cleanupUnitDb());

// ── #5 getAdapter ────────────────────────────────────────────────────────────

test("getAdapter: the no-argument default is the local stub", () => {
  assert.equal(getAdapter().channel, "local");
  assert.ok(getAdapter() instanceof LocalDistributionAdapter);
  assert.equal(getAdapter("local").channel, "local");
});

test("getAdapter: an UNKNOWN channel throws instead of silently using local", () => {
  // NON-VACUITY: pre-fix `return ADAPTERS[channel] ?? ADAPTERS.local` returned the
  // LOCAL adapter for these (no throw), so a publish to "email"/"ats"/a typo looked
  // configured but went nowhere. assert.throws would fail against that behavior.
  assert.throws(() => getAdapter("email"), UnknownChannelError);
  assert.throws(() => getAdapter("ats"), /Unsupported distribution channel/);
  assert.throws(() => getAdapter("locl"), UnknownChannelError); // a genuine typo
});

// ── #4 intakeSubmission acknowledgement durability ───────────────────────────

test("intakeSubmission: a genuinely new submission is acknowledged exactly once", async () => {
  const posting = freshPosting();
  const { submission, isNew } = await intakeSubmission({
    postingId: posting.id,
    candidateRef: "alice",
    repoRef: "repo-alice",
  });
  assert.equal(isNew, true);
  assert.equal(ackCount(submission.id), 1);
});

test("intakeSubmission: a retry of an ALREADY-acknowledged submission does not double-send", async () => {
  const posting = freshPosting();
  const input = { postingId: posting.id, candidateRef: "bob", repoRef: "repo-bob" };
  const first = await intakeSubmission(input);
  const second = await intakeSubmission(input);
  assert.equal(second.isNew, false, "the duplicate is not treated as new");
  // Idempotent: the existing ack row is detected, so no second acknowledgement is sent.
  assert.equal(ackCount(first.submission.id), 1);
});

test("intakeSubmission: a retry RE-SENDS the ack when the first attempt persisted the row but dropped the ack", async () => {
  const posting = freshPosting();
  const input = { postingId: posting.id, candidateRef: "carol", repoRef: "repo-carol" };

  // Reproduce the post-first-attempt state the bug leaves behind: the submission row
  // is committed, but its sendComm threw before recordOutbox — so NO acknowledgement
  // outbox row exists. createSubmission alone (without the ack) models exactly that.
  const { submission, created } = createSubmission(input);
  assert.equal(created, true);
  assert.equal(ackCount(submission.id), 0, "precondition: the ack was dropped by the failed first attempt");

  // The candidate re-submits. Here `created` is now false.
  // NON-VACUITY: pre-fix, `if (!created) return { submission, isNew: false }` ran
  // BEFORE sendComm, so the ack stayed dropped forever — ackCount would remain 0 and
  // this assertion would fail. The fix drives the ack off the (absent) outbox marker
  // and re-sends it.
  const retry = await intakeSubmission(input);
  assert.equal(retry.isNew, false, "the row already existed, so it is not a new arrival");
  assert.equal(ackCount(submission.id), 1, "the retry recovered the dropped acknowledgement");
});

// ── The candidate ACK's LOCALE (wave-37 fix, previously untested) ────────────
//
// The acknowledgement is written to the CANDIDATE, so it renders in the
// candidate's language — and when the candidate recorded none (intake arrives
// off-session; `locale` is null on most webhook/apply payloads) the fallback is
// THEIR TEAM's `default_locale`, not the default team's. distribution.ts:158
// passes the submission's own workspace for exactly that reason:
//
//     const t = await commsTranslator(input.locale, submission.workspaceId);
//
// Nothing pinned it, so dropping the second argument — which still compiles for a
// null locale only because the overload pair in comms-translator.ts is what makes
// it a type error — would silently re-ship English (the DEFAULT team's language
// here) to a Czech team's candidates. This test is that pin.
const { createWorkspace, setWorkspaceDefaultLocale, getWorkspaceDefaultLocale, DEFAULT_WORKSPACE_ID } =
  await import("./db/workspaces.ts");
const { saveDevCase } = await import("./db/devcase.ts");

/** The `comms.ack` subject a locale's catalog actually carries — read from the
 *  catalog rather than hardcoded, so ordinary copy edits don't fail this test and
 *  the assertion stays about the LANGUAGE CHOICE, which is what regressed. */
function ackSubjectRole(locale: string, role: string): string {
  const catalog = JSON.parse(
    fsSync.readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")
  ) as { comms: { ack: { subjectRole: string } } };
  return catalog.comms.ack.subjectRole.replace("{role}", role);
}

test("intakeSubmission: a NULL-locale candidate hears THEIR team's default_locale, not the default team's", async () => {
  // A Czech team beside an English default team — the two-tenant shape the fix is about.
  const czechTeam = createWorkspace("Česká spořitelna");
  setWorkspaceDefaultLocale("cs", czechTeam.id);
  setWorkspaceDefaultLocale("en", DEFAULT_WORKSPACE_ID);
  // PRECONDITIONS — without these the assertion below is vacuous: if the default
  // team were also Czech, an unscoped resolve would produce Czech too and pass.
  assert.equal(getWorkspaceDefaultLocale(czechTeam.id), "cs");
  assert.equal(getWorkspaceDefaultLocale(DEFAULT_WORKSPACE_ID), "en", "the default team must NOT be Czech here");

  // A posting in the Czech team (the posting inherits its case's workspace, the
  // submission inherits the posting's — so the submission is genuinely that tenant's).
  const role = "Backend Developer";
  const dc = saveDevCase(
    { need: {}, analysis: {}, role: { title: role }, case: { title: "Take-home case" } },
    czechTeam.id
  );
  seq += 1;
  const posting = createPosting({
    caseId: dc.id,
    channel: "local",
    token: `tok-cs-${seq}`,
    roleTitle: role,
    caseTitle: "Take-home case",
  });
  assert.equal(posting.workspaceId, czechTeam.id, "precondition: the posting is the Czech team's");

  // The candidate records NO language — the case the workspace default exists for.
  const { submission } = await intakeSubmission({
    postingId: posting.id,
    candidateRef: "dana",
    repoRef: "repo-dana",
    locale: null,
  });
  assert.equal(submission.workspaceId, czechTeam.id, "precondition: the submission is the Czech team's");

  const acks = listOutboxFiltered({ ref: submission.id, kind: "acknowledgement", limit: 5 }, czechTeam.id);
  assert.equal(acks.length, 1, "the ack is filed under the submission's own team");
  // NON-VACUITY: `commsTranslator(input.locale)` without the tenant resolves the
  // null locale against the DEFAULT team — "en" here — so this assertion fails
  // against the pre-fix call, and the next one states what it would have said.
  assert.equal(acks[0].subject, ackSubjectRole("cs", role), "the Czech team's candidate is written to in Czech");
  assert.notEqual(
    ackSubjectRole("cs", role),
    ackSubjectRole("en", role),
    "guard: the two catalogs must differ, or the assertion above proves nothing"
  );
});
