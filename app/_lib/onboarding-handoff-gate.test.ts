// bug-ui-scan 2026-07-09 (candidate-onboarding-hand-off #1, #2): the candidate token
// bridge must enforce the SAME live-stage gate the recruiter POST uses, and a withdrawn
// hire's link must go dead / be revocable. Real DB via testing/unit-db.ts (first import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import "better-sqlite3";
import Database from "better-sqlite3";
import { UNIT_DB_PATH, cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { createOffer } from "./offers-store.ts";
import { candidateOnboardingView } from "./onboarding-candidate.ts";
import { cancelRun, runForEntry } from "./onboarding-store.ts";

after(() => cleanupUnitDb());

function raw() {
  return new Database(UNIT_DB_PATH);
}

function setStage(entryId: string, stage: string): void {
  const d = raw();
  d.prepare(`UPDATE pipeline_entries SET stage = ? WHERE id = ?`).run(stage, entryId);
  d.close();
}

// A Hired entry with an accepted offer — the only legitimate onboarding precondition.
function hiredWithAcceptedOffer(key: string): { entryId: string; token: string } {
  const { entry } = createPipelineEntry({
    candidateId: key,
    candidateLabel: `Candidate ${key}`,
    jobId: `job-${key}`,
    jobTitle: "Software Engineer",
    stage: "Hired",
  });
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: `Candidate ${key}`,
    jobId: `job-${key}`,
    jobTitle: "Software Engineer",
    currency: null,
    salary: null,
    payload: {},
  });
  const d = raw();
  d.prepare(`UPDATE offers SET status = 'accepted' WHERE token = ?`).run(offer.token);
  d.close();
  return { entryId: entry.id, token: offer.token };
}

test("a live-Hired candidate with an accepted offer resolves the onboarding link", () => {
  const { token } = hiredWithAcceptedOffer("ob-hired");
  const view = candidateOnboardingView(token);
  assert.ok(view, "the token must resolve for a genuine Hired candidate");
  assert.equal(view!.role, "Software Engineer");
  assert.equal(view!.submitted, false);
});

test("a candidate who accepted then moved OFF Hired can no longer provision (both gates agree)", () => {
  const { entryId, token } = hiredWithAcceptedOffer("ob-withdrawn");
  // The offer stays `accepted`, but the recruiter withdrew the hire (stage moved back).
  setStage(entryId, "Screening");
  const view = candidateOnboardingView(token);
  assert.equal(view, null, "an accepted-then-withdrawn candidate must not provision an onboarding run");
});

test("a revoked run never resolves again and its PII is purged", () => {
  const { entryId, token } = hiredWithAcceptedOffer("ob-revoke");
  // Provision the run, then a recruiter revokes it (withdrawn hire).
  assert.ok(candidateOnboardingView(token), "precondition: resolves before revoke");
  const run = runForEntry(entryId);
  assert.ok(run, "a run exists after the first resolve");
  // Seed some intake PII, then revoke.
  const d = raw();
  d.prepare(`INSERT INTO onboarding_intake (run_id, answers_json, submitted_at) VALUES (?, ?, ?)`).run(
    run!.id,
    JSON.stringify({ ssn: "123-45-6789" }),
    new Date().toISOString(),
  );
  const intakeBefore = d.prepare(`SELECT COUNT(*) c FROM onboarding_intake WHERE run_id = ?`).get(run!.id) as { c: number };
  d.close();
  assert.equal(intakeBefore.c, 1, "intake PII present before revoke");

  assert.equal(cancelRun(run!.id), true);

  // The token bridge refuses a cancelled run — the link is dead.
  assert.equal(candidateOnboardingView(token), null, "a revoked run must not re-resolve");
  // And the run's PII was purged.
  const d2 = raw();
  const intakeAfter = d2.prepare(`SELECT COUNT(*) c FROM onboarding_intake WHERE run_id = ?`).get(run!.id) as { c: number };
  const status = d2.prepare(`SELECT status FROM onboarding_runs WHERE id = ?`).get(run!.id) as { status: string };
  d2.close();
  assert.equal(intakeAfter.c, 0, "intake PII purged on revoke");
  assert.equal(status.status, "cancelled");
});
