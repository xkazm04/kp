// Behavioral coverage for the candidate onboarding bridge (bug-ui-scan-2026-07-09
// offers-onboarding #2) against an ISOLATED throwaway DB (testing/unit-db.ts must stay the
// first project import). Pins the empty-submit guard: a blank pre-boarding submit must NOT
// create an intake row, because an intake row both fakes "submitted" AND permanently
// suppresses the one-shot pre-boarding reminder (duePreboardingReminders).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { createOffer } from "./offers-store.ts";
import { respondToOffer } from "./offer-finalize.ts";
import { candidateOnboardingView, submitCandidateIntake } from "./onboarding-candidate.ts";
import { duePreboardingReminders } from "./onboarding-store.ts";

after(() => cleanupUnitDb());

let seq = 0;
/** Create a candidate, extend + ACCEPT an offer so the entry is Hired with an onboarding
 *  run — the state in which the accepted offer's token resolves to the intake page. */
async function acceptedOfferToken(): Promise<string> {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `oc-c${seq}`,
    candidateLabel: `Onboard Candidate ${seq}`,
    jobId: `oc-job-${seq}`,
    jobTitle: "Onboard Role",
    stage: "Offer",
    contact: `oc-c${seq}@example.com`,
  });
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: null,
    jobTitle: "Onboard Role",
    currency: "CZK",
    salary: 80_000,
    payload: {},
    ttlDays: null,
  });
  const res = await respondToOffer(offer.token, "accept");
  assert.ok(res.ok && res.status === "accepted", "offer accepted so the onboarding token resolves");
  return offer.token;
}

test("an all-blank onboarding submit writes NO intake row and keeps the pre-boarding reminder alive", async () => {
  const token = await acceptedOfferToken();
  const FUTURE = new Date(Date.now() + 3600_000).toISOString();

  // Before any submit, the fresh run is due its one nudge.
  const dueBefore = new Set(duePreboardingReminders(FUTURE).map((r) => r.id));
  assert.ok(dueBefore.size > 0, "a fresh un-submitted run is due a pre-boarding reminder");

  // A blank submit is refused with a distinct `empty` signal (not a silent success).
  assert.deepEqual(submitCandidateIntake(token, {}), { ok: false, empty: true });
  // Whitespace-only, and non-questionnaire keys, are equally "empty".
  assert.deepEqual(submitCandidateIntake(token, { preferredName: "   " }), { ok: false, empty: true });
  assert.deepEqual(submitCandidateIntake(token, { notAField: "x" }), { ok: false, empty: true });

  // The hire stays un-submitted, so the one-shot reminder is STILL due (not suppressed).
  const view = candidateOnboardingView(token)!;
  assert.equal(view.submitted, false, "a blank submit must not mark the intake submitted");
  const dueAfter = new Set(duePreboardingReminders(FUTURE).map((r) => r.id));
  assert.deepEqual(dueAfter, dueBefore, "the one-shot reminder is not killed by a blank submit");
});

test("a submit with real content persists and marks the intake submitted", async () => {
  const token = await acceptedOfferToken();
  assert.deepEqual(submitCandidateIntake(token, { preferredName: "Alex" }), { ok: true });
  const view = candidateOnboardingView(token)!;
  assert.equal(view.submitted, true);
  assert.equal(view.answers.preferredName, "Alex");
});
