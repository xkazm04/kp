import { test } from "node:test";
import assert from "node:assert/strict";
import { factorPoints, FACTOR_MAXES, FACTOR_DOMAIN } from "./factor-points.ts";

// bug-ui-scan 2026-07-09 (analysis-result-panels #1): the score-breakdown chart plotted RAW
// values on an auto-scaled y-axis. Each factor has a different ceiling (25/30/23/12/10), so
// the axis snapped to the largest bar VALUE and a uniformly weak candidate's tallest bar
// filled the chart. A recruiter reads "maxed out" where the truth is 8/25. The domain also
// floated per candidate, so two charts could not be compared by eye.

const score = (o: Partial<Record<"experience" | "skills" | "roleSeniority" | "education" | "traits", number>>) =>
  ({ experience: 0, skills: 0, roleSeniority: 0, education: 0, traits: 0, total: 0, ...o }) as never;

test("the y-domain is pinned, not data-relative", () => {
  assert.deepEqual([...FACTOR_DOMAIN], [0, 1]);
});

test("a uniformly weak candidate never produces a full-height bar", () => {
  // The exact scenario from the finding: every component weak.
  const pts = factorPoints(score({ experience: 8, skills: 7, roleSeniority: 6, education: 3, traits: 2 }));
  for (const p of pts) {
    assert.ok(p.ratio < 0.4, `${p.id} should be visibly short, got ratio ${p.ratio}`);
  }
  // Height now tracks each factor's fraction of its OWN max, not raw magnitude.
  const byId = Object.fromEntries(pts.map((p) => [p.id, p]));
  assert.equal(byId.experience!.ratio, 8 / 25);
  assert.equal(byId.skills!.ratio, 7 / 30);
  assert.ok(byId.experience!.ratio > byId.skills!.ratio, "8/25 is a larger fraction than 7/30");
});

test("a maxed factor reaches exactly 1 and a zero factor exactly 0", () => {
  const pts = factorPoints(score({ skills: 30, education: 0 }));
  const byId = Object.fromEntries(pts.map((p) => [p.id, p]));
  assert.equal(byId.skills!.ratio, 1);
  assert.equal(byId.education!.ratio, 0);
});

test("ratios are clamped to [0,1] against out-of-range input", () => {
  const pts = factorPoints(score({ skills: 999, traits: -5 }));
  const byId = Object.fromEntries(pts.map((p) => [p.id, p]));
  assert.equal(byId.skills!.ratio, 1);
  assert.equal(byId.traits!.ratio, 0);
});

test("two candidates are comparable by height because the scale is shared", () => {
  // Strong-on-skills vs weak-on-skills: the strong candidate's skills bar MUST be taller.
  const strong = factorPoints(score({ skills: 27 })).find((p) => p.id === "skills")!;
  const weak = factorPoints(score({ skills: 6 })).find((p) => p.id === "skills")!;
  assert.ok(strong.ratio > weak.ratio);
  // Under the old auto-domain both charts scaled to their own largest bar, so BOTH rendered
  // that bar at full height. The pinned domain is what makes this assertion meaningful.
  assert.equal(weak.ratio, 6 / 30);
});

test("the raw value and max ride along for the tooltip", () => {
  const p = factorPoints(score({ experience: 8 })).find((x) => x.id === "experience")!;
  assert.equal(p.value, 8);
  assert.equal(p.max, 25);
});

test("every declared factor is projected exactly once", () => {
  const pts = factorPoints(score({}));
  assert.equal(pts.length, FACTOR_MAXES.length);
  assert.deepEqual(
    pts.map((p) => p.id),
    FACTOR_MAXES.map((f) => f.id),
  );
});
