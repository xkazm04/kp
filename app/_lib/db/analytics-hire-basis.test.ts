// UAT KAT-ANA-4 — ONE BASIS PER PER-HIRE FIGURE.
//
// pipelineAnalytics used to run three windowing bases at once and divide them into
// each other:
//
//   creation cohort  `hired`      — entries CREATED in the window, terminal today
//   event time       `kindCounts` — events that HAPPENED in the window (ROI numerator)
//   ledger time      `computeCost`— llm_usage rows stamped in the window
//
// The two per-hire figures took an event/ledger-time NUMERATOR and a creation-cohort
// DENOMINATOR. Those populations diverge by exactly the time-to-hire, so on any role
// whose time-to-hire exceeds the window, a full window of work was amortised over a
// fraction of its hires. The code comment above the division asserted the opposite
// ("both same-window → honest"), which is why it survived review.
//
// This file reproduces the defect on the shape the Character hit — a 44-day
// time-to-hire inside a 30-day window — and pins the fix. The arithmetic is chosen so
// the two bases give recognisable numbers: $62.40 of ledger cost over 6 hires closed
// in the window is $10.40/hire (honest) and $62.40/hire (cohort, wrong by 6×).
//
// (testing/unit-db.ts must be the first project import — see that module's header.)
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pipelineAnalytics } from "./analytics.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;
const WS = "hire-basis-ws";
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

/** A hire: an entry created `createdDaysAgo` ago that reached the terminal stage
 *  `closedDaysAgo` ago, with the transition event the real board writes. */
function hire(id: string, createdDaysAgo: number, closedDaysAgo: number) {
  const { entry } = createPipelineEntry({
    candidateId: id,
    candidateLabel: id,
    jobId: "basis-job",
    jobTitle: "Role",
    stage: "Hired",
    workspaceId: WS,
  });
  const db = ensureDb();
  db.prepare(`UPDATE pipeline_entries SET created_at = ?, stage_changed_at = ? WHERE id = ?`).run(
    iso(createdDaysAgo * DAY),
    iso(closedDaysAgo * DAY),
    entry.id
  );
  // The terminal transition itself — what "a hire happened" actually looks like in the
  // event trail. Matched by ROLE downstream, never by the literal name "Hired" (G8).
  db.prepare(
    `INSERT INTO pipeline_events (entry_id, candidate_label, job_title, kind, from_stage, to_stage, created_at, workspace_id)
     VALUES (?, ?, 'Role', 'advanced', 'Offer', 'Hired', ?, ?)`
  ).run(entry.id, id, iso(closedDaysAgo * DAY), WS);
}

/** `n` automated actions of one kind, all inside the window. */
function automatedActions(kind: string, n: number, daysAgo: number) {
  const stmt = ensureDb().prepare(
    `INSERT INTO pipeline_events (entry_id, job_title, kind, created_at, workspace_id) VALUES (NULL, 'Role', ?, ?, ?)`
  );
  const at = iso(daysAgo * DAY);
  for (let i = 0; i < n; i += 1) stmt.run(kind, at, WS);
}

// The whole corpus, built once: 6 hires that CLOSED inside the last 30 days, of which
// only ONE was also CREATED inside them (time-to-hire 44 days for the other five).
test("setup — a 44-day time-to-hire inside a 30-day window", () => {
  for (let i = 0; i < 5; i += 1) hire(`slow-${i}`, 44, 2);
  hire("fast-0", 10, 1);
  // 120 × interview_prep_generated (25 min each) = 3000 min = 50 h of saved labor.
  automatedActions("interview_prep_generated", 120, 5);
  // $62.40 of metered compute in the same window, in six equal calls.
  const usage = ensureDb().prepare(
    `INSERT INTO llm_usage (ts, use_case, provider, model, cost_usd, source) VALUES (?, 'jobfit', 'test', 'test-model', ?, 'test')`
  );
  for (let i = 0; i < 6; i += 1) usage.run(iso(3 * DAY), 10.4);
});

test("the two hire counts are DIFFERENT populations, and both are reported", () => {
  const a = pipelineAnalytics(30, undefined, WS);
  assert.equal(a.hired, 1, "creation cohort: only the fast hire was CREATED in the window");
  assert.equal(a.hiresClosedInWindow, 6, "event time: all six CLOSED in the window");
  // Neither is wrong — they answer different questions. The defect was dividing an
  // event-time numerator by the cohort count while claiming one window.
  assert.equal(a.total, 1, "the cohort figures keep their existing meaning");
});

test("automation ROI divides by hires CLOSED in the window, not the cohort", () => {
  const a = pipelineAnalytics(30, undefined, WS);
  assert.equal(a.automationRoi.hoursSaved, 50, "120 prep packs × 25 min = 50 h");
  assert.equal(a.automationRoi.hires, 6, "the denominator is the closed-in-window count");
  assert.equal(a.automationRoi.hoursSavedPerHire, 8.3, "50 h / 6 hires");
  // 8.333 / 42 = 19.8% → 20. On the old cohort basis this was 50 h / 1 hire = 119% of
  // the manual baseline, which Math.min(100, …) then rendered as a clean, believable
  // "100%" — the exact shape the Character reported at 437%.
  assert.equal(a.automationRoi.pctOfManualBaseline, 20);
});

test("compute cost per hire divides ledger-time cost by closed-in-window hires", () => {
  const a = pipelineAnalytics(30, undefined, WS);
  assert.ok(a.computeCost, "the window holds metered calls");
  assert.equal(a.computeCost.costUsd, 62.4);
  assert.equal(a.computeCost.hires, 6, "the denominator travels with the figure");
  assert.equal(a.computeCost.costPerHireUsd, 10.4, "$62.40 / 6 — was $62.40 / 1 on the cohort basis");
});

test("the compute basis names its own period, so a reader can tell it from Billing's", () => {
  const windowed = pipelineAnalytics(30, undefined, WS);
  assert.equal(windowed.computeCost?.windowDays, 30);
  const allTime = pipelineAnalytics(undefined, undefined, WS);
  assert.equal(allTime.computeCost?.windowDays, null, "all time says so rather than saying nothing");
});

test("all-time needs no second basis — every hire is in cohort and in the trail", () => {
  const a = pipelineAnalytics(undefined, undefined, WS);
  assert.equal(a.hired, 6);
  assert.equal(a.hiresClosedInWindow, a.hired, "the two bases cannot differ with no window");
});

test("a window with no closed hire reports no per-hire figure rather than a huge one", () => {
  // A workspace with no hires at all: removing the cap must not turn an empty
  // denominator into an infinity, only an uncapped-but-real ratio.
  const a = pipelineAnalytics(30, undefined, "hire-basis-empty-ws");
  assert.equal(a.hiresClosedInWindow, 0);
  assert.equal(a.automationRoi.hoursSavedPerHire, null);
  assert.equal(a.automationRoi.pctOfManualBaseline, null);
});
