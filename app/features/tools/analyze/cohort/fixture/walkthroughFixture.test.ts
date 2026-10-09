import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildWalkthroughFixture, PROPOSED_MATCHED, readInputs, serializeWalkthrough, WALKTHROUGH_PATH } from "./buildWalkthroughFixture.ts";
import { COHORT_CAP, COHORT_MIN } from "../cohortTypes.ts";
import type { WalkthroughFixture } from "../cohortWalkthroughModel.ts";

const ROOT = new URL("../../../../../../", import.meta.url);
const committed = fs.readFileSync(new URL(WALKTHROUGH_PATH, ROOT), "utf8");
const { done, jobs } = readInputs();
const fx = JSON.parse(committed) as WalkthroughFixture;

test("walkthrough.json is exactly what the builder derives from the finished fixture (re-run is byte-identical)", () => {
  assert.equal(serializeWalkthrough(buildWalkthroughFixture(done, jobs)), committed);
  assert.equal(serializeWalkthrough(buildWalkthroughFixture(done, jobs)), serializeWalkthrough(buildWalkthroughFixture(done, jobs)));
});

test("the cohort's role is listed first with the only proposal; every other role has nobody yet", () => {
  assert.ok(fx.roles.length >= 5 && fx.roles.length <= 7);
  assert.equal(fx.roles[0].slug, done.jdSlug);
  assert.equal(fx.roles[0].title, done.jdTitle);
  assert.equal(new Set(fx.roles.map((r) => r.slug)).size, fx.roles.length);
  for (const r of fx.roles) {
    const p = fx.proposals[r.slug];
    assert.ok(p, `${r.slug} has a proposal`);
    assert.equal(p.jdTitle, r.title);
    assert.ok(r.roleFamily && r.seniority, `${r.slug} carries family and seniority`);
    if (r.slug === done.jdSlug) continue;
    // Honest counts: a role whose proposal is empty claims no pipeline members and no analyses.
    assert.equal(p.members.length, 0);
    assert.equal(r.analysisCount, 0);
    assert.ok(r.pipeline == null || r.pipeline.total === 0);
  }
});

test("the proposal seats all applicants and the first matched by pool rank: 16, under the cap", () => {
  const p = fx.proposals[done.jdSlug];
  const applicants = done.members.filter((m) => m.membership === "applicant").map((m) => m.memberId);
  const matched = done.members.filter((m) => m.membership === "matched").map((m) => m.memberId);
  assert.deepEqual(
    p.members.map((m) => m.memberId),
    [...applicants, ...matched.slice(0, PROPOSED_MATCHED)]
  );
  assert.equal(p.members.length, 16);
  assert.ok(p.members.length >= COHORT_MIN && p.members.length <= COHORT_CAP);
  // The live cap rule: nobody is left out while seats remain.
  assert.deepEqual(p.leftOut, { applicants: 0, matched: 0 });
  const scores = p.members.filter((m) => m.membership === "matched").map((m) => m.matchScore!);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(p.members.filter((m) => m.membership === "applicant").every((m) => m.matchScore === null));
  assert.equal(p.freshCount, p.members.filter((m) => !m.reusable).length);
  assert.equal(p.companyText, done.orgName);
});

test("proposal + population are exactly the finished fixture's members, so every runnable member has a landed state", () => {
  const p = fx.proposals[done.jdSlug];
  const ids = [...p.members.map((m) => m.memberId), ...fx.population.map((r) => r.slug!)];
  assert.deepEqual([...ids].sort(), done.members.map((m) => m.memberId).sort());
  assert.equal(ids.length, COHORT_CAP, "adding the whole population reaches the cap");
  const fixed = new Map(done.members.map((m) => [m.memberId, m]));
  for (const m of p.members) {
    const f = fixed.get(m.memberId)!;
    assert.equal(m.label, f.label);
    assert.equal(m.membership, f.membership);
    assert.equal(m.reusable, f.runState === "reused", m.memberId);
  }
  for (const r of fx.population) {
    assert.equal(r.name, fixed.get(r.key)!.label);
    assert.ok(r.slug && r.analyses.some((a) => a.slug === r.slug), "an analysed CV the add control can seat");
  }
});
