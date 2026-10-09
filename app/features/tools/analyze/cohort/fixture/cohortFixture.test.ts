import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildCohortFixtures, serializeFixture } from "./buildFixture.ts";
import { WHY_CAP } from "../cohortWhy.ts";
import {
  ABSENT_REASONS,
  CELL_TIERS,
  COHORT_CAP,
  COHORT_DIMENSIONS,
  COHORT_STATUSES,
  CRITERION_STATUSES,
  isTextPhrase,
  MEMBER_RUN_STATES,
  MEMBERSHIPS,
  ROBUSTNESS,
  SEPARATIONS,
  type CohortView,
  type Phrase,
  type ShortLabel,
} from "../cohortTypes.ts";

const raw = (name: string): string => fs.readFileSync(new URL(`../../../../../../public/dev/cohort/${name}`, import.meta.url), "utf8");
const read = (name: string): CohortView => JSON.parse(raw(name)) as CohortView;
const done = read("cohort20.done.json");
const running = read("cohort20.running.json");
const en = JSON.parse(fs.readFileSync(new URL("../../../../../../messages/en.json", import.meta.url), "utf8")) as {
  analyzeCohort: { labels: Record<string, unknown>; absent: Record<string, string>; why: Record<string, unknown> };
};

const has = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v);
const keyIn = (root: Record<string, unknown>, key: string) =>
  typeof key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), root) === "string";
const labelExists = (l: ShortLabel) => keyIn(en.analyzeCohort.labels, l.key);
/** A why phrase is analysis prose (non-empty text) or a key under analyzeCohort.why. */
const phraseOk = (p: Phrase) => (isTextPhrase(p) ? p.text.trim().length > 0 : keyIn(en.analyzeCohort.why, p.key));

/** Every union field holds a contract value, every absent cell is a reason (never a 0), every label resolves. */
function assertWellFormed(view: CohortView) {
  assert.ok(has(COHORT_STATUSES, view.status));
  assert.ok(view.members.length <= COHORT_CAP);
  assert.deepEqual([...view.members.map((m) => m.neutralIndex)].sort((a, b) => a - b), view.members.map((_, i) => i));
  for (const m of view.members) {
    assert.ok(has(MEMBERSHIPS, m.membership) && has(MEMBER_RUN_STATES, m.runState), m.memberId);
    for (const d of COHORT_DIMENSIONS) {
      const c = m.cells[d];
      assert.equal(c.dimension, d);
      assert.ok(has(CELL_TIERS, c.tier));
      assert.ok(labelExists(c.label), `${m.memberId}.${d}: label ${c.label.key} is not in analyzeCohort.labels`);
      if (c.tier === "absent") {
        assert.equal(c.rating, null, `${m.memberId}.${d}`);
        assert.ok(has(ABSENT_REASONS, c.absentReason) && c.absentReason! in en.analyzeCohort.absent, `${m.memberId}.${d}`);
        assert.equal(c.band, undefined);
        assert.equal(c.comment, undefined);
      } else {
        assert.ok(Number.isInteger(c.rating) && c.rating! >= 0 && c.rating! <= 100, `${m.memberId}.${d}`);
        assert.equal(c.absentReason, undefined);
        for (const drv of c.band?.drivers ?? []) assert.ok(labelExists(drv), drv.key);
      }
    }
  }
  for (const d of COHORT_DIMENSIONS) {
    const claim = view.claims.byDimension[d];
    assert.ok(has(SEPARATIONS, claim.separation));
    assert.equal(claim.rated, view.members.filter((m) => m.cells[d].rating != null).length);
    if (claim.leader) assert.equal(claim.separation, "clears");
  }
  assert.ok(has(ROBUSTNESS, view.claims.overall.robustness));
}

test("both fixtures are well-formed CohortViews", () => {
  assertWellFormed(done);
  assertWellFormed(running);
});

