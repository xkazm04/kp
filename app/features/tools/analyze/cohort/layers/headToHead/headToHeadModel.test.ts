import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { COHORT_DIMENSIONS, type CohortMember, type CohortView } from "../../cohortTypes.ts";
import {
  H2H_MAX,
  alignCriteria,
  alignLoose,
  builtOf,
  columnsOf,
  defaultRivals,
  deltaOf,
  fieldOf,
  fieldOrder,
  orderedCriteria,
  reasonKey,
  toggleRival,
} from "./headToHeadModel.ts";

const read = (name: string): CohortView =>
  JSON.parse(fs.readFileSync(new URL(`../../../../../../../public/dev/cohort/${name}`, import.meta.url), "utf8")) as CohortView;
const done = read("cohort20.done.json");
const running = read("cohort20.running.json");
const byLabel = (v: CohortView, label: string): CohortMember => {
  const m = v.members.find((x) => x.label === label);
  assert.ok(m, label);
  return m;
};

test("default rivals: the strongest, then the strongest that differs; two beside a focus, three without", () => {
  const vit = byLabel(done, "Vít Malý").memberId;
  const withFocus = defaultRivals(done, "skills", vit);
  assert.equal(withFocus.length, 2);
  assert.ok(!withFocus.includes(vit));
  const rating = (id: string) => done.members.find((m) => m.memberId === id)?.cells.skills.rating;
  assert.equal(rating(withFocus[0]), 100, "the strongest first");
  assert.ok(![75, 100].includes(rating(withFocus[1]) as number), "then one that differs from the focus and the top");
  const open = defaultRivals(done, "skills", null);
  assert.equal(open.length, 3);
  assert.equal(new Set(open.map(rating)).size, 3, "three different ratings when the field has them");
  // an unknown focus id is no focus
  assert.equal(defaultRivals(done, "skills", "nobody").length, 3);
  // a field where everyone ties still fills the board
  const trust = defaultRivals(done, "trust", byLabel(done, "Vít Malý").memberId);
  assert.equal(trust.length, 2);
});

test("columns: focus first and fixed, rivals by rating, deduped, capped at H2H_MAX", () => {
  const ids = done.members.map((m) => m.memberId);
  const focus = byLabel(done, "Adam Malý").memberId;
  const cols = columnsOf(done, "experience", focus, [ids[0], focus, ids[0], ids[4], ids[2], ids[1], ids[3]]);
  assert.equal(cols[0].memberId, focus);
  assert.equal(cols.length, H2H_MAX);
  assert.equal(new Set(cols.map((m) => m.memberId)).size, cols.length);
  const rest = cols.slice(1).map((m) => m.cells.experience.rating ?? -1);
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a));
  // an absent rival sorts after every rated one
  const failed = byLabel(done, "Hana Černá").memberId;
  const c2 = columnsOf(done, "skills", null, [failed, ids[2]]);
  assert.equal(c2[1].memberId, failed);
});

test("toggleRival: out when in, in when there is room, unchanged when full", () => {
  assert.deepEqual(toggleRival(["a", "b"], "a", 3), ["b"]);
  assert.deepEqual(toggleRival(["a"], "b", 2), ["a", "b"]);
  assert.deepEqual(toggleRival(["a", "b", "c"], "d", H2H_MAX), ["a", "b", "c"]);
});

test("criteria come required-first, and a differing row is open while agreeing rows fold by status", () => {
  for (const d of COHORT_DIMENSIONS) {
    const kinds = orderedCriteria(done, d).map((c) => c.kind);
    const order = ["must", "target", "nice", "signal"];
    assert.deepEqual(kinds, [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)), d);
  }
  const cols = [byLabel(done, "Klára Blažková"), byLabel(done, "Vít Malý")];
  const { open, agree } = alignCriteria(done, "skills", cols);
  const openIds = open.map((r) => r.criterion.id);
  assert.ok(openIds.includes("skill:oracle"), "Oracle: meets vs misses");
  assert.ok(openIds.includes("skill:microservices architecture"), "meets vs partial");
  assert.ok(open.every((r) => r.differs));
  const meets = agree.find((g) => g.status === "meets");
  assert.ok(meets && meets.rows.some((r) => r.criterion.id === "skill:java"));
  assert.equal(open.length + agree.reduce((s, g) => s + g.rows.length, 0), done.criteria.skills.length, "every criterion lands once");
  // a cell carries the member's reasons on that criterion, with their points
  const oracle = open.find((r) => r.criterion.id === "skill:oracle")!;
  assert.equal(oracle.cells[1].status, "misses");
  assert.equal(oracle.cells[1].reasons[0].points, -17);
});

test("with fewer than two readings nothing folds, and an absent column reads null, not unknown", () => {
  const cols = [byLabel(done, "Klára Blažková"), byLabel(done, "Hana Černá")];
  const { open, agree } = alignCriteria(done, "trust", cols);
  assert.equal(agree.length, 0);
  assert.equal(open.length, done.criteria.trust.length);
  assert.ok(open.every((r) => r.cells[1].status === null && !r.differs));
});

