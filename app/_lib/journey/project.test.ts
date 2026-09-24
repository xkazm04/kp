// Behavioural coverage for the journey projection, against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import).
//
// WHAT IS PINNED HERE, and why each one is a defect that has actually happened:
//
//   1. THE PHASE INVARIANT. `phases[x].present` must be DERIVED from the rows the
//      projector emitted for that phase. The contest's staged material shipped 22
//      journeys flagged `screening.present: false` while carrying screening rows;
//      the winning prototype found it before we did. So the test does not check a
//      hand-written expectation — it recomputes the flag from the payload and fails
//      if the two can EVER disagree, on every column the board produces.
//   2. THE IDENTITY CONTRACT. A same-named stranger on a DIFFERENT role must not
//      leak into a column, and a match with no job axis must carry
//      `confidence: "label-only"` so the board can never render it as certain.
//   3. NO PROSE ON THE WIRE. A journey row is `kind` + `facts`; the sentence is
//      rendered per locale. The payload is serialized and searched for the English
//      the catalogs own.
//   4. TWO CLOCKS, NEVER INVENTED. Both are always set, and every instant on a row
//      must be an instant that exists in the source row it came from.
//   5. skipped ≠ never-reached. Three shapes: a column missing a MIDDLE step, a
//      column that ENDS EARLY, and a column that has everything.
//   6. THE SHARED BAND, all three of its states: a database with the `intake_events`
//      table actually DROPPED degrades to an honest empty band rather than a throw; a
//      linked intake fills the band and flips job-definition present on every column
//      of the cluster; a TITLE-only match fills it but flags itself as the weaker
//      claim it is.
//   7. THE APPROVAL WRITE. setApproval now records its own event, and the detail
//      prefix the projector decodes is pinned against pipeline.ts's SOURCE.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  actOnPipelineEntry,
  createPipelineEntry,
  listPipelineEventsForEntry,
  recordAutomationEvent,
  setApproval,
} from "../db/pipeline.ts";
import { saveAnalysis } from "../db/analyses.ts";
import { ensureDb } from "../db/core.ts";
import { createIntake, markIntakePromoted } from "../db/intakes.ts";
import { recordIntakeEvent } from "../db/intake-events.ts";
import { sealDecisionRecord } from "../decision-record-store.ts";
import {
  APPROVAL_SET_DETAIL_PREFIX,
  journeyBoard,
  journeyColumn,
  journeyEntryView,
  journeyEventDetail,
  journeyPhaseEvidence,
  journeyRail,
  railCellState,
} from "./project.ts";
import { JOURNEY_PHASE_IDS, type JourneyColumn, type JourneyEvent, type JourneyRailStep } from "./types.ts";
import { journeyAnalysisAttachment, journeyStepKey } from "./identity.ts";

after(() => cleanupUnitDb());

const HERE = dirname(fileURLToPath(import.meta.url));
const WS = "workspace";

let seq = 0;
function addEntry(overrides: Partial<Parameters<typeof createPipelineEntry>[0]> = {}) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `jrn-c${seq}`,
    candidateLabel: `Journey Tester ${seq}`,
    jobId: `jrn-job-${seq}`,
    jobTitle: `Journey Role ${seq}`,
    ...overrides,
  });
  return entry;
}

/** Every column the board produced, across every cluster. */
function allColumns(board: ReturnType<typeof journeyBoard>): JourneyColumn[] {
  return board.clusters.flatMap((c) => c.columns);
}

// ── 1. the phase invariant ───────────────────────────────────────────────────

