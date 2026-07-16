// Behavioral coverage for the one-call drawer bundle + the entity-scoped analysis
// join (perfect-board Direction 2). The headline: two SAME-NAMED candidates in
// one workspace must NOT inherit each other's analysis history. Analyses carry no
// entry/candidate FK — only a free-text label + a jd_slug — so the join uses the
// strict (label + jd_slug↔jobId) identity contract the canonical match score
// uses; a same-named stranger analyzed for a DIFFERENT role no longer leaks in.
//
// unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, recordEntryConsent } from "./db/pipeline.ts";
import { saveAnalysis } from "./db/analyses.ts";
import { recordOutbox } from "./db/devcase.ts";
import { createInterviewSession, completeInterviewSession } from "./db/interviews.ts";
import {
  createScheduleInvite,
  confirmScheduleInvite,
  declineScheduleInvite,
  markScheduleInviteNoShow,
  setScheduleInviteProposals,
  listScheduleInvites,
  listScheduleInvitesForEntry,
} from "./schedule-store.ts";
import { UNIT_DB_PATH } from "./testing/unit-db.ts";
import Database from "better-sqlite3";
import { candidateDrawerBundle } from "./candidate-timeline.ts";

after(() => cleanupUnitDb());

const inviteStatuses = (entryId: string): string[] =>
  (candidateDrawerBundle(entryId)!.items.filter((i) => i.kind === "invite").map((i) => i.status)) as string[];

// A completed voice interview whose AI scorecard carries the round-3 telemetry +
// coverage that ride on the scorecard object at runtime (interview-run.ts).
const TELEMETRY = {
  version: 1,
  turns: 12,
  candidateTurns: 6,
  interviewerTurns: 6,
  candidateWords: 300,
  interviewerWords: 100,
  talkRatio: 0.75,
  durationSec: 630,
  longestResponseGapSec: 42,
  hint: { offered: true, turnIndex: 4, uptake: "integrated", responseSec: 8 },
} as const;
const COVERAGE = { version: 1, keptTurns: 40, totalTurns: 120, droppedTurns: 80, droppedChars: 5000, coverageRatio: 0.33 } as const;

function seedCompletedInterview(entryId: string, extra: Record<string, unknown> = {}) {
  const session = createInterviewSession({ provider: "openai", entryId, mode: "candidate" });
  completeInterviewSession(session.id, {
    transcript: [{ role: "candidate", text: "I'd approach it incrementally." }],
    scorecard: { recommendation: "advance", summary: "Strong structured reasoning.", ratings: [{ competency: "problem_solving", rating: 4 }], telemetry: TELEMETRY, coverage: COVERAGE, ...extra },
    status: "completed",
  });
}

