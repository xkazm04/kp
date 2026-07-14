import { test } from "node:test";
import assert from "node:assert/strict";
// Import the import-light rank module directly (not rediscover.ts, which pulls in
// better-sqlite3 + the db barrel and won't load under the strip-types runner). Its
// only import, pipeline-stages.ts, is a pure DB-free axis so it loads here.
import { priorDepthBoost, byPriorAwareRank, PRIOR_DEPTH_BAND } from "./rediscovery-rank.ts";
import { PIPELINE_STAGES } from "./pipeline-stages.ts";

test("priorDepthBoost is the stage index, one point per stage reached", () => {
  assert.equal(priorDepthBoost("Accepted"), 0); // day-one entry → no float
  assert.equal(priorDepthBoost("Screened"), 1);
  assert.equal(priorDepthBoost("Interview"), 2);
  assert.equal(priorDepthBoost("Offer"), 3);
  assert.equal(priorDepthBoost("Hired"), 4);
});

test("priorDepthBoost never exceeds the band and never goes negative", () => {
  for (const s of PIPELINE_STAGES) {
    const b = priorDepthBoost(s);
    assert.ok(b >= 0 && b <= PRIOR_DEPTH_BAND, `${s} → ${b} out of [0, ${PRIOR_DEPTH_BAND}]`);
  }
});

test("priorDepthBoost of an unknown/blank stage is 0 (only ever helps a placeable prior)", () => {
  assert.equal(priorDepthBoost(undefined), 0);
  assert.equal(priorDepthBoost(null), 0);
  assert.equal(priorDepthBoost(""), 0);
  assert.equal(priorDepthBoost("Sourced"), 0); // legacy value off the canonical axis
});

test("a deeper prior floats above a shallower one at EQUAL base score", () => {
  const offer = { score: 70, boost: priorDepthBoost("Offer") };
  const screenout = { score: 70, boost: priorDepthBoost("Accepted") };
  assert.ok(byPriorAwareRank(offer, screenout) < 0, "offer near-miss should sort first");
});

test("a deeper prior floats above a shallower one WITHIN the band", () => {
  // Base scores 2 apart, within the Offer prior's +3 boost → it overtakes.
  const offer = { score: 68, boost: priorDepthBoost("Offer") }; // effective 71
  const screenout = { score: 70, boost: priorDepthBoost("Accepted") }; // effective 70
  assert.ok(byPriorAwareRank(offer, screenout) < 0, "within-band deep prior overtakes");
});

test("BAND GUARANTEE: the boost never lifts a candidate past one more than the band above", () => {
  // For every stage pairing, a candidate whose base score trails by MORE than the
  // band must stay behind, no matter how deep its prior — the structural promise.
  for (const deep of PIPELINE_STAGES) {
    for (const shallow of PIPELINE_STAGES) {
      const behind = { score: 60, boost: priorDepthBoost(deep) };
      const ahead = { score: 60 + PRIOR_DEPTH_BAND + 1, boost: priorDepthBoost(shallow) };
      assert.ok(
        byPriorAwareRank(behind, ahead) > 0,
        `${deep}@60 must not overtake ${shallow}@${60 + PRIOR_DEPTH_BAND + 1}`
      );
    }
  }
});

test("at EXACTLY the band the honest leader still holds (boost ≤ band, tiebreak on base)", () => {
  // Trailing by exactly the band: max boost only TIES the effective score, and the
  // honest-score tiebreak then keeps the genuinely-higher base ahead.
  const behind = { score: 60, boost: PRIOR_DEPTH_BAND }; // effective 65
  const ahead = { score: 60 + PRIOR_DEPTH_BAND, boost: 0 }; // effective 65
  assert.ok(byPriorAwareRank(behind, ahead) > 0, "equal effective → honest base wins");
});

test("the displayed score is untouched — the comparator reads boost separately", () => {
  // byPriorAwareRank takes score + boost as distinct fields; callers pass the honest
  // base as `score` and never mutate it. Ordering swings, the number does not.
  const rows = [
    { id: "shallow-high", score: 72, boost: priorDepthBoost("Accepted") }, // effective 72
    { id: "deep-low", score: 70, boost: priorDepthBoost("Offer") }, // effective 73 — overtakes within band
  ];
  const sorted = [...rows].sort(byPriorAwareRank);
  assert.deepEqual(sorted.map((r) => r.id), ["deep-low", "shallow-high"]);
  // Scores are unchanged by sorting — only the order moved.
  assert.equal(sorted.find((r) => r.id === "deep-low")!.score, 70);
  assert.equal(sorted.find((r) => r.id === "shallow-high")!.score, 72);
});