test("phases[x].present can never disagree with the events emitted for that phase", () => {
  // A cohort deliberately built so all three phases and both absent states occur:
  // a candidate with a full screening trail, one with nothing but the `added` row
  // the store writes on creation, and one that was rejected.
  const busy = addEntry({ jobId: "jrn-invariant", jobTitle: "Invariant Role" });
  actOnPipelineEntry(busy.id, "accept");
  setApproval(busy.id, "calendar", "Tue 14:00");
  // A third entry with no activity at all: the assertion below counts three columns,
  // and this one is the case where every phase must report itself absent WITH a reason.
  addEntry({ jobId: "jrn-invariant", jobTitle: "Invariant Role" });
  const closed = addEntry({ jobId: "jrn-invariant", jobTitle: "Invariant Role" });
  actOnPipelineEntry(closed.id, "reject", "no fit");

  const board = journeyBoard({ workspaceId: WS, role: "jrn-invariant", limit: 50 });
  assert.equal(allColumns(board).length, 3, "all three columns of the cluster are on one page");

  for (const cluster of board.clusters) {
    for (const column of cluster.columns) {
      for (const phase of JOURNEY_PHASE_IDS) {
        const evidence = journeyPhaseEvidence(column, phase, cluster.sharedEvents);
        const state = column.phases[phase];
        assert.equal(
          state.present,
          evidence.length > 0,
          `${column.entryId}/${phase}: present=${state.present} but ${evidence.length} rows were emitted`
        );
        if (!state.present) {
          assert.match(
            state.absenceReasonKey,
            /^journey\.absence\.[a-zA-Z]+$/,
            "an absent phase carries an i18n KEY, never a sentence"
          );
        }
      }
    }
  }
});

test("the invariant holds the OTHER way too: a phase flagged present has rows behind it", () => {
  const entry = addEntry({ jobId: "jrn-present", jobTitle: "Present Role" });
  const column = journeyColumn(entry.id, WS);
  assert.ok(column, "the column resolves");
  assert.equal(column.phases.screening.present, true, "creation wrote an `added` row, so screening happened");
  assert.ok(
    column.events.some((e) => e.phase === "screening" && e.kind === "added"),
    "…and that row is on the column, not merely counted"
  );
  // The two phases with no writer in this fixture are absent WITH A REASON, and the
  // two reasons are different facts.
  assert.equal(column.phases["job-definition"].present, false);
  assert.equal(column.phases.case.present, false);
  const jobDef = column.phases["job-definition"];
  const caseState = column.phases.case;
  assert.equal(jobDef.present === false && jobDef.absenceReasonKey, "journey.absence.intakeMissing");
  assert.equal(
    caseState.present === false && caseState.absenceReasonKey,
    "journey.absence.caseNotRun",
    "this role runs no work-sample case — a different fact from one that was never assigned"
  );
});

// ── 2. the identity contract ─────────────────────────────────────────────────

test("a same-named person analysed for a DIFFERENT role does not leak into the column", () => {
  const label = "Ambiguous Namesake";
  // A JD-BACKED entry: `jd-<slug>` gives the join a job axis to confirm against.
  const entry = addEntry({ candidateId: "jrn-dup-a", candidateLabel: label, jobId: "jd-alpha", jobTitle: "Alpha Role" });
  saveAnalysis({ candidateLabel: label, jdSlug: "alpha", score: 71, roleFamily: null, seniority: null, payload: {} }, WS);
  saveAnalysis({ candidateLabel: label, jdSlug: "beta", score: 12, roleFamily: null, seniority: null, payload: {} }, WS);

  const column = journeyColumn(entry.id, WS);
  assert.ok(column);
  const analyses = column.events.filter((e) => e.kind === "analysis");
  assert.equal(analyses.length, 1, "only the analysis for THIS role attaches");
  assert.equal(analyses[0].facts.score, 71, "…and it is the right one");
  assert.equal(analyses[0].confidence, undefined, "the job axis confirmed it — no reduced-confidence caveat");
});

test("an analysis matched by label ALONE carries confidence: label-only", () => {
  const label = "Corpus Only Candidate";
  // A CORPUS job (no `jd-` prefix) has no jd_slug, so there is no job axis and the
  // strongest claim the data supports is a name match.
  const entry = addEntry({ candidateId: "jrn-lbl", candidateLabel: label, jobId: "jrn-corpus-1", jobTitle: "Corpus Role" });
  saveAnalysis({ candidateLabel: label, jdSlug: null, score: 55, roleFamily: null, seniority: null, payload: {} }, WS);

  const column = journeyColumn(entry.id, WS);
  const analysis = column?.events.find((e) => e.kind === "analysis");
  assert.ok(analysis, "the analysis still attaches — a weaker claim is not no claim");
  assert.equal(analysis.confidence, "label-only", "…but it is never presented as certain");
});

