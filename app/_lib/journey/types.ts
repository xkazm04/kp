// The wire contract for Journey Analytics — one cross-phase story per candidate,
// many of them side by side.
//
// WHY THIS SHAPE. A journey row is never a stored sentence. It is a `kind` plus
// structured `facts`, and the sentence is RENDERED per locale from an i18n key
// (see render-keys.ts). Two reasons, and both are load-bearing:
//
//   1. kp ships four locales and `i18n:check` pins every user-facing string to the
//      catalogs. A stored English sentence would ship English to cs/de/fr readers —
//      the same defect the `useErrorMessage()` work removed from 84 call sites.
//   2. A `kind` is countable across a cohort; a sentence is not. "How many
//      candidates were auto-rejected without a named actor" is a query over kinds
//      and facts, and an impossible one over prose.
//
// This is the registry's `structured-facts-plus-a-locale-invariant-audit-string`
// and `reason-codes-over-prose`, applied to a read projection rather than to an
// audit ledger.
//
// WHAT THIS IS NOT. There is no `journey_events` table. Five append-only logs
// already hold these facts — `pipeline_events`, `decision_records`,
// `interview_events`, `dev_session_events`, `consent_events` — and this module
// PROJECTS them. The single exception is role intake, which persists a whole-row
// JSON blob and therefore has no history at all; `intake_events` is the one new
// write in the design (see db/intake-events.ts).

/** Lifecycle phases, in the order they are drawn. */
export const JOURNEY_PHASE_IDS = ["job-definition", "case", "screening"] as const;
export type JourneyPhaseId = (typeof JOURNEY_PHASE_IDS)[number];

const PHASE_IDS = new Set<string>(JOURNEY_PHASE_IDS);
export function isJourneyPhaseId(v: unknown): v is JourneyPhaseId {
  return typeof v === "string" && PHASE_IDS.has(v);
}

/**
 * The closed topic vocabulary for conversational rounds — intake dialog and
 * interview turns. Extracted by a model with a deterministic keyless fallback;
 * a round the classifier cannot place simply OMITS `topicCode`, which is a
 * legitimate row and not a failure.
 *
 * Every code needs `journey.topics.<code>` in all four catalogs.
 */
export const JOURNEY_TOPIC_CODES = [
  // role intake
  "role-shape",
  "backfill-reason",
  "role-title",
  "first-90-days",
  "must-have-skills",
  "seniority",
  "team-context",
  "salary-band",
  "work-mode",
  "timeline",
  // interview rounds
  // `salary` is the spark's own worked example ("Candidate asked about salary")
  // and is what a candidate-initiated pay question classifies as; `salary-band`
  // above is the REQUESTOR stating a band during intake. Two different speakers,
  // two different facts, so two codes.
  "salary",
  "role-scope",
  "tech-stack",
  "team-fit",
  "availability",
  "remote-policy",
  "growth",
  "guardrail",
] as const;
export type JourneyTopicCode = (typeof JOURNEY_TOPIC_CODES)[number];

const TOPIC_CODES = new Set<string>(JOURNEY_TOPIC_CODES);
export function isJourneyTopicCode(v: unknown): v is JourneyTopicCode {
  return typeof v === "string" && TOPIC_CODES.has(v);
}

/**
 * A fact value. Deliberately narrow: anything a row needs to SAY goes here as a
 * named value the renderer interpolates, never as pre-composed prose.
 */
export type JourneyFactValue = string | number | boolean | null;

/**
 * ABSENT-VALUE CONVENTION (stated once, obeyed everywhere in this module):
 * an optional field is OMITTED. Never `null`, never `0`, never "".
 *
 * `actor` is the single deliberate exception — it is `string | null`, because a
 * null there is a FACT ("kp does not know who did this"), not an absence. Legacy
 * rows and any writer that genuinely cannot name an actor read as "not
 * identified", and the board renders that as its own mark rather than as a blank.
 */
export type JourneyEvent = {
  /** Stable across requests: derived from the source table and its primary key. */
  id: string;
  phase: JourneyPhaseId;
  /**
   * The event vocabulary. Existing kinds are reused VERBATIM from the source
   * logs (`added`, `matched`, `advanced`, `screening_hold`, `auto_rejected`,
   * `offer_sent`, `topic_covered`, …) so the board and the underlying ledger
   * never disagree about what a thing is called. New kinds introduced by this
   * module are prefixed `intake_`.
   */
  kind: string;
  facts: Record<string, JourneyFactValue>;
  /** Conversational rounds only; omitted when the classifier placed nothing. */
  topicCode?: JourneyTopicCode;
  /** When it happened. */
  occurredAt: string;
  /**
   * When kp learned it. Two clocks, never collapsed into one: a backfilled row
   * and a live row are both legitimate and a report over a past window must stay
   * reproducible. Registry: `audit-logging/two-clock-records`.
   */
  recordedAt: string;
  /** "human:*" / "auto:*" / null = genuinely not identified. See the note above. */
  actor: string | null;
  /**
   * Present ONLY when this row was attached to this candidate by a name match
   * with no confirming job axis — it may belong to a different person. Carried
   * forward from the join contract `candidate-timeline.ts` already enforces.
   * The board must never render such a row as certain.
   */
  confidence?: "label-only";
  /** Where the row came from, for the second detail layer. */
  sourceRef: { table: string; id: string };
};

