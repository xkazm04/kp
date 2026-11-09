// C2 — the WITNESSED timeline. The hash chain protects the log, not the timeline it
// records: a scripted client can mint a session, wait out the timebox, then POST one
// flush carrying a fully synthetic hour of events and read `chain: valid,
// backdatedEvents: 0`. The tell is stored and was unread: nearly every event ARRIVES
// long after the time it claims. These fixtures pin the three shapes —
//   attack          mint, wait, ONE POST of 60 minutes      -> unwitnessed
//   honest replay   8-second flushes                         -> witnessed
//   offline return  regular flushes, a dead-air stretch
//                   flushed on reconnect, regular flushes    -> neutral (never suspect)
// — and the one rule that matters: an unwitnessed trace costs the candidate NO score.
// It only holds auto-promote, caps process confidence and blocks permanent observed
// minting, and every hold says why.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendDevSessionEvents, getDevSessionIntegrity, startDevSession, type DevSessionEvent } from "./db/devcase.ts";
import { createPosting, createSubmission, saveDevCase, saveSubmissionEvaluation } from "./db/devcase.ts";
import { saveProfile } from "./db/profiles.ts";
import { scoreAuthenticity } from "./devcase-authenticity.ts";
import { mintObservedFromSubmission, promoteSubmission } from "./devcase-run.ts";

after(() => cleanupUnitDb());

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const KINDS = ["open", "edit", "edit", "decision_log"] as const;

/** One flush: events claimed at `claims`, received (server clock) at `receivedAt`. */
function flush(sessionId: string, claims: number[], receivedAt: number) {
  const events: DevSessionEvent[] = claims.map((t, i) => ({ t, kind: KINDS[i % KINDS.length], path: "src/a.ts" }));
  appendDevSessionEvents(sessionId, events, iso(receivedAt));
}

/** A live editor: a flush every 8s carrying the two events since the last one. */
function liveStretch(sessionId: string, fromMs: number, toMs: number) {
  for (let rx = fromMs + 8_000; rx <= toMs; rx += 8_000) flush(sessionId, [rx - 6_000, rx - 2_000], rx);
}

function sessionAt() {
  const s = startDevSession({ token: null, candidateRef: "witness" });
  return { id: s.id, t0: Date.parse(s.createdAt) };
}

test("attack: mint, wait, ONE POST of a synthetic hour -> unwitnessed, though the chain still reads valid", () => {
  const { id, t0 } = sessionAt();
  const claims = Array.from({ length: 121 }, (_, k) => t0 + k * 30_000); // 60 minutes
  flush(id, claims, t0 + 61 * MIN);
  const integrity = getDevSessionIntegrity(id);
  // What the old verdict said — and still says: the lie is not a tamper.
  assert.equal(integrity.chain.valid, true);
  assert.equal(integrity.backdatedEvents, 0);
  assert.equal(integrity.witness.verdict, "unwitnessed");
  assert.equal(integrity.witness.arrivalBatches, 1);
  assert.ok(integrity.witness.claimedSpanMs >= 59 * MIN, "the claimed hour is reported");
  assert.equal(integrity.witness.arrivalSpanMs, 0);
});

test("attack split into many rapid POSTs is the same lie", () => {
  const { id, t0 } = sessionAt();
  for (let k = 0; k < 60; k++) flush(id, [t0 + k * MIN, t0 + k * MIN + 30_000], t0 + 61 * MIN + k * 1_000);
  assert.equal(getDevSessionIntegrity(id).witness.verdict, "unwitnessed");
});

test("honest replay: 8-second flushes -> witnessed, many arrival batches", () => {
  const { id, t0 } = sessionAt();
  liveStretch(id, t0, t0 + 8 * MIN);
  const { witness } = getDevSessionIntegrity(id);
  assert.equal(witness.verdict, "witnessed");
  assert.ok(witness.arrivalBatches >= 50);
  assert.ok(witness.arrivalSpanMs >= 7 * MIN);
});