test("the done fixture carries every case the worlds must render", () => {
  assert.equal(done.status, "done");
  assert.equal(done.members.length, 20);
  const count = (pred: (m: CohortView["members"][number]) => boolean) => done.members.filter(pred).length;
  assert.equal(count((m) => m.membership === "applicant"), 8);
  assert.equal(count((m) => m.membership === "matched"), 10);
  assert.equal(count((m) => m.membership === "added"), 2);
  assert.equal(count((m) => m.runState === "failed"), 2);
  assert.equal(count((m) => m.cells.salary.absentReason === "currencyMismatch"), 2);
  assert.ok(done.claims.byDimension.salary.partitions && done.claims.byDimension.salary.partitions.length === 2);
  assert.equal(count((m) => m.cells.publicWork.rating != null), 3);
  assert.equal(count((m) => m.cells.publicWork.absentReason === "noLink"), 1);
  assert.ok(count((m) => m.decoyOf !== null) >= 1);
  assert.ok(done.members.flatMap((m) => m.detail.trust?.findings ?? []).filter((f) => f.severity === "warn").length >= 2);
  assert.ok(done.members.flatMap((m) => m.detail.trust?.findings ?? []).some((f) => f.severity === "blocker"));
  const comments = done.members.flatMap((m) => COHORT_DIMENSIONS.filter((d) => m.cells[d].comment));
  assert.ok(comments.length >= 3 && comments.length <= 4);
  assert.equal(COHORT_DIMENSIONS.filter((d) => done.claims.byDimension[d].note).length, 2);
  assert.equal(done.narrative?.covers.length, 6);
  assert.equal(done.claims.byDimension.salary.leader, null);
});

test("the running fixture: 7 landed, 1 failed, 12 in flight, no narrative", () => {
  assert.equal(running.status, "running");
  assert.equal(running.finishedAt, null);
  assert.equal(running.narrative, null);
  assert.deepEqual(running.progress, { total: 20, done: 7, reused: 1, failed: 1 });
  const pending = running.members.filter((m) => COHORT_DIMENSIONS.every((d) => m.cells[d].absentReason === "pending"));
  assert.equal(pending.length, 12);
});

test("the committed fixtures are the engine's current output, byte for byte (regenerate with buildFixture.ts)", () => {
  const built = buildCohortFixtures();
  assert.equal(serializeFixture(built.done), raw("cohort20.done.json"));
  assert.equal(serializeFixture(built.running), raw("cohort20.running.json"));
});

/** Every phrase the why-engine emitted resolves; every rated cell explains itself; absent ones do not. */
function assertWhy(view: CohortView) {
  for (const d of COHORT_DIMENSIONS) for (const c of view.criteria[d]) assert.ok(phraseOk(c.phrase), `criteria.${d}.${c.id}`);
  for (const m of view.members) {
    for (const d of COHORT_DIMENSIONS) {
      const cell = m.cells[d];
      const why = m.why[d];
      const at = `${m.memberId}.${d}`;
      if (cell.tier === "absent") {
        assert.equal(why, null, at);
        continue;
      }
      assert.ok(why, `${at}: a rated cell has a why`);
      assert.ok(phraseOk(why.why), `${at}: sentence ${JSON.stringify(why.why)}`);
      for (const r of [...why.pros, ...why.cons, ...why.notes]) {
        assert.ok(phraseOk(r.phrase), `${at}: ${JSON.stringify(r.phrase)}`);
        if (d === "fit") assert.equal(r.points, undefined, `${at}: fit is model-given, it never carries points`);
      }
      for (const list of [why.pros, why.cons, why.notes]) assert.ok(list.length <= WHY_CAP + 1, at);
      // Every criterion of the dimension has a status, in the criteria's order.
      assert.deepEqual(Object.keys(why.criteria), view.criteria[d].map((c) => c.id), at);
      for (const c of Object.values(why.criteria)) {
        assert.ok(has(CRITERION_STATUSES, c.status), at);
        if (c.note) assert.ok(phraseOk(c.note), at);
      }
      if (d === "fit") {
        assert.equal(why.anatomy, undefined, at);
        continue;
      }
      // The anatomy invariant: base + parts === raw, clamp(raw) === the cell's rating.
      const a = why.anatomy!;
      assert.ok(a, `${at}: a formula rating has an anatomy`);
      for (const p of a.parts) {
        assert.ok(Number.isInteger(p.points) && phraseOk(p.phrase), at);
      }
      assert.equal(a.base + a.parts.reduce((s, p) => s + p.points, 0), a.raw, `${at}: base + parts`);
      assert.equal(Math.max(0, Math.min(100, a.raw)), a.rating, `${at}: clamp(raw)`);
      assert.equal(a.rating, cell.rating, `${at}: anatomy rating === cell rating`);
    }
  }
}

test("why: both fixtures explain every rated cell exactly, and every phrase key is in en.json", () => {
  assertWhy(done);
  assertWhy(running);
  assert.deepEqual(done.roleBand, { currency: "CZK", period: "month", min: 110000, max: 160000 });
  assert.deepEqual(done.criteria.experience.map((c) => c.phrase), [{ key: "criteria.minYears", params: { years: 6 } }, { key: "criteria.seniority", params: { level: "senior" } }]);
  assert.ok(done.criteria.skills.length >= 6 && done.criteria.trust.length >= 4 && done.criteria.publicWork.length >= 4);
});
