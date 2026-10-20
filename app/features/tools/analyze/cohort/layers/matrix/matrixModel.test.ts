// The Criteria matrix's pure model, over the REAL engine fixtures and small hand-built cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { COHORT_DIMENSIONS, isTextPhrase, type CohortDimension, type CohortView } from "../../cohortTypes.ts";
import {
  anatomySum,
  differences,
  entryOf,
  headClaim,
  KIND_ORDER,
  matrixColumns,
  matrixGroups,
  moveCell,
  pointLedger,
  pointRoles,
  readPair,
  rowStats,
  signed,
  summaryCount,
  voiceOf,
} from "./matrixModel.ts";

const read = (name: string): CohortView => JSON.parse(fs.readFileSync(new URL(`../../../../../../../public/dev/cohort/${name}`, import.meta.url), "utf8")) as CohortView;
const done = read("cohort20.done.json");
const running = read("cohort20.running.json");
const byLabel = (v: CohortView, label: string) => v.members.find((m) => m.label === label)!;

test("columns: every member is a column or in the remainder, never both, never twice", () => {
  for (const v of [done, running]) {
    for (const d of COHORT_DIMENSIONS) {
      const cols = matrixColumns(v, d);
      const ids = cols.map((c) => c.member.memberId);
      assert.equal(new Set(ids).size, ids.length, `${d}: a column twice`);
      const absent = v.members.filter((m) => m.cells[d].tier === "absent" && m.cells[d].absentReason !== "pending");
      for (const m of absent) assert.ok(!ids.includes(m.memberId), `${d}: absent ${m.label} drawn as a column`);
      assert.equal(cols.length + absent.length, v.members.length, `${d}: someone vanished`);
      // a rated column always carries a why, a pending one never a rating
      for (const c of cols) {
        if (c.state === "rated") assert.ok(c.member.why[d], `${d}: rated column without a why`);
        else assert.equal(c.rating, null);
      }
    }
  }
});

test("columns: rated by rating (neutral tie-break), pending after; salary by figure, lowest first", () => {
  const cols = matrixColumns(done, "skills");
  const ratings = cols.map((c) => c.rating as number);
  assert.deepEqual(ratings, [...ratings].sort((a, b) => b - a));
  const run = matrixColumns(running, "fit");
  const firstPending = run.findIndex((c) => c.state === "pending");
  assert.ok(firstPending > 0 && run.slice(firstPending).every((c) => c.state === "pending"), "pending columns trail the rated ones");
  assert.equal(run.filter((c) => c.state === "pending").length, 12);
  const sal = matrixColumns(done, "salary").map((c) => c.member.detail.salary?.midpoint ?? Infinity);
  assert.deepEqual(sal, [...sal].sort((a, b) => a - b));
});

test("rows: grouped by kind in the role's order, most splitting first inside a group", () => {
  for (const d of COHORT_DIMENSIONS) {
    const cols = matrixColumns(done, d);
    const groups = matrixGroups(done.criteria[d], cols, d);
    const kinds = groups.map((g) => g.kind);
    assert.deepEqual(kinds, KIND_ORDER.filter((k) => kinds.includes(k)), `${d}: kind order`);
    assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), done.criteria[d].length, `${d}: every criterion is a row`);
    for (const g of groups) {
      for (let i = 1; i < g.rows.length; i++) assert.ok(g.rows[i - 1].stats.split >= g.rows[i].stats.split, `${d}: split order`);
    }
  }
  // skills: Java splits 10/8 and Oracle 5/1/12: the even split comes first
  const skills = matrixGroups(done.criteria.skills, matrixColumns(done, "skills"), "skills")[0].rows.map((r) => r.criterion.id);
  assert.ok(skills.indexOf("skill:java") < skills.indexOf("skill:oracle"));
});

test("rowStats: counts the rated only, and a unanimous row does not split", () => {
  const cols = matrixColumns(done, "skills");
  const s = rowStats(cols, "skills", "skill:java");
  assert.equal(s.rated, 18);
  assert.equal(s.meets + s.partial + s.misses + s.unknown, s.rated);
  assert.equal(s.meets, 10);
  const one = cols.slice(0, 1);
  assert.equal(rowStats(one, "skills", "skill:java").split, 0);
  // pending columns never count
  const run = matrixColumns(running, "skills");
  assert.equal(rowStats(run, "skills", "skill:java").rated, run.filter((c) => c.state === "rated").length);
});