test("the identity rule itself is the one candidate-timeline.ts enforces inline", () => {
  // The rule lifted into identity.ts, checked against the four states it decides.
  assert.equal(
    journeyAnalysisAttachment({ entryLabel: "A", entryJdSlug: "x", analysisLabel: "a", analysisJdSlug: "x" }),
    "confirmed"
  );
  assert.equal(
    journeyAnalysisAttachment({ entryLabel: "A", entryJdSlug: "x", analysisLabel: "a", analysisJdSlug: "y" }),
    "none",
    "a JD-backed entry REQUIRES the job axis to agree"
  );
  assert.equal(
    journeyAnalysisAttachment({ entryLabel: "A", entryJdSlug: null, analysisLabel: "a", analysisJdSlug: "y" }),
    "label-only",
    "no job axis ⇒ reduced confidence, never a refusal"
  );
  assert.equal(
    journeyAnalysisAttachment({ entryLabel: "  ", entryJdSlug: null, analysisLabel: "  ", analysisJdSlug: null }),
    "none",
    "a blank label is not an identity — two nameless rows are not the same person"
  );
});

// ── 3. no prose on the wire ──────────────────────────────────────────────────

test("nothing in a board payload is a rendered sentence", () => {
  const entry = addEntry({ jobId: "jrn-prose", jobTitle: "Prose Role", candidateLabel: "Prose Probe" });
  actOnPipelineEntry(entry.id, "accept");
  setApproval(entry.id, "scorecard_review", JSON.stringify({ recommendation: "review" }));
  const board = journeyBoard({ workspaceId: WS, role: "jrn-prose", limit: 50 });
  const columns = allColumns(board);
  assert.ok(columns.length > 0, "non-vacuity: the fixture produced a column");

  // The catalogs own these sentences. If one appears in the payload, some writer
  // composed prose instead of emitting a kind plus facts.
  const CATALOG_PROSE = [
    "Candidate advanced to",
    "Approval was set to",
    "Candidate was added to the board",
    "Screening was never recorded",
    "Nothing happened here",
  ];
  const serialized = JSON.stringify(board);
  for (const sentence of CATALOG_PROSE) {
    assert.ok(!serialized.includes(sentence), `the payload carries a rendered sentence: "${sentence}"`);
  }

  // And structurally: every event is a kind plus a fact bag, with no free-text field
  // the renderer would be tempted to print instead of its own catalog string.
  for (const event of columns.flatMap((c) => c.events)) {
    const keys = Object.keys(event);
    for (const banned of ["text", "label", "message", "sentence", "description"]) {
      assert.ok(!keys.includes(banned), `event ${event.id} carries a "${banned}" field — that is a stored sentence`);
    }
    assert.equal(typeof event.kind, "string");
    assert.equal(typeof event.facts, "object");
  }
});

// ── 4. two clocks, never invented ────────────────────────────────────────────

test("both clocks are always set, and neither is a time the source row does not hold", () => {
  const entry = addEntry({ jobId: "jrn-clocks", jobTitle: "Clock Role" });
  actOnPipelineEntry(entry.id, "accept");
  setApproval(entry.id, "calendar", "Tue 14:00");
  sealDecisionRecord(
    {
      kind: "auto_rejected",
      actor: "auto:screen-wave",
      policyVersion: "test-v1",
      candidateRef: entry.id,
      rationale: "below the floor",
      reasonCode: "reject",
      inputs: { score: 11 },
    },
    WS
  );

  const column = journeyColumn(entry.id, WS);
  assert.ok(column);
  assert.ok(column.events.length >= 3, "non-vacuity: the fixture produced rows from three sources");

  // The ONLY timestamps in the tree are the ones the rows were written with. There is
  // no source of "now" in the projection at all — so a fabricated clock would have to
  // come from Date.now() inside project.ts, and this pins that it does not.
  const stored = new Set<string>([
    ...listPipelineEventsForEntry(entry.id, 50, WS).map((e) => e.createdAt),
  ]);
  for (const event of column.events) {
    assert.ok(event.occurredAt, `${event.id} has no occurredAt`);
    assert.ok(event.recordedAt, `${event.id} has no recordedAt`);
    assert.doesNotThrow(() => new Date(event.occurredAt).toISOString());
    if (event.sourceRef.table === "pipeline_events") {
      assert.ok(stored.has(event.occurredAt), `${event.id} occurredAt is not the stored created_at`);
      assert.equal(event.recordedAt, event.occurredAt, "one stored timestamp ⇒ both clocks take it");
    }
  }
});

