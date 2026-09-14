import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_RUN_STAGES,
  RUN_WIDE_STAGES,
  STAGE_GATE,
  assertStagePayloadPiiFree,
  findStagePayloadPii,
  isRunWideStage,
  nextRoleRunStage,
  RoleRunPiiError,
  roleRunStageIndex,
  stageIsGated,
} from "./role-run-stages.ts";
import { APPROVAL_KINDS } from "./approval-kinds.ts";

// ADR-0009's two load-bearing claims, pinned: the run has exactly three gates, and the
// ledger holds no candidate PII. Both are compliance claims, not conveniences — the
// gate list is the Art. 22 argument and the PII rule is what makes
// consentWithholdsPii() at a read boundary sufficient.

test("the stage order is the ADR's S0..S6, and next walks it exactly once", () => {
  assert.deepEqual(
    [...ROLE_RUN_STAGES],
    ["role_spec", "slate", "screen", "case_assignment", "interview", "scorecard", "offer_draft"],
    "the order IS the run; a stage inserted in the wrong place changes what happens, not just the names"
  );
  // Walking from the first stage must visit every stage and then stop.
  const walked: string[] = [ROLE_RUN_STAGES[0]];
  let cursor = nextRoleRunStage(ROLE_RUN_STAGES[0]);
  while (cursor) {
    walked.push(cursor);
    cursor = nextRoleRunStage(cursor);
  }
  assert.deepEqual(walked, [...ROLE_RUN_STAGES]);
  assert.equal(nextRoleRunStage("offer_draft"), null, "the offer draft is the last thing the run produces");
});

test("S0 and S1 are run-wide; every stage from S2 on is per-candidate", () => {
  assert.deepEqual([...RUN_WIDE_STAGES], ["role_spec", "slate"]);
  for (const kind of ROLE_RUN_STAGES) {
    assert.equal(
      isRunWideStage(kind),
      roleRunStageIndex(kind) <= roleRunStageIndex("slate"),
      `${kind} must be run-wide exactly when it precedes the fan-out`
    );
  }
});

test("exactly three stages gate on a human, and they are rejection / invite / offer", () => {
  const gated = ROLE_RUN_STAGES.filter(stageIsGated);
  assert.deepEqual(
    [...gated],
    ["screen", "interview", "offer_draft"],
    "a fourth gate turns the run from three pauses into a supervised pipeline — the operator accepted the three-gate list as written"
  );
  assert.equal(STAGE_GATE.screen, "rejection_review");
  assert.equal(STAGE_GATE.interview, "calendar");
  assert.equal(STAGE_GATE.offer_draft, "offer_review");
  // Sourcing, case assignment and scorecard synthesis run unattended, by decision.
  for (const kind of ["role_spec", "slate", "case_assignment", "scorecard"] as const) {
    assert.equal(STAGE_GATE[kind], null, `${kind} must NOT wait on a human`);
  }
});

test("every gate's approval kind is a value the documented taxonomy already declares", () => {
  // NON-VACUITY: a typo'd kind would be a gate that PipelineTab renders and
  // actOnPipelineEntry cannot resolve — a candidate parked where nobody can act.
  for (const kind of ROLE_RUN_STAGES) {
    const approval = STAGE_GATE[kind];
    if (approval === null) continue;
    assert.ok((APPROVAL_KINDS as readonly string[]).includes(approval), `${approval} is not in APPROVAL_KINDS`);
  }
});

// --- the PII rule (ADR-0009 §5) ----------------------------------------------

test("a payload of ids, scores, codes and hashes is storable", () => {
  const screen = {
    decisions: [
      { entryId: "m-abc-jd-role", route: "hold", matchScore: 41, reasonCode: "score_below_floor", reasonParams: { floor: 60, score: 41 } },
    ],
    policyVersion: "screen-1@60",
    fairnessAlerts: [],
  };
  assert.deepEqual(findStagePayloadPii(screen), [], "the ADR blesses exactly this shape");
  assert.doesNotThrow(() => assertStagePayloadPiiFree(screen));
});

test("a 32-char hex hash is NOT read as a phone number", () => {
  // The guard's most likely false positive, and the one that would have got it
  // disabled: a sha256 slice contains a run of seven digits more often than not, and
  // the engine mints several per run (roleSpecHash, seedRef, caseDesignHash).
  const hashes = [
    "1234567abcdef0123456789abcdef012",
    "a1234567890bcdef0123456789abcde0",
    "00000000ffffffff00000000ffffffff",
  ];
  for (const h of hashes) {
    assert.deepEqual(findStagePayloadPii({ roleSpecHash: h }), [], `${h} must be storable`);
  }
});

test("a candidate's name, contact, CV text or transcript is refused — by key", () => {
  for (const [key, value] of [
    ["candidateLabel", "Jana Novakova"],
    ["candidateName", "Jana Novakova"],
    ["contact", "somebody"],
    ["cvText", "Ten years of Java."],
    ["transcript", "so tell me about yourself"],
    ["homeAddress", "Prague"],
  ] as const) {
    const violations = findStagePayloadPii({ decisions: [{ entryId: "m-1", [key]: value }] });
    assert.equal(violations.length, 1, `${key} must be refused`);
    assert.equal(violations[0].reason, "denied_key");
    assert.equal(violations[0].path, `$.decisions[0].${key}`, "the path must name where the PII is, or nobody can fix it");
  }
});

test("a contact hiding in an innocently-named field is refused — by value", () => {
  const email = findStagePayloadPii({ reasonParams: { note: "reply to jana@example.com" } });
  assert.equal(email.length, 1);
  assert.equal(email[0].reason, "email_value");

  const phone = findStagePayloadPii({ reasonParams: { note: "call +420 123 456 789 after six" } });
  assert.equal(phone.length, 1);
  assert.equal(phone[0].reason, "phone_value");
});

test("the reference vocabulary the ADR blesses survives the key denylist", () => {
  // candidateRef / rationaleRef / approverRef all contain a denied root as a substring
  // ("name" is not in them, but the *Ref suffix rule is what a stage author relies on),
  // and cvHash is a hash OF a CV — a code, not the CV.
  const ok = {
    candidateRef: "m-abc-jd-role",
    rationaleRef: "deadbeef",
    approverRef: "cafebabe",
    cvHash: "0123456789abcdef",
    entryId: "m-abc",
    rubricKeys: ["java", "sql"],
  };
  assert.deepEqual(findStagePayloadPii(ok), []);
});

test("the write gate throws a typed error naming every violation at once", () => {
  const bad = { candidateName: "Jana", notes: { contactEmail: "j@example.com" } };
  assert.throws(
    () => assertStagePayloadPiiFree(bad),
    (err: unknown) => {
      assert.ok(err instanceof RoleRunPiiError);
      // Two distinct violations, reported together: a stage author fixing one at a time
      // is a stage author who ships the second one.
      assert.equal(err.violations.length, 2);
      assert.match(err.message, /ADR-0009/);
      return true;
    }
  );
});

test("PII nested arbitrarily deep is still found", () => {
  const deep = { a: [{ b: { c: [{ candidateEmail: "x@y.zz" }] } }] };
  const violations = findStagePayloadPii(deep);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "$.a[0].b.c[0].candidateEmail");
});