test("summary voice: requirements meet, signals are seen at all, trust is clear", () => {
  const s = { meets: 6, partial: 1, misses: 2, unknown: 8, rated: 17, split: 0.5 };
  assert.equal(summaryCount("req", s), 6);
  assert.equal(summaryCount("trust", s), 6);
  assert.equal(summaryCount("signal", s), 9);
  assert.equal(voiceOf("trust", "signal"), "trust");
  assert.equal(voiceOf("signals", "signal"), "signal");
  assert.equal(voiceOf("skills", "must"), "req");
});

test("entryOf: null for a member with no why, unknown for a criterion the record is silent on", () => {
  const pending = running.members.find((m) => m.cells.fit.absentReason === "pending")!;
  assert.equal(entryOf(pending, "fit", "seniority"), null);
  assert.deepEqual(entryOf(byLabel(done, "Klára Blažková"), "skills", "skill:nope"), { status: "unknown" });
});

test("readPair: the focused rated column against the first, the first against the second", () => {
  const cols = matrixColumns(done, "skills");
  const first = cols[0].member.memberId;
  const fourth = cols[3].member.memberId;
  assert.deepEqual([readPair(cols, fourth).focus?.member.memberId, readPair(cols, fourth).ref?.member.memberId], [fourth, first]);
  assert.deepEqual([readPair(cols, first).focus?.member.memberId, readPair(cols, first).ref?.member.memberId], [first, cols[1].member.memberId]);
  assert.equal(readPair(cols, null).focus?.member.memberId, first, "no focus reads the first column");
  const pendingId = matrixColumns(running, "fit").find((c) => c.state === "pending")!.member.memberId;
  assert.equal(readPair(matrixColumns(running, "fit"), pendingId).focus?.state, "rated", "a pending focus never reads");
  assert.deepEqual(readPair(cols.slice(0, 1), first), { focus: cols[0], ref: null });
});

test("differences: only rows where both are read and the statuses differ", () => {
  const cols = matrixColumns(done, "skills");
  const groups = matrixGroups(done.criteria.skills, cols, "skills");
  const a = cols[cols.length - 1].member;
  const b = cols[0].member;
  const diff = differences(groups, "skills", a, b);
  for (const x of diff) {
    assert.notEqual(x.mine, x.theirs);
    assert.equal(entryOf(a, "skills", x.criterion.id)!.status, x.mine);
  }
  assert.deepEqual(differences(groups, "skills", b, b), []);
});

test("headClaim: a lead only where the claim clears, a noise span of at least two, never on salary", () => {
  const pw = headClaim(done, "publicWork", matrixColumns(done, "publicWork"));
  assert.deepEqual(pw, { kind: "clears", leader: done.claims.byDimension.publicWork.leader });
  const fit = headClaim(done, "fit", matrixColumns(done, "fit"));
  assert.equal(fit?.kind, "noise");
  assert.ok(fit && fit.kind === "noise" && fit.count >= 2);
  assert.equal(headClaim(done, "salary", matrixColumns(done, "salary")), null);
  const floor: CohortView = { ...done, claims: { ...done.claims, byDimension: { ...done.claims.byDimension, fit: { ...done.claims.byDimension.fit, separation: "belowFloor" } } } };
  assert.equal(headClaim(floor, "fit", matrixColumns(floor, "fit")), null);
});

test("anatomy: every fixture anatomy sums exactly, and fit never carries one or any points", () => {
  for (const v of [done, running]) {
    for (const m of v.members) {
      for (const d of COHORT_DIMENSIONS as readonly CohortDimension[]) {
        const w = m.why[d];
        if (!w) continue;
        if (d === "fit") {
          assert.equal(w.anatomy, undefined);
          for (const r of [...w.pros, ...w.cons, ...w.notes]) assert.equal(r.points, undefined, "fit reason with points");
          continue;
        }
        if (!w.anatomy) continue;
        const s = anatomySum(w.anatomy);
        assert.ok(s.exact, `${m.label}/${d}: base + parts != raw`);
        assert.equal(s.rating, m.cells[d].rating, `${m.label}/${d}: anatomy rating != cell rating`);
      }
    }
  }
  assert.deepEqual(anatomySum({ base: 50, parts: [{ phrase: { text: "x" }, points: 70, tone: "pro" }], raw: 120, rating: 100 }).clamped, true);
});