test("the interview outcome projects telemetry + coverage from the scorecard", () => {
  const e = createPipelineEntry({ candidateId: "cand-iv", candidateLabel: "Iva Telemetry", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  seedCompletedInterview(e.entry.id);

  const bundle = candidateDrawerBundle(e.entry.id);
  const iv = bundle!.interview;
  assert.ok(iv, "the completed interview rides the bundle");
  assert.equal(iv!.recommendation, "advance");
  assert.equal(iv!.hasTranscript, true);
  // The descriptive signals + the coverage caveat shape are projected verbatim.
  assert.deepEqual(iv!.telemetry, TELEMETRY, "telemetry rides the outcome");
  assert.deepEqual(iv!.coverage, COVERAGE, "coverage rides the outcome");
});

test("consent-expiry redaction drops the scorecard synthesis AND its telemetry/coverage", () => {
  const e = createPipelineEntry({ candidateId: "cand-redact", candidateLabel: "Red Acted", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  seedCompletedInterview(e.entry.id);
  // ttlDays -1 ⇒ consent already expired ⇒ consentWithholdsPii ⇒ redaction at read.
  recordEntryConsent(e.entry.id, "apply", -1);

  const bundle = candidateDrawerBundle(e.entry.id);
  assert.equal(bundle!.consent.consent.status, "expired", "the consent snapshot reads expired in the bundle");
  const iv = bundle!.interview;
  assert.ok(iv, "the outcome object still renders a state (metadata kept)");
  assert.equal(iv!.summary, undefined, "the verbatim synthesis is withheld");
  assert.equal(iv!.telemetry, undefined, "telemetry is withheld with the redacted scorecard");
  assert.equal(iv!.coverage, undefined, "coverage is withheld with the redacted scorecard");
  assert.equal(iv!.hasTranscript, false, "the redacted transcript reads as absent");
});

test("the consent snapshot + audit trail ride the bundle (no separate drawer fetch)", () => {
  const e = createPipelineEntry({ candidateId: "cand-consent", candidateLabel: "Con Sent", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  recordEntryConsent(e.entry.id, "apply"); // default TTL ⇒ active

  const bundle = candidateDrawerBundle(e.entry.id);
  assert.equal(bundle!.consent.consent.status, "active", "granted consent reads active");
  assert.equal(bundle!.consent.consent.source, "apply");
  assert.ok(bundle!.consent.consent.givenAt, "the grant timestamp rides along");
  assert.ok(bundle!.consent.events.some((ev) => ev.kind === "granted"), "the audit trail rides the bundle too");
});

test("same-named candidates on different JD-backed jobs do NOT inherit each other's analyses", () => {
  const NAME = "Jan Novák"; // two real, distinct people who happen to share a name
  // Two entries, same label, DIFFERENT JD-backed jobs (jobId `jd-<slug>`).
  const a = createPipelineEntry({ candidateId: "cand-fe", candidateLabel: NAME, jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const b = createPipelineEntry({ candidateId: "cand-be", candidateLabel: NAME, jobId: "jd-backend", jobTitle: "Backend Engineer" });
  assert.ok(a.created && b.created);

  // One analysis per person, keyed to THEIR role's jd_slug (same shared label).
  const feAnalysis = saveAnalysis({ candidateLabel: NAME, jdSlug: "frontend", score: 81, roleFamily: "engineering", seniority: "mid", payload: {} });
  const beAnalysis = saveAnalysis({ candidateLabel: NAME, jdSlug: "backend", score: 62, roleFamily: "engineering", seniority: "mid", payload: {} });

  const bundleA = candidateDrawerBundle(a.entry.id);
  assert.ok(bundleA, "the entry resolves");
  const analysisSlugsA = bundleA!.items.filter((i) => i.kind === "analysis").map((i) => i.slug);
  assert.deepEqual(analysisSlugsA, [feAnalysis.slug], "the frontend entry sees ONLY its own job's analysis");
  assert.ok(!analysisSlugsA.includes(beAnalysis.slug), "the backend stranger's analysis must NOT leak in");
  // Job axis confirmed the identity ⇒ full confidence, no by-name caveat.
  assert.equal(bundleA!.items.find((i) => i.kind === "analysis")!.labelOnly, false);

  const bundleB = candidateDrawerBundle(b.entry.id);
  const analysisSlugsB = bundleB!.items.filter((i) => i.kind === "analysis").map((i) => i.slug);
  assert.deepEqual(analysisSlugsB, [beAnalysis.slug], "the backend entry sees ONLY its own job's analysis");
});

test("a corpus-job entry (no JD slug) flags its label-only analyses as reduced-confidence", () => {
  const NAME = "Petr Svoboda";
  // A non-JD-backed job — jobId is not `jd-<slug>`, so there's no job axis to
  // confirm identity; a label match is inherently by-name.
  const c = createPipelineEntry({ candidateId: "cand-corpus", candidateLabel: NAME, jobId: "corpus-role-7", jobTitle: "Ops Lead" });
  const an = saveAnalysis({ candidateLabel: NAME, jdSlug: "some-other-jd", score: 70, roleFamily: "ops", seniority: "senior", payload: {} });

  const bundle = candidateDrawerBundle(c.entry.id);
  const analysis = bundle!.items.find((i) => i.kind === "analysis" && i.slug === an.slug);
  assert.ok(analysis, "a corpus entry still surfaces its label matches");
  assert.equal(analysis!.labelOnly, true, "but flags them reduced-confidence (matched by name only)");
});

test("comms appear EXACTLY ONCE — in the comms letters, never duplicated as timeline items", () => {
  const e = createPipelineEntry({ candidateId: "cand-comm", candidateLabel: "Eva Dvořák", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  recordOutbox({ recipient: "eva@example.com", subject: "Thanks for applying", body: "We received your application.", kind: "rejection", channel: "email", status: "queued", ref: e.entry.id });

  const bundle = candidateDrawerBundle(e.entry.id);
  assert.equal(bundle!.comms.length, 1, "the letter shows up in the comms section");
  assert.equal(bundle!.comms[0].subject, "Thanks for applying");
  // The timeline items no longer carry a comm kind at all — so a comm can never be
  // rendered twice (once as a letter, once in history).
  assert.equal(bundle!.items.some((i) => (i.kind as string) === "comm"), false, "no comm item duplicates the letter");
});

// ── Direction 1: read-back entities project onto the interview outcome ──────────
test("the interview outcome projects the structured read-back entities", () => {
  const e = createPipelineEntry({ candidateId: "cand-ent", candidateLabel: "Enti Ties", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  seedCompletedInterview(e.entry.id, {
    entities: {
      confirmed: ["PostgreSQL", " Docker "],
      corrected: [{ heard: "Rust", meant: "React" }, { heard: "", meant: "x" }],
      unconfirmed: ["Kubernetes", 42],
    },
  });
  const iv = candidateDrawerBundle(e.entry.id)!.interview;
  // Projected through the SAME normalizer the modal uses: trimmed, half-empty pairs
  // and non-string buckets dropped.
  assert.deepEqual(iv!.entities, {
    confirmed: ["PostgreSQL", "Docker"],
    corrected: [{ heard: "Rust", meant: "React" }],
    unconfirmed: ["Kubernetes"],
  });
});

test("no read-back ⇒ entities absent (no chrome), and consent redaction drops it", () => {
  const e1 = createPipelineEntry({ candidateId: "cand-noent", candidateLabel: "No Enti", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  seedCompletedInterview(e1.entry.id); // scorecard carries no entities
  assert.equal(candidateDrawerBundle(e1.entry.id)!.interview!.entities, undefined, "absent when no read-back happened");

  const e2 = createPipelineEntry({ candidateId: "cand-entredact", candidateLabel: "Ent Redact", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  seedCompletedInterview(e2.entry.id, { entities: { confirmed: ["React"], corrected: [], unconfirmed: [] } });
  recordEntryConsent(e2.entry.id, "apply", -1); // already expired ⇒ redaction at read
  assert.equal(candidateDrawerBundle(e2.entry.id)!.interview!.entities, undefined, "dropped with the redacted scorecard");
});

// ── Direction 2: terminal invite states stop rendering as live ──────────────────
test("a declined invite surfaces its true terminal state (not just 'sent')", () => {
  const e = createPipelineEntry({ candidateId: "cand-decl", candidateLabel: "Deb Cline", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const inv = createScheduleInvite({ entryId: e.entry.id });
  declineScheduleInvite(inv.token);
  assert.deepEqual(inviteStatuses(e.entry.id), ["sent", "declined"], "the story ends declined, no stale confirmed");
});

test("a no-show invite renders confirmed → no_show, anchored to the missed slot", () => {
  const e = createPipelineEntry({ candidateId: "cand-noshow", candidateLabel: "Noah Show", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const inv = createScheduleInvite({ entryId: e.entry.id });
  confirmScheduleInvite(inv.token, "Wed 15 Jan · 10:00", "2030-01-15T10:00:00.000Z");
  markScheduleInviteNoShow(inv.token);
  const items = candidateDrawerBundle(e.entry.id)!.items.filter((i) => i.kind === "invite");
  assert.deepEqual(items.map((i) => i.status), ["sent", "confirmed", "no_show"]);
  assert.equal(items.find((i) => i.status === "no_show")!.at, "2030-01-15T10:00:00.000Z", "the lapse is anchored to the missed slot time");
});

test("a candidate's pending proposal is a timeline fact", () => {
  const e = createPipelineEntry({ candidateId: "cand-prop", candidateLabel: "Pro Posal", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const inv = createScheduleInvite({ entryId: e.entry.id });
  setScheduleInviteProposals(inv.token, [{ value: "2030-02-01T09:00:00.000Z", label: "Fri 1 Feb · 09:00" }]);
  assert.deepEqual(inviteStatuses(e.entry.id), ["sent", "proposed"], "the proposal is recorded, invite still pending");
});

test("a stale pending invite past its TTL renders derived 'expired'", () => {
  const e = createPipelineEntry({ candidateId: "cand-exp", candidateLabel: "Ex Pyred", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const inv = createScheduleInvite({ entryId: e.entry.id });
  // Backdate created_at past the 7-day TTL via a raw handle on the same test DB —
  // there's no store API to age a row, and expiry is derived from createdAt.
  const raw = new Database(UNIT_DB_PATH);
  raw.prepare(`UPDATE schedule_invites SET created_at = ? WHERE token = ?`).run("2020-01-01T00:00:00.000Z", inv.token);
  raw.close();
  assert.deepEqual(inviteStatuses(e.entry.id), ["sent", "expired"], "a never-booked stale link stops reading as live");
});

test("a live pending/confirmed invite is unchanged (no terminal item)", () => {
  const ep = createPipelineEntry({ candidateId: "cand-live", candidateLabel: "Liv Ely", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  createScheduleInvite({ entryId: ep.entry.id });
  assert.deepEqual(inviteStatuses(ep.entry.id), ["sent"], "a fresh pending invite is just 'sent'");

  const ec = createPipelineEntry({ candidateId: "cand-conf", candidateLabel: "Con Firmed", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const inv = createScheduleInvite({ entryId: ec.entry.id });
  confirmScheduleInvite(inv.token, "Wed 15 Jan · 14:00", "2030-01-15T14:00:00.000Z");
  assert.deepEqual(inviteStatuses(ec.entry.id), ["sent", "confirmed"], "a confirmed booking stays sent + confirmed");
});

// ── drawer-open-diet: the entry-scoped invite read is byte-identical to filtering ──
test("listScheduleInvitesForEntry equals the filtered workspace scan (entry with invites among others')", () => {
  // Three entries, each with invites, in various states — so the workspace scan holds
  // a mix and the entry-scoped read must return EXACTLY this entry's rows, in order.
  const mine = createPipelineEntry({ candidateId: "cand-mine", candidateLabel: "Mine Invited", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const other1 = createPipelineEntry({ candidateId: "cand-o1", candidateLabel: "Other One", jobId: "jd-backend", jobTitle: "Backend Engineer" });
  const other2 = createPipelineEntry({ candidateId: "cand-o2", candidateLabel: "Other Two", jobId: "jd-backend", jobTitle: "Backend Engineer" });

  // This entry gets a CONFIRMED invite (has a slot_at, so it sorts ahead of pending).
  const mineInv = createScheduleInvite({ entryId: mine.entry.id });
  confirmScheduleInvite(mineInv.token, "Wed 15 Jan · 09:00", "2030-01-15T09:00:00.000Z");
  // Others get their own invites, interleaved in the workspace scan.
  createScheduleInvite({ entryId: other1.entry.id });
  const o2Inv = createScheduleInvite({ entryId: other2.entry.id });
  confirmScheduleInvite(o2Inv.token, "Thu 16 Jan · 09:00", "2030-01-16T09:00:00.000Z");

  const scoped = listScheduleInvitesForEntry(mine.entry.id);
  const filtered = listScheduleInvites(500).filter((i) => i.entryId === mine.entry.id);
  assert.deepEqual(scoped, filtered, "entry-scoped read is byte-identical to the filtered workspace scan");
  assert.equal(scoped.length, 1, "and returns only this entry's invite, none of the others'");
  assert.equal(scoped[0].entryId, mine.entry.id);
});

test("the bundle carries every drawer section in one payload", () => {
  const e = createPipelineEntry({ candidateId: "cand-shape", candidateLabel: "Shape Test", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const bundle = candidateDrawerBundle(e.entry.id);
  assert.ok(bundle, "resolves");
  assert.ok(Array.isArray(bundle!.items) && Array.isArray(bundle!.events) && Array.isArray(bundle!.comms), "items/events/comms are arrays");
  // createPipelineEntry logs an "added" event — proving events ride the same bundle.
  assert.ok(bundle!.events.some((ev) => ev.kind === "added"), "pipeline events ride the bundle");
  assert.equal(bundle!.interview, null, "no interview yet");
  assert.equal(bundle!.humanScorecard, null, "no human scorecard yet");
  assert.equal(bundle!.consent.consent.status, "none", "consent rides the bundle (none until granted)");
  assert.equal(candidateDrawerBundle("does-not-exist"), null, "an unknown entry is null (route → 404)");
});
