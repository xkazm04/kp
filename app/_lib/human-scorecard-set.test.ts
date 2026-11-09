// Human interview scorecards are a PANEL keyed by (author, stage), not one slot
// (r09 schedule-interview-prep/A). Pure cases over app/_lib/human-scorecard-set.ts:
// a save replaces only its own record, a later round never overwrites an earlier one,
// a legacy single-key payload keeps reading as ONE record (and is never counted twice
// once the list exists), and the scoring form's seed is the caller's own record only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  headlineScorecard,
  humanScorecardByline,
  humanScorecardViews,
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

// ---- the read-side projection (r09 follow-up: the drawer + compare grid show EVERY
// record, not the headline mirror) ---------------------------------------------------

test("views: every record, newest first, legacy last and marked, no author id, empties dropped", () => {
  const list: HumanScorecardRecord[] = [
    { ...readHumanScorecards({ humanScorecard: { ratings: [{ competency: "Ownership", rating: 2 }] } })[0] },
    rec("u1", "interview", "2026-09-23T10:00:00.000Z", 4),
    rec("u2", "interview-2", "2026-09-24T10:00:00.000Z", 2),
    { ...rec("u3", "interview", "2026-09-25T10:00:00.000Z"), ratings: [], summary: "" },
  ];
  const views = humanScorecardViews(list);
  assert.deepEqual(
    views.map((v) => [v.authorLabel, v.stage, v.legacy]),
    [
      ["Label u2", "interview-2", false],
      ["Label u1", "interview", false],
      [null, null, true],
    ],
  );
  for (const v of views) assert.ok(!("author" in v), "the signed-in user id never rides a view");
  assert.equal(views[0].ratings?.[0].rating, 2, "the record's own ratings, not the headline's");
  assert.deepEqual(humanScorecardViews([]), []);
});

test("byline: legacy, a named author, and an unnamed (open-mode) author are three distinct claims", () => {
  const [legacy] = humanScorecardViews(readHumanScorecards({ humanScorecard: { summary: "old" } }));
  assert.deepEqual(humanScorecardByline(legacy), { kind: "legacy", author: null, stage: null });
  const [named] = humanScorecardViews([rec("u1", "interview", "2026-09-23T10:00:00.000Z")]);
  assert.deepEqual(humanScorecardByline(named), { kind: "by", author: "Label u1", stage: "interview" });
  const [open] = humanScorecardViews([rec(null, "interview", "2026-09-23T10:00:00.000Z")]);
  assert.deepEqual(humanScorecardByline(open), { kind: "unnamed", author: null, stage: "interview" });
});

// ── independent scoring: the one projection every reader passes through ──────────

import { isFiledScorecard, projectForViewer, projectHumanScorecards, projectPrepPayload } from "./human-scorecard-set.ts";

const ME = { author: "me", authorLabel: "Me", stage: "Interview" };

test("a reviewer who has not filed gets no colleague's record, verdict or user id — only a count", () => {
  const list = [rec("colleague", "Interview", "2026-01-01T00:00:00Z", 5, "colleague verdict")];
  const p = projectHumanScorecards(list, ME, false);
  assert.equal(p.mine, null);
  assert.deepEqual(p.records, []);
  assert.equal(p.othersCount, 1);
  assert.equal(JSON.stringify(p).includes("colleague"), false);
});

test("after filing for this round the caller sees the colleagues' records, without a user id", () => {
  const list = [rec("colleague", "Interview", "2026-01-01T00:00:00Z", 5, "colleague verdict"), rec("me", "Interview", "2026-01-02T00:00:00Z")];
  const p = projectHumanScorecards(list, ME, false);
  assert.equal(p.mine?.author, "me");
  assert.deepEqual(p.records.map((r) => r.summary).sort(), ["by me", "colleague verdict"]);
  assert.equal(p.othersCount, 1);
  assert.equal(JSON.stringify(p.records).includes('"author":'), false, "no author id on a view");
  assert.equal(JSON.stringify(p.records).includes('"colleague"'), false);
});

test("filing for ANOTHER round does not reveal this round", () => {
  const list = [rec("colleague", "Interview", "2026-01-01T00:00:00Z"), rec("me", "Screen", "2026-01-02T00:00:00Z")];
  assert.deepEqual(projectHumanScorecards(list, ME, false).records, []);
});

test("a team manager sees every record without filing", () => {
  const list = [rec("colleague", "Interview", "2026-01-01T00:00:00Z")];
  assert.equal(projectHumanScorecards(list, ME, true).records.length, 1);
  assert.equal(projectHumanScorecards(list, { author: null, authorLabel: null, stage: null }, true).records.length, 1);
});

test("fails closed: no identity and no team:manage reveals nothing, even over an identity-less slot", () => {
  const list = [rec(null, "Interview", "2026-01-01T00:00:00Z", 4, "open-mode slot")];
  const p = projectForViewer(list, null, "Interview");
  assert.deepEqual(p.records, []);
  assert.equal(p.mine, null);
  assert.deepEqual(projectForViewer(list, { author: null, authorLabel: null, canManage: false }, "Interview").records, []);
});

test("a stored zero-rating record does not count as filed, and the projection does not mutate its input", () => {
  const empty = { ...rec("me", "Interview", "2026-01-02T00:00:00Z"), ratings: [] };
  const list = [rec("colleague", "Interview", "2026-01-01T00:00:00Z"), empty];
  const before = JSON.stringify(list);
  assert.equal(isFiledScorecard(empty), false);
  assert.equal(isFiledScorecard(list[0]), true);
  assert.deepEqual(projectHumanScorecards(list, ME, false).records, [], "an empty card opens nothing");
  assert.equal(JSON.stringify(list), before, "the gate's full set is untouched");
  assert.equal(readHumanScorecards({ humanScorecards: list }).length, 2, "the full set still counts every record");
});

test("a prep payload is projected: panel and headline mirror withheld, then shown without author ids", () => {
  const list = [rec("colleague", "Interview", "2026-01-01T00:00:00Z", 5, "colleague verdict")];
  const payload = { scenario: "x", humanScorecards: list, humanScorecard: list[0] };
  const hidden = projectPrepPayload(payload, { author: "me", authorLabel: null, canManage: false }, "Interview");
  assert.equal(hidden.scenario, "x");
  assert.equal("humanScorecard" in hidden, false);
  assert.deepEqual(hidden.humanScorecards, []);
  assert.equal(readHumanScorecards(hidden).length, 0, "an empty list is not read back as the legacy key");
  const shown = projectPrepPayload(payload, { author: null, authorLabel: null, canManage: true }, "Interview");
  assert.equal(JSON.stringify(shown).includes('"author"'), false);
  assert.equal((shown.humanScorecard as { summary?: string }).summary, "colleague verdict");
  assert.equal(projectPrepPayload({ scenario: "y" }, null, null).scenario, "y");
  assert.equal(JSON.stringify(payload).includes('"author":"colleague"'), true, "the input is untouched");
});