test("events are sorted by (occurredAt, id) and actor travels through INCLUDING null", () => {
  const entry = addEntry({ jobId: "jrn-order", jobTitle: "Order Role" });
  actOnPipelineEntry(entry.id, "accept");
  const column = journeyColumn(entry.id, WS);
  assert.ok(column);
  const sorted = [...column.events].sort((a, b) =>
    a.occurredAt === b.occurredAt ? a.id.localeCompare(b.id) : a.occurredAt.localeCompare(b.occurredAt)
  );
  assert.deepEqual(column.events.map((e) => e.id), sorted.map((e) => e.id));
  for (const event of column.events) {
    assert.ok(event.actor === null || typeof event.actor === "string", `${event.id} dropped its actor field`);
  }
  assert.ok(
    column.events.some((e) => e.actor === null),
    "a writer that cannot name an actor reads as null — a fact, never a missing key"
  );
});

// ── 5. the rail, and skipped vs never-reached ────────────────────────────────

/** A synthetic column: the rail and its cell states are pure functions of the
 *  payload, so they are driven directly rather than through a DB fixture. */
function fakeColumn(entryId: string, kinds: string[]): JourneyColumn {
  const events: JourneyEvent[] = kinds.map((kind, i) => ({
    id: `pipeline_events:${entryId}-${i}`,
    phase: "screening",
    kind,
    facts: {},
    occurredAt: `2026-01-0${i + 1}T00:00:00.000Z`,
    recordedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
    actor: kind === "auto_advanced" ? "auto:screen-wave" : null,
    sourceRef: { table: "pipeline_events", id: `${entryId}-${i}` },
  }));
  return {
    entryId,
    candidateLabel: entryId,
    stage: "Screened",
    active: true,
    matchScore: null,
    locale: "en",
    origin: { kind: "live" },
    phases: {
      "job-definition": { present: false, absenceReasonKey: "journey.absence.intakeMissing" },
      case: { present: false, absenceReasonKey: "journey.absence.caseNotRun" },
      screening: events.length > 0 ? { present: true } : { present: false, absenceReasonKey: "journey.absence.screeningNotRecorded" },
    },
    events,
  };
}

test("the rail is derived from what actually happened, ordered by median first occurrence", () => {
  const full = fakeColumn("full", ["added", "matched", "advanced", "offer_sent"]);
  const middle = fakeColumn("middle", ["added", "advanced", "offer_sent"]);
  const early = fakeColumn("early", ["added", "matched"]);
  const rail = journeyRail([full, middle, early]);

  assert.deepEqual(
    rail.map((s) => s.kind),
    ["added", "matched", "advanced", "offer_sent"],
    "one column skipping a step must not reorder the cohort's rail"
  );
  assert.deepEqual(rail.map((s) => s.index), [0, 1, 2, 3], "indices are positions, assigned after the sort");
  const matched = rail.find((s) => s.kind === "matched")!;
  assert.equal(matched.reached, 2, "two of the three columns took this step");
  assert.equal(matched.cohort, 3, "…out of the three the rail was derived from");
  assert.equal(rail.find((s) => s.kind === "added")!.byMachine, 0, "no `auto:` actor on these rows");
});

test("byMachine counts the columns whose take was automated, and null is NOT automation", () => {
  const machine = fakeColumn("machine", ["added", "auto_advanced"]);
  const human = fakeColumn("human", ["added", "auto_advanced"]);
  human.events[1] = { ...human.events[1], actor: "human:Petra Nováková" };
  const unknown = fakeColumn("unknown", ["added", "auto_advanced"]);
  unknown.events[1] = { ...unknown.events[1], actor: null };
  const rail = journeyRail([machine, human, unknown]);
  const step = rail.find((s) => s.kind === "auto_advanced")!;
  assert.equal(step.reached, 3);
  assert.equal(step.byMachine, 1, "an unidentified actor is not credited to the machine (guardrail G3)");
});

