import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  GATE_STAGE,
  ROLE_RUN_GATES,
  SCREEN_WAVE_APPROVAL_MAX_AGE_MS,
  ScreenWaveApprovalError,
  commitRoleRunGate,
  gateApprovalKind,
  isRoleRunGateSpent,
  roleRunGateToken,
  verifyRoleRunGateToken,
} from "./role-run-gates.ts";
import { STAGE_GATE, stageIsGated, ROLE_RUN_STAGES } from "./role-run-stages.ts";
import { resetScreenWaveApprovalSpendForTests } from "./screen-wave-approval.ts";

// The three gates ARE the screen-wave approval protocol at three call sites. These pin
// that they inherit the whole of it — the signed set, the 15-minute window, the single
// spend, the five distinct refusals — AND the one thing this module adds: a token for
// one gate must never verify at another.

const RUN = "rr-abc";
const SUBJECTS = ["m-one", "m-two"];
const POLICY = "screen-1@60";
const NOW = 1_757_000_000_000;

beforeEach(() => resetScreenWaveApprovalSpendForTests());

test("GATE_STAGE and STAGE_GATE agree — the two literals cannot drift apart", () => {
  const gatedStages = ROLE_RUN_STAGES.filter(stageIsGated);
  assert.equal(ROLE_RUN_GATES.length, gatedStages.length, "one gate per gated stage, no more and no fewer");
  for (const gate of ROLE_RUN_GATES) {
    const stage = GATE_STAGE[gate];
    assert.ok(gatedStages.includes(stage), `${gate} maps to ${stage}, which STAGE_GATE does not gate`);
    assert.equal(gateApprovalKind(gate), STAGE_GATE[stage], "the approval kind is read through STAGE_GATE, never restated");
  }
});

test("a fresh token over the live set verifies", () => {
  const token = roleRunGateToken(RUN, "rejection", POLICY, SUBJECTS, NOW);
  assert.deepEqual(verifyRoleRunGateToken(token, RUN, "rejection", POLICY, SUBJECTS, NOW + 1000), { ok: true });
});

test("the signature is order-independent but set-sensitive", () => {
  const a = roleRunGateToken(RUN, "rejection", POLICY, ["m-one", "m-two"], NOW);
  const b = roleRunGateToken(RUN, "rejection", POLICY, ["m-two", "m-one"], NOW);
  assert.equal(a, b, "the same set reviewed is the same approval, whatever order it was listed in");

  // A candidate who joined the cohort since the preview is a DIFFERENT review.
  const drifted = verifyRoleRunGateToken(a, RUN, "rejection", POLICY, [...SUBJECTS, "m-three"], NOW + 1000);
  assert.deepEqual(drifted, { ok: false, reason: "mismatch" });
});

test("a token for one gate does not verify at another gate, or in another run", () => {
  // This is the scope this module adds on top of the wave protocol, and the defect it
  // exists to prevent: an approval to REJECT these two people must not stand in as an
  // approval to make them an OFFER.
  const rejection = roleRunGateToken(RUN, "rejection", POLICY, SUBJECTS, NOW);
  assert.deepEqual(verifyRoleRunGateToken(rejection, RUN, "offer", POLICY, SUBJECTS, NOW + 1000), {
    ok: false,
    reason: "mismatch",
  });
  assert.deepEqual(verifyRoleRunGateToken(rejection, "rr-other", "rejection", POLICY, SUBJECTS, NOW + 1000), {
    ok: false,
    reason: "mismatch",
  });
  // And a policy change is a new review too.
  assert.deepEqual(verifyRoleRunGateToken(rejection, RUN, "rejection", "screen-1@70", SUBJECTS, NOW + 1000), {
    ok: false,
    reason: "mismatch",
  });
});

test("an approval older than the window is expired, not merely stale", () => {
  const token = roleRunGateToken(RUN, "interview_invite", POLICY, SUBJECTS, NOW);
  assert.deepEqual(
    verifyRoleRunGateToken(token, RUN, "interview_invite", POLICY, SUBJECTS, NOW + SCREEN_WAVE_APPROVAL_MAX_AGE_MS - 1),
    { ok: true },
    "inside the window it still stands"
  );
  assert.deepEqual(
    verifyRoleRunGateToken(token, RUN, "interview_invite", POLICY, SUBJECTS, NOW + SCREEN_WAVE_APPROVAL_MAX_AGE_MS + 1),
    { ok: false, reason: "expired" }
  );
});

test("a commit with no token is refused 'required', and with no approver 'unattributed'", () => {
  const base = { runId: RUN, gate: "offer" as const, policyVersion: POLICY, subjectRefs: SUBJECTS, now: NOW };
  const token = roleRunGateToken(RUN, "offer", POLICY, SUBJECTS, NOW);

  assert.throws(
    () => commitRoleRunGate({ ...base, token: null, approver: "ops@kp" }),
    (e: unknown) => e instanceof ScreenWaveApprovalError && e.reason === "required"
  );
  assert.throws(
    () => commitRoleRunGate({ ...base, token, approver: "   " }),
    (e: unknown) => e instanceof ScreenWaveApprovalError && e.reason === "unattributed"
  );
  // NON-VACUITY: the token from the refused attempts must NOT have been burned — a
  // commit refused for a missing approver must not cost the recruiter their review.
  assert.equal(isRoleRunGateSpent(token, NOW), false);
  assert.doesNotThrow(() => commitRoleRunGate({ ...base, token, approver: "ops@kp" }));
});

test("an approval is spent on one commit — a replay inside the window is refused", () => {
  const token = roleRunGateToken(RUN, "rejection", POLICY, SUBJECTS, NOW);
  const input = { runId: RUN, gate: "rejection" as const, policyVersion: POLICY, subjectRefs: SUBJECTS, token, approver: "ops@kp", now: NOW };

  commitRoleRunGate(input);
  assert.equal(isRoleRunGateSpent(token, NOW), true);
  assert.throws(
    () => commitRoleRunGate(input),
    (e: unknown) => e instanceof ScreenWaveApprovalError && e.reason === "spent",
    "a double-click, a retried fetch or a replayed request must not run the adverse act twice on one human review"
  );
});

test("the five refusals stay distinguishable at the gate boundary", () => {
  // A client that cannot tell a spent token from a changed cohort tells the recruiter to
  // re-review a set that did not move. Each refusal must arrive with its own reason.
  const seen = new Set<string>();
  const token = roleRunGateToken(RUN, "offer", POLICY, SUBJECTS, NOW);
  const attempt = (patch: Record<string, unknown>) => {
    try {
      commitRoleRunGate({
        runId: RUN,
        gate: "offer",
        policyVersion: POLICY,
        subjectRefs: SUBJECTS,
        token,
        approver: "ops@kp",
        now: NOW,
        ...patch,
      } as Parameters<typeof commitRoleRunGate>[0]);
    } catch (e) {
      if (e instanceof ScreenWaveApprovalError) seen.add(e.reason);
    }
  };
  attempt({ token: null });
  attempt({ approver: null });
  attempt({ subjectRefs: ["m-one"] });
  attempt({ now: NOW + SCREEN_WAVE_APPROVAL_MAX_AGE_MS + 1 });
  attempt({}); // succeeds, spends
  attempt({}); // replay

  assert.deepEqual([...seen].sort(), ["expired", "mismatch", "required", "spent", "unattributed"]);
});
