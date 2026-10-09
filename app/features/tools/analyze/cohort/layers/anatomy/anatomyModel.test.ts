import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { COHORT_DIMENSIONS, type CohortView, type ScoreAnatomy } from "../../cohortTypes.ts";
import { anatomyGeometry, attachReasons, besideReasons, fieldOrder, gapBetween, partIdentity, partStarts, phraseKey, rivalOf, signed } from "./anatomyModel.ts";

const read = (name: string): CohortView =>
  JSON.parse(fs.readFileSync(new URL(`../../../../../../../public/dev/cohort/${name}`, import.meta.url), "utf8")) as CohortView;
const done = read("cohort20.done.json");
const running = read("cohort20.running.json");

const an = (base: number, parts: Array<[number, "pro" | "con" | "note", string]>, rating?: number): ScoreAnatomy => {
  const raw = base + parts.reduce((s, [p]) => s + p, 0);
  return { base, parts: parts.map(([points, tone, text]) => ({ points, tone, phrase: { text } })), raw, rating: rating ?? Math.max(0, Math.min(100, raw)) };
};

test("geometry: earning parts climb from the base, losing parts fall back from the peak, the solid run ends at the rating", () => {
  const g = anatomyGeometry(an(50, [[9, "pro", "a"], [7, "pro", "b"], [-5, "con", "c"]]));
  assert.deepEqual(g.segs.map((s) => [s.kind, s.from, s.to]), [["base", 0, 50], ["earn", 50, 59], ["earn", 59, 66], ["lose", 61, 66]]);
  assert.equal(g.peak, 66);
  assert.equal(g.raw, 61);
  assert.equal(g.sums, true);
  assert.equal(g.clamped, false);
});

test("geometry: a claimed-not-shown part is half credit, a zero con is named, not drawn", () => {
  const g = anatomyGeometry(an(0, [[17, "pro", "Java"], [8, "note", "Kafka"], [0, "con", "Oracle"]]));
  assert.deepEqual(g.segs.map((s) => s.kind), ["earn", "half"]);
  assert.deepEqual(g.zeroCons, [{ text: "Oracle" }]);
});

test("geometry: a raw outside the scale is drawn clamped and says so", () => {
  const g = anatomyGeometry(an(100, [[-40, "con", "x"], [-40, "con", "y"], [-40, "con", "z"]], 0));
  assert.equal(g.raw, -20);
  assert.equal(g.clamped, true);
  assert.ok(g.segs.every((s) => s.from >= 0 && s.to <= 100));
  assert.deepEqual(g.segs.filter((s) => s.kind === "lose").map((s) => [s.from, s.to]), [[60, 100], [20, 60], [0, 20]]);
});

test("geometry: labels only where the segment is wide enough", () => {
  const g = anatomyGeometry(an(0, [[60, "pro", "wide"], [5, "pro", "thin"]]));
  assert.deepEqual(g.segs.map((s) => s.label), [true, false]);
});

test("every anatomy in both fixtures sums exactly, and the drawing never leaves the scale", () => {
  for (const view of [done, running])
    for (const m of view.members)
      for (const d of COHORT_DIMENSIONS) {
        const a = m.why[d]?.anatomy;
        if (!a) continue;
        const g = anatomyGeometry(a);
        assert.equal(g.sums, true, `${m.label} ${d}`);
        assert.equal(a.rating, m.cells[d].rating, `${m.label} ${d} rating`);
        assert.ok(g.segs.every((s) => s.from >= 0 && s.to <= 100 && s.to > s.from));
        const solidEnd = Math.max(0, ...g.segs.filter((s) => s.kind !== "lose").map((s) => s.to));
        const lost = g.segs.filter((s) => s.kind === "lose").reduce((t, s) => t + (s.to - s.from), 0);
        if (!g.clamped) assert.equal(solidEnd - lost, a.rating, `${m.label} ${d}: drawn run ends at the rating`);
      }
});

test("fit is model-given: no anatomy and no points on any of its reasons", () => {
  for (const m of done.members) {
    const w = m.why.fit;
    if (!w) continue;
    assert.equal(w.anatomy, undefined);
    for (const r of [...w.pros, ...w.cons, ...w.notes]) assert.equal(r.points, undefined);
  }
});