test("railCellState: present, skipped (a MIDDLE step), never-reached (the journey ENDED)", () => {
  const full = fakeColumn("full", ["added", "matched", "advanced", "offer_sent"]);
  const middle = fakeColumn("middle", ["added", "advanced", "offer_sent"]);
  const early = fakeColumn("early", ["added", "matched"]);
  const rail = journeyRail([full, middle, early]);
  const step = (kind: string): JourneyRailStep => rail.find((s) => s.kind === kind)!;

  // A column that has everything: every cell is present.
  for (const s of rail) assert.equal(railCellState(full, s, rail), "present", `full/${s.kind}`);

  // A column missing a MIDDLE step: the journey went on without it.
  assert.equal(railCellState(middle, step("added"), rail), "present");
  assert.equal(railCellState(middle, step("matched"), rail), "skipped", "it has a LATER step — the journey went on");
  assert.equal(railCellState(middle, step("advanced"), rail), "present");
  assert.equal(railCellState(middle, step("offer_sent"), rail), "present");

  // A column that ENDS EARLY: no later step, so the journey stopped here.
  assert.equal(railCellState(early, step("added"), rail), "present");
  assert.equal(railCellState(early, step("matched"), rail), "present");
  assert.equal(railCellState(early, step("advanced"), rail), "never-reached", "nothing later — it ended before here");
  assert.equal(railCellState(early, step("offer_sent"), rail), "never-reached");
});

test("skipped and never-reached are distinguishable for the SAME step in two columns", () => {
  // The whole point of the concept: at rail row 2 one column says "we went on
  // without it" and the other says "we stopped". If these ever collapse into one
  // value the board's funnel becomes a lie.
  const full = fakeColumn("full", ["added", "matched", "advanced", "offer_sent"]);
  const middle = fakeColumn("middle", ["added", "advanced", "offer_sent"]);
  const early = fakeColumn("early", ["added", "matched"]);
  const rail = journeyRail([full, middle, early]);
  const advanced = rail.find((s) => s.kind === "advanced")!;
  assert.notEqual(railCellState(middle, advanced, rail), railCellState(early, advanced, rail));
});

test("a topic-driven round is its own rail step, not collapsed onto its kind", () => {
  const a = fakeColumn("a", ["interview_round"]);
  a.events[0] = { ...a.events[0], topicCode: "salary-band" };
  const b = fakeColumn("b", ["interview_round"]);
  b.events[0] = { ...b.events[0], topicCode: "tech-stack" };
  assert.notEqual(journeyStepKey(a.events[0]), journeyStepKey(b.events[0]));
  assert.equal(journeyRail([a, b]).length, 2, "two topics are two steps of the process");
});

// ── 6. a missing intake_events table ─────────────────────────────────────────

/** The exact DDL db/core.ts:1126 installs, so the drop-and-restore below leaves the
 *  process's throwaway DB byte-identical to how it found it. */
const INTAKE_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS intake_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intake_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    topic_code TEXT,
    facts_json TEXT,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    actor TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_intake_events_intake ON intake_events (intake_id, seq);
  CREATE INDEX IF NOT EXISTS idx_intake_events_ws ON intake_events (workspace_id, occurred_at);
