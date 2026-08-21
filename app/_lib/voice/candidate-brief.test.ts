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
  candidateSafeTopic,
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
  for (const marker of [
    "Listen for:",
    "red flag",
    "never say this aloud",
    "missing must-have",
    "aspiration mismatch",
    "observe whether",
  ]) {
    assert.ok(!text.includes(marker), `internal marker ${JSON.stringify(marker)} must not survive: ${text.slice(0, 200)}`);
  }
}

// The gap annotations ride the TOPIC LABEL itself — `session.runOfShow` IS
// `chronology[].topic`, and both the /connect and /complete contract tests
// fixture these exact strings as interviewer-internal (TP-L2-VOICE-01).
const ANNOTATED_TOPIC = "Test automation fundamentals (missing must-have)";
const ANNOTATED_PHASE = "Motivation [aspiration mismatch]";

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

// TP-L2-VOICE-01, the half the field-level allow-list did not cover: the topic is
// the LLM's free-text `competency` from an interviewer prompt that says "Cover the
// missing must-haves", so the assessment annotation is INSIDE the picked field.
// Pre-fix the topic was copied verbatim, so a chronology block topicked
// "Test automation fundamentals (missing must-have)" put that gap verdict into the
// client-sent ElevenLabs prompt override — the candidate's own Network tab, and
// read aloud by the agent as its agenda.
test("an assessment annotation embedded in the TOPIC LABEL cannot survive", () => {
  const block = sanitizeChronologyBlock({
    topic: ANNOTATED_TOPIC,
    fromMin: 3,
    toMin: 7,
    goal: GOAL_WITH_GUIDANCE,
    questions: ["How do you decide what is worth automating?"],
  });
  assert.ok(block);
  assert.equal(block.topic, "Test automation fundamentals");
  assertNoInternal(JSON.stringify(block));

  const phase = sanitizeScenarioPhase({ phase: ANNOTATED_PHASE, probe: "What drew you to this role?", feeds: ["Motivation"] });
  assert.ok(phase);
  assert.equal(phase.topic, "Motivation");
  assertNoInternal(JSON.stringify(phase));
});

test("candidateSafeTopic: asides are removed by SHAPE, and a label that is only an aside drops its block", () => {
  assert.equal(candidateSafeTopic("Ownership of the ingestion rebuild"), "Ownership of the ingestion rebuild");
  assert.equal(candidateSafeTopic("Design depth (probe: coursework only)"), "Design depth");
  // An unterminated aside takes the rest of the label with it.
  assert.equal(candidateSafeTopic("Data modelling (internal red flag — never say this aloud"), "Data modelling");
  // A future annotation phrase lands in the same bracket — no vocabulary to miss.
  assert.equal(candidateSafeTopic("Kubernetes (not evidenced anywhere in the CV)"), "Kubernetes");
  // Nothing but an aside → no topic → the caller drops the whole block.
  assert.equal(candidateSafeTopic("(missing must-have)"), null);
  assert.equal(sanitizeChronologyBlock({ topic: "(missing must-have)", questions: ["Anything?"] }), null);
  // Hyphenated words and ampersands in real agenda labels are untouched.
  assert.equal(candidateSafeTopic("Stuck-and-recovered"), "Stuck-and-recovered");
  assert.equal(candidateSafeTopic("Counterfactual & transfer"), "Counterfactual & transfer");
  // A label is a label: prose smuggled into the topic slot is capped.
  assert.ok((candidateSafeTopic("x".repeat(400)) ?? "").length <= 80);
});

test("imported interview-kit questions ride the SAME allow-list as a plain aloud block", () => {
  // Direction 1: buildCandidateSafeBrief routes the flat `importedQuestions` list
  // through sanitizeChronologyBlock as { topic, questions } — so imported questions
  // reach the candidate-safe brief only via the tested allow-list, and nothing but
  // the aloud questions can survive (a stray internal-looking field cannot smuggle).
  const extra = sanitizeChronologyBlock({
    topic: "Recruiter-added questions",
    questions: ["How do you approach flaky tests?", "  ", 42],
    // A private field that must not survive even on this synthetic block:
    listenFor: LISTEN_FOR,
  });
  assert.ok(extra);
  assert.equal(extra.topic, "Recruiter-added questions");
  assert.deepEqual(extra.questions, ["How do you approach flaky tests?"]);
  assertNoInternal(JSON.stringify(extra));
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
    sanitizeChronologyBlock({
      topic: ANNOTATED_TOPIC,
      fromMin: 12,
      toMin: 16,
      goal: GOAL_WITH_GUIDANCE,
      questions: ["Which tests would you write first?"],
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
  // The annotated block still grounds the agent — only its verdict is gone.
  assert.match(brief, /Test automation fundamentals \(12–16 min\)/);
  assert.match(brief, /Which tests would you write first\?/);
  assert.match(brief, /Order notifications/);
  // The shared compliance contract rides along.
  assert.match(brief, /Do not give feedback, scores/);
  assert.match(brief, /LOCK onto the one language/);
});