/**
 * A phase either happened or it did not, and "did not" always carries a REASON.
 * `absenceReasonKey` is an i18n key (`journey.absence.*`), never a sentence.
 *
 * INVARIANT: `present` is DERIVED from the events actually emitted for that
 * phase — never set independently. A projector that computes the flag and the
 * rows separately will eventually disagree with itself; the contest's own staged
 * material shipped 22 journeys flagged screening-absent while carrying screening
 * rows, and the winning prototype found it before we did.
 */
export type JourneyPhaseState =
  | { present: true }
  | { present: false; absenceReasonKey: string };

/**
 * Whether this column came from real traffic or from a test run. A `/uat` L2 run
 * drives the real app against a real database, so it produces genuine journey
 * columns; they must be distinguishable and must never be counted in a live metric.
 */
export type JourneyOrigin = { kind: "live" } | { kind: "test-run"; runId: string };

/** One candidate's journey — one column on the board. */
export type JourneyColumn = {
  entryId: string;
  candidateLabel: string;
  stage: string;
  /** The board's "active candidates" filter reads this. */
  active: boolean;
  matchScore: number | null;
  locale: string;
  origin: JourneyOrigin;
  phases: Record<JourneyPhaseId, JourneyPhaseState>;
  /** Sorted by (occurredAt, id). */
  events: JourneyEvent[];
};

/**
 * One step on the canonical rail — the concept imported from the contest's
 * runner-up. A role's rail is DERIVED from the event kinds that actually
 * occurred in that role, ordered by where each typically falls, so that row `n`
 * means the same step in every column of the cluster.
 *
 * The rail is the shape the process took. It is NOT a declared policy, and it is
 * per role: equal vertical position in two clusters is not the same step.
 */
export type JourneyRailStep = {
  /** Position in the rail, 0-based. */
  index: number;
  phase: JourneyPhaseId;
  kind: string;
  topicCode?: JourneyTopicCode;
  /** How many columns in this cluster reached this step. */
  reached: number;
  /** Cluster size, so the board can print "38 of 45" without a second lookup. */
  cohort: number;
  /** How many of `reached` were done by an "auto:*" actor. */
  byMachine: number;
};

/**
 * How one column relates to one rail step. The two absent states are different
 * facts and must never render alike:
 *  - `skipped`      — the column has no event at this step but DOES have a later
 *                     one: the journey went on without it.
 *  - `never-reached` — no later step either: the journey ended before here.
 */
export type JourneyRailCellState = "present" | "skipped" | "never-reached";

/** One role's cluster of columns, under the conversation that defined the role. */
export type RoleCluster = {
  jobId: string;
  title: string;
  openedAt: string;
  /**
   * The job-definition band. These events belong to the ROLE, not to any column,
   * and are drawn once above the whole cluster.
   */
  sharedEvents: JourneyEvent[];
  /**
   * True when the intake record projected into `sharedEvents` is not actually
   * linked to this job in the data (no `job_id`, no matching `jd_slug`). The band
   * must say so: a spanning band is a claim about the data, and an unlinked one
   * is a weaker claim than a linked one.
   */
  sharedEventsUnlinked: boolean;
  rail: JourneyRailStep[];
  columns: JourneyColumn[];
  /** Total columns for this role, which may exceed `columns.length` when paged. */
  totalColumns: number;
};

/** The board payload. */
export type JourneyBoard = {
  clusters: RoleCluster[];
  /** Echoed back so the client never has to re-derive what it asked for. */
  query: { role?: string; activeOnly: boolean; limit: number; offset: number };
  /** Counts over the WHOLE workspace, not just this page. */
  totals: { roles: number; columns: number; events: number };
};

/** The second detail layer, fetched on demand for one event. */
export type JourneyEventDetail = {
  eventId: string;
  /** Layer one: label key -> value. Rendered as a fact card. */
  card: Record<string, JourneyFactValue>;
  /**
   * Layer two: the underlying evidence — a transcript excerpt, a sealed decision
   * record, an analysis. Omitted when the source row carries none.
   */
  source?: { labelKey: string; excerpt: string; reply?: string };
};