`;

test("a database with NO intake_events table degrades to an honest empty band, never a throw", () => {
  // The table is created by a DIFFERENT package's migration. It may genuinely not be
  // there — an older DB file, a deploy where that migration has not landed — and the
  // board must not 500 for the whole workspace because one band cannot be drawn.
  // Proven by actually removing it rather than by asserting an empty band that would
  // be empty anyway; the table is restored immediately, on the same connection.
  const db = ensureDb();
  const entry = addEntry({ jobId: "jrn-band", jobTitle: "Band Role" });
  db.exec("DROP TABLE IF EXISTS intake_events");
  try {
    const board = journeyBoard({ workspaceId: WS, role: "jrn-band", limit: 50 });
    const cluster = board.clusters[0];
    assert.ok(cluster, "the cluster still renders");
    assert.deepEqual(cluster.sharedEvents, [], "an empty band, not a fabricated one");
    assert.equal(cluster.sharedEventsUnlinked, false, "nothing was claimed, so nothing is claimed weakly");
    assert.equal(entry.id, cluster.columns[0].entryId);
    const jobDef = cluster.columns[0].phases["job-definition"];
    assert.equal(jobDef.present, false);
    assert.equal(
      jobDef.present === false && jobDef.absenceReasonKey,
      "journey.absence.intakeMissing",
      "…and the column says WHY, with a key"
    );
  } finally {
    db.exec(INTAKE_EVENTS_DDL);
  }
});

test("a role whose intake IS linked gets its band, and every column reports job-definition present", () => {
  const jobId = "jd-band-linked";
  const entry = addEntry({ candidateId: "jrn-band-1", candidateLabel: "Band Probe", jobId, jobTitle: "Linked Band Role" });
  const intake = createIntake({ title: "Linked Band Role" }, WS);
  markIntakePromoted(intake.id, { jdSlug: "band-linked", jobId }, WS);
  recordIntakeEvent({
    intakeId: intake.id,
    workspaceId: WS,
    kind: "intake_round",
    occurredAt: "2026-01-01T09:00:00.000Z",
    topicCode: "salary-band",
    facts: { band: "80-95k" },
    actor: "human:Requestor",
  });

  const board = journeyBoard({ workspaceId: WS, role: jobId, limit: 50 });
  const cluster = board.clusters[0];
  assert.ok(cluster);
  assert.equal(cluster.sharedEvents.length, 1, "the role's conversation is drawn once, above the columns");
  assert.equal(cluster.sharedEventsUnlinked, false, "role_intakes.job_id links it — a strong claim");
  const row = cluster.sharedEvents[0];
  assert.equal(row.phase, "job-definition");
  assert.equal(row.kind, "intake_round");
  assert.equal(row.topicCode, "salary-band", "a placed round renders through its TOPIC, not its kind");
  assert.equal(row.actor, "human:Requestor");
  assert.equal(row.facts.band, "80-95k");
  // TWO REAL COLUMNS — this is the one source that has them, and they must not collapse.
  assert.equal(row.occurredAt, "2026-01-01T09:00:00.000Z", "the turn's own `at`");
  assert.notEqual(row.recordedAt, row.occurredAt, "…and when kp wrote it down, which is later");

  const column = cluster.columns.find((c) => c.entryId === entry.id);
  assert.ok(column);
  assert.equal(column.phases["job-definition"].present, true, "the band IS this column's job-definition evidence");
  assert.deepEqual(
    column.events.filter((e) => e.phase === "job-definition"),
    [],
    "…and it is NOT duplicated onto the column: the conversation belongs to the ROLE"
  );
});

test("an intake matched only by TITLE is a weaker claim, and the band says so", () => {
  const jobId = "jrn-band-titled";
  addEntry({ candidateId: "jrn-band-2", candidateLabel: "Title Band Probe", jobId, jobTitle: "Titled Band Role" });
  // No job_id, no jd_slug on the intake — the only thing tying it to the role is that
  // somebody typed the same title. That is a guess, and the board must present it as one.
  const intake = createIntake({ title: "Titled Band Role" }, WS);
  recordIntakeEvent({
    intakeId: intake.id,
    workspaceId: WS,
    kind: "intake_round",
    occurredAt: "2026-01-02T09:00:00.000Z",
  });

  const cluster = journeyBoard({ workspaceId: WS, role: jobId, limit: 50 }).clusters[0];
  assert.ok(cluster);
  assert.equal(cluster.sharedEvents.length, 1);
  assert.equal(cluster.sharedEventsUnlinked, true, "a spanning band is a CLAIM, and an unlinked one is a weaker claim");
  assert.equal(cluster.sharedEvents[0].topicCode, undefined, "a round the classifier could not place is a legitimate row");
});

// ── 7. the approval write ────────────────────────────────────────────────────

test("setApproval records its own event, in the same transaction as the update", () => {
  const entry = addEntry({ jobId: "jrn-approval", jobTitle: "Approval Role" });
  const before = listPipelineEventsForEntry(entry.id, 50, WS).length;
  assert.equal(setApproval(entry.id, "screening_review", JSON.stringify({ recommendation: "advance" })), true);
  const events = listPipelineEventsForEntry(entry.id, 50, WS);
  assert.equal(events.length, before + 1, "the state change is no longer silent");
  const raised = events.at(-1)!;
  assert.equal(raised.kind, "approval_set");
  assert.equal(raised.detail, "approval:screening_review", "WHICH gate was raised travels on the row");
  assert.equal(raised.actor, null, "this store has no request identity — null, never an invented person");
});

test("clearing an approval writes NO second row, and a refused CAS write writes none either", () => {
  const entry = addEntry({ jobId: "jrn-approval-2", jobTitle: "Approval Role 2" });
  setApproval(entry.id, "offer_review", "{}");
  const afterRaise = listPipelineEventsForEntry(entry.id, 50, WS).length;

  // A clear is always accompanied by the decision that caused it, which logs its own
  // event — a second row here would double-count one moment in the audit trail.
  assert.equal(setApproval(entry.id, null, "", WS), true);
  assert.equal(listPipelineEventsForEntry(entry.id, 50, WS).length, afterRaise, "a clear adds no row");

  // A stale compare-and-swap must not write the event for a write that did not apply.
  setApproval(entry.id, "calendar", "Tue 14:00");
  const afterCalendar = listPipelineEventsForEntry(entry.id, 50, WS).length;
  assert.equal(setApproval(entry.id, "scorecard_review", "{}", WS, { expectedApprovalKind: "offer_review" }), false);
  assert.equal(
    listPipelineEventsForEntry(entry.id, 50, WS).length,
    afterCalendar,
    "a refused write leaves the log exactly as it was"
  );
});

test("the projector decodes approval_set into facts.gate, which is what the catalog interpolates", () => {
  const entry = addEntry({ jobId: "jrn-approval-3", jobTitle: "Approval Role 3" });
  setApproval(entry.id, "calendar", "Tue 14:00");
  const column = journeyColumn(entry.id, WS);
  const row = column?.events.find((e) => e.kind === "approval_set");
  assert.ok(row, "the raised gate reaches the board");
  // `gate`, NOT `kind`. `kind` is reserved for `journey.events.unknown`, the one
  // message whose argument is the event's own kind; overloading one placeholder
  // with two meanings is what let an unmapped kind ship without its argument and
  // throw FORMATTING_ERROR on the first real board.
  assert.equal(row.facts.gate, "calendar", "`journey.events.approvalSet` interpolates {gate}");
  assert.equal(row.facts.kind, undefined, "a mapped kind never carries facts.kind");
  assert.equal(row.facts.detail, undefined, "the raw detail is decoded, not carried twice");
});

test("the approval detail prefix pipeline.ts WRITES is the one project.ts DECODES", () => {
  // The two literals are deliberately NOT shared by an import: db/pipeline.ts is on
  // nearly every route's import graph and must not grow an edge to the journey
  // module. A source pin is what keeps them honest instead — the same idiom
  // pipeline-approval-cas.test.ts already applies to this file.
  const src = readFileSync(resolve(HERE, "..", "db", "pipeline.ts"), "utf8").replace(/\r\n/g, "\n");
  const fn = src.slice(src.indexOf("export function setApproval"));
  const body = fn.slice(0, fn.indexOf("export function recordAutomationEvent"));
  assert.match(body, /return tx\.immediate\(\);/, "the approval read→write must lock at BEGIN");
  assert.match(body, /kind: "approval_set"/, "the write is still there");
  assert.match(
    body,
    new RegExp(`detail: \`${APPROVAL_SET_DETAIL_PREFIX}\\$\\{approvalKind\\}\``),
    `pipeline.ts must encode the gate behind "${APPROVAL_SET_DETAIL_PREFIX}" — project.ts decodes exactly that`
  );
});

