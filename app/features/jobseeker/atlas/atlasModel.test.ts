import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PREFERENCES, type JobseekerPostingSummary, type JobseekerPreferences } from "@/app/_lib/jobseeker/types";
import { deriveSieve } from "../sieve/sieveModel";
import { aperture, lockOf, polar, rimLayout, rOf, rotFor, sectorsFor, skyLayout, SK, wantsSet } from "./atlasModel";

// The Atlas's two promises: the dome opens on exactly the wants that steer the search, and a
// posting is drawn where its score puts it - or on the rim when it never reached one.

function row(id: string, over: Partial<JobseekerPostingSummary> = {}): JobseekerPostingSummary {
  return {
    id, sourceId: "on", externalKey: id, url: "https://example.invalid/" + id, title: id, company: null, location: null, country: null,
    workMode: null, postedAt: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null, jobSource: null,
    matchTotal: null, fitTier: null, matchVersion: null, matchedAt: null, status: "new", dismissReason: null, dismissNote: null,
    appliedAt: null, firstSeenAt: "2026-09-20T00:00:00Z", lastSeenAt: "2026-09-24T00:00:00Z", goneAt: null, bodyChars: 1,
    eligibility: [], confidence: null, blockedBy: [], blockedDetails: [], asIfTotal: null, matchedSkills: [], missingSkills: [], deepDived: false, previousTotal: null, reasoningStale: false, targetAlignment: null, skillsStated: true, directionTotal: null,
    ...over,
  };
}

const full: JobseekerPreferences = {
  ...EMPTY_PREFERENCES,
  locations: ["Brno"],
  salaryFloor: { amount: 60000, currency: "CZK", period: "month" },
  targetTitles: ["Frontend Engineer"],
  workModes: ["hybrid"],
  seniority: "medior",
};

test("a floor without a currency (or an amount) is not a set want", () => {
  assert.equal(wantsSet({ ...full, salaryFloor: { amount: 60000, currency: "", period: "month" } }).pay, false);
  assert.equal(wantsSet({ ...full, salaryFloor: { amount: 0, currency: "CZK", period: "month" } }).pay, false);
  assert.equal(wantsSet(full).pay, true);
  assert.equal(wantsSet(null).places, false);
});

test("the gate: no CV, then a CV with wants missing, then ready - languages never hold it shut", () => {
  assert.equal(lockOf(false, wantsSet(null)).gate, "no-cv");
  const half = lockOf(true, wantsSet({ ...full, salaryFloor: null, workModes: [] }));
  assert.equal(half.gate, "cv-in");
  assert.deepEqual(half.missing, ["pay", "modes"]);
  assert.equal(half.n, 3);
  const ready = lockOf(true, wantsSet(full));
  assert.equal(ready.gate, "ready");
  assert.equal(wantsSet(full).languages, false, "languages are not set here");
  assert.equal(ready.missing.length, 0);
});

test("the iris: shut without a CV, wider with each want, gone when ready", () => {
  const a = (n: number) => aperture({ gate: "cv-in", n, total: 5, missing: [] });
  assert.equal(aperture({ gate: "no-cv", n: 0, total: 5, missing: [] }), 0);
  assert.ok(a(1) < a(3) && a(3) < a(4));
  assert.ok(aperture({ gate: "ready", n: 5, total: 5, missing: [] }) > SK.RH);
});

test("sectors add up to 360 degrees, widest source first, none under its floor", () => {
  const rows = [...Array.from({ length: 30 }, (_, i) => row(`a${i}`, { sourceId: "big" })), ...Array.from({ length: 2 }, (_, i) => row(`b${i}`, { sourceId: "small" }))];
  const secs = sectorsFor(rows);
  assert.equal(secs[0]!.key, "big");
  assert.ok(Math.abs(secs.reduce((n, s) => n + s.span, 0) - 360) < 1e-9);
  assert.ok(secs.every((s) => s.span >= 18));
  assert.deepEqual(sectorsFor([]), []);
});

test("a star sits at the radius its score gives it, inside its own sector, and never moves", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`s${i}`, { sourceId: i % 2 ? "x" : "y", matchTotal: 20 + i * 6, fitTier: "partial" }));
  const facts = deriveSieve(rows, [{ id: "x", enabled: true, pausedReason: null }, { id: "y", enabled: true, pausedReason: null }]);
  const one = skyLayout(rows, facts.scored);
  const two = skyLayout(rows, facts.scored);
  assert.deepEqual(one, two, "same rows, same sky");
  for (const r of facts.scored) {
    const m = one.marks[r.id]!;
    assert.ok(m.star, r.id);
    const dist = Math.hypot(m.star![0] - SK.C, m.star![1] - SK.C);
    // The relaxation moves a star along its arc, never in or out.
    assert.ok(Math.abs(dist - rOf(r.matchTotal!)) < 0.5, `${r.id}: ${dist} vs ${rOf(r.matchTotal!)}`);
    const sec = one.sectors.find((s) => s.key === m.sector)!;
    let ang = (Math.atan2(m.star![1] - SK.C, m.star![0] - SK.C) * 180) / Math.PI;
    while (ang < sec.start) ang += 360;
    assert.ok(ang >= sec.start - 0.01 && ang <= sec.end + 0.01, `${r.id} inside ${sec.key}`);
  }
  assert.ok(rOf(90) < rOf(10), "a better score sits nearer the centre");
});

test("an unscored row has a scatter place and no star - never a zero score", () => {
  const rows = [row("g", { blockedBy: ["work_mode"] }), row("w"), row("s", { matchTotal: 50, fitTier: "partial" })];
  const facts = deriveSieve(rows, [{ id: "on", enabled: true, pausedReason: null }]);
  const sky = skyLayout(rows, facts.scored);
  assert.equal(sky.marks.g!.star, null);
  assert.equal(sky.marks.w!.star, null);
  assert.ok(sky.marks.s!.star);
});

test("the rim carries every gated, held and waiting row once, on the circle, even at 1,500 held", () => {
  const rows = [
    ...Array.from({ length: 1500 }, (_, i) => row(`h${i}`, { sourceId: "off" })),
    ...Array.from({ length: 40 }, (_, i) => row(`g${i}`, { blockedBy: i % 5 === 0 ? ["work_mode", "language"] : ["work_mode"] })),
    ...Array.from({ length: 7 }, (_, i) => row(`w${i}`)),
  ];
  const facts = deriveSieve(rows, [{ id: "on", enabled: true, pausedReason: null }, { id: "off", enabled: false, pausedReason: null }]);
  const rim = rimLayout(facts);
  const placed = Object.keys(rim.pos);
  assert.equal(placed.length, 1500 + 40 + 7);
  assert.equal(new Set(placed).size, placed.length);
  for (const [x, y] of Object.values(rim.pos)) assert.ok(Math.abs(Math.hypot(x - SK.C, y - SK.C) - SK.RIM) < 0.01);
  const kinds = rim.groups.map((g) => g.kind);
  assert.deepEqual(kinds.slice(-2), ["held", "wait"]);
  assert.equal(rim.groups.find((g) => g.kind === "gate")!.total, 40, "a two-gate row is counted on its first gate only when drawn, total is the gate's count");
  assert.equal(rim.groups.find((g) => g.key === "held")!.rows.length, 1500);
});

test("labels read upright: never rotated past a quarter turn", () => {
  for (let d = -180; d <= 540; d += 7) assert.ok(Math.abs(rotFor(d)) <= 90 + 1e-9, String(d));
  const [x, y] = polar(100, 90);
  assert.ok(Math.abs(x - SK.C) < 1e-9 && y > SK.C);
});
