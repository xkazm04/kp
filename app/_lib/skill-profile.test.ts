import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDurableSkillProfile, isSubstantiveSkillProfile, signProfile, verifyProfile, skillProfileFreshness, PROFILE_FRESHNESS_DAYS, DSP_VERSION, resolveSkillProfileCardState, skillProfileShowsScoreCard } from "./skill-profile.ts";

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

// bug-ui-scan-2026-07-09 (skill-matrix-coverage #3): the "Verified" shield must not read
// identically for a week-old and a five-year-old attestation, nor for a superseded
// methodology. These prove the freshness dimension the old binary-integrity verdict lacked.
const DAY = 86_400_000;

test("a freshly-issued current-methodology profile is NOT stale", () => {
  const now = Date.parse("2026-06-20T00:00:00.000Z");
  const f = skillProfileFreshness({ issuedAt: "2026-06-14T00:00:00.000Z", methodologyVersion: DSP_VERSION }, now);
  assert.equal(f.stale, false);
  assert.equal(f.reason, null);
  assert.equal(f.ageDays, 6);
});

test("a profile issued past the validity window is stale (reason: age)", () => {
  const issued = "2026-01-01T00:00:00.000Z";
  const now = Date.parse(issued) + (PROFILE_FRESHNESS_DAYS + 5) * DAY;
  const f = skillProfileFreshness({ issuedAt: issued, methodologyVersion: DSP_VERSION }, now);
  // Pre-fix the page showed a green "Verified" shield here — a years-old score reading as
  // freshly current. The fix flags it stale so the badge downgrades to amber.
  assert.equal(f.stale, true);
  assert.equal(f.reason, "age");
  assert.ok((f.ageYears ?? 0) >= 2);
});

test("the window boundary is exclusive — exactly windowDays old is still fresh", () => {
  const issued = "2026-01-01T00:00:00.000Z";
  const now = Date.parse(issued) + PROFILE_FRESHNESS_DAYS * DAY;
  assert.equal(skillProfileFreshness({ issuedAt: issued, methodologyVersion: DSP_VERSION }, now).stale, false);
});

test("a superseded methodology marks an otherwise-fresh profile stale (reason: methodology)", () => {
  const now = Date.parse("2026-06-20T00:00:00.000Z");
  const f = skillProfileFreshness({ issuedAt: "2026-06-14T00:00:00.000Z", methodologyVersion: "dsp-v0" }, now);
  assert.equal(f.stale, true);
  assert.equal(f.reason, "methodology");
});

test("age takes reason priority when a profile is BOTH old and on a superseded methodology", () => {
  const issued = "2020-01-01T00:00:00.000Z";
  const now = Date.parse("2026-06-20T00:00:00.000Z");
  const f = skillProfileFreshness({ issuedAt: issued, methodologyVersion: "dsp-v0" }, now);
  assert.equal(f.stale, true);
  assert.equal(f.reason, "age");
});

test("an unparseable issue date can't be aged, but a superseded methodology still marks stale", () => {
  const now = Date.now();
  assert.deepEqual(skillProfileFreshness({ issuedAt: "not-a-date", methodologyVersion: DSP_VERSION }, now), {
    ageDays: null, ageYears: null, stale: false, reason: null,
  });
  assert.equal(skillProfileFreshness({ issuedAt: "not-a-date", methodologyVersion: "dsp-v0" }, now).stale, true);
});

// bug-ui-scan-2026-07-09 (dev-lifecycle-cohort-outcomes #2): the public score card must be
// gated on the full TRUST state, not on `substantive` alone. A tampered/revoked/unverifiable
// credential can still be substantive (it HAS numbers), and the old gate rendered those
// untrusted numbers as the visual focus under a red "do not trust" badge. These pin the
// priority ordering and the show/hide contract.
const V = { revoked: false, verifiable: true, valid: true, substantive: true, stale: false };

test("resolveSkillProfileCardState follows the trust priority (revoked ▸ unverifiable ▸ tampered ▸ incomplete ▸ stale ▸ verified)", () => {
  assert.equal(resolveSkillProfileCardState(V), "verified");
  assert.equal(resolveSkillProfileCardState({ ...V, stale: true }), "stale");
  assert.equal(resolveSkillProfileCardState({ ...V, substantive: false }), "incomplete");
  // A SUBSTANTIVE-but-untrusted credential must resolve to its untrusted state, never "verified".
  assert.equal(resolveSkillProfileCardState({ ...V, valid: false }), "tampered");
  assert.equal(resolveSkillProfileCardState({ ...V, verifiable: false }), "unverifiable");
  assert.equal(resolveSkillProfileCardState({ ...V, revoked: true }), "revoked");
  // Priority: revoked outranks a mismatch/config problem; unverifiable outranks tampered.
  assert.equal(resolveSkillProfileCardState({ revoked: true, verifiable: false, valid: false, substantive: true, stale: true }), "revoked");
  assert.equal(resolveSkillProfileCardState({ ...V, verifiable: false, valid: false }), "unverifiable");
});

test("skillProfileShowsScoreCard reveals numbers ONLY for genuine attested states (verified, stale)", () => {
  assert.equal(skillProfileShowsScoreCard("verified"), true);
  assert.equal(skillProfileShowsScoreCard("stale"), true); // genuine but old — numbers shown, green shield withheld
  // The regression this closes: a tampered/revoked/unverifiable card is substantive, so the
  // old `substantive`-only gate showed it. The card must now be HIDDEN for every one of them.
  assert.equal(skillProfileShowsScoreCard("tampered"), false);
  assert.equal(skillProfileShowsScoreCard("revoked"), false);
  assert.equal(skillProfileShowsScoreCard("unverifiable"), false);
  assert.equal(skillProfileShowsScoreCard("incomplete"), false);
});

test("a tampered-but-substantive credential hides its score card (the #2 fix end-to-end)", () => {
  const state = resolveSkillProfileCardState({ ...V, valid: false }); // signature mismatch, still has numbers
  assert.equal(state, "tampered");
  assert.equal(skillProfileShowsScoreCard(state), false); // pre-fix (`substantive` gate) this was shown
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
