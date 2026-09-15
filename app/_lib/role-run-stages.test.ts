import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_RUN_STAGES,
  ROLE_RUN_TRANSITIONS,
  RUN_WIDE_STAGES,
  STAGE_GATE,
  assertStagePayloadPiiFree,
  completedStagesFor,
  findRoleRunTransitionViolations,
  findStagePayloadPii,
  isRunWideStage,
  nextRoleRunStage,
  nextStageFor,
  replayRoleRunChain,
  RoleRunPiiError,
  roleRunStageIndex,
  stageIsGated,
  type RoleRunArtifactRow,
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

// --- the transition table and the resume read (ADR-0009 §1) -------------------

type Row = RoleRunArtifactRow;
let seqClock = 0;
const row = (kind: Row["kind"], status: Row["status"], branchRef: string | null = null): Row => ({
  kind,
  status,
  branchRef,
  seq: (seqClock += 1),
});
/** The run-wide chain up to the fan-out. */
const fannedOut = (): Row[] => [row("role_spec", "complete"), row("slate", "complete")];

test("the transition table agrees with the stage order and the gate list — it cannot drift from either", () => {
  for (const kind of ROLE_RUN_STAGES) {
    const next = nextRoleRunStage(kind);
    const afterComplete = [...ROLE_RUN_TRANSITIONS[`${kind}:complete`]];

    // Forward edge: a completed stage leads to exactly the next stage's first artifact,
    // and that artifact is a PROPOSAL exactly when the next stage gates.
    if (next === null) {
      assert.deepEqual(afterComplete, [], "nothing follows an approved offer on the ledger");
    } else if (isRunWideStage(next)) {
      assert.deepEqual(afterComplete, [`${next}:complete`, `${next}:terminal`], `${kind}:complete → ${next}`);
    } else {
      assert.deepEqual(afterComplete, [`${next}:${stageIsGated(next) ? "awaiting_approval" : "complete"}`], `${kind}:complete → ${next}`);
    }

    // A parked position exists exactly for the three gated stages, and it resolves only
    // into its own kind.
    const afterParked = [...ROLE_RUN_TRANSITIONS[`${kind}:awaiting_approval`]];
    assert.deepEqual(afterParked, stageIsGated(kind) ? [`${kind}:complete`, `${kind}:terminal`] : [], `${kind}:awaiting_approval`);

    assert.deepEqual([...ROLE_RUN_TRANSITIONS[`${kind}:terminal`]], [], `${kind}:terminal ends its chain`);
  }
  assert.deepEqual([...ROLE_RUN_TRANSITIONS.start], ["role_spec:complete", "role_spec:terminal"]);

  // The gate claim, read off the whole table rather than per row: a gated stage is only
  // ever entered as a proposal, and only ever resolved from its own proposal.
  for (const [from, targets] of Object.entries(ROLE_RUN_TRANSITIONS)) {
    for (const to of targets) {
      const [toKind, toStatus] = to.split(":") as [Row["kind"], Row["status"]];
      if (stageIsGated(toKind) && toStatus !== "awaiting_approval") {
        assert.equal(from, `${toKind}:awaiting_approval`, `${from} → ${to} would resolve a gate nobody was asked`);
      }
      if (toStatus === "terminal" && !isRunWideStage(toKind)) {
        assert.ok(stageIsGated(toKind), `${from} → ${to} ends a candidacy without a gate`);
      }
    }
  }
});

test("nextStageFor walks an empty run to the fan-out from rows alone", () => {
  assert.deepEqual(nextStageFor([]), { action: "produce", kind: "role_spec" });
  assert.deepEqual(nextStageFor([row("role_spec", "complete")]), { action: "produce", kind: "slate" });
  assert.deepEqual(nextStageFor(fannedOut()), { action: "done", reason: "fanned_out" });
  assert.deepEqual(nextStageFor([row("role_spec", "terminal")]), { action: "done", reason: "run_terminal" });
  // A branch asked about before the slate has nothing to run — not `role_spec`.
  assert.deepEqual(nextStageFor([row("role_spec", "complete")], "m-1"), { action: "await_fan_out" });
  assert.deepEqual(nextStageFor([row("role_spec", "terminal")], "m-1"), { action: "done", reason: "run_terminal" });
});

test("nextStageFor carries one branch JD → offer, parking at exactly the three gates", () => {
  const ledger = fannedOut();
  const walk: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    const next = nextStageFor(ledger, "m-1");
    if (next.action === "produce") {
      walk.push(`produce ${next.kind}`);
      ledger.push(row(next.kind, stageIsGated(next.kind) ? "awaiting_approval" : "complete", "m-1"));
    } else if (next.action === "await_gate") {
      walk.push(`gate ${next.kind} (${next.approvalKind})`);
      ledger.push(row(next.kind, "complete", "m-1"));
    } else {
      walk.push(next.action === "done" ? `done ${next.reason}` : next.action);
      break;
    }
  }

  assert.deepEqual(walk, [
    "produce screen",
    "gate screen (rejection_review)",
    "produce case_assignment",
    "produce interview",
    "gate interview (calendar)",
    "produce scorecard",
    "produce offer_draft",
    "gate offer_draft (offer_review)",
    "done offer_approved",
  ]);
  // A different branch in the same run is untouched by all of that.
  assert.deepEqual(nextStageFor(ledger, "m-2"), { action: "produce", kind: "screen" });
});

