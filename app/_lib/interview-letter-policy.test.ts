// Who may ask for an interview feedback letter, and what the candidate's own status page is
// told about it (spark interview-feedback-letter, WP-alpha). Pure — literals only, no DB.
//
// The rule under test (interview-letter-policy.ts): a letter follows a decision a PERSON made
// about this candidate — a human reject, or a hire — with an interview on record and consent
// intact. An automated screen-out is not eligible even when a named person approved the batch;
// a closed role and a rematch are not decisions about the candidate at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateLetterView,
  EMPTY_LETTER_VIEW,
  isLetterOutcome,
  LETTER_REJECT_EVENT_KINDS,
  letterEligibility,
  letterEventAttribution,
  letterTextProblem,
  type LetterEligibilityInput,
} from "./interview-letter-policy.ts";
import { LETTER_MAX_CHARS } from "./interview-letter-types.ts";
import { sealedActorAttribution } from "./status-decisions.ts";

const NOW = Date.parse("2026-09-18T10:00:00.000Z");
const CONSENT_OK = { givenAt: "2026-09-01T00:00:00.000Z", expiresAt: "2027-09-01T00:00:00.000Z", anonymizedAt: null };

function input(over: Partial<LetterEligibilityInput>): LetterEligibilityInput {
  return {
    entryStatus: "rejected",
    atTerminalStage: false,
    decidingEvent: { kind: "rejected", actor: "human:Petra Nováková" },
    consent: CONSENT_OK,
    hasInterviewRecord: true,
    ...over,
  };
}

test("a person's reject is eligible, as not_selected", () => {
  assert.deepEqual(letterEligibility(input({}), NOW), { eligible: true, outcome: "not_selected" });
  // The role actor a session without identity writes is still a person clicking.
  assert.deepEqual(letterEligibility(input({ decidingEvent: { kind: "rejected", actor: "human:recruiter" } }), NOW), {
    eligible: true,
    outcome: "not_selected",
  });
  // A legacy row with no actor falls back to the KIND: `rejected` is the human routes' kind.
  assert.deepEqual(letterEligibility(input({ decidingEvent: { kind: "rejected", actor: null } }), NOW), {
    eligible: true,
    outcome: "not_selected",
  });
});

test("an automated screen-out is NOT eligible, even with a named approver on the batch", () => {
  // screen-wave.ts: actOnPipelineEntry(..., { actor: "system" }) with no actorRef — the
  // batch's named approver lives in the sealed record's inputs, never on this event.
  assert.deepEqual(letterEligibility(input({ decidingEvent: { kind: "auto_rejected", actor: null } }), NOW), {
    eligible: false,
    reason: "automated_decision",
  });
  assert.deepEqual(letterEligibility(input({ decidingEvent: { kind: "auto_rejected", actor: "auto:screen-wave" } }), NOW), {
    eligible: false,
    reason: "automated_decision",
  });
  // The guided simulation's reject is the machine's too.
  assert.deepEqual(letterEligibility(input({ decidingEvent: { kind: "auto_rejected", actor: "auto:sim" } }), NOW), {
    eligible: false,
    reason: "automated_decision",
  });
  // The actor prefix is authoritative over the kind: an "auto:" actor never reads human.
  assert.equal(letterEligibility(input({ decidingEvent: { kind: "rejected", actor: "auto:screen-wave" } }), NOW).eligible, false);
});

test("a rejected entry with no reject event on record fails CLOSED", () => {
  assert.deepEqual(letterEligibility(input({ decidingEvent: null }), NOW), { eligible: false, reason: "unattributed_decision" });
  // An unmapped kind with no actor prefix is unknown, and unknown is never a person.
  assert.equal(letterEligibility(input({ decidingEvent: { kind: "something_new", actor: null } }), NOW).eligible, false);
});

test("a hire is eligible, as hired", () => {
  assert.deepEqual(letterEligibility(input({ entryStatus: "active", atTerminalStage: true, decidingEvent: null }), NOW), {
    eligible: true,
    outcome: "hired",
  });
});

test("role_closed and rematched are not decisions about this candidate", () => {
  for (const entryStatus of ["role_closed", "rematched"]) {
    assert.deepEqual(letterEligibility(input({ entryStatus, decidingEvent: null }), NOW), {
      eligible: false,
      reason: "not_decided_about_candidate",
    });
  }
});

test("the candidate's own decline, a live application and an unknown status are not eligible", () => {
  assert.deepEqual(letterEligibility(input({ entryStatus: "declined", decidingEvent: null }), NOW), {
    eligible: false,
    reason: "candidate_withdrew",
  });
  assert.deepEqual(letterEligibility(input({ entryStatus: "active", atTerminalStage: false, decidingEvent: null }), NOW), {
    eligible: false,
    reason: "no_decision",
  });
  assert.equal(letterEligibility(input({ entryStatus: "archived" }), NOW).eligible, false);
});

test("consent withheld (expired or anonymized) is never eligible — and wins over everything", () => {
  const expired = { givenAt: "2024-01-01T00:00:00.000Z", expiresAt: "2025-01-01T00:00:00.000Z", anonymizedAt: null };
  const anonymized = { ...CONSENT_OK, anonymizedAt: "2026-09-10T00:00:00.000Z" };
  for (const consent of [expired, anonymized]) {
    assert.deepEqual(letterEligibility(input({ consent }), NOW), { eligible: false, reason: "consent_withheld" });
    assert.deepEqual(letterEligibility(input({ consent, entryStatus: "active", atTerminalStage: true }), NOW), {
      eligible: false,
      reason: "consent_withheld",
    });
  }
});

