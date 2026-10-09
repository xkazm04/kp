// The Verdict ledger's pure model, over the REAL engine fixtures and small hand-built cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { COHORT_DIMENSIONS, type CohortView, type MemberDimensionWhy, type Reason } from "../../cohortTypes.ts";
import { anatomySum, buildLedger, consFor, criteriaTally, filterRows, hasMusts, headOf, mustMisses, phraseId, reasonWeight, signed, splitShared } from "./ledgerModel.ts";

const read = (name: string): CohortView =>
  JSON.parse(fs.readFileSync(new URL(`../../../../../../../public/dev/cohort/${name}`, import.meta.url), "utf8")) as CohortView;
const done = read("cohort20.done.json");
const running = read("cohort20.running.json");
const byLabel = (v: CohortView, label: string) => v.members.find((m) => m.label === label)!;

const r = (tone: Reason["tone"], text: string, points?: number): Reason => ({ tone, phrase: { text }, source: "skills", ...(points === undefined ? {} : { points }) });

test("buildLedger: every member lands exactly once - rated, pending or absent - on every dimension", () => {
  for (const view of [done, running]) {
    for (const d of COHORT_DIMENSIONS) {
      const l = buildLedger(view, d);
      const ids = [...l.rows.map((x) => x.member.memberId), ...l.pending.map((m) => m.memberId), ...l.absent.flatMap((g) => g.members.map((m) => m.memberId))];
      assert.equal(ids.length, view.members.length, `${d}: count`);
      assert.equal(new Set(ids).size, view.members.length, `${d}: unique`);
      assert.equal(l.rows.length, view.claims.byDimension[d].rated, `${d}: rated rows match the claim`);
    }
  }
});

test("buildLedger: best first, competition positions on ties, the gap to the first row", () => {
  const l = buildLedger(done, "skills");
  for (let i = 1; i < l.rows.length; i++) assert.ok(l.rows[i - 1].rating >= l.rows[i].rating);
  assert.equal(l.rows[0].rating, 100);
  assert.equal(l.rows[1].rating, 100);
  // three share 100 (1, 1, 1), the next is fourth, not second
  assert.deepEqual(l.rows.slice(0, 4).map((x) => x.position), [1, 1, 1, 4]);
  assert.ok(l.rows[0].tied && l.rows[2].tied);
  assert.equal(l.rows[0].gap, null);
  assert.equal(l.rows[1].gap, 0);
  assert.equal(l.rows[3].gap, 100 - l.rows[3].rating);
});

test("buildLedger: a lead is drawn only where the claim clears; inside the noise nobody is crowned", () => {
  const pw = buildLedger(done, "publicWork");
  assert.equal(done.claims.byDimension.publicWork.separation, "clears");
  assert.deepEqual(pw.rows.filter((x) => x.lead).map((x) => x.member.memberId), [done.claims.byDimension.publicWork.leader]);
  assert.ok(pw.rows.every((x) => !x.noise));
  const fit = buildLedger(done, "fit");
  assert.equal(done.claims.byDimension.fit.separation, "insideNoise");
  assert.ok(fit.rows.every((x) => !x.lead));
  // fit carries bands: the second row's band overlaps the first's, the tail's does not
  assert.ok(fit.rows[0].noise && fit.rows[1].noise);
  assert.ok(!fit.rows[fit.rows.length - 1].noise);
  // no bands on skills: the noise is the rows sharing the first rating
  assert.deepEqual(buildLedger(done, "skills").rows.filter((x) => x.noise).map((x) => x.rating), [100, 100, 100]);
});

test("buildLedger: salary and below-the-floor are an order, never a rank, a lead or a gap", () => {
  const sal = buildLedger(done, "salary");
  assert.equal(sal.positionKind, "order");
  assert.ok(sal.rows.every((x) => !x.lead && !x.noise && x.gap === null));
  // ordered by the figure the claim strip names, highest expectation first, never by band fit
  const mids = sal.rows.map((x) => x.member.detail.salary!.midpoint as number);
  for (let i = 1; i < mids.length; i++) assert.ok(mids[i - 1] >= mids[i]);
  // the refused partition (EUR) is absent as "currencyMismatch", never converted into the ledger
  const eur = sal.absent.find((g) => g.reason === "currencyMismatch");
  assert.ok(eur && eur.members.length === 2);
  const floor: CohortView = structuredClone(done);
  floor.claims.byDimension.skills.separation = "belowFloor";
  assert.equal(buildLedger(floor, "skills").positionKind, "order");
});

test("buildLedger: the running fixture keeps pending members as pending rows, in neutral order", () => {
  const l = buildLedger(running, "skills");
  assert.ok(l.pending.length > 0);
  assert.ok(l.pending.every((m) => m.cells.skills.absentReason === "pending"));
  for (let i = 1; i < l.pending.length; i++) assert.ok(l.pending[i - 1].neutralIndex < l.pending[i].neutralIndex);
});

test("headOf: shows three, shows a lone fourth rather than '+1 more', counts a folded reason as its N", () => {
  const five = [1, 2, 3, 4, 5].map((n) => r("pro", `p${n}`, n));
  assert.deepEqual(headOf(five), { items: five.slice(0, 3), more: 2 });
  const four = five.slice(0, 4);
  assert.deepEqual(headOf(four), { items: four, more: 0 });
  const folded: Reason = { tone: "con", phrase: { key: "more", params: { n: 4 } }, source: "skills", points: -40 };
  assert.equal(reasonWeight(folded), 4);
  const seven = [...five, r("pro", "p6", 1), folded];
  assert.equal(headOf(seven).more, 3 + 4);
  assert.deepEqual(headOf([]), { items: [], more: 0 });
});

