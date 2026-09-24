// A `JourneyBoard` that exercises every state the board can draw.
//
// Derived from the contest corpus (.contest/arena/journey-analytics/data/
// journeys.json + SCHEMA.md) — the role titles, candidate names, event kinds,
// actor strings, stage vocabulary and the label-only analysis join are all taken
// from there — but RESHAPED to the real contract in `app/_lib/journey/types.ts`,
// which the contest export predates. Two differences matter and are the reason
// this is hand-built rather than dumped:
//
//   • the contest rows carry a pre-baked English `text`; the real ones carry
//     `kind` + `facts` and are rendered per locale, so every row here has facts
//     instead of prose;
//   • the contest had no `rail` at all (the runner-up derived its own), and the
//     real payload has the server derive it, so the rails below are written out
//     the way the projector is contracted to emit them.
//
// `GET /api/journeys` does not exist in this tree yet (P1 builds it in
// parallel), so this file is what the board's tests run against. It is a TEST
// fixture: nothing in the shipped board imports it.

import type {
  JourneyBoard,
  JourneyColumn,
  JourneyEvent,
  JourneyRailStep,
  RoleCluster,
} from "@/app/_lib/journey/types";

const T = (day: number, hour = 9): string =>
  new Date(Date.UTC(2026, 0, day, hour, 0, 0)).toISOString();

function ev(
  id: string,
  kind: string,
  phase: JourneyEvent["phase"],
  day: number,
  actor: string | null,
  extra: Partial<JourneyEvent> = {}
): JourneyEvent {
  return {
    id,
    phase,
    kind,
    facts: {},
    occurredAt: T(day),
    recordedAt: T(day),
    actor,
    sourceRef: { table: "pipeline_events", id },
    ...extra,
  };
}

function step(index: number, phase: JourneyRailStep["phase"], kind: string, extra: Partial<JourneyRailStep> = {}): JourneyRailStep {
  return { index, phase, kind, reached: 3, cohort: 4, byMachine: 2, ...extra };
}

/* ── Cluster A: a full role, with every honesty state in it ───────────────── */

const SHARED_A: JourneyEvent[] = [
  ev("sh-a-1", "intake_round", "job-definition", 2, "human:requestor", { topicCode: "role-shape" }),
  ev("sh-a-2", "intake_round", "job-definition", 2, "human:requestor", { topicCode: "backfill-reason" }),
  // 11 days later — the shared band gets a silence row too.
  ev("sh-a-3", "intake_round", "job-definition", 13, "human:requestor", { topicCode: "salary-band" }),
];

const RAIL_A: JourneyRailStep[] = [
  step(0, "job-definition", "intake_round", { topicCode: "role-shape", reached: 45, cohort: 45, byMachine: 0 }),
  step(1, "job-definition", "intake_round", { topicCode: "backfill-reason", reached: 45, cohort: 45, byMachine: 0 }),
  step(2, "job-definition", "intake_round", { topicCode: "salary-band", reached: 45, cohort: 45, byMachine: 0 }),
  step(3, "case", "case_published", { reached: 2, cohort: 4, byMachine: 1 }),
  step(4, "case", "case_submitted", { reached: 1, cohort: 4, byMachine: 0 }),
  step(5, "screening", "analysis", { reached: 3, cohort: 4, byMachine: 3 }),
  step(6, "screening", "acknowledgement_sent", { reached: 3, cohort: 4, byMachine: 3 }),
  step(7, "screening", "screening_hold", { reached: 2, cohort: 4, byMachine: 0 }),
  step(8, "screening", "advanced", { reached: 1, cohort: 4, byMachine: 0 }),
];

/** Reached every step; a label-only analysis, an unidentified actor, and an
 *  8-day silence between the analysis and the acknowledgement. */