test("the interview record is read only when the decision already qualifies", () => {
  let reads = 0;
  const probe = () => {
    reads += 1;
    return true;
  };
  letterEligibility(input({ entryStatus: "active", atTerminalStage: false, decidingEvent: null, hasInterviewRecord: probe }), NOW);
  letterEligibility(input({ decidingEvent: { kind: "auto_rejected", actor: null }, hasInterviewRecord: probe }), NOW);
  assert.equal(reads, 0, "a live or machine-decided application never pays for the read");
  assert.equal(letterEligibility(input({ hasInterviewRecord: probe }), NOW).eligible, true);
  assert.equal(reads, 1);
});

test("no interview on record → nothing a letter could report", () => {
  assert.deepEqual(letterEligibility(input({ hasInterviewRecord: false }), NOW), { eligible: false, reason: "no_interview" });
  assert.deepEqual(letterEligibility(input({ entryStatus: "active", atTerminalStage: true, hasInterviewRecord: false }), NOW), {
    eligible: false,
    reason: "no_interview",
  });
});

// ---- the candidate's projection -------------------------------------------------------

const ELIGIBLE = { eligible: true, outcome: "not_selected" } as const;
const NOT_ELIGIBLE = { eligible: false, reason: "automated_decision" } as const;

test("the view is exactly the four contract fields", () => {
  const view = candidateLetterView(null, ELIGIBLE, CONSENT_OK, NOW);
  assert.deepEqual(Object.keys(view).sort(), ["canRequest", "requestedAt", "state", "text"]);
  assert.deepEqual(view, { canRequest: true, state: null, requestedAt: null, text: null });
  assert.deepEqual(candidateLetterView(null, NOT_ELIGIBLE, CONSENT_OK, NOW), EMPTY_LETTER_VIEW);
});

test("once a letter exists the page shows its state, never a second button, and text only once sent", () => {
  const requested = { state: "requested" as const, requestedAt: "2026-09-17T09:00:00.000Z", finalText: null };
  assert.deepEqual(candidateLetterView(requested, ELIGIBLE, CONSENT_OK, NOW), {
    canRequest: false,
    state: "requested",
    requestedAt: "2026-09-17T09:00:00.000Z",
    text: null,
  });
  // A drafted letter's draft is NOT the candidate's — only an approved, sent text is.
  const drafted = { ...requested, state: "drafted" as const, finalText: null };
  assert.equal(candidateLetterView(drafted, ELIGIBLE, CONSENT_OK, NOW).text, null);
  const sent = { ...requested, state: "sent" as const, finalText: "Dear candidate, thank you." };
  assert.equal(candidateLetterView(sent, ELIGIBLE, CONSENT_OK, NOW).text, "Dear candidate, thank you.");
  // A decline is a closed request the candidate is told about, with no text.
  const declined = { ...requested, state: "declined" as const, finalText: null };
  assert.deepEqual(candidateLetterView(declined, NOT_ELIGIBLE, CONSENT_OK, NOW), {
    canRequest: false,
    state: "declined",
    requestedAt: "2026-09-17T09:00:00.000Z",
    text: null,
  });
});

test("consent withheld blanks the view entirely — silently, even for a sent letter", () => {
  const anonymized = { ...CONSENT_OK, anonymizedAt: "2026-09-10T00:00:00.000Z" };
  const sent = { state: "sent" as const, requestedAt: "2026-09-17T09:00:00.000Z", finalText: "Dear candidate…" };
  assert.deepEqual(candidateLetterView(sent, ELIGIBLE, anonymized, NOW), EMPTY_LETTER_VIEW);
  assert.deepEqual(candidateLetterView(null, ELIGIBLE, anonymized, NOW), EMPTY_LETTER_VIEW);
});

test("the text cap is the contract's, and a letter is never storable empty", () => {
  assert.equal(letterTextProblem("A short, real letter."), null);
  assert.equal(letterTextProblem("x".repeat(LETTER_MAX_CHARS)), null);
  assert.equal(letterTextProblem("x".repeat(LETTER_MAX_CHARS + 1)), "too_long");
  assert.equal(letterTextProblem("   "), "empty");
  assert.equal(letterTextProblem(null), "empty");
  assert.equal(isLetterOutcome("hired"), true);
  assert.equal(isLetterOutcome("withdrawn"), false);
});

test("the reject attribution is the candidate decision history's rule, exactly", () => {
  // Restated locally to keep a 35 KB kind map off the task hub's import graph; pinned
  // EQUAL here so the two can never disagree about who decided.
  const actors = [null, "", "human:Petra Nováková", "human:recruiter", "auto:screen-wave", "auto:sim", "system", "Petra"];
  for (const kind of LETTER_REJECT_EVENT_KINDS) {
    for (const actor of actors) {
      assert.equal(
        letterEventAttribution({ kind, actor }),
        sealedActorAttribution(actor ?? "", kind),
        `${kind} / ${JSON.stringify(actor)}`
      );
    }
  }
  // Any other kind never reaches it (the store reads reject kinds only); if one did, an
  // actor-less row is `unknown` here — stricter than the general map, never a person.
  assert.equal(letterEventAttribution({ kind: "reinstated", actor: null }), "unknown");
});