test("a gate resolved as terminal ends the branch at each of the three gates", () => {
  const before: Record<"screen" | "interview" | "offer_draft", [Row["kind"], Row["status"]][]> = {
    screen: [],
    interview: [
      ["screen", "awaiting_approval"],
      ["screen", "complete"],
      ["case_assignment", "complete"],
    ],
    offer_draft: [
      ["screen", "awaiting_approval"],
      ["screen", "complete"],
      ["case_assignment", "complete"],
      ["interview", "awaiting_approval"],
      ["interview", "complete"],
      ["scorecard", "complete"],
    ],
  };
  for (const kind of ["screen", "interview", "offer_draft"] as const) {
    const ledger = [...fannedOut(), ...before[kind].map(([k, s]) => row(k, s, "b")), row(kind, "awaiting_approval", "b")];
    assert.equal(nextStageFor(ledger, "b").action, "await_gate", `${kind} parks`);
    ledger.push(row(kind, "terminal", "b"));
    assert.deepEqual(nextStageFor(ledger, "b"), { action: "done", reason: "branch_terminal" }, `${kind} resolved terminal ends the branch`);
  }
});

test("the read orders by seq, never by the order the rows were handed over", () => {
  const ledger = [...fannedOut(), row("screen", "awaiting_approval", "m-1"), row("screen", "complete", "m-1")];
  const reversed = [...ledger].reverse();
  assert.deepEqual(nextStageFor(reversed, "m-1"), { action: "produce", kind: "case_assignment" });
  assert.deepEqual(findRoleRunTransitionViolations(reversed), []);
});

test("a row the table forbids is reported, and the chain it sits on is never advanced", () => {
  const cases: { name: string; ledger: Row[]; branch: string | null; reason: string; state: string }[] = [
    {
      name: "a gated stage written straight to complete (the gate skipped)",
      ledger: [...fannedOut(), row("screen", "complete", "m-1")],
      branch: "m-1",
      reason: "unreachable",
      state: "screen:complete",
    },
    {
      name: "an ungated stage ending a candidacy on its own",
      ledger: [...fannedOut(), row("screen", "awaiting_approval", "m-1"), row("screen", "complete", "m-1"), row("case_assignment", "terminal", "m-1")],
      branch: "m-1",
      reason: "unreachable",
      state: "case_assignment:terminal",
    },
    {
      name: "a stage skipped",
      ledger: [...fannedOut(), row("screen", "awaiting_approval", "m-1"), row("screen", "complete", "m-1"), row("interview", "awaiting_approval", "m-1")],
      branch: "m-1",
      reason: "unreachable",
      state: "interview:awaiting_approval",
    },
    {
      name: "a branch artifact appended before the slate completed",
      ledger: [row("role_spec", "complete"), row("screen", "awaiting_approval", "m-1"), row("slate", "complete")],
      branch: "m-1",
      reason: "before_fan_out",
      state: "screen:awaiting_approval",
    },
    {
      name: "a run-wide kind on a candidate branch",
      ledger: [...fannedOut(), row("role_spec", "complete", "m-1")],
      branch: "m-1",
      reason: "wrong_chain",
      state: "role_spec:complete",
    },
    {
      name: "a second slate on the run-wide chain",
      ledger: [...fannedOut(), row("slate", "complete")],
      branch: null,
      reason: "unreachable",
      state: "slate:complete",
    },
  ];
  for (const c of cases) {
    const violations = findRoleRunTransitionViolations(c.ledger);
    assert.equal(violations.length, 1, `${c.name}: exactly one violation`);
    assert.equal(violations[0].reason, c.reason, c.name);
    assert.equal(violations[0].state, c.state, c.name);
    assert.equal(nextStageFor(c.ledger, c.branch).action, "invalid", `${c.name}: the resume read refuses to advance it`);
  }
  // A corrupt run-wide chain poisons every branch, not only its own.
  assert.equal(nextStageFor([...fannedOut(), row("slate", "complete")], "m-9").action, "invalid");
});

test("a stage reads complete only when a legal complete row backs it", () => {
  assert.deepEqual(completedStagesFor([], null), [], "no rows, nothing complete");
  assert.deepEqual(completedStagesFor(fannedOut(), "m-1"), ["role_spec", "slate"], "a branch inherits the stages it fanned out from");

  const parked = [...fannedOut(), row("screen", "awaiting_approval", "m-1")];
  assert.deepEqual(completedStagesFor(parked, "m-1"), ["role_spec", "slate"], "a proposal is not a completed stage");

  // An ILLEGAL complete row is a row, not a completion: the gate-skipped screen below
  // exists in the ledger and still does not read as done.
  const skipped = [...fannedOut(), row("screen", "complete", "m-1")];
  assert.deepEqual(completedStagesFor(skipped, "m-1"), ["role_spec", "slate"]);
  assert.equal(replayRoleRunChain(skipped, "m-1").head, "slate:complete");
});