test("loose reasons: shared ones align by tone and words, the rest stay each column's own", () => {
  const a = byLabel(done, "Klára Blažková");
  const b = byLabel(done, "David Kříž");
  const { shared, own } = alignLoose(done, "fit", [a, b]);
  const java = shared.find((s) => s.key === reasonKey({ tone: "pro", phrase: { text: "Demonstrates Java." }, source: "strengths" }));
  assert.ok(java, "both demonstrate Java");
  assert.ok(java.cells[0] && java.cells[1]);
  const all = (i: number) => [...own[i].pros, ...own[i].cons, ...own[i].notes].length + shared.filter((s) => s.cells[i]).length;
  const ids = new Set(done.criteria.fit.map((c) => c.id));
  for (const [i, m] of [a, b].entries()) {
    const w = m.why.fit!;
    const loose = [...w.pros, ...w.cons, ...w.notes].filter((r) => !r.criterionId || !ids.has(r.criterionId));
    assert.equal(all(i), loose.length, "no loose reason lost or doubled");
  }
  // pros before cons before notes among shared rows
  const tones = shared.map((s) => s.tone);
  assert.deepEqual(tones, [...tones].sort((x, y) => ["pro", "con", "note"].indexOf(x) - ["pro", "con", "note"].indexOf(y)));
});

test("the '+N more' fold is never shared", () => {
  const more = { tone: "pro" as const, phrase: { key: "more", params: { n: 2 } }, source: "skills" as const };
  const m = (id: string): CohortMember => ({ ...done.members[0], memberId: id, why: { ...done.members[0].why, signals: { why: { text: "x" }, pros: [more], cons: [], notes: [], criteria: {} } } });
  const { shared, own } = alignLoose(done, "signals", [m("a"), m("b")]);
  assert.equal(shared.length, 0);
  assert.equal(own[0].pros.length, 1);
});

test("built: fit is the model's own number; every formula anatomy sums exactly", () => {
  for (const v of [done, running]) {
    for (const m of v.members) {
      assert.deepEqual(builtOf(m, "fit"), { kind: "model" });
      for (const d of COHORT_DIMENSIONS.filter((x) => x !== "fit")) {
        const b = builtOf(m, d);
        if (m.why[d] == null) {
          assert.equal(b.kind, "none");
          continue;
        }
        assert.equal(b.kind, "sum", `${m.label} ${d}`);
        if (b.kind !== "sum") continue;
        assert.equal(b.base + b.earned - b.lost, b.raw, `${m.label} ${d}`);
        assert.equal(b.rating, m.cells[d].rating, `${m.label} ${d}`);
        assert.equal(b.clamped, b.raw !== b.rating);
      }
    }
  }
});

test("fit reasons never carry points (the rule the UI relies on)", () => {
  for (const m of done.members) {
    const w = m.why.fit;
    if (!w) continue;
    assert.ok([...w.pros, ...w.cons, ...w.notes].every((r) => r.points === undefined), m.label);
  }
});

test("delta: signed against the first column; bands decide clears vs overlaps; unrated is null", () => {
  const a = byLabel(done, "Klára Blažková");
  const b = byLabel(done, "Karolína Hájková");
  const d = deltaOf(a, b, "fit")!;
  assert.equal(d.delta, (b.cells.fit.rating as number) - (a.cells.fit.rating as number));
  assert.equal(d.gap, "clears");
  const c = byLabel(done, "David Kříž");
  assert.equal(deltaOf(a, c, "fit")!.gap, "overlaps");
  assert.equal(deltaOf(a, byLabel(done, "Hana Černá"), "fit"), null);
  assert.equal(deltaOf(a, c, "skills")!.gap, null, "no bands on skills: no gap word");
});

test("the field: rated by rating with shared competition ranks, then pending, then absent; every member once", () => {
  for (const v of [done, running]) {
    for (const d of COHORT_DIMENSIONS) {
      const f = fieldOf(v, d);
      const order = fieldOrder(f);
      assert.equal(order.length, v.members.length, d);
      assert.equal(new Set(order).size, order.length);
      for (const [i, r] of f.rated.entries()) {
        if (i === 0) assert.equal(r.rank, 1);
        else if (r.member.cells[d].rating === f.rated[i - 1].member.cells[d].rating) assert.equal(r.rank, f.rated[i - 1].rank);
        else assert.equal(r.rank, i + 1);
      }
    }
  }
  assert.ok(fieldOf(running, "skills").pending.length > 0);
});

test("a point-less reason takes its anatomy part's points (an unproven skill's half credit)", () => {
  const vit = byLabel(done, "Vít Malý");
  const { open } = alignCriteria(done, "skills", [byLabel(done, "Klára Blažková"), vit]);
  const micro = open.find((r) => r.criterion.id === "skill:microservices architecture")!;
  assert.equal(micro.cells[1].reasons[0].points, 8);
  // the con keeps its own points, never the part's
  const oracle = open.find((r) => r.criterion.id === "skill:oracle")!;
  assert.equal(oracle.cells[1].reasons[0].points, -17);
});

test("a shared reason every reading column holds is agreement (all), a partly held one is not", () => {
  const cols = [byLabel(done, "Vít Malý"), byLabel(done, "Klára Blažková"), byLabel(done, "David Kříž")];
  const { shared } = alignLoose(done, "fit", cols);
  for (const s of shared) assert.equal(s.all, s.cells.every(Boolean), s.key);
  assert.ok(shared.some((s) => s.all));
});
