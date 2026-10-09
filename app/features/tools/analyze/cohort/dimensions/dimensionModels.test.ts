// The dimension pages' pure models (WP4), over the REAL engine fixtures and small hand-built cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { CohortMember, CohortView } from "../cohortTypes.ts";
import { absentGroups, makeStops, pctOn, ratedOn, shortName, stepMember } from "./dimensionModel.ts";
import { fitGap, fitModel, type FitRow } from "./fitModel.ts";
import { skillRows, skillsModel } from "./skillsModel.ts";
import { educationOf, experienceModel, laneOf, MIN_GAP_PCT, stackMarks, yearsAxis, type ExperienceMark } from "./experienceModel.ts";
import { groupSignals, probesFor, signalsModel } from "./signalsModel.ts";
import { humanCode, trustModel } from "./trustModel.ts";
import { median, niceScale, salaryModel } from "./salaryModel.ts";
import { languageBar, publicWorkModel } from "./publicWorkModel.ts";

const read = (name: string): CohortView => JSON.parse(fs.readFileSync(new URL(`../../../../../../public/dev/cohort/${name}`, import.meta.url), "utf8")) as CohortView;
const done = read("cohort20.done.json");
const running = read("cohort20.running.json");
const byLabel = (v: CohortView, label: string) => v.members.find((m) => m.label === label)!;

// ---- shared ------------------------------------------------------------------------

test("shortName: blind letter, initials of first+last word, never empty", () => {
  assert.equal(shortName("Candidate C"), "C");
  assert.equal(shortName("Klára Blažková"), "KB");
  assert.equal(shortName("Jan van der Berg"), "JB");
  assert.equal(shortName("Madonna"), "M");
  assert.equal(shortName("  "), "?");
});

test("stepMember: starts at an end, holds at the ends, never wraps", () => {
  const ids = ["a", "b", "c"];
  assert.equal(stepMember(ids, null, 1), "a");
  assert.equal(stepMember(ids, null, -1), "c");
  assert.equal(stepMember(ids, "b", 1), "c");
  assert.equal(stepMember(ids, "c", 1), "c");
  assert.equal(stepMember(ids, "a", -1), "a");
  assert.equal(stepMember(ids, "zz", 1), "a");
  assert.equal(stepMember([], "a", 1), null);
});

test("makeStops: the first slot per member is its stop, and a slot's answer never changes", () => {
  const stops = makeStops();
  assert.equal(stops("a", "row"), true);
  assert.equal(stops("a", "rest"), false);
  assert.equal(stops("a", "row"), true, "asked again (a child's second render) the slot keeps its answer");
  assert.equal(stops("b", "rest"), true);
  assert.equal(stops("b", "rest"), true);
});

test("ratedOn / absentGroups: every member lands in exactly one of rated, pending, absent", () => {
  for (const v of [done, running]) {
    for (const d of ["fit", "skills", "trust", "publicWork"] as const) {
      const rated = ratedOn(v, d).length;
      const pending = v.members.filter((m) => m.cells[d].absentReason === "pending").length;
      const absent = absentGroups(v, d).reduce((a, g) => a + g.members.length, 0);
      assert.equal(rated + pending + absent, v.members.length, `${d}`);
    }
  }
  assert.equal(pctOn(5, 0, 10), 50);
  assert.equal(pctOn(50, 0, 10), 100);
  assert.equal(pctOn(3, 3, 3), 50);
});

// ---- fit ---------------------------------------------------------------------------

const row = (id: string, rating: number, lo: number, hi: number): FitRow =>
  ({ member: { memberId: id } as CohortMember, rank: null, rating, lo, hi, drivers: [] });

test("fit geometry: strict separation, the same rule the engine claims by", () => {
  const clears = fitGap([row("a", 90, 84, 96), row("b", 70, 64, 76)]);
  assert.deepEqual(clears, { kind: "clears", leaderId: "a", runnerId: "b", from: 76, to: 84, width: 8 });
  const touching = fitGap([row("a", 82, 76, 88), row("b", 70, 64, 76)]);
  assert.equal(touching.kind, "overlap", "bands that merely touch do not clear");
  assert.equal(touching.kind === "overlap" && touching.width, 0);
  const noise = fitGap([row("a", 96, 88, 100), row("b", 93, 80, 100)]);
  assert.deepEqual(noise, { kind: "overlap", leaderId: "a", runnerId: "b", from: 88, to: 100, width: 12 });
  assert.deepEqual(fitGap([row("a", 90, 84, 96)]), { kind: "none" });
});

