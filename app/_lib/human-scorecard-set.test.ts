// Human interview scorecards are a PANEL keyed by (author, stage), not one slot
// (r09 schedule-interview-prep/A). Pure cases over app/_lib/human-scorecard-set.ts:
// a save replaces only its own record, a later round never overwrites an earlier one,
// a legacy single-key payload keeps reading as ONE record (and is never counted twice
// once the list exists), and the scoring form's seed is the caller's own record only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  headlineScorecard,
  MAX_HUMAN_SCORECARDS,
  ownScorecard,
  readHumanScorecards,
  upsertHumanScorecard,
  type HumanScorecardRecord,
} from "./human-scorecard-set.ts";

function rec(author: string | null, stage: string | null, savedAt: string, rating = 3, summary = `by ${author}`): HumanScorecardRecord {
  return {
    ratings: [{ competency: "Ownership", rating, evidence: `${author} saw it` }],
    summary,
    recommendation: "advance",
    source: "human",
    author,
    authorLabel: author ? `Label ${author}` : null,
    stage,
    savedAt,
  };
}

test("a second interviewer's save appends; the first record is byte-identical", () => {
  const first = upsertHumanScorecard([], rec("u1", "interview", "2026-09-23T10:00:00.000Z", 4));
  assert.ok(first);
  const before = JSON.stringify(first[0]);
  const second = upsertHumanScorecard(first, rec("u2", "interview", "2026-09-23T11:00:00.000Z", 2));
  assert.ok(second);
  assert.equal(second.length, 2);
  assert.equal(JSON.stringify(second[0]), before, "u1's ratings, summary and savedAt are untouched");
  assert.equal(second[1].author, "u2");
});

test("the same (author, stage) replaces its own record; length unchanged, savedAt moved", () => {
  const list = upsertHumanScorecard([], rec("u1", "interview", "2026-09-23T10:00:00.000Z", 4));
  assert.ok(list);
  const next = upsertHumanScorecard(list, rec("u1", "interview", "2026-09-23T12:00:00.000Z", 5, "revised"));
  assert.ok(next);
  assert.equal(next.length, 1);
  assert.equal(next[0].summary, "revised");
  assert.equal(next[0].ratings?.[0].rating, 5);
  assert.equal(next[0].savedAt, "2026-09-23T12:00:00.000Z");
});

test("the same author in a later round appends; round 2 never overwrites round 1", () => {
  const r1 = upsertHumanScorecard([], rec("u1", "interview", "2026-09-23T10:00:00.000Z", 4));
  assert.ok(r1);
  const r2 = upsertHumanScorecard(r1, rec("u1", "interview-2", "2026-09-24T10:00:00.000Z", 2));
  assert.ok(r2);
  assert.equal(r2.length, 2);
  assert.deepEqual(
    r2.map((r) => [r.stage, r.ratings?.[0].rating]),
    [
      ["interview", 4],
      ["interview-2", 2],
    ],
  );
});

test("a legacy payload reads as ONE unattributed record; with both keys only the list counts", () => {
  const r = { competency: "Ownership", rating: 3 };
  const legacy = readHumanScorecards({ humanScorecard: { ratings: [r], source: "human" } });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].author, null);
  assert.equal(legacy[0].stage, null);
  assert.deepEqual(legacy[0].ratings, [r]);

  const list = [rec("u1", "interview", "2026-09-23T10:00:00.000Z"), rec("u2", "interview", "2026-09-23T11:00:00.000Z")];
  const both = readHumanScorecards({ humanScorecards: list, humanScorecard: list[1] });
  assert.equal(both.length, 2, "the headline mirror is never counted a second time");
  assert.deepEqual(
    both.map((x) => x.author),
    ["u1", "u2"],
  );
  assert.deepEqual(readHumanScorecards({}), []);
  assert.deepEqual(readHumanScorecards(null), []);
});

test("a legacy record is nobody's own: no save claims it, and it survives the next save", () => {
  const legacy = readHumanScorecards({ humanScorecard: { ratings: [{ competency: "Ownership", rating: 2 }] } });
  assert.equal(ownScorecard(legacy, null, null), null);
  const next = upsertHumanScorecard(legacy, rec(null, "interview", "2026-09-23T10:00:00.000Z"));
  assert.ok(next);
  assert.equal(next.length, 2, "the pre-change card is kept beside the new one, never replaced");
  assert.equal(headlineScorecard(next)?.savedAt, "2026-09-23T10:00:00.000Z");
});

test("the second interviewer's form seed is empty, never the first one's verdict", () => {
  const list = [rec("u1", "interview", "2026-09-23T10:00:00.000Z")];
  assert.equal(ownScorecard(list, "u2", "interview"), null);
  assert.equal(ownScorecard(list, "u1", "interview-2"), null, "a new round starts empty too");
  assert.equal(ownScorecard(list, "u1", "interview")?.author, "u1");
});

test("the headline is the latest save; a full panel refuses a new key and never evicts", () => {
  const list = [rec("u2", "interview", "2026-09-23T11:00:00.000Z"), rec("u1", "interview", "2026-09-23T12:00:00.000Z")];
  assert.equal(headlineScorecard(list)?.author, "u1");
  assert.equal(headlineScorecard([]), null);

  const full: HumanScorecardRecord[] = [];
  for (let i = 0; i < MAX_HUMAN_SCORECARDS; i++) full.push(rec(`u${i}`, "interview", `2026-09-23T10:00:${String(i).padStart(2, "0")}.000Z`));
  assert.equal(upsertHumanScorecard(full, rec("new", "interview", "2026-09-24T00:00:00.000Z")), null);
  const replaced = upsertHumanScorecard(full, rec("u0", "interview", "2026-09-24T00:00:00.000Z", 5));
  assert.ok(replaced, "an existing key can always re-save at the cap");
  assert.equal(replaced.length, MAX_HUMAN_SCORECARDS);
});
