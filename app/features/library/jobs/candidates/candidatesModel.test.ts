// The Candidates tab's shared row model, pinned.
//
// Three variants read these rows; a change here changes what ALL of them claim,
// which is exactly why the claims live in one tested module instead of in three
// layouts. Runner: node:test via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandOf,
  bandShare,
  buildLadderRows,
  filterRows,
  groupByBand,
  MAX_GAPS,
  MAX_STRENGTHS,
  stageOptions } from "./candidatesModel";
import type { CandRow } from "../JobsTypes";

function cand(over: Partial<CandRow> & { candidateId: string; total: number }): CandRow {
  const { candidateId, total, ...rest } = over;
  return {
    candidateId,
    label: candidateId,
    archetype: "bau",
    seniority: "medior",
    koPassed: true,
    koReasons: [],
    assumptions: [],
    result: {
      total,
      confidence: { low: total - 5, high: total + 5, level: "moderate", drivers: [] },
      matchedSkills: [],
      missingSkills: [],
    },
    ...rest,
  } as CandRow;
}

test("rank is the position in the ordered eligible pool, and a KO row has none", () => {
  const rows = buildLadderRows([
    cand({ candidateId: "a", total: 90 }),
    cand({ candidateId: "b", total: 70 }),
    cand({ candidateId: "c", total: 30, koPassed: false, koReasons: ["No German"] }),
  ]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 0]);
  assert.deepEqual(rows.map((r) => r.eligible), [true, true, false]);
});

test("the chip strips are capped — three strengths, two gaps", () => {
  const [row] = buildLadderRows([
    cand({
      candidateId: "a",
      total: 80,
      result: {
        total: 80,
        confidence: { low: 75, high: 85, level: "tight", drivers: [] },
        matchedSkills: ["go", "k8s", "sql", "aws", "tf"],
        missingSkills: ["rust", "scala", "elixir"],
      },
    }),
  ]);
  assert.equal(row.strengths.length, MAX_STRENGTHS);
  assert.equal(row.gaps.length, MAX_GAPS);
  assert.deepEqual(row.strengths, ["go", "k8s", "sql"]);
  assert.deepEqual(row.gaps, ["rust", "scala"]);
});

test("Fair Rank swaps the displayed score for the robust mean and keeps the own score", () => {
  const fair = (id: string) => (id === "a" ? { own: 90, mean: 71, delta: -19 } : undefined);
  const [a, b] = buildLadderRows([cand({ candidateId: "a", total: 90 }), cand({ candidateId: "b", total: 60 })], {
    fair,
  });
  assert.equal(a.score, 71);
  assert.equal(a.ownScore, 90);
  // No matrix entry for b — the own-weight total stands rather than a zero.
  assert.equal(b.score, 60);
  assert.equal(b.ownScore, 60);
});

test("bands use the shared fit floors, and ineligibility outranks any score", () => {
  assert.equal(bandOf({ eligible: true, score: 70 }), "strong");
  assert.equal(bandOf({ eligible: true, score: 69 }), "mid");
  assert.equal(bandOf({ eligible: true, score: 55 }), "mid");
  assert.equal(bandOf({ eligible: true, score: 54 }), "weak");
  // A KO-filtered candidate scoring 95 is still not eligible — the band must
  // never launder an exclusion into a strong-match header.
  assert.equal(bandOf({ eligible: false, score: 95 }), "notEligible");
});

test("groupByBand keeps SCORE_BANDS order and drops empty bands", () => {
  const groups = groupByBand(
    buildLadderRows([
      cand({ candidateId: "a", total: 85 }),
      cand({ candidateId: "b", total: 20 }),
      cand({ candidateId: "c", total: 10, koPassed: false, koReasons: ["x"] }),
    ]),
  );
  assert.deepEqual(groups.map((g) => g.band), ["strong", "weak", "notEligible"]);
  assert.deepEqual(groups.map((g) => g.rows.length), [1, 1, 1]);
});

test("the name filter ignores case and diacritics; the stage filter is exact", () => {
  const rows = buildLadderRows([
    cand({ candidateId: "a", label: "Šárka Nováková", total: 80, inPipeline: "Screened" }),
    cand({ candidateId: "b", label: "Tomáš Dvořák", total: 70, inPipeline: "Offer" }),
  ]);
  assert.deepEqual(filterRows(rows, { name: "sarka" }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterRows(rows, { name: "  DVOR " }).map((r) => r.id), ["b"]);
  assert.deepEqual(filterRows(rows, { stage: "Offer" }).map((r) => r.id), ["b"]);
  assert.equal(filterRows(rows, {}).length, 2);
  assert.equal(filterRows(rows, { name: "", stage: "" }).length, 2);
});

test("stage options are the distinct stages in ranked order, not alphabetical", () => {
  const rows = buildLadderRows([
    cand({ candidateId: "a", total: 90, inPipeline: "Offer" }),
    cand({ candidateId: "b", total: 80 }),
    cand({ candidateId: "c", total: 70, inPipeline: "Screened" }),
    cand({ candidateId: "d", total: 60, inPipeline: "Offer" }),
  ]);
  assert.deepEqual(stageOptions(rows), ["Offer", "Screened"]);
});

test("a band share over an empty pool is 0, never NaN", () => {
  assert.equal(bandShare(0, 0), 0);
  assert.equal(bandShare(3, 12), 25);
});