test("fit model over the fixtures agrees with the claim and keeps every member", () => {
  for (const v of [done, running]) {
    const m = fitModel(v);
    const sep = v.claims.byDimension.fit.separation;
    assert.equal(m.gap.kind, sep === "clears" ? "clears" : sep === "insideNoise" ? "overlap" : "none");
    assert.equal(m.rows.length, v.claims.byDimension.fit.rated);
    assert.equal(m.rows.length + m.pending.length + m.absent.reduce((a, g) => a + g.members.length, 0), v.members.length);
    for (const r of m.rows) assert.ok(r.lo <= r.rating && r.rating <= r.hi);
    assert.ok(m.scale.min <= Math.min(...m.rows.map((r) => r.lo)) && m.scale.ticks.at(-1) === 100);
  }
  assert.equal(fitModel(running).pending.length, 12);
  assert.deepEqual(fitModel(done).absent.map((g) => g.reason), ["failed"]);
});

// ---- skills ------------------------------------------------------------------------

test("skills: the row union is case-insensitive and the discriminating skills sort first", () => {
  const a = { memberId: "a", neutralIndex: 0, detail: { skills: { dimension: "skills", matched: ["Java", "Kafka"], missing: ["Oracle"], unproven: [], extra: [] } } } as unknown as CohortMember;
  const b = { memberId: "b", neutralIndex: 1, detail: { skills: { dimension: "skills", matched: ["java"], missing: ["oracle", "Kafka"], unproven: ["Docker"], extra: [] } } } as unknown as CohortMember;
  const rows = skillRows([a, b]);
  assert.deepEqual(rows.map((r) => r.key), ["oracle", "kafka", "docker", "java"]);
  assert.equal(rows[0].label, "Oracle", "the first spelling met is kept");
  assert.deepEqual(rows[2].marks, { a: "unlisted", b: "unproven" });
  assert.equal(rows[3].matched, 2);
});

test("skills model over the fixtures: 6 skills, every member a column, rated columns first", () => {
  const m = skillsModel(done);
  assert.equal(m.columns.length, 20);
  assert.equal(m.rows.length, 6);
  assert.equal(m.rows.at(-1)!.missing <= m.rows[0].missing, true);
  const ratedCols = m.columns.filter((c) => c.cells.skills.rating != null).length;
  assert.ok(m.columns.slice(ratedCols).every((c) => c.cells.skills.rating == null));
  assert.deepEqual(m.extra["analysis-cand-000"], ["Microservices", "REST APIs", "Docker"]);
  const r = skillsModel(running);
  assert.equal(r.columns.length, 20, "pending members stay as columns");
});

// ---- experience --------------------------------------------------------------------

test("experience: lanes and education normalise; the axis holds everyone", () => {
  assert.equal(laneOf("Senior"), "senior");
  assert.equal(laneOf("medior"), "medior");
  assert.equal(laneOf("Tech Lead"), "lead");
  assert.equal(laneOf(null), "unknown");
  assert.equal(educationOf("master"), "master");
  assert.equal(educationOf("PhD"), "phd");
  assert.equal(educationOf("unknown"), "unknown");
  assert.deepEqual(yearsAxis([3, 11, null]).max, 15);
  assert.deepEqual(yearsAxis([]).max, 10);
});

test("experience: marks closer than the gap never share a sub-row", () => {
  const mk = (id: string, x: number, i: number): ExperienceMark =>
    ({ member: { memberId: id, neutralIndex: i } as CohortMember, rating: 50, years: x, lane: "senior", education: "master", x, stack: 0 });
  const out = stackMarks([mk("a", 60, 0), mk("b", 60, 1), mk("c", 62, 2), mk("d", 90, 3)]);
  const s = Object.fromEntries(out.map((m) => [m.member.memberId, m.stack]));
  assert.deepEqual(s, { a: 0, b: 1, c: 2, d: 0 });
  const m = experienceModel(done);
  for (const lane of m.lanes) {
    const marks = m.marks.filter((x) => x.lane === lane.lane);
    for (const p of marks) for (const q of marks) if (p !== q && p.stack === q.stack) assert.ok(Math.abs((p.x ?? 0) - (q.x ?? 0)) >= MIN_GAP_PCT);
  }
  assert.equal(m.marks.length, 18);
  assert.deepEqual(m.lanes.map((l) => l.lane), ["senior", "junior"]);
});

// ---- signals -----------------------------------------------------------------------