test("attachReasons: a part keeps its own reason; a con worded like it is its shortfall", () => {
  const m = done.members.find((x) => x.why.skills?.cons.length && x.why.skills.anatomy)!;
  const w = m.why.skills!;
  const att = attachReasons(w.anatomy, w);
  const missing = att.rows.find((r) => r.points === 0 && r.tone === "con")!;
  assert.ok(missing.reason, "the missing skill keeps its reason");
  assert.equal(missing.short, 17);
  // nothing is listed twice: every reason is either a part's or left over
  const placed = att.rows.filter((r) => r.reason).length + att.pros.length + att.cons.length + att.notes.length;
  assert.ok(placed <= w.pros.length + w.cons.length + w.notes.length);
});

test("attachReasons: experience's pros are paired by points, its cons become the parts' shortfalls", () => {
  const m = done.members.find((x) => x.why.experience?.cons.length === 2)!;
  const w = m.why.experience!;
  const att = attachReasons(w.anatomy, w);
  for (const row of att.rows) assert.ok(row.reason && row.reason.points === row.points, phraseKey(row.phrase));
  assert.deepEqual(att.rows.map((r) => r.short), w.cons.map((c) => -(c.points as number)));
  assert.equal(att.cons.length, 0);
});

test("gapBetween: lines skills up by name and the deltas sum to the raw gap exactly", () => {
  for (const d of COHORT_DIMENSIONS) {
    const order = fieldOrder(done, d).filter((m) => m.why[d]?.anatomy);
    if (order.length < 2) continue;
    const top = order[0].why[d]!.anatomy!;
    for (const m of order.slice(1)) {
      const gap = gapBetween(m.why[d]!.anatomy!, top);
      assert.equal(gap.rows.reduce((s, r) => s + r.delta, 0), gap.rawGap, `${d} ${m.label}`);
      assert.ok(gap.rows.every((r) => r.delta !== 0));
    }
  }
  assert.equal(partIdentity({ key: "skill.missing", params: { skill: "Kafka" } }), partIdentity({ key: "skill.matched", params: { skill: "kafka" } }));
});

test("fieldOrder: salary goes by the asked figure, the rest by rating", () => {
  const sal = fieldOrder(done, "salary");
  const mids = sal.map((m) => m.detail.salary!.midpoint!);
  assert.deepEqual(mids, [...mids].sort((a, b) => a - b));
  const skills = fieldOrder(done, "skills").map((m) => m.cells.skills.rating!);
  assert.deepEqual(skills, [...skills].sort((a, b) => b - a));
});

test("rivalOf: salary and below-floor name nobody; the leader only where the claim clears", () => {
  const someone = fieldOrder(done, "skills")[3].memberId;
  assert.equal(rivalOf(done, "salary", someone), null);
  assert.equal(rivalOf(done, "skills", someone)?.role, "first");
  const first = fieldOrder(done, "skills")[0].memberId;
  assert.equal(rivalOf(done, "skills", first)?.role, "next");
  const pw = fieldOrder(done, "publicWork");
  assert.equal(rivalOf(done, "publicWork", pw[1].memberId)?.role, done.claims.byDimension.publicWork.leader === pw[0].memberId ? "leader" : "first");
  assert.equal(rivalOf(done, "skills", null), null);
});

test("signed reads as a signed number", () => {
  assert.deepEqual([signed(17), signed(-15), signed(0)], ["+17", "−15", "0"]);
});

test("partStarts: each step starts where the climb is; a zero part sits where it would have begun", () => {
  assert.deepEqual(partStarts(an(0, [[17, "pro", "a"], [0, "con", "b"], [16, "pro", "c"]])), [0, 17, 17]);
  assert.deepEqual(partStarts(an(50, [[9, "pro", "a"], [-5, "con", "b"]])), [50, 59]);
});

test("besideReasons: a fit row shows the model's first con and first note, else its first pro", () => {
  const r = (tone: "pro" | "con" | "note", text: string) => ({ tone, phrase: { text }, source: "strengths" as const });
  assert.deepEqual(besideReasons({ pros: [r("pro", "p")], cons: [r("con", "c")], notes: [r("note", "n"), r("note", "m")] }).map((x) => x.phrase), [{ text: "c" }, { text: "n" }]);
  assert.deepEqual(besideReasons({ pros: [r("pro", "p"), r("pro", "q")], cons: [], notes: [] }).map((x) => x.phrase), [{ text: "p" }]);
});