const COL_FULL: JourneyColumn = {
  entryId: "pe-011",
  candidateLabel: "Aneta Veselá",
  stage: "Interview",
  active: true,
  matchScore: 63,
  locale: "cs",
  origin: { kind: "live" },
  phases: {
    "job-definition": { present: false, absenceReasonKey: "absence.intakeMissing" },
    // The record says why: this role runs no work-sample case.
    case: { present: false, absenceReasonKey: "absence.caseNotRun" },
    screening: { present: true },
  },
  events: [
    ev("e-011-1", "analysis", "screening", 1, "auto:analyze", {
      facts: { score: 76 },
      confidence: "label-only",
      sourceRef: { table: "analyses", id: "an-011" },
    }),
    ev("e-011-2", "acknowledgement_sent", "screening", 9, "auto:comms"),
    ev("e-011-3", "screening_hold", "screening", 11, "human:recruiter"),
    // actor null — kp genuinely does not know who advanced this candidate.
    ev("e-011-4", "advanced", "screening", 13, null, { facts: { to: "Interview" } }),
  ],
};

/** Stopped after the acknowledgement: rows 7 and 8 are its never-reached tail,
 *  and its `case` band has an absence reason no catalog can resolve. */
const COL_STOPPED: JourneyColumn = {
  entryId: "pe-012",
  candidateLabel: "Petr Svoboda",
  stage: "Rejected",
  active: false,
  matchScore: 41,
  locale: "cs",
  origin: { kind: "live" },
  phases: {
    "job-definition": { present: false, absenceReasonKey: "absence.intakeMissing" },
    case: { present: false, absenceReasonKey: "absence.aReasonNobodyTranslated" },
    screening: { present: true },
  },
  events: [
    ev("e-012-1", "analysis", "screening", 1, "auto:analyze", { facts: { score: 52 } }),
    ev("e-012-2", "acknowledgement_sent", "screening", 2, "auto:comms"),
  ],
};

/** A /uat L2 run: real rows against a real database, none of them live traffic.
 *  Its screening band is `allGenerated`; it SKIPS the acknowledgement rung and
 *  goes on anyway; and its `case` band is the contradiction types.ts names —
 *  `present: true` carrying no rows at all. */
const COL_TEST_RUN: JourneyColumn = {
  entryId: "pe-013",
  candidateLabel: "Uat Walker",
  stage: "Screened",
  active: true,
  matchScore: null,
  locale: "en",
  origin: { kind: "test-run", runId: "uat-2026-09-20" },
  phases: {
    "job-definition": { present: false, absenceReasonKey: "absence.intakeMissing" },
    case: { present: true },
    screening: { present: true },
  },
  events: [
    ev("e-013-1", "analysis", "screening", 3, "auto:analyze", { facts: { score: 70 } }),
    // no acknowledgement_sent: rung 1 of the screening band is a SKIP, not an end
    ev("e-013-3", "screening_hold", "screening", 4, "human:recruiter"),
  ],
};

/** Nothing on file anywhere, and a reason for each phase. */
const COL_EMPTY: JourneyColumn = {
  entryId: "pe-014",
  candidateLabel: "Jana Králová",
  stage: "Screened",
  active: true,
  matchScore: null,
  locale: "cs",
  origin: { kind: "live" },
  phases: {
    "job-definition": { present: false, absenceReasonKey: "absence.intakeMissing" },
    case: { present: false, absenceReasonKey: "absence.caseNotAssigned" },
    screening: { present: false, absenceReasonKey: "absence.screeningNotRecorded" },
  },
  events: [],
};

export const CLUSTER_A: RoleCluster = {
  jobId: "job-a",
  title: "Senior Java Backend Engineer",
  // The record DOES carry an area for this one; cluster B's is null, which is
  // the state the role picker must group as "other roles" rather than invent a
  // bucket for.
  roleArea: "Engineering",
  openedAt: T(1),
  sharedEvents: SHARED_A,
  // The intake conversation is not linked to this role in the record, so the
  // band that spans the cohort is a weaker claim than it looks.
  sharedEventsUnlinked: true,
  rail: RAIL_A,
  columns: [COL_FULL, COL_STOPPED, COL_TEST_RUN, COL_EMPTY],
  totalColumns: 45,
};