// ── the board's own contract ─────────────────────────────────────────────────

test("totals describe the whole workspace, never the page", () => {
  const jobId = "jrn-totals";
  for (let i = 0; i < 5; i += 1) {
    addEntry({ candidateId: `jrn-tot-${i}`, candidateLabel: `Totals Probe ${i}`, jobId, jobTitle: "Totals Role" });
  }
  const page = journeyBoard({ workspaceId: WS, role: jobId, limit: 2, offset: 0 });
  assert.equal(allColumns(page).length, 2, "the page is a slice");
  assert.equal(page.totals.columns, 5, "…and the totals are not");
  assert.equal(page.totals.roles, 1);
  assert.ok(page.totals.events >= 5, "every entry's `added` row is counted");
  assert.equal(page.clusters[0].totalColumns, 5, "the cluster states its full size beside the slice");
  assert.deepEqual(page.query, { role: jobId, activeOnly: false, limit: 2, offset: 0 }, "the query is echoed back");

  const second = journeyBoard({ workspaceId: WS, role: jobId, limit: 2, offset: 2 });
  const firstIds = allColumns(page).map((c) => c.entryId);
  const secondIds = allColumns(second).map((c) => c.entryId);
  assert.deepEqual(
    firstIds.filter((id) => secondIds.includes(id)),
    [],
    "paging is stable — a column must not appear on two pages of one ordering"
  );
});

