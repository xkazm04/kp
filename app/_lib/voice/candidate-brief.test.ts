// Pins the SECURITY BOUNDARY of the ElevenLabs candidate-session grounded brief:
// the allow-list sanitizers in candidate-brief.ts. The EL prompt override is
// client-sent (it transits the candidate's browser), so nothing interviewer-
// internal may survive these transforms — listenFor, redFlag, goal text (which
// embeds "Listen for:" / whatsGoodLooksLike assessment guidance), coachability
// stage directions, or any future private field. The fixtures below deliberately
// carry every internal-field style found in the real shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeCandidateBrief,
  sanitizeChronologyBlock,
  sanitizeFollowupQuestion,
  sanitizeScenarioPhase,
  type CandidateSafeBlock,
} from "./candidate-brief.ts";

// Unmistakably-internal markers (the annotation styles TP-L2-VOICE-01 found leaking).
const LISTEN_FOR = "Listen for: hedging about who actually wrote the migration";
const RED_FLAG = "Internal red flag — never say this aloud: claims 8 skills, largely self-taught";
const GOAL_WITH_GUIDANCE = `Probe depth on the missing must-have. ${LISTEN_FOR}`;
const STAGE_DIRECTION = "Mid-discussion, offer ONE gentle hint: “Could the same event arrive twice?” and observe whether they integrate it.";

function assertNoInternal(text: string) {
  for (const marker of ["Listen for:", "red flag", "never say this aloud", "missing must-have", "observe whether"]) {
    assert.ok(!text.includes(marker), `internal marker ${JSON.stringify(marker)} must not survive: ${text.slice(0, 200)}`);
  }
}

test("chronology block: only topic/timebox/questions survive; goal and unknown fields cannot", () => {
  const block = sanitizeChronologyBlock({
    topic: "Recent backend ownership",
    fromMin: 3,
    toMin: 7,
    goal: GOAL_WITH_GUIDANCE,
    questions: ["Walk me through the service you own end to end."],
    followUp: "What breaks first under 10× load?",
    // A future private field must be structurally incapable of leaking:
    recruiterNotes: RED_FLAG,
  });
  assert.ok(block);
  assert.equal(block.topic, "Recent backend ownership");
  assert.deepEqual(Object.keys(block).sort(), ["fromMin", "questions", "toMin", "topic"]);
  assert.deepEqual(block.questions, [
    "Walk me through the service you own end to end.",
    "What breaks first under 10× load?",
  ]);
  assertNoInternal(JSON.stringify(block));
});

test("scenario phase: listenFor/goal/caseRef never survive; coachability keeps only its topic", () => {
  const mechanism = sanitizeScenarioPhase({
    phase: "Mechanism probes",
    minutes: "4–5",
    goal: "Test causal understanding of the shared case.",
    probe: "“Why might the service read from a queue instead of being called directly?”",
    listenFor: LISTEN_FOR,
    feeds: ["Technical reasoning"],
    caseGrounded: true,
    caseRef: "coverProbes[p1]",
  });
  assert.ok(mechanism);
  assert.deepEqual(mechanism.questions, ["“Why might the service read from a queue instead of being called directly?”"]);
  assertNoInternal(JSON.stringify(mechanism));

  // The coachability phase's probe is a scripted stage direction (the deliberate
  // hint the agent injects and observes) — it must NOT reach the browser.
  const coachability = sanitizeScenarioPhase({
    phase: "Coachability injection",
    probe: STAGE_DIRECTION,
    listenFor: "Do they integrate the hint?",
    feeds: ["Coachability"],
    caseGrounded: true,
  });
  assert.ok(coachability);
  assert.equal(coachability.topic, "Coachability injection");
  assert.deepEqual(coachability.questions, [], "coachability stage directions must be stripped");
  assertNoInternal(JSON.stringify(coachability));
});

test("debrief followup: only the aloud question survives listenFor/redFlag/decision", () => {
  const q = sanitizeFollowupQuestion({
    id: "f1",
    decision: "Kept the ORM despite the N+1s",
    question: "What alternative did you consider before keeping the ORM?",
    listenFor: LISTEN_FOR,
    redFlag: RED_FLAG,
  });
  assert.equal(q, "What alternative did you consider before keeping the ORM?");
  // Junk shapes refuse safely.
  assert.equal(sanitizeFollowupQuestion(null), null);
  assert.equal(sanitizeFollowupQuestion({ listenFor: LISTEN_FOR }), null);
  assert.equal(sanitizeFollowupQuestion({ question: "   " }), null);
});

test("malformed inputs cannot smuggle non-string content", () => {
  assert.equal(sanitizeChronologyBlock(null), null);
  assert.equal(sanitizeChronologyBlock({ goal: GOAL_WITH_GUIDANCE }), null, "no topic → no block");
  const block = sanitizeChronologyBlock({
    topic: "Topic",
    questions: ["ok", 42, { q: RED_FLAG }, null, ""],
    fromMin: "3",
    toMin: Number.NaN,
  });
  assert.ok(block);
  assert.deepEqual(block.questions, ["ok"]);
  assert.ok(!("fromMin" in block) && !("toMin" in block), "non-numeric timeboxes are dropped");
});

test("composed brief carries only sanitized material end to end", () => {
  const blocks = [
    sanitizeChronologyBlock({
      topic: "Design trade-offs",
      fromMin: 7,
      toMin: 12,
      goal: GOAL_WITH_GUIDANCE,
      questions: ["Why an event queue over direct calls?"],
    }),
    sanitizeScenarioPhase({
      phase: "Coachability injection",
      probe: STAGE_DIRECTION,
      listenFor: LISTEN_FOR,
      feeds: ["Coachability"],
    }),
  ].filter((b): b is CandidateSafeBlock => b !== null);

  const brief = composeCandidateBrief({
    company: "Česká spořitelna",
    roleLine: "QA Engineer (Praha · hybrid)",
    candidateLabel: "Unit Candidate",
    durationMin: 20,
    blocks,
    intro: "Order notifications: our shop emails customers when an order ships.",
  });

  assertNoInternal(brief);
  assert.match(brief, /QA Engineer/);
  assert.match(brief, /about 20 minutes/);
  assert.match(brief, /Design trade-offs \(7–12 min\)/);
  assert.match(brief, /Why an event queue over direct calls\?/);
  assert.match(brief, /Order notifications/);
  // The shared compliance contract rides along.
  assert.match(brief, /Do not give feedback, scores/);
  assert.match(brief, /LOCK onto the one language/);
});
