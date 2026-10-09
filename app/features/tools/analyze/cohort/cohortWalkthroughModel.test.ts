import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  narrativeWithheld,
  pendingShape,
  planFor,
  simSchedule,
  simView,
  SIM_FIRST_FRESH_AT,
  SIM_LAST_FRESH_AT,
  SIM_REUSED_AT,
  type SimOutcome,
  type WalkthroughFixture,
  type WalkthroughRun,
} from "./cohortWalkthroughModel.ts";
import { addMember, freshEstimate, memberFromPopulation, populationOffer, removeMember, runRequest, trayFromProposal, trayIsFull } from "./cohortProposalEdits.ts";
import { COHORT_CAP, type CohortRunRequest, type CohortView } from "./cohortTypes.ts";

const read = <T,>(name: string): T => JSON.parse(fs.readFileSync(new URL(`../../../../../public/dev/cohort/${name}`, import.meta.url), "utf8")) as T;
const done = read<CohortView>("cohort20.done.json");
const running = read<CohortView>("cohort20.running.json");
const fx = read<WalkthroughFixture>("walkthrough.json");
const java = fx.proposals[done.jdSlug];

const roster = (spec: Array<[string, SimOutcome]>) => spec.map(([memberId, outcome]) => ({ memberId, outcome }));
const runOf = (request: CohortRunRequest): WalkthroughRun => ({ done, pending: pendingShape(running), request });
const proposalRequest = (blind = false) => runRequest(java.jdSlug, trayFromProposal(java), { blind, reportLang: "en" });

// ---- the schedule ----------------------------------------------------------------

test("reused members land first, together, before any fresh one", () => {
  const plan = simSchedule(roster([["a", "done"], ["r1", "reused"], ["b", "failed"], ["r2", "reused"], ["c", "done"]]), { reducedMotion: false });
  const at = new Map(plan.entries.map((e) => [e.memberId, e]));
  assert.equal(at.get("r1")!.landAt, SIM_REUSED_AT);
  assert.equal(at.get("r2")!.landAt, SIM_REUSED_AT);
  for (const id of ["a", "b", "c"]) assert.ok(at.get(id)!.landAt > SIM_REUSED_AT, id);
});

test("the schedule is deterministic and independent of the tray order", () => {
  const spec: Array<[string, SimOutcome]> = done.members.map((m) => [m.memberId, m.runState === "reused" ? "reused" : m.runState === "failed" ? "failed" : "done"]);
  const a = simSchedule(roster(spec), { reducedMotion: false });
  const b = simSchedule(roster(spec), { reducedMotion: false });
  const c = simSchedule(roster([...spec].reverse()), { reducedMotion: false });
  assert.deepEqual(a, b);
  const landing = (p: typeof a) => Object.fromEntries(p.entries.map((e) => [e.memberId, e.landAt]));
  assert.deepEqual(landing(a), landing(c));
});

test("fresh members land a few at a time across the window, the run settling inside ~8-12 s", () => {
  const plan = planFor(runOf(proposalRequest()), { reducedMotion: false });
  const fresh = plan.entries.filter((e) => e.outcome !== "reused");
  const byTime = new Map<number, number>();
  for (const e of fresh) byTime.set(e.landAt, (byTime.get(e.landAt) ?? 0) + 1);
  assert.ok([...byTime.values()].every((n) => n >= 1 && n <= 3), "batches of 1-3");
  assert.ok(byTime.size >= 4, "several beats, not one");
  assert.equal(Math.min(...fresh.map((e) => e.landAt)), SIM_FIRST_FRESH_AT);
  assert.equal(Math.max(...fresh.map((e) => e.landAt)), SIM_LAST_FRESH_AT);
  assert.ok(plan.doneAt >= 8000 && plan.doneAt <= 12000, `done at ${plan.doneAt}`);
  // The batch about to land is analyzing; the clock ticks at every change and never before 0.
  for (const e of fresh) assert.ok(e.startAt < e.landAt);
  assert.deepEqual(plan.beats, [...plan.beats].sort((x, y) => x - y));
  assert.ok(plan.beats.every((t) => t > 0) && plan.beats.at(-1) === plan.doneAt);
});

test("reduced motion lands everyone at once and is done at once: no clock at all", () => {
  const plan = planFor(runOf(proposalRequest()), { reducedMotion: true });
  assert.deepEqual(plan.beats, []);
  assert.equal(plan.doneAt, 0);
  assert.ok(plan.entries.every((e) => e.startAt === 0 && e.landAt === 0));
  const view = simView(runOf(proposalRequest()), plan, 0);
  assert.equal(view.status, "done");
  assert.ok(view.members.every((m) => m.runState !== "queued" && m.runState !== "analyzing"));
});

// ---- the view at a moment ---------------------------------------------------------

test("at Start every member is drawn pending; at the end each takes its finished-fixture state", () => {
  const run = runOf(proposalRequest());
  const plan = planFor(run, { reducedMotion: false });
  const first = simView(run, plan, 0);
  assert.equal(first.status, "running");
  assert.equal(first.members.length, 16);
  assert.ok(first.members.every((m) => m.runState === "queued" || m.runState === "analyzing"));
  assert.ok(first.members.every((m) => m.cells.fit.absentReason === "pending" && m.analysisSlug === null));
  assert.equal(first.progress.done, 0);

  const last = simView(run, plan, plan.doneAt);
  assert.equal(last.status, "done");
  const fixed = new Map(done.members.map((m) => [m.memberId, m]));
  for (const m of last.members) {
    const f = fixed.get(m.memberId)!;
    assert.equal(m.runState, f.runState, m.memberId);
    assert.deepEqual(m.cells, f.cells, m.memberId);
  }
  // 16 seated: one reused, one applicant whose analysis fails (the other failure sits in the population).
  assert.deepEqual(last.progress, { total: 16, done: 15, reused: 1, failed: 1 });
});

