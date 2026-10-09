import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildCohortFixtures } from "./buildFixture.ts";
import {
  ABSENT_REASONS,
  CELL_TIERS,
  COHORT_CAP,
  COHORT_DIMENSIONS,
  COHORT_STATUSES,
  MEMBER_RUN_STATES,
  MEMBERSHIPS,
  ROBUSTNESS,
  SEPARATIONS,
  type CohortView,
  type ShortLabel,
} from "../cohortTypes.ts";

const read = (name: string): CohortView =>
  JSON.parse(fs.readFileSync(new URL(`../../../../../../public/dev/cohort/${name}`, import.meta.url), "utf8")) as CohortView;
const done = read("cohort20.done.json");
const running = read("cohort20.running.json");
const en = JSON.parse(fs.readFileSync(new URL("../../../../../../messages/en.json", import.meta.url), "utf8")) as {
  analyzeCohort: { labels: Record<string, unknown>; absent: Record<string, string> };
};

const has = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v);
const labelExists = (l: ShortLabel) =>
  typeof l.key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), en.analyzeCohort.labels) === "string";

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

test("the committed fixtures are the engine's current output (regenerate with buildFixture.ts)", () => {
  const built = buildCohortFixtures();
  assert.deepEqual(JSON.parse(JSON.stringify(built.done)), done);
  assert.deepEqual(JSON.parse(JSON.stringify(built.running)), running);
});
