import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDurableSkillProfile, isSubstantiveSkillProfile, signProfile, verifyProfile, DSP_VERSION } from "./skill-profile.ts";

// Sign/verify need KP_SECRET (the operator master secret), same as llm-secret.test.
process.env.KP_SECRET = process.env.KP_SECRET || "test-master-secret";

const sampleEval = {
  evaluation: { dimensionScores: { problemFraming: 80, toolingFluency: 70, judgment: 90, architecture: 60 }, confidence: 0.75 },
  transfer: { transferScore: 78 },
};

function sampleDsp() {
  return buildDurableSkillProfile({ candidateRef: "entry-1", caseId: "case-1", issuedAt: "2026-06-14T00:00:00.000Z", eval: sampleEval });
}

test("build extracts axes, transferScore, confidence, version", () => {
  const dsp = sampleDsp();
  assert.equal(dsp.version, DSP_VERSION);
  assert.equal(dsp.transferScore, 78);
  assert.equal(dsp.confidence, 0.75);
  assert.deepEqual(dsp.axes, { problemFraming: 80, toolingFluency: 70, judgment: 90, architecture: 60 });
  assert.equal(dsp.candidateRef, "entry-1");
});

test("build clamps out-of-range / non-finite values", () => {
  const dsp = buildDurableSkillProfile({
    candidateRef: "e", caseId: null, issuedAt: "t",
    eval: { evaluation: { dimensionScores: { a: 150, b: NaN, c: -5 }, confidence: 9 }, transfer: { transferScore: 200 } },
  });
  assert.equal(dsp.axes.a, 100);
  assert.equal(dsp.axes.c, 0);
  assert.ok(!("b" in dsp.axes)); // non-finite dropped
  assert.equal(dsp.transferScore, 100);
  assert.equal(dsp.confidence, 1);
});

test("isSubstantiveSkillProfile gates empty (validly-signable but content-free) profiles", () => {
  // axes={} + transferScore 0 = the bug: a signable but empty credential.
  assert.equal(isSubstantiveSkillProfile({ axes: {}, transferScore: 0 }), false);
  assert.equal(isSubstantiveSkillProfile({ axes: {}, transferScore: 42 }), true); // score alone
  assert.equal(isSubstantiveSkillProfile({ axes: { reasoning: 0 }, transferScore: 0 }), true); // an assessed axis (scored 0) counts
  assert.equal(isSubstantiveSkillProfile(sampleDsp()), true);
});

test("sign is deterministic and verify accepts a matching signature", () => {
  const dsp = sampleDsp();
  const sig = signProfile(dsp);
  assert.equal(signProfile(dsp), sig); // deterministic
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(verifyProfile(dsp, sig), true);
});

test("verify rejects a tampered profile (a bumped score)", () => {
  const dsp = sampleDsp();
  const sig = signProfile(dsp);
  const tampered = { ...dsp, transferScore: 99 };
  assert.equal(verifyProfile(tampered, sig), false);
});

test("verify rejects a signature made under a different KP_SECRET", () => {
  const dsp = sampleDsp();
  const sig = signProfile(dsp);
  const prev = process.env.KP_SECRET;
  process.env.KP_SECRET = "rotated-secret";
  try {
    assert.equal(verifyProfile(dsp, sig), false);
  } finally {
    process.env.KP_SECRET = prev;
  }
});

test("verify is false for garbage / empty signatures", () => {
  const dsp = sampleDsp();
  assert.equal(verifyProfile(dsp, ""), false);
  assert.equal(verifyProfile(dsp, "zz"), false);
});

test("sign throws when KP_SECRET is unset", () => {
  const prev = process.env.KP_SECRET;
  delete process.env.KP_SECRET;
  try {
    assert.throws(() => signProfile(sampleDsp()));
  } finally {
    process.env.KP_SECRET = prev;
  }
});