test("the neutral order never moves while members land (the world does not reflow)", () => {
  const run = runOf(proposalRequest());
  const plan = planFor(run, { reducedMotion: false });
  const order = (at: number) => Object.fromEntries(simView(run, plan, at).members.map((m) => [m.memberId, m.neutralIndex]));
  const start = order(0);
  for (const beat of plan.beats) assert.deepEqual(order(beat), start, `beat ${beat}`);
});

test("removed members are absent and claims never name someone not drawn", () => {
  const tray = removeMember(trayFromProposal(java), "analysis-cand-000");
  const run = runOf(runRequest(java.jdSlug, tray, { blind: false, reportLang: "en" }));
  const view = simView(run, planFor(run, { reducedMotion: true }), 0);
  const ids = new Set(view.members.map((m) => m.memberId));
  assert.ok(!ids.has("analysis-cand-000"));
  for (const c of Object.values(view.claims.byDimension)) if (c.leader) assert.ok(ids.has(c.leader), c.dimension);
  for (const m of view.members) if (m.decoyOf) assert.ok(ids.has(m.decoyOf), m.memberId);
  assert.ok(view.members.every((m) => m.fitRank === null || m.fitRank <= view.members.length));
});

test("the full fixture set reproduces the finished fixture's claims, narrative and notes; any other set withholds them", () => {
  let tray = trayFromProposal(java);
  for (const row of fx.population) tray = addMember(tray, memberFromPopulation(row)!).tray;
  const full = runOf(runRequest(java.jdSlug, tray, { blind: false, reportLang: "en" }));
  const view = simView(full, planFor(full, { reducedMotion: true }), 0);
  assert.equal(view.members.length, COHORT_CAP);
  assert.deepEqual(view.claims, done.claims);
  assert.deepEqual(view.narrative, done.narrative);
  assert.equal(narrativeWithheld(full), false);
  const byId = new Map(done.members.map((m) => [m.memberId, m]));
  for (const m of view.members) {
    const f = byId.get(m.memberId)!;
    assert.deepEqual([m.neutralIndex, m.fitRank, m.decoyOf], [f.neutralIndex, f.fitRank, f.decoyOf], m.memberId);
  }

  const partial = runOf(proposalRequest());
  const pv = simView(partial, planFor(partial, { reducedMotion: true }), 0);
  assert.equal(pv.narrative, null);
  assert.ok(Object.values(pv.claims.byDimension).every((c) => c.note === undefined));
  assert.equal(narrativeWithheld(partial), true);
});

test("a blind run shows letters, reads no GitHub, and withholds the named narrative", () => {
  const run = runOf(proposalRequest(true));
  const view = simView(run, planFor(run, { reducedMotion: true }), 0);
  assert.equal(view.blind, true);
  assert.ok(view.members.every((m) => /^Candidate [A-Z]$/.test(m.label)), "letters by neutral order");
  for (const m of view.members) {
    if (m.runState === "failed") continue;
    assert.equal(m.cells.publicWork.absentReason, "blind", m.memberId);
    assert.equal(m.detail.publicWork, null);
  }
  assert.equal(view.narrative, null);
});

test("a hand-added member keeps the membership the tray gave it", () => {
  const row = fx.population.find((r) => r.key === "profile:cand-048")!;
  const tray = addMember(trayFromProposal(java), memberFromPopulation(row)!).tray;
  const run = runOf(runRequest(java.jdSlug, tray, { blind: false, reportLang: "en" }));
  const m = simView(run, planFor(run, { reducedMotion: true }), 0).members.find((x) => x.memberId === "profile:cand-048")!;
  assert.equal(m.membership, "added");
  assert.equal(m.runState, "reused");
});

// ---- tray edits in walkthrough mode -------------------------------------------------

test("the walkthrough tray: 16 proposed, one reused; removing and putting back keep the rule", () => {
  const tray = trayFromProposal(java);
  assert.equal(tray.members.length, 16);
  assert.deepEqual(freshEstimate(tray), { fresh: 15, reused: 1, upperBound: false });
  const out = removeMember(tray, "profile:cand-012");
  assert.deepEqual(freshEstimate(out), { fresh: 15, reused: 0, upperBound: false });
  const back = addMember(out, out.removed[0]).tray;
  assert.equal(back.members.at(-1)!.membership, "matched");
  assert.deepEqual(freshEstimate(back), { fresh: 15, reused: 1, upperBound: false });
});

test("the population fills the tray to the cap of 20, then the cap refuses", () => {
  let tray = trayFromProposal(java);
  assert.equal(populationOffer(fx.population, tray, "").length, fx.population.length);
  for (const row of fx.population) {
    const r = addMember(tray, memberFromPopulation(row)!);
    assert.equal(r.refused, null);
    tray = r.tray;
  }
  assert.equal(tray.members.length, COHORT_CAP);
  assert.ok(trayIsFull(tray));
  assert.equal(populationOffer(fx.population, tray, "").length, 0, "everyone is seated");
  // A hand-added member's reuse is the server's call: the estimate says "at most".
  assert.deepEqual(freshEstimate(tray), { fresh: 19, reused: 1, upperBound: true });
  const stranger = memberFromPopulation({ key: "x", source: "analysis", slug: "x", id: null, name: "X", seniority: null, analyses: [] })!;
  assert.equal(addMember(tray, stranger).refused, "cap");
});