test("mustMisses / filterRows / consFor: the must-miss filter keeps only rows missing a must-have and names every miss", () => {
  const criteria = done.criteria.skills;
  assert.ok(hasMusts(criteria));
  assert.ok(!hasMusts(done.criteria.fit));
  const rows = buildLedger(done, "skills").rows;
  const kept = filterRows(rows, "mustMiss", criteria);
  assert.ok(kept.length > 0 && kept.length < rows.length);
  assert.ok(kept.every((x) => mustMisses(criteria, x.why).length > 0));
  assert.equal(filterRows(rows, "cons", criteria).length, rows.length);
  const filip = rows.find((x) => x.member.label === "Filip Sýkora")!;
  const cons = consFor(filip, "mustMiss", criteria, "skills");
  assert.equal(cons.length, mustMisses(criteria, filip.why).length);
  assert.deepEqual(consFor(filip, "all", criteria, "skills"), filip.why.cons);
  // a missed must-have with no reason of its own is still named (as its criterion's phrase)
  const silentWhy: MemberDimensionWhy = { ...filip.why, cons: [] };
  const silent = consFor({ ...filip, why: silentWhy }, "mustMiss", criteria, "publicWork");
  assert.equal(silent.length, mustMisses(criteria, filip.why).length);
  assert.ok(silent.every((x) => x.source === "github" && x.points === undefined));
});

test("anatomySum: every formula anatomy in both fixtures sums exactly; fit never has one and never carries points", () => {
  for (const view of [done, running]) {
    for (const m of view.members) {
      for (const d of COHORT_DIMENSIONS) {
        const why = m.why[d];
        if (!why) continue;
        if (d === "fit") {
          assert.equal(why.anatomy, undefined);
          assert.ok([...why.pros, ...why.cons, ...why.notes].every((x) => x.points === undefined), `${m.label} fit points`);
          continue;
        }
        if (!why.anatomy) continue;
        const s = anatomySum(why.anatomy);
        assert.ok(s.exact, `${m.label} ${d}`);
        assert.equal(s.rating, m.cells[d].rating, `${m.label} ${d} rating`);
      }
    }
  }
  const clamped = anatomySum({ base: 100, parts: [{ phrase: { text: "x" }, points: 7, tone: "pro" }], raw: 107, rating: 100 });
  assert.ok(clamped.clamped && clamped.exact);
  assert.ok(!anatomySum({ base: 0, parts: [{ phrase: { text: "x" }, points: 7, tone: "pro" }], raw: 8, rating: 8 }).exact);
});

test("signed: plus, a real minus sign, and a plus-minus zero", () => {
  assert.equal(signed(17), "+17");
  assert.equal(signed(-6), "−6");
  assert.equal(signed(0), "±0");
});

test("criteriaTally: counts every criterion once by status", () => {
  const vit = byLabel(done, "Vít Malý").why.skills!;
  assert.deepEqual(criteriaTally(vit), { meets: 4, partial: 1, misses: 1, unknown: 0 });
});

test("phraseId: prose by text, keys by key and values in any order", () => {
  assert.equal(phraseId({ text: " Java " }), phraseId({ text: "Java" }));
  assert.equal(phraseId({ key: "a", params: { x: 1, y: 2 } }), phraseId({ key: "a", params: { y: 2, x: 1 } }));
  assert.notEqual(phraseId({ key: "a", params: { x: 1 } }), phraseId({ key: "a", params: { x: 2 } }));
});

test("splitShared: what the first row also says folds into a count with its points; the rest stays", () => {
  const rows = buildLedger(done, "skills").rows;
  const first = rows[0].why;
  const gabriela = rows.find((x) => x.member.label === "Gabriela Černá")!.why;
  const pros = splitShared(gabriela.pros, first.pros);
  assert.equal(pros.distinct.length, 0);
  assert.equal(pros.shared, gabriela.pros.length);
  assert.equal(pros.sharedPoints, gabriela.pros.reduce((s, x) => s + (x.points ?? 0), 0));
  const cons = splitShared(gabriela.cons, first.cons);
  assert.deepEqual(cons.distinct, gabriela.cons);
  assert.equal(cons.sharedPoints, null);
  // no first row to compare against (the first row itself, salary, below the floor): the list stays whole
  assert.deepEqual(splitShared(gabriela.pros, null), { distinct: gabriela.pros, shared: 0, sharedPoints: null });
  // fit prose: a strength the first row lacks stays distinct
  const fit = buildLedger(done, "fit").rows;
  const vit = fit.find((x) => x.member.label === "Vít Malý")!.why;
  const split = splitShared(vit.pros, fit[0].why.pros);
  assert.ok(split.distinct.some((x) => "text" in x.phrase && x.phrase.text.includes("ISO 20022")));
  assert.equal(split.sharedPoints, null);
  // the engine's fold is never "shared": it stands for reasons nobody compared
  const fold: Reason = { tone: "pro", phrase: { key: "more", params: { n: 2 } }, source: "skills" };
  assert.equal(splitShared([fold], [fold]).distinct.length, 1);
});
