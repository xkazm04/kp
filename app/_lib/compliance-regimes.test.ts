import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLIANCE_REGIMES,
  DEFAULT_REGIME_ID,
  REGIME_IDS,
  getRegime,
  normalizeRegimeId,
  type RegimeId,
} from "./compliance-regimes.ts";

// The jurisdiction catalog decides which law kp NAMES to a candidate on the AI
// disclosure and to a recruiter on the Decisions compliance card. It shipped with no
// test at all, which left two things unguarded that a wrong answer makes worse than
// no answer: (1) the normalization boundary — every read of a stored or posted regime
// id goes through normalizeRegimeId, so a hand-edited config must land on the EU
// default rather than surface an undefined regime and paint an empty legal framework;
// and (2) the adverse-impact standard, the one field that is deliberately null almost
// everywhere. Only the US has a codified ratio (the EEOC four-fifths rule); asserting a
// threshold for a jurisdiction that has none would be inventing law, so the null is the
// contract, not a gap waiting to be filled in.

test("normalizeRegimeId accepts every declared id and defaults everything else to the EU regime", () => {
  for (const id of REGIME_IDS) assert.equal(normalizeRegimeId(id), id);
  // Unknown, malformed, or absent input — a hand-edited config, a stale row written by
  // an older build, a posted body. None may produce an undefined regime.
  for (const bad of ["EU", " eu", "eu ", "atlantis", "", null, undefined, 7, {}, ["eu"], true]) {
    assert.equal(normalizeRegimeId(bad), DEFAULT_REGIME_ID, `normalizeRegimeId(${JSON.stringify(bad)})`);
  }
  // The default preserves the app's pre-P1-1 behaviour: an unconfigured workspace is GDPR.
  assert.equal(DEFAULT_REGIME_ID, "eu");
});

test("getRegime always answers a complete record, normalizing untrusted input first", () => {
  assert.equal(getRegime("atlantis").id, DEFAULT_REGIME_ID);
  assert.equal(getRegime(undefined).id, DEFAULT_REGIME_ID);
  assert.equal(getRegime("us").id, "us");
  for (const id of REGIME_IDS) {
    const r = getRegime(id);
    assert.equal(r.id, id, "the record's own id matches the key it is stored under");
    for (const field of ["dataLaw", "oversightBasis", "antiDiscrimination"] as const) {
      assert.equal(typeof r[field], "string");
      assert.ok(r[field].trim().length > 0, `${id}.${field} must name a real instrument, not an empty string`);
    }
  }
});

test("the catalog and its id list cannot drift apart", () => {
  assert.deepEqual(Object.keys(COMPLIANCE_REGIMES).sort(), [...REGIME_IDS].sort());
  assert.ok(REGIME_IDS.includes("global"), "the honest cross-jurisdiction fallback stays available");
});

test("exactly ONE regime asserts a codified adverse-impact standard: the US four-fifths rule", () => {
  const withStandard = REGIME_IDS.filter((id) => COMPLIANCE_REGIMES[id].adverseImpactStandard !== null);
  assert.deepEqual(withStandard, ["us" as RegimeId], "only a jurisdiction with a statutory ratio may name one");
  assert.match(COMPLIANCE_REGIMES.us.adverseImpactStandard!, /four-fifths|80%/i);
  // Everywhere else computeAdverseImpact still runs; what it must NOT do is claim a
  // local legal threshold that does not exist.
  for (const id of REGIME_IDS.filter((i) => i !== "us")) {
    assert.equal(COMPLIANCE_REGIMES[id].adverseImpactStandard, null, `${id} must not invent a statutory ratio`);
  }
});