/* ── Cluster B: a short rail, so the global band padding gets exercised ───── */

export const CLUSTER_B: RoleCluster = {
  jobId: "job-b",
  title: "Junior Risk Data Analyst",
  roleArea: null,
  openedAt: T(4),
  sharedEvents: [ev("sh-b-1", "intake_round", "job-definition", 4, "human:requestor", { topicCode: "role-title" })],
  sharedEventsUnlinked: false,
  rail: [
    step(0, "job-definition", "intake_round", { topicCode: "role-title", reached: 7, cohort: 7, byMachine: 0 }),
    step(1, "screening", "analysis", { reached: 1, cohort: 1, byMachine: 1 }),
  ],
  columns: [
    {
      entryId: "pe-090",
      candidateLabel: "Sam Okafor",
      stage: "Offer",
      active: true,
      matchScore: 81,
      locale: "en",
      origin: { kind: "live" },
      phases: {
        "job-definition": { present: false, absenceReasonKey: "absence.intakeMissing" },
        case: { present: false, absenceReasonKey: "absence.caseNotRun" },
        screening: { present: true },
      },
      events: [ev("e-090-1", "analysis", "screening", 5, "auto:analyze", { facts: { score: 81 } })],
    },
  ],
  totalColumns: 7,
};

export const journeyBoardFixture: JourneyBoard = {
  clusters: [CLUSTER_A, CLUSTER_B],
  query: { activeOnly: false, limit: 120, offset: 0 },
  totals: { roles: 2, columns: 5, events: 9 },
};

/**
 * A board the size the contest was judged at: 4 roles, 99 columns, ~1,100
 * events. Used to check that planning stays proportional to the EVENTS rather
 * than to columns x rows — see journeyLayout.test.ts.
 */
export function makeWideBoard(roleCount = 4, columnsPerRole = 25): JourneyBoard {
  const clusters: RoleCluster[] = [];
  for (let r = 0; r < roleCount; r++) {
    const columns: JourneyColumn[] = [];
    for (let c = 0; c < columnsPerRole; c++) {
      const base = [COL_FULL, COL_STOPPED, COL_TEST_RUN, COL_EMPTY][c % 4];
      columns.push({
        ...base,
        entryId: `r${r}-c${c}`,
        candidateLabel: `${base.candidateLabel} ${r}-${c}`,
        events: base.events.map((event) => ({ ...event, id: `r${r}-c${c}-${event.id}` })),
      });
    }
    clusters.push({
      ...CLUSTER_A,
      jobId: `job-${r}`,
      title: `Role ${r}`,
      sharedEvents: SHARED_A.map((event) => ({ ...event, id: `r${r}-${event.id}` })),
      columns,
      totalColumns: columnsPerRole,
    });
  }
  const events = clusters.reduce(
    (sum, cluster) => sum + cluster.columns.reduce((n, column) => n + column.events.length, 0),
    0
  );
  return {
    clusters,
    query: { activeOnly: false, limit: 500, offset: 0 },
    totals: { roles: roleCount, columns: roleCount * columnsPerRole, events },
  };
}

/** The catalogs really hold these; `absence.aReasonNobodyTranslated` really does
 *  not. Passed to `planBoard` as its `hasKey`. */
export const CATALOG_KEYS = new Set([
  "absence.caseNotRun",
  "absence.caseNotAssigned",
  "absence.caseNotLinked",
  "absence.screeningNotRecorded",
  "absence.intakeMissing",
  "absence.nothingHappened",
  "absence.neverRecorded",
]);

export const hasCatalogKey = (key: string): boolean => CATALOG_KEYS.has(key);