test("pointRoles: every pro with points is a term, the drawn terms sum exactly, a missing skill's price is forgone", () => {
  let summed = 0;
  for (const v of [done, running]) {
    for (const m of v.members) {
      for (const d of COHORT_DIMENSIONS) {
        const w = m.why[d];
        if (!w) continue;
        const roles = pointRoles(w);
        for (const r of w.pros) if (r.points != null) assert.equal(roles.get(r), "part", `${m.label}/${d}: a pro outside the sum`);
        for (const r of [...w.pros, ...w.cons, ...w.notes]) if (r.points == null) assert.equal(roles.has(r), false);
        if (!w.anatomy) continue;
        const terms = [...w.pros, ...w.cons, ...w.notes].filter((r) => roles.get(r) === "part").reduce((a, r) => a + (r.points ?? 0), 0);
        const zeroFree = w.anatomy.parts.filter((p) => p.points !== 0).length;
        // the reasons drawn as terms ARE the anatomy's non-zero terms (when every term has a reason)
        if ([...roles.values()].filter((x) => x === "part").length === zeroFree) {
          assert.equal(w.anatomy.base + terms, w.anatomy.raw, `${m.label}/${d}: drawn terms do not sum`);
          summed += 1;
        }
      }
    }
  }
  assert.ok(summed > 60, `the sum check ran on only ${summed} records`);
  const vit = byLabel(done, "Vít Malý").why.skills!;
  const oracle = vit.cons.find((r) => r.criterionId === "skill:oracle")!;
  assert.equal(pointRoles(vit).get(oracle), "forgone");
  assert.equal(anatomySum(vit.anatomy!).parts.includes(0), false, "zero terms are not drawn");
  // the unproven skill's half credit is a term no reason claims: it is named as an orphan
  assert.deepEqual(pointLedger(vit).orphans.map((p) => p.points), [8]);
  // and in every record, claimed terms + orphans ARE the non-zero anatomy
  for (const m of done.members) {
    for (const d of COHORT_DIMENSIONS) {
      const w = m.why[d];
      if (!w?.anatomy || [...w.pros, ...w.cons, ...w.notes].some((r) => !isTextPhrase(r.phrase) && r.phrase.key === "more")) continue;
      const { roles, orphans } = pointLedger(w);
      const claimed = [...roles].filter(([, role]) => role === "part").reduce((a, [r]) => a + (r.points ?? 0), 0);
      assert.equal(w.anatomy.base + claimed + orphans.reduce((a, p) => a + p.points, 0), w.anatomy.raw, `${m.label}/${d}: ledger does not close`);
    }
  }
  const klara = byLabel(done, "Klára Blažková").why.experience!;
  assert.deepEqual(klara.pros.map((r) => pointRoles(klara).get(r)), ["part", "part"], "matched by value, not by phrase");
});

test("signed: a true minus, a plus, a bare zero", () => {
  assert.equal(signed(12), "+12");
  assert.equal(signed(-8), "−8");
  assert.equal(signed(0), "0");
});

test("moveCell: arrows walk, j/k step candidates, the edges hold", () => {
  assert.deepEqual(moveCell({ row: 1, col: 1 }, "ArrowDown", 5, 4), { row: 2, col: 1 });
  assert.deepEqual(moveCell({ row: 0, col: 0 }, "ArrowUp", 5, 4), { row: 0, col: 0 });
  assert.deepEqual(moveCell({ row: 2, col: 3 }, "j", 5, 4), { row: 2, col: 3 });
  assert.deepEqual(moveCell({ row: 2, col: 3 }, "k", 5, 4), { row: 2, col: 2 });
  assert.deepEqual(moveCell({ row: 2, col: 1 }, "End", 5, 4), { row: 2, col: 3 });
  assert.deepEqual(moveCell({ row: 2, col: 1 }, "PageDown", 5, 4), { row: 4, col: 1 });
  assert.equal(moveCell({ row: 0, col: 0 }, "x", 5, 4), null);
  assert.equal(moveCell({ row: 0, col: 0 }, "j", 0, 4), null);
});