test("activeOnly filters terminal journeys out, and the unfiltered board keeps them", () => {
  const jobId = "jrn-active";
  const live = addEntry({ candidateId: "jrn-act-1", candidateLabel: "Still Running", jobId, jobTitle: "Active Role" });
  const done = addEntry({ candidateId: "jrn-act-2", candidateLabel: "Rejected Here", jobId, jobTitle: "Active Role" });
  actOnPipelineEntry(done.id, "reject", "no fit");

  const all = journeyBoard({ workspaceId: WS, role: jobId, limit: 50 });
  assert.equal(all.totals.columns, 2, "a journey that ends in a rejection is still a journey");
  const closed = allColumns(all).find((c) => c.entryId === done.id);
  assert.equal(closed?.active, false, "…and it is marked as no longer active");

  const activeOnly = journeyBoard({ workspaceId: WS, role: jobId, activeOnly: true, limit: 50 });
  assert.deepEqual(allColumns(activeOnly).map((c) => c.entryId), [live.id]);
  assert.equal(activeOnly.totals.columns, 1, "the totals honour the filter they were computed under");
});

test("a sealed decision reaches the candidate's own column, with its reason and its chain status", () => {
  const entry = addEntry({ jobId: "jrn-sealed", jobTitle: "Sealed Role", candidateLabel: "Sealed Probe" });
  sealDecisionRecord(
    {
      kind: "auto_rejected",
      actor: "auto:screen-wave",
      policyVersion: "policy-v9",
      candidateRef: entry.id,
      rationale: "Scored 11 against a floor of 55.",
      reasonCode: "reject",
      inputs: { score: 11, threshold: 55 },
    },
    WS
  );
  const view = journeyEntryView(entry.id, WS);
  assert.ok(view);
  const sealed = view.column.events.find((e) => e.kind === "decision_sealed");
  assert.ok(sealed, "the sealed chain now sits beside the stage moves, not only in an analytics panel");
  assert.equal(sealed.facts.reasonCode, "reject");
  assert.equal(sealed.facts.policyVersion, "policy-v9");
  assert.equal(sealed.actor, "auto:screen-wave", "a sealed record ALWAYS names an actor");
  assert.equal(typeof sealed.facts.chainOk, "boolean");
  assert.equal(typeof sealed.facts.chainKeyed, "boolean", "`ok` alone is not a security claim");

  // The second layer: the rationale is evidence, behind an explicit label key.
  const detail = journeyEventDetail(entry.id, sealed.id, WS);
  assert.ok(detail);
  assert.equal(detail.eventId, sealed.id);
  assert.equal(detail.card.actor, "auto:screen-wave");
  assert.equal(detail.card.occurredAt, sealed.occurredAt);
  assert.equal(detail.card.recordedAt, sealed.recordedAt);
  assert.equal(detail.source?.labelKey, "detail.sourceDecision");
  assert.equal(detail.source?.excerpt, "Scored 11 against a floor of 55.");
});

test("an unknown entry and another team's entry answer identically: null", () => {
  const entry = addEntry({ jobId: "jrn-tenant", jobTitle: "Tenant Role" });
  assert.equal(journeyColumn("no-such-entry", WS), null);
  assert.equal(journeyColumn(entry.id, "other-workspace"), null, "a cross-tenant probe learns nothing");
  assert.ok(journeyColumn(entry.id, WS), "…and the owning team still reads it");
});

test("an unknown source kind degrades to a kind fact, so the catalog's fallback can say something", () => {
  // `journey.events.unknown` renders "An event of kind {kind} was recorded", so a kind
  // render-keys.ts has never heard of MUST carry `facts.kind` or the fallback has
  // nothing to interpolate and the row renders blank. A NEW source kind arriving
  // before this module learns about it is the normal case, not an error.
  const entry = addEntry({ jobId: "jrn-unknown", jobTitle: "Unknown Role" });
  recordAutomationEvent(entry.id, "some_kind_this_module_has_never_heard_of", undefined, WS);
  const column = journeyColumn(entry.id, WS);
  assert.ok(column);
  const stranger = column.events.find((e) => e.kind === "some_kind_this_module_has_never_heard_of");
  assert.ok(stranger, "an unheard-of kind still reaches the board — it is not dropped");
  assert.equal(stranger.facts.kind, "some_kind_this_module_has_never_heard_of", "…carrying what the fallback interpolates");
  // …and a KNOWN kind does not carry the redundant fact, because its own message
  // already says what it is.
  const known = column.events.find((e) => e.kind === "added");
  assert.ok(known);
  assert.equal(known.facts.kind, undefined);
});