test("signals: grouped by label across members, weighted by confidence, probes kept", () => {
  const m = signalsModel(done);
  const banking = m.strengths.find((r) => r.key === "regulated-banking delivery")!;
  assert.equal(banking.carriers.length, 8);
  assert.equal(banking.carriers[0].confidence, 0.8, "the heaviest carrier first");
  assert.ok(m.strengths[0].carriers.length >= m.strengths.at(-1)!.carriers.length);
  assert.ok(m.antipatterns.every((r) => r.kind === "antipattern"));
  const klara = byLabel(done, "Klára Blažková").memberId;
  assert.deepEqual(probesFor(m, klara).map((p) => p.kind), ["strength", "strength"]);
  assert.deepEqual(m.absent.map((g) => g.reason), ["notRead", "failed"]);
  const twice = { memberId: "x", neutralIndex: 0, detail: { signals: { dimension: "signals", strengths: [{ label: "A", detail: "1", probe: null, confidence: null }, { label: "a ", detail: "2", probe: "p", confidence: 0.9 }], antipatterns: [] } } } as unknown as CohortMember;
  const rows = groupSignals([twice], "strength");
  assert.equal(rows[0].carriers.length, 1);
  assert.equal(rows[0].carriers[0].probe, "p");
  assert.equal(rows[0].weight, 0.9);
});

// ---- trust -------------------------------------------------------------------------

test("trust: one row per code, blockers first, clean stated, not-read never clean", () => {
  const m = trustModel(done);
  assert.equal(m.flagged[0].code, "duplicate_text");
  assert.equal(m.flagged[0].severity, "blocker");
  assert.equal(m.flagged.length, 5);
  assert.equal(m.clean.length, 11);
  const notRead = m.absent.find((g) => g.reason === "notRead")!;
  assert.equal(notRead.members.length, 2);
  assert.ok(notRead.members.every((x) => !m.clean.includes(x)));
  assert.equal(humanCode("employment_overlap"), "Employment overlap");
  assert.equal(trustModel(running).pending.length, 12);
});

// ---- salary ------------------------------------------------------------------------

test("salary: partitions are separate rulers, never converted; the rated one comes first", () => {
  const m = salaryModel(done);
  assert.deepEqual(m.rulers.map((r) => [r.key, r.comparable, r.rows.length]), [["CZK/month", true, 16], ["EUR/month", false, 2]]);
  const czk = m.rulers[0];
  assert.equal(czk.basis, "role");
  assert.equal(czk.window, null, "the role band's edges are not in the view: nothing is shaded");
  assert.ok(czk.rows.every((r, i) => i === 0 || czk.rows[i - 1].mid <= r.mid), "ordered by figure, low to high");
  assert.equal(czk.rows.find((r) => r.member.label === "Adam Malý")!.inBand, false);
  assert.equal(czk.rows.find((r) => r.member.label === "Klára Blažková")!.inBand, true);
  assert.ok(czk.scale.min <= Math.min(...czk.rows.map((r) => r.min)) && czk.scale.max >= Math.max(...czk.rows.map((r) => r.max)));
  assert.equal(m.rulers[1].basis, "none");
  assert.deepEqual(m.absent.map((g) => g.reason), ["failed"]);
  assert.deepEqual(niceScale(46750, 193200), { min: 0, max: 200000, ticks: [0, 50000, 100000, 150000, 200000] });
  assert.deepEqual(niceScale(3060, 7130), { min: 3000, max: 8000, ticks: [3000, 4000, 5000, 6000, 7000, 8000] });
  assert.equal(niceScale(5, 5).max > niceScale(5, 5).min, true, "a flat partition still gets a span");
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test("salary: a cohort-median basis shades the +/-15% window", () => {
  const v = structuredClone(done);
  for (const mem of v.members) if (mem.cells.salary.label.key === "cells.salaryBand") mem.cells.salary.label.key = "cells.salaryCohort";
  const czk = salaryModel(v).rulers[0];
  assert.equal(czk.basis, "cohort");
  assert.ok(czk.window && Math.abs(czk.window.hi / czk.window.median - 1.15) < 1e-9);
  assert.ok(czk.rows.every((r) => r.inBand === null));
});

// ---- public work -------------------------------------------------------------------

test("public work: cards for read GitHub, the remainder grouped by reason in reading order", () => {
  const m = publicWorkModel(done);
  assert.deepEqual(m.cards.map((c) => c.member.label), ["Klára Blažková", "David Kříž", "Vít Malý"]);
  assert.deepEqual(m.remainder.map((g) => [g.reason, g.note ?? null, g.members.length]), [
    ["notTechnical", null, 3],
    ["noLink", null, 1],
    ["notRead", null, 10],
    ["failed", "readFailed", 1],
    ["failed", null, 2],
  ], "a failed GitHub read is never called a failed analysis");
  assert.equal(m.cards.length + m.remainder.reduce((a, g) => a + g.members.length, 0), 20);
  const bar = languageBar([{ name: "A", percent: 50 }, { name: "B", percent: 20 }, { name: "C", percent: 10 }, { name: "D", percent: 10 }, { name: "E", percent: 6 }, { name: "F", percent: 4 }, { name: "Z", percent: 0 }]);
  assert.deepEqual(bar.languages.map((l) => l.name), ["A", "B", "C", "D"]);
  assert.equal(bar.other, 10);
});