test("offline reconnect reads neutral, never suspect", () => {
  const { id, t0 } = sessionAt();
  liveStretch(id, t0, t0 + 10 * MIN);
  // Dead air: 15 minutes of work buffered offline, flushed in one batch on reconnect.
  flush(id, Array.from({ length: 31 }, (_, k) => t0 + 10 * MIN + k * 30_000), t0 + 25 * MIN);
  liveStretch(id, t0 + 25 * MIN, t0 + 40 * MIN);
  const { witness } = getDevSessionIntegrity(id);
  assert.equal(witness.verdict, "neutral");
});

test("a session with no timestamped events has nothing to witness: unknown, not accused", () => {
  const { id } = sessionAt();
  assert.equal(getDevSessionIntegrity(id).witness.verdict, "unknown");
});

test("zero penalty: the verdict never reaches the authenticity score", () => {
  // runEvaluateSubmission's compromised predicate stays chain/backdate/watermark only.
  const { id, t0 } = sessionAt();
  flush(id, Array.from({ length: 121 }, (_, k) => t0 + k * 30_000), t0 + 61 * MIN);
  const i = getDevSessionIntegrity(id);
  const compromised = i.chain.valid === false || i.backdatedEvents > 0 || i.watermark.foreign.length > 0;
  assert.equal(compromised, false);
  const scored = scoreAuthenticity({
    commitCount: 0,
    bursty: null,
    spanHours: null,
    decisionsLogPresent: true,
    readBeforeWrite: 0.6,
    iterationPattern: "linear",
    observed: true,
    integrityCompromised: compromised,
  });
  assert.equal(scored.band, "authentic");
});

let seq = 0;
function seeded(witness: string) {
  seq += 1;
  const kase = saveDevCase({ need: null, analysis: null, role: { title: "Backend Engineer", mustHaves: ["Python"] }, case: { title: "Case" } });
  const posting = createPosting({ caseId: kase.id, channel: "local", token: `tok-wit-${seq}`, roleTitle: "Backend Engineer", caseTitle: "Case" });
  saveProfile({ label: `Wit ${seq}`, archetype: "bau", roleFamily: null, completeness: null, payload: {} });
  const { submission } = createSubmission({ postingId: posting.id, candidateRef: `Wit ${seq}`, repoRef: `session:wit-${seq}` });
  saveSubmissionEvaluation(
    submission.id,
    {
      evaluation: { summary: "Strong work.", strengths: ["testing"], concerns: [], confidence: 0.8 },
      transfer: { transferScore: 88, confidence: 0.8, transfers: ["Python"], gaps: [], roleFitRationale: "Fits." },
      authenticity: { band: "authentic", score: 100 },
      integrity: {
        chain: { valid: true, events: 3, brokenAtSeq: null },
        backdatedEvents: 0,
        maxClockDriftMs: 0,
        watermark: { expected: "x", present: true, foreign: [] },
        witness: { verdict: witness, arrivalBatches: 1, claimedSpanMs: 3_600_000, arrivalSpanMs: 0, lateEvents: 120, totalEvents: 121 },
      },
    },
    88
  );
  return submission.id;
}

test("unwitnessed: promote HOLDS with a reasons line, and minting is blocked", async () => {
  const id = seeded("unwitnessed");
  const result = promoteSubmission(id, 55);
  assert.equal(result!.recommendation, "hold");
  assert.ok(
    result!.reasons.some((r) => /unwitnessed/i.test(r)),
    "every hold carries a reasons line"
  );
  assert.deepEqual(await mintObservedFromSubmission(id, result!.entryId), { credited: [], applied: false });
});

test("witnessed and neutral traces advance exactly as before", () => {
  for (const verdict of ["witnessed", "neutral"]) {
    const result = promoteSubmission(seeded(verdict), 55);
    assert.equal(result!.recommendation, "advance", verdict);
    assert.ok(!result!.reasons.some((r) => /unwitnessed/i.test(r)));
  }
});
