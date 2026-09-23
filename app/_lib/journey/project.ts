// THE PROJECTION. Five append-only logs plus two state tables, read as one
// cross-phase story per candidate and many of them side by side.
//
// THERE IS NO `journey_events` TABLE AND THIS MODULE NEVER WRITES ONE. Everything
// below is a READ over rows some other writer already owns:
//
//   pipeline_events     (db/core.ts:601, written only via recordEvent)  → screening
//   analyses            (label + jd_slug join, see identity.ts)         → screening
//   interview_sessions  (db/core.ts:819)                                → screening
//   consent_events      (db/core.ts:1715)                               → screening
//   decision_records    (decision-record-store.ts, its OWN connection)  → screening
//   dev_submissions / dev_sessions (db/core.ts:697,714)                 → case
//   intake_events       (created by db/intake-events.ts)                → job-definition
//
// The one thing that is NOT a read is `setApproval`'s new `approval_set` event in
// db/pipeline.ts — a state change on the path to a hire that used to happen with no
// row in the event log at all.
//
// THE FIVE HONESTY RULES this module exists to hold (brief, 2026-09-21):
//
//  1. A row is never a stored sentence. It is `kind` + `facts`, rendered per locale
//     through `journeyEventMessageKey` (render-keys.ts).
//  2. "Nothing happened" and "we never recorded this" are different facts and get
//     different keys (`JourneyPhaseState.absenceReasonKey`).
//  3. A row attached by NAME ALONE carries `confidence: "label-only"`.
//  4. `actor: null` is a fact ("kp does not know who did this"), never a blank.
//  5. Two clocks, never collapsed. When a source row carries exactly one timestamp,
//     BOTH clocks take it — a fabricated second clock is worse than a duplicated one.
//
// TENANCY. Every statement here binds `workspace_id` in a PREDICATE (the shape
// `journey-tenancy.test.ts` asserts). `decision_records` lives on the isolated
// store and is reached only through its own workspace-scoped readers.

import { ensureDb, safeRowParse } from "../db/core";
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces";
import { chunk, SQL_IN_CHUNK } from "../entries-param";
import { jdSlugOfJobId } from "../jd-limits";
import { isTerminalEntryStatus, TERMINAL_ENTRY_STATUSES } from "../pipeline-status";
import { consentWithholdsPii } from "../consent";
import { listDecisionRecordsForRefs, verifyDecisionChain, type DecisionRecord } from "../decision-record-store";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { isKnownJourneyKind } from "./render-keys";
import {
  journeyActorIsMachine,
  journeyAnalysisAttachment,
  journeyNormalizeLabel,
  journeyStepKey,
} from "./identity";
import {
  JOURNEY_PHASE_IDS,
  isJourneyTopicCode,
  type JourneyBoard,
  type JourneyCohort,
  type JourneyCohortInstance,
  type JourneyCohortOutcome,
  type JourneyCohortRole,
  type JourneyCohortStep,
  type JourneyColumn,
  type JourneyEvent,
  type JourneyEventDetail,
  type JourneyFactValue,
  type JourneyOrigin,
  type JourneyPhaseId,
  type JourneyPhaseState,
  type JourneyRailCellState,
  type JourneyRailStep,
  type JourneyTopicCode,
  type RoleCluster,
} from "./types";

// ── bounds ───────────────────────────────────────────────────────────────────
//
// Every number here is a READ FLOOR, stated rather than discovered. The board is
// an analytics surface over tables that only grow, and the sibling that taught us
// this (`/api/analytics/decisions`) was unbounded until a customer's own history
// made it slow.

/** Columns considered for `totals` — the whole workspace, bounded. Matches
 *  PIPELINE_BOARD_CAP so the journey board can never claim to have counted more
 *  of the workspace than the pipeline board itself reads. */
export const JOURNEY_SCAN_CAP = 2000;

/** Default / maximum columns per request. Copied from /api/analytics/decisions
 *  (DEFAULT_LIMIT 20, MAX_LIMIT 50) so the two paged analytics surfaces page alike. */
export const JOURNEY_DEFAULT_LIMIT = 20;
export const JOURNEY_MAX_LIMIT = 50;

/** `analyses` carry no entry/candidate foreign key, so there is no indexed column to
 *  scope this read by (candidate-timeline.ts:194-200 states the same floor and picks
 *  300 for ONE candidate's drawer). The board joins the whole page at once, so it
 *  reads the workspace's recent analyses ONCE and matches in JS. */
export const JOURNEY_ANALYSES_SCAN_LIMIT = 500;

/** Rows projected onto one column. A runaway automation loop must not be able to
 *  turn one candidate into an unbounded response body. */
const COLUMN_EVENT_CAP = 400;

/** Free-text carried onto the wire as a fact or an excerpt. */
const FACT_DETAIL_MAX = 400;
const EXCERPT_MAX = 600;

/** The detail `setApproval` writes so the projection can recover WHICH gate was
 *  raised. `pipeline_events` has no structured payload column — only `detail` — so
 *  the writer encodes it and this reader decodes it.
 *
 *  The literal is deliberately duplicated rather than imported: db/pipeline.ts is on
 *  nearly every route's import graph and must not grow an edge to this module (see
 *  the perf note in the build brief). `project.test.ts` reads pipeline.ts's SOURCE
 *  and fails if the two ever disagree — the same source-pinning idiom
 *  `pipeline-approval-cas.test.ts` already uses on that file. */
export const APPROVAL_SET_DETAIL_PREFIX = "approval:";

// ── absence reasons (i18n keys, never sentences) ─────────────────────────────
//
// FULL dotted paths, as the build brief specifies them verbatim
// (`absenceReasonKey: "journey.absence.intakeMissing"`). Note that
// `journeyEventMessageKey` returns RELATIVE keys (`events.added`) because the board
// resolves it under `useTranslations("journey")` — the two are not symmetrical, and
// that asymmetry is the contract, not an oversight on this side.
const ABSENCE = {
  caseNotRun: "journey.absence.caseNotRun",
  caseNotAssigned: "journey.absence.caseNotAssigned",
  caseNotLinked: "journey.absence.caseNotLinked",
  screeningNotRecorded: "journey.absence.screeningNotRecorded",
  intakeMissing: "journey.absence.intakeMissing",
} as const;

// ── row shapes ───────────────────────────────────────────────────────────────

type EntryRow = {
  id: string;
  candidate_label: string;
  job_id: string | null;
  job_title: string | null;
  stage: string;
  status: string;
  match_score: number | null;
  locale: string | null;
  created_at: string | null;
  dev_case_id: string | null;
  dev_submission_id: string | null;
  consent_given_at: string | null;
  consent_expires_at: string | null;
  anonymized_at: string | null;
};

const ENTRY_COLUMNS = `id, candidate_label, job_id, job_title, stage, status, match_score, locale,
        created_at, dev_case_id, dev_submission_id, consent_given_at, consent_expires_at, anonymized_at`;

const TERMINAL_STATUS_SQL = `(${TERMINAL_ENTRY_STATUSES.map((s) => `'${s}'`).join(", ")})`;

// ── small helpers ────────────────────────────────────────────────────────────

function bounded(text: string | null | undefined, max: number): string | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Does this SQLite file have the table yet?
 *
 *  `intake_events` is created by a DIFFERENT package's migration and may simply not
 *  exist when this runs — against an older DB file, or on a deploy where that
 *  migration has not landed. A missing table is an honest EMPTY BAND
 *  (`journey.absence.intakeMissing`), never a 500 on the whole board. */
function hasTable(db: ReturnType<typeof ensureDb>, name: string): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).get(name);
}

/** Group a list of rows by a key, preserving read order within each bucket. */
function groupBy<T>(rows: readonly T[], key: (row: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/** Run a chunked `IN (…)` read under the SQLite variable floor (the `chunk` /
 *  SQL_IN_CHUNK idiom entries-param.ts owns) and concatenate the rows. */
function readIn<T>(ids: readonly string[], run: (idsChunk: string[], placeholders: string) => T[]): T[] {
  const out: T[] = [];
  for (const idsChunk of chunk([...ids], SQL_IN_CHUNK)) {
    out.push(...run(idsChunk, idsChunk.map(() => "?").join(", ")));
  }
  return out;
}

/** (occurredAt, id) — the ONE ordering every column's `events` uses. `id` is the
 *  stable tiebreak: two rows written in the same millisecond must not swap places
 *  between two reads of the same board. */
function byOccurrence(a: JourneyEvent, b: JourneyEvent): number {
  return a.occurredAt === b.occurredAt ? a.id.localeCompare(b.id) : a.occurredAt.localeCompare(b.occurredAt);
}

/** Drop the keys whose value is absent. The ABSENT-VALUE CONVENTION (types.ts:77-85):
 *  an optional field is OMITTED — never null, never 0, never "". */
function facts(entries: Record<string, JourneyFactValue | undefined>): Record<string, JourneyFactValue> {
  const out: Record<string, JourneyFactValue> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ── the per-request read context ─────────────────────────────────────────────
//
// Everything a page of columns needs, read ONCE and indexed by entry id, so the
// projection is a handful of chunked queries rather than one query per column.

type AnalysisScanRow = {
  slug: string;
  candidate_label: string | null;
  jd_slug: string | null;
  score: number | null;
  disposition: string | null;
  decision_note: string | null;
  created_at: string;
};

type PipelineEventRow = {
  id: number;
  entry_id: string;
  kind: string;
  from_stage: string | null;
  to_stage: string | null;
  detail: string | null;
  created_at: string;
  actor: string | null;
};

type ConsentEventRow = { id: number; entry_id: string; kind: string; detail: string | null; created_at: string };

type InterviewRow = {
  id: string;
  entry_id: string;
  status: string;
  provider: string;
  mode: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  transcript_json: string | null;
};

type SubmissionRow = { id: string; entry_key: string; status: string; received_at: string; transfer_score: number | null };
type SessionRow = { id: string; entry_key: string; status: string; created_at: string; submitted_at: string | null };

type IntakeEventRow = {
  id: number;
  intake_id: string;
  kind: string;
  topic_code: string | null;
  facts_json: string | null;
  occurred_at: string;
  recorded_at: string;
  actor: string | null;
};

type ColumnSources = {
  pipelineEvents: PipelineEventRow[];
  consentEvents: ConsentEventRow[];
  interviews: InterviewRow[];
  decisions: DecisionRecord[];
  analyses: AnalysisScanRow[];
  submissions: SubmissionRow[];
  sessions: SessionRow[];
};

const EMPTY_SOURCES: ColumnSources = {
  pipelineEvents: [],
  consentEvents: [],
  interviews: [],
  decisions: [],
  analyses: [],
  submissions: [],
  sessions: [],
};

type ChainStatus = { ok: boolean; keyed: boolean };

// ── reads ────────────────────────────────────────────────────────────────────

function readEntries(
  workspaceId: string,
  opts: { role?: string; activeOnly?: boolean; entryId?: string }
): EntryRow[] {
  const db = ensureDb();
  // `WHERE workspace_id = ?` is written LITERALLY and the optional filters are
  // appended as AND-clauses — the `eventKindClause` idiom db/pipeline.ts already uses.
  // Building the whole predicate by joining an array would leave the tenant term
  // invisible in the statement's source text, and journey-tenancy.test.ts reads that
  // source: a guard that cannot see the scoping cannot prove it.
  const filters: string[] = [];
  const params: (string | number)[] = [workspaceId];
  if (opts.entryId) {
    filters.push(" AND id = ?");
    params.push(opts.entryId);
  }
  if (opts.role) {
    filters.push(" AND job_id = ?");
    params.push(opts.role);
  }
  // `activeOnly` is the board's own filter and means exactly what the pipeline board
  // means by it (pipeline-status.ts TERMINAL_ENTRY_STATUSES). Unfiltered, the journey
  // board deliberately INCLUDES terminal rows: a journey that ends in a rejection is
  // still a journey, and hiding it would make the funnel look like nobody ever lost.
  if (opts.activeOnly) filters.push(` AND status NOT IN ${TERMINAL_STATUS_SQL}`);
  return db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM pipeline_entries
        WHERE workspace_id = ?${filters.join("")}
        ORDER BY (job_title IS NULL) ASC, job_title ASC, job_id ASC, created_at ASC, id ASC
        LIMIT ?`
    )
    .all(...params, JOURNEY_SCAN_CAP + 1) as EntryRow[];
}

/** The workspace's recent analyses, indexed by normalized candidate label.
 *
 *  ONE bounded scan for the WHOLE page (see JOURNEY_ANALYSES_SCAN_LIMIT): the
 *  label↔jd_slug join has no index to stand on, so the choice is a bounded scan here
 *  or a scan per column. Read newest-first, so a capped scan is describable. */
function readAnalysesByLabel(workspaceId: string): Map<string, AnalysisScanRow[]> {
  const rows = ensureDb()
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, disposition, decision_note, created_at
         FROM analyses WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(workspaceId, JOURNEY_ANALYSES_SCAN_LIMIT) as AnalysisScanRow[];
  return groupBy(rows, (r) => journeyNormalizeLabel(r.candidate_label));
}

function readSources(entries: readonly EntryRow[], workspaceId: string, analysesByLabel: Map<string, AnalysisScanRow[]>): Map<string, ColumnSources> {
  const db = ensureDb();
  const ids = entries.map((e) => e.id);
  const out = new Map<string, ColumnSources>();
  if (ids.length === 0) return out;

  const pipelineEvents = readIn(ids, (idsChunk, placeholders) =>
    db
      .prepare(
        `SELECT id, entry_id, kind, from_stage, to_stage, detail, created_at, actor
           FROM pipeline_events WHERE workspace_id = ? AND entry_id IN (${placeholders})
          ORDER BY created_at ASC, id ASC`
      )
      .all(workspaceId, ...idsChunk) as PipelineEventRow[]
  );
  const consentEvents = readIn(ids, (idsChunk, placeholders) =>
    db
      .prepare(
        `SELECT id, entry_id, kind, detail, created_at
           FROM consent_events WHERE workspace_id = ? AND entry_id IN (${placeholders})
          ORDER BY id ASC`
      )
      .all(workspaceId, ...idsChunk) as ConsentEventRow[]
  );
  const interviews = readIn(ids, (idsChunk, placeholders) =>
    db
      .prepare(
        `SELECT id, entry_id, status, provider, mode, created_at, started_at, ended_at, transcript_json
           FROM interview_sessions WHERE workspace_id = ? AND entry_id IN (${placeholders})
          ORDER BY created_at ASC`
      )
      .all(workspaceId, ...idsChunk) as InterviewRow[]
  );

  // The CASE phase. Both reads are keyed on the entry's OWN dev linkage columns
  // (devcase-identity.ts: "the pipeline's own identities are the pipeline's
  // identities"), so an entry that never did an assignment costs nothing.
  const submissionIds = entries.filter((e) => e.dev_submission_id).map((e) => e.dev_submission_id as string);
  const submissionOwner = new Map<string, string>();
  for (const e of entries) if (e.dev_submission_id) submissionOwner.set(e.dev_submission_id, e.id);
  // `chunk([], n)` is `[]`, so an entry set with no assignments issues no query at
  // all — the guard is in the data, not in a branch that could drift from it.
  const submissions: SubmissionRow[] = readIn(submissionIds, (idsChunk, placeholders) =>
    (
      db
        .prepare(
          `SELECT id, status, received_at, transfer_score
             FROM dev_submissions WHERE workspace_id = ? AND id IN (${placeholders})`
        )
        .all(workspaceId, ...idsChunk) as Omit<SubmissionRow, "entry_key">[]
    ).map((r): SubmissionRow => ({ ...r, entry_key: submissionOwner.get(r.id) ?? "" }))
  );
  const sessions: SessionRow[] = readIn(submissionIds, (idsChunk, placeholders) =>
    (
      db
        .prepare(
          `SELECT id, submission_id, status, created_at, submitted_at
             FROM dev_sessions WHERE workspace_id = ? AND submission_id IN (${placeholders})`
        )
        .all(workspaceId, ...idsChunk) as { id: string; submission_id: string | null; status: string; created_at: string; submitted_at: string | null }[]
    ).map(
      (r): SessionRow => ({
        id: r.id,
        status: r.status,
        created_at: r.created_at,
        submitted_at: r.submitted_at,
        entry_key: submissionOwner.get(r.submission_id ?? "") ?? "",
      })
    )
  );

  // decision_records lives on its OWN connection (decision-record-store.ts:1-20) and
  // `candidate_ref` IS the pipeline entry id. Its batched reader is already chunked
  // and already workspace-scoped, so it is used rather than re-implemented here.
  const decisionsByRef = listDecisionRecordsForRefs(ids, { workspaceId, limit: 50 });

  const pipelineByEntry = groupBy(pipelineEvents, (r) => r.entry_id);
  const consentByEntry = groupBy(consentEvents, (r) => r.entry_id);
  const interviewsByEntry = groupBy(interviews, (r) => r.entry_id);
  const submissionsByEntry = groupBy(submissions, (r) => r.entry_key || null);
  const sessionsByEntry = groupBy(sessions, (r) => r.entry_key || null);

  for (const entry of entries) {
    const label = journeyNormalizeLabel(entry.candidate_label);
    const entryJdSlug = jdSlugOfJobId(entry.job_id);
    const candidates = label ? (analysesByLabel.get(label) ?? []) : [];
    out.set(entry.id, {
      pipelineEvents: pipelineByEntry.get(entry.id) ?? [],
      consentEvents: consentByEntry.get(entry.id) ?? [],
      interviews: interviewsByEntry.get(entry.id) ?? [],
      decisions: decisionsByRef.get(entry.id) ?? [],
      analyses: candidates.filter(
        (a) =>
          journeyAnalysisAttachment({
            entryLabel: entry.candidate_label,
            entryJdSlug,
            analysisLabel: a.candidate_label,
            analysisJdSlug: a.jd_slug,
          }) !== "none"
      ),
      submissions: submissionsByEntry.get(entry.id) ?? [],
      sessions: sessionsByEntry.get(entry.id) ?? [],
    });
  }
  return out;
}

/** Does this ROLE run a work-sample case at all? The difference between
 *  `caseNotRun` and `caseNotAssigned`, and the only question that distinguishes
 *  them. `dev_cases.job_id` is the link (core.ts:2054). */
function roleRunsACase(jobId: string | null, workspaceId: string): boolean {
  if (!jobId) return false;
  return !!ensureDb()
    .prepare(`SELECT 1 FROM dev_cases WHERE workspace_id = ? AND job_id = ? LIMIT 1`)
    .get(workspaceId, jobId);
}

// ── the shared job-definition band ───────────────────────────────────────────

type SharedBand = { events: JourneyEvent[]; unlinked: boolean };

const EMPTY_BAND: SharedBand = { events: [], unlinked: false };

/**
 * The role's own conversation, drawn once above the whole cluster.
 *
 * RESOLUTION ORDER, strongest link first — and the LAST one is a claim about the
 * data rather than a fact in it, which is exactly what `sharedEventsUnlinked` tells
 * the board to say out loud:
 *
 *   1. `role_intakes.job_id = <jobId>`            → linked
 *   2. `role_intakes.jd_slug = jdSlugOfJobId(…)`  → linked
 *   3. same TITLE, case-folded                    → UNLINKED (a guess, flagged)
 *
 * A missing `intake_events` table (package P2 owns its migration) degrades to an
 * empty band, never a throw.
 */
function readSharedBand(jobId: string | null, jobTitle: string | null, workspaceId: string): SharedBand {
  const db = ensureDb();
  if (!hasTable(db, "intake_events")) return EMPTY_BAND;

  type IntakeRef = { id: string };
  let intake: IntakeRef | undefined;
  let unlinked = false;
  if (jobId) {
    intake = db
      .prepare(`SELECT id FROM role_intakes WHERE workspace_id = ? AND job_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(workspaceId, jobId) as IntakeRef | undefined;
  }
  if (!intake) {
    const slug = jdSlugOfJobId(jobId);
    if (slug) {
      intake = db
        .prepare(`SELECT id FROM role_intakes WHERE workspace_id = ? AND jd_slug = ? ORDER BY created_at DESC LIMIT 1`)
        .get(workspaceId, slug) as IntakeRef | undefined;
    }
  }
  if (!intake) {
    const title = jobTitle?.trim().toLowerCase();
    if (title) {
      intake = db
        .prepare(
          `SELECT id FROM role_intakes WHERE workspace_id = ? AND LOWER(TRIM(title)) = ?
            ORDER BY created_at DESC LIMIT 1`
        )
        .get(workspaceId, title) as IntakeRef | undefined;
      if (intake) unlinked = true;
    }
  }
  if (!intake) return EMPTY_BAND;

  const rows = db
    .prepare(
      `SELECT id, intake_id, kind, topic_code, facts_json, occurred_at, recorded_at, actor
         FROM intake_events WHERE workspace_id = ? AND intake_id = ? ORDER BY seq ASC LIMIT ?`
    )
    .all(workspaceId, intake.id, COLUMN_EVENT_CAP) as IntakeEventRow[];

  const events = rows.map((r): JourneyEvent => {
    const parsed = r.facts_json ? safeRowParse<Record<string, JourneyFactValue>>(r.facts_json, "journey.intakeFacts", String(r.id)) : null;
    const stored = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const topicCode: JourneyTopicCode | undefined = isJourneyTopicCode(r.topic_code) ? r.topic_code : undefined;
    return {
      id: `intake_events:${r.id}`,
      phase: "job-definition",
      kind: r.kind,
      // `journey.events.unknown` interpolates {kind}; a writer's own `kind` fact (if it
      // ever supplies one) wins, because the row knows more about itself than we do.
      facts: facts({ ...(isKnownJourneyKind(r.kind) ? {} : { kind: r.kind }), ...stored }),
      ...(topicCode ? { topicCode } : {}),
      // TWO REAL COLUMNS here, which is the whole reason intake_events was worth
      // writing: a backfilled round happened at the turn's own `at` and was recorded
      // when the backfill ran, and a report over a past window must stay reproducible.
      occurredAt: r.occurred_at,
      recordedAt: r.recorded_at,
      actor: r.actor ?? null,
      sourceRef: { table: "intake_events", id: String(r.id) },
    };
  });
  events.sort(byOccurrence);
  return { events, unlinked };
}

// ── one column ───────────────────────────────────────────────────────────────

function projectEvents(entry: EntryRow, sources: ColumnSources, chain: ChainStatus): JourneyEvent[] {
  const events: JourneyEvent[] = [];
  const entryJdSlug = jdSlugOfJobId(entry.job_id);

  // pipeline_events — the kind travels VERBATIM (types.ts:90-96) so the board and
  // the ledger can never disagree about what a thing is called, and `actor` travels
  // straight through INCLUDING null.
  for (const r of sources.pipelineEvents) {
    const approvalKind =
      r.kind === "approval_set" && r.detail?.startsWith(APPROVAL_SET_DETAIL_PREFIX)
        ? r.detail.slice(APPROVAL_SET_DETAIL_PREFIX.length)
        : undefined;
    events.push({
      id: `pipeline_events:${r.id}`,
      phase: "screening",
      kind: r.kind,
      facts: facts({
        from: r.from_stage ?? undefined,
        to: r.to_stage ?? undefined,
        // WHICH gate was raised. Its own name on purpose: `kind` is RESERVED for
        // `journey.events.unknown`, the one message whose argument is the event's
        // own kind. Overloading one placeholder with two meanings is what let an
        // unmapped kind ship without its argument and throw FORMATTING_ERROR on
        // the first real board (useJourneySentence.test.ts pins the pairing now).
        gate: approvalKind,
        // A source kind this module has never heard of degrades to something
        // honest instead of rendering blank.
        kind: isKnownJourneyKind(r.kind) ? undefined : r.kind,
        detail: approvalKind ? undefined : bounded(r.detail, FACT_DETAIL_MAX),
      }),
      // ONE stored timestamp, so both clocks take it. Inventing a second would be
      // a fabrication dressed as precision.
      occurredAt: r.created_at,
      recordedAt: r.created_at,
      actor: r.actor ?? null,
      sourceRef: { table: "pipeline_events", id: String(r.id) },
    });
  }

  // analyses — attached by the identity contract in identity.ts, carrying the
  // reduced-confidence flag when the entry's job had no JD slug to confirm against.
  for (const a of sources.analyses) {
    const attachment = journeyAnalysisAttachment({
      entryLabel: entry.candidate_label,
      entryJdSlug,
      analysisLabel: a.candidate_label,
      analysisJdSlug: a.jd_slug,
    });
    if (attachment === "none") continue;
    events.push({
      id: `analyses:${a.slug}`,
      phase: "screening",
      kind: "analysis",
      facts: facts({ score: a.score ?? undefined, disposition: a.disposition ?? undefined }),
      occurredAt: a.created_at,
      recordedAt: a.created_at,
      // An analysis row records no actor at all. NULL is the truth about it, and the
      // board draws that as its own mark rather than crediting a person or a machine.
      actor: null,
      ...(attachment === "label-only" ? { confidence: "label-only" as const } : {}),
      sourceRef: { table: "analyses", id: a.slug },
    });
  }

  // interview_sessions — the row is minted when the link is created and the call
  // happens later, so `occurredAt` prefers `started_at`. Both values are STORED;
  // neither is computed.
  for (const s of sources.interviews) {
    events.push({
      id: `interview_sessions:${s.id}`,
      phase: "screening",
      kind: "interview_session",
      facts: facts({ status: s.status, provider: s.provider, mode: s.mode }),
      occurredAt: s.started_at ?? s.created_at,
      recordedAt: s.created_at,
      actor: null,
      sourceRef: { table: "interview_sessions", id: s.id },
    });
  }

  // consent_events — the KIND of consent transition (granted / renewed / expired /
  // anonymized / erased) is a FACT on the row, not a separate journey kind: one
  // sentence with an argument beats five near-identical catalog entries.
  for (const c of sources.consentEvents) {
    events.push({
      id: `consent_events:${c.id}`,
      phase: "screening",
      kind: "consent_recorded",
      facts: facts({ consentEvent: c.kind, detail: bounded(c.detail, FACT_DETAIL_MAX) }),
      occurredAt: c.created_at,
      recordedAt: c.created_at,
      actor: null,
      sourceRef: { table: "consent_events", id: String(c.id) },
    });
  }

  // decision_records — THE HALF THIS PACKAGE ADDS. The sealed chain was rendered in
  // one analytics panel and was absent from the candidate's own story, so "why was
  // this person rejected, sealed and provable" never sat beside their stage moves.
  for (const d of sources.decisions) {
    events.push({
      id: `decision_records:${d.seq}`,
      phase: "screening",
      kind: "decision_sealed",
      facts: facts({
        decision: d.kind,
        reasonCode: d.reasonCode,
        policyVersion: d.policyVersion,
        // The chain's own verdict, carried per row: `ok` alone is not a security
        // claim (decision-record-store.ts:56-63), so `chainKeyed` rides beside it.
        chainOk: chain.ok,
        chainKeyed: chain.keyed,
      }),
      occurredAt: d.createdAt,
      recordedAt: d.createdAt,
      // A sealed record ALWAYS names an actor — it is sealed into the hash.
      actor: d.actor,
      sourceRef: { table: "decision_records", id: String(d.seq) },
    });
  }

  // The CASE phase.
  for (const s of sources.sessions) {
    events.push({
      id: `dev_sessions:${s.id}`,
      phase: "case",
      kind: "case_opened",
      facts: facts({ status: s.status }),
      occurredAt: s.created_at,
      recordedAt: s.created_at,
      actor: null,
      sourceRef: { table: "dev_sessions", id: s.id },
    });
  }
  for (const s of sources.submissions) {
    events.push({
      id: `dev_submissions:${s.id}`,
      phase: "case",
      kind: "case_submitted",
      facts: facts({ status: s.status, score: s.transfer_score ?? undefined }),
      occurredAt: s.received_at,
      recordedAt: s.received_at,
      actor: null,
      sourceRef: { table: "dev_submissions", id: s.id },
    });
  }
  // NOT EMITTED, deliberately: `case_evaluated`. `dev_submissions.eval_json` proves an
  // evaluation happened but the table stores no instant for it, and rule 5 says a clock
  // is never invented. The row would have to borrow `received_at` and would then claim
  // the evaluation happened at submission time, which is false for every one of them.

  events.sort(byOccurrence);
  return events.length > COLUMN_EVENT_CAP ? events.slice(0, COLUMN_EVENT_CAP) : events;
}

/**
 * The events that DECIDE `phases[phase].present` for a column.
 *
 * EXPORTED BECAUSE THE INVARIANT IS TESTED THROUGH IT. `JourneyPhaseState.present`
 * must be DERIVED from the rows actually emitted, never computed by a second query
 * that can disagree — the contest's staged material shipped 22 journeys flagged
 * `screening.present: false` while carrying screening rows, and the winning
 * prototype found it before we did (types.ts:122-131).
 *
 * `job-definition` is the one phase whose evidence is NOT on the column: the role
 * conversation belongs to the ROLE and is drawn once above the cluster
 * (`RoleCluster.sharedEvents`). So it is passed in, and a column in a cluster with
 * a band reports the phase present exactly when that band has rows.
 */
export function journeyPhaseEvidence(
  column: Pick<JourneyColumn, "events">,
  phase: JourneyPhaseId,
  sharedEvents: readonly JourneyEvent[] = []
): JourneyEvent[] {
  if (phase === "job-definition") return [...sharedEvents];
  return column.events.filter((e) => e.phase === phase);
}

function phaseStates(
  events: JourneyEvent[],
  sharedEvents: readonly JourneyEvent[],
  caseAbsence: string
): Record<JourneyPhaseId, JourneyPhaseState> {
  const out = {} as Record<JourneyPhaseId, JourneyPhaseState>;
  for (const phase of JOURNEY_PHASE_IDS) {
    const evidence = journeyPhaseEvidence({ events }, phase, sharedEvents);
    if (evidence.length > 0) {
      out[phase] = { present: true };
      continue;
    }
    out[phase] =
      phase === "job-definition"
        ? { present: false, absenceReasonKey: ABSENCE.intakeMissing }
        : phase === "case"
          ? { present: false, absenceReasonKey: caseAbsence }
          : { present: false, absenceReasonKey: ABSENCE.screeningNotRecorded };
  }
  return out;
}

/** WHY this candidate has no case activity — three different facts that must never
 *  render alike (types.ts:122-131 for the phase, `journey.absence.*` for the words). */
function caseAbsenceReason(entry: EntryRow, workspaceId: string): string {
  if (entry.dev_case_id || entry.dev_submission_id) return ABSENCE.caseNotLinked;
  return roleRunsACase(entry.job_id, workspaceId) ? ABSENCE.caseNotAssigned : ABSENCE.caseNotRun;
}

/**
 * Live traffic, or a test run?
 *
 * kp persists NO test-run marker on `pipeline_entries`. The one place it records
 * that a candidate-facing exchange was a rehearsal is `interview_sessions.mode`
 * ('test' | 'candidate', db/core.ts:819). So a column is reported as a test run
 * exactly when it HAS interview sessions and EVERY one of them is a test — a fact
 * the data states — and `runId` is the newest such session.
 *
 * KNOWN LIMIT, stated rather than papered over: an entry created by a test run that
 * never reached an interview is indistinguishable from live traffic here. Closing
 * that needs a marker at intake, which is a schema change and not this package's.
 */
function originOf(sources: ColumnSources): JourneyOrigin {
  const sessions = sources.interviews;
  if (sessions.length === 0 || !sessions.every((s) => s.mode === "test")) return { kind: "live" };
  const newest = sessions.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
  return { kind: "test-run", runId: newest.id };
}

function projectColumn(
  entry: EntryRow,
  sources: ColumnSources,
  sharedEvents: readonly JourneyEvent[],
  chain: ChainStatus,
  workspaceId: string
): JourneyColumn {
  const events = projectEvents(entry, sources, chain);
  return {
    entryId: entry.id,
    candidateLabel: entry.candidate_label,
    stage: entry.stage,
    active: !isTerminalEntryStatus(entry.status),
    matchScore: entry.match_score,
    // The candidate's own language, captured at inbound apply. Absent ⇒ the catalog
    // default, exactly as every candidate-facing dispatch resolves it.
    locale: entry.locale ?? DEFAULT_LOCALE,
    origin: originOf(sources),
    phases: phaseStates(events, sharedEvents, caseAbsenceReason(entry, workspaceId)),
    events,
  };
}

// ── the canonical rail ───────────────────────────────────────────────────────

/**
 * The ordered steps of THIS role, derived from the event kinds that actually
 * occurred in it.
 *
 * IT IS THE SHAPE THE PROCESS TOOK, never a declared policy (types.ts:158-166), and
 * it is per role: equal vertical position in two clusters is not the same step.
 *
 * ORDERING RULE, stated because the brief asked for whichever one we picked to be
 * named: each step is placed at the MEDIAN of its FIRST-occurrence position across
 * the columns that have it. Median rather than mean because one column that ran a
 * step wildly out of order must not drag the whole cohort's rail with it. Ties break
 * on reach (a step more columns took sits higher) and then on the step key, so the
 * rail is deterministic for a given set of columns.
 */
export function journeyRail(columns: readonly JourneyColumn[]): JourneyRailStep[] {
  type Draft = {
    key: string;
    phase: JourneyPhaseId;
    kind: string;
    topicCode?: JourneyTopicCode;
    firstIndices: number[];
    reached: number;
    byMachine: number;
  };
  const drafts = new Map<string, Draft>();

  for (const column of columns) {
    const seen = new Map<string, { index: number; machine: boolean }>();
    column.events.forEach((event, index) => {
      const key = journeyStepKey(event);
      const prior = seen.get(key);
      if (prior) {
        // One column can take the same step twice; the rail counts the COLUMN once,
        // and "by the machine" is true if any of its takes was automated.
        prior.machine = prior.machine || journeyActorIsMachine(event.actor);
        return;
      }
      seen.set(key, { index, machine: journeyActorIsMachine(event.actor) });
      let draft = drafts.get(key);
      if (!draft) {
        draft = {
          key,
          phase: event.phase,
          kind: event.kind,
          ...(event.topicCode ? { topicCode: event.topicCode } : {}),
          firstIndices: [],
          reached: 0,
          byMachine: 0,
        };
        drafts.set(key, draft);
      }
      draft.firstIndices.push(index);
      draft.reached += 1;
    });
    for (const [key, take] of seen) {
      if (take.machine) {
        const draft = drafts.get(key);
        if (draft) draft.byMachine += 1;
      }
    }
  }

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  return [...drafts.values()]
    .sort((a, b) => {
      const byMedian = median(a.firstIndices) - median(b.firstIndices);
      if (byMedian !== 0) return byMedian;
      if (a.reached !== b.reached) return b.reached - a.reached;
      return a.key.localeCompare(b.key);
    })
    .map((draft, index) => ({
      index,
      phase: draft.phase,
      kind: draft.kind,
      ...(draft.topicCode ? { topicCode: draft.topicCode } : {}),
      reached: draft.reached,
      // The cohort the rail was DERIVED from — the columns on this page of this
      // cluster. `RoleCluster.totalColumns` carries the role's full size beside it,
      // so neither number has to stand in for the other.
      cohort: columns.length,
      byMachine: draft.byMachine,
    }));
}

/**
 * How ONE column relates to ONE rail step.
 *
 *   `present`       — the column has an event at this step.
 *   `skipped`       — it does not, but it DOES have one at a LATER step: the journey
 *                     went on without it.
 *   `never-reached` — no later step either: the journey ended before here.
 *
 * The two absent states are DIFFERENT FACTS and the board renders them differently.
 *
 * ⚠ SIGNATURE NOTE — the build brief specified `railCellState(column, step)`. That
 * two-argument form is not computable: "a LATER step" is a statement about the
 * cluster's rail ORDER, and neither a `JourneyColumn` nor a `JourneyRailStep`
 * carries the mapping from an event to a rail index. Object identity cannot supply
 * it either, because this function runs on the CLIENT against a payload that has
 * been through JSON. So the rail is a third, required argument — the caller always
 * has it (`cluster.rail`), and the alternative was a function that silently
 * confuses "skipped" with "never-reached", which is the one thing the owner
 * imported this concept to prevent.
 */
export function railCellState(
  column: Pick<JourneyColumn, "events">,
  step: Pick<JourneyRailStep, "index" | "kind" | "topicCode">,
  rail: readonly Pick<JourneyRailStep, "index" | "kind" | "topicCode">[]
): JourneyRailCellState {
  const stepKey = journeyStepKey(step);
  const indexByKey = new Map<string, number>();
  for (const s of rail) indexByKey.set(journeyStepKey(s), s.index);

  let furthest = -1;
  for (const event of column.events) {
    const key = journeyStepKey(event);
    if (key === stepKey) return "present";
    const index = indexByKey.get(key);
    if (index !== undefined && index > furthest) furthest = index;
  }
  return furthest > step.index ? "skipped" : "never-reached";
}

// ── the public reads ─────────────────────────────────────────────────────────

/** The chain verdict for this workspace, read ONCE per board.
 *
 *  `verifyDecisionChain` is checkpointed in-process (decision-record-store.ts:154-182),
 *  so this is cheap on a warm process and correct on a cold one. A store that cannot
 *  answer at all must not take the board down with it — the journey rows still stand,
 *  they just cannot claim the chain verified. */
function chainStatus(workspaceId: string): ChainStatus {
  try {
    const verdict = verifyDecisionChain(workspaceId);
    return { ok: verdict.ok, keyed: verdict.keyed };
  } catch (error) {
    console.error("[journey] decision chain verdict unavailable", error);
    return { ok: false, keyed: false };
  }
}

export function journeyBoard(opts: {
  workspaceId: string;
  role?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}): JourneyBoard {
  const workspaceId = opts.workspaceId || DEFAULT_WORKSPACE_ID;
  const activeOnly = opts.activeOnly === true;
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? JOURNEY_DEFAULT_LIMIT), 1), JOURNEY_MAX_LIMIT);
  const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);

  // The WHOLE (filtered) workspace, bounded — this is what `totals` describes, and
  // what the page is a slice of. A totals figure derived from the page would tell a
  // recruiter that their workspace holds 20 journeys.
  const scanned = readEntries(workspaceId, { role: opts.role, activeOnly });
  const allEntries = scanned.length > JOURNEY_SCAN_CAP ? scanned.slice(0, JOURNEY_SCAN_CAP) : scanned;

  const analysesByLabel = readAnalysesByLabel(workspaceId);
  const totals = countTotals(allEntries, workspaceId, analysesByLabel);

  const page = allEntries.slice(offset, offset + limit);
  const sources = readSources(page, workspaceId, analysesByLabel);
  const chain = chainStatus(workspaceId);

  // Cluster key: `job_id`, exactly as the board groups. An entry with no job at all
  // still has a journey, so it clusters under the empty key rather than vanishing.
  const clusterOrder: string[] = [];
  const byCluster = new Map<string, EntryRow[]>();
  for (const entry of page) {
    const key = entry.job_id ?? "";
    const bucket = byCluster.get(key);
    if (bucket) bucket.push(entry);
    else {
      byCluster.set(key, [entry]);
      clusterOrder.push(key);
    }
  }

  const totalByCluster = new Map<string, number>();
  for (const entry of allEntries) {
    const key = entry.job_id ?? "";
    totalByCluster.set(key, (totalByCluster.get(key) ?? 0) + 1);
  }

  const clusters: RoleCluster[] = clusterOrder.map((jobId) => {
    const rows = byCluster.get(jobId) ?? [];
    const title = rows.find((r) => r.job_title)?.job_title ?? jobId;
    const band = readSharedBand(jobId || null, title || null, workspaceId);
    const columns = rows.map((entry) =>
      projectColumn(entry, sources.get(entry.id) ?? EMPTY_SOURCES, band.events, chain, workspaceId)
    );
    return {
      jobId,
      title,
      roleArea: clusterRoleArea(jobId, workspaceId),
      openedAt: clusterOpenedAt(jobId, rows, workspaceId),
      sharedEvents: band.events,
      sharedEventsUnlinked: band.unlinked,
      rail: journeyRail(columns),
      columns,
      totalColumns: totalByCluster.get(jobId) ?? columns.length,
    };
  });

  return {
    clusters,
    query: { ...(opts.role ? { role: opts.role } : {}), activeOnly, limit, offset },
    totals,
  };
}

/** A journey still active with nothing recorded for this long has stalled. The board's
 *  own silence marker fires at 7 days between two rows; a whole journey going quiet
 *  for three weeks is the stronger claim the cohort makes. */
export const JOURNEY_STALL_DAYS = 21;

function cohortOutcome(entry: EntryRow, steps: readonly JourneyCohortStep[], now: number): JourneyCohortOutcome {
  if (entry.stage === "Hired") return "hired";
  if (entry.status === "rematched") return "rematched";
  if (entry.status === "rejected") return "rejected";
  if (isTerminalEntryStatus(entry.status)) return "withdrawn";
  const lastKind = steps[steps.length - 1]?.kind;
  if (lastKind === "withdrawn" || lastKind === "offer_expired") return "withdrawn";
  const last = Date.parse(steps[steps.length - 1]?.at ?? entry.created_at ?? "");
  if (Number.isFinite(last) && now - last > JOURNEY_STALL_DAYS * 86_400_000) return "stalled";
  return "open";
}

/**
 * The cohort layer's read: EVERY journey in the workspace (bounded by the scan cap),
 * each reduced to its ordered step kinds, times and actor class. The standard path,
 * coverage and failures are derived on the client from these, over the whole
 * workspace - never over a page, which is the defect the board's paging carries.
 */
export function journeyCohort(opts: { workspaceId: string; now?: number }): JourneyCohort {
  const workspaceId = opts.workspaceId || DEFAULT_WORKSPACE_ID;
  const now = opts.now ?? Date.now();
  const scanned = readEntries(workspaceId, {});
  const entries = scanned.length > JOURNEY_SCAN_CAP ? scanned.slice(0, JOURNEY_SCAN_CAP) : scanned;
  const analysesByLabel = readAnalysesByLabel(workspaceId);
  const sources = readSources(entries, workspaceId, analysesByLabel);
  const chain = chainStatus(workspaceId);

  const roles = new Map<string, JourneyCohortRole>();
  const instances: JourneyCohortInstance[] = entries.map((entry) => {
    const jobId = entry.job_id ?? "";
    const role = roles.get(jobId);
    if (role) role.n++;
    else roles.set(jobId, { jobId, title: entry.job_title ?? jobId, roleArea: clusterRoleArea(jobId, workspaceId), n: 1 });
    const steps: JourneyCohortStep[] = projectEvents(entry, sources.get(entry.id) ?? EMPTY_SOURCES, chain)
      .map((e): JourneyCohortStep => ({ kind: e.kind, at: e.occurredAt, actor: e.actor ? (journeyActorIsMachine(e.actor) ? "machine" : "human") : null }))
      .sort((a, b) => a.at.localeCompare(b.at));
    return { id: entry.id, jobId, outcome: cohortOutcome(entry, steps, now), steps };
  });

  return {
    roles: [...roles.values()].sort((a, b) => b.n - a.n),
    instances,
    scanned: scanned.length,
    capped: scanned.length > JOURNEY_SCAN_CAP,
    asOf: new Date(now).toISOString(),
  };
}

/** When this role opened. `jobs.created_at` when the corpus holds the job; otherwise
 *  the earliest entry on the board for it — a REAL stored instant either way. A role
 *  whose job row is gone does not get a made-up opening date. */
/** The area a role sits in (`jobs.role_family`), for grouping the role picker.
 *  NULL when no job row exists or it records no family — never a guessed bucket. */
function clusterRoleArea(jobId: string, workspaceId: string): string | null {
  if (!jobId) return null;
  // Same tenant predicate as clusterOpenedAt: `jobs.workspace_id` is NULL for the
  // SHARED cross-company corpus, so accept this workspace's row or the shared one.
  const job = ensureDb()
    .prepare(`SELECT role_family FROM jobs WHERE id = ? AND (workspace_id = ? OR workspace_id IS NULL) LIMIT 1`)
    .get(jobId, workspaceId) as { role_family: string | null } | undefined;
  const area = job?.role_family?.trim();
  return area ? area : null;
}

function clusterOpenedAt(jobId: string, rows: readonly EntryRow[], workspaceId: string): string {
  if (jobId) {
    // `jobs.workspace_id` is NULL for the SHARED cross-company corpus (core.ts:1809-1812),
    // so the tenant check accepts either this workspace's row or the shared one.
    const job = ensureDb()
      .prepare(`SELECT created_at FROM jobs WHERE id = ? AND (workspace_id = ? OR workspace_id IS NULL) LIMIT 1`)
      .get(jobId, workspaceId) as { created_at: string } | undefined;
    if (job?.created_at) return job.created_at;
  }
  const earliest = rows.map((r) => r.created_at).filter((v): v is string => !!v).sort()[0];
  return earliest ?? "";
}

/** Counts over the WHOLE (filtered) workspace. Every figure is a real count of real
 *  rows; nothing here is extrapolated from the page. */
function countTotals(
  entries: readonly EntryRow[],
  workspaceId: string,
  analysesByLabel: Map<string, AnalysisScanRow[]>
): JourneyBoard["totals"] {
  const roles = new Set(entries.map((e) => e.job_id ?? ""));
  const ids = entries.map((e) => e.id);
  if (ids.length === 0) return { roles: 0, columns: 0, events: 0 };
  const db = ensureDb();

  const countRows = (sql: (placeholders: string) => string): number =>
    readIn(ids, (idsChunk, placeholders) => db.prepare(sql(placeholders)).all(workspaceId, ...idsChunk) as { n: number }[]).reduce(
      (sum, r) => sum + Number(r.n ?? 0),
      0
    );

  let events = 0;
  events += countRows((p) => `SELECT COUNT(*) AS n FROM pipeline_events WHERE workspace_id = ? AND entry_id IN (${p})`);
  events += countRows((p) => `SELECT COUNT(*) AS n FROM consent_events WHERE workspace_id = ? AND entry_id IN (${p})`);
  events += countRows((p) => `SELECT COUNT(*) AS n FROM interview_sessions WHERE workspace_id = ? AND entry_id IN (${p})`);

  const decisions = listDecisionRecordsForRefs(ids, { workspaceId, limit: 1000 });
  for (const records of decisions.values()) events += records.length;

  // The analysis join has no index to stand on, so it is counted from the ONE bounded
  // scan the board already read rather than with a query of its own.
  for (const entry of entries) {
    const label = journeyNormalizeLabel(entry.candidate_label);
    if (!label) continue;
    const entryJdSlug = jdSlugOfJobId(entry.job_id);
    for (const a of analysesByLabel.get(label) ?? []) {
      if (
        journeyAnalysisAttachment({
          entryLabel: entry.candidate_label,
          entryJdSlug,
          analysisLabel: a.candidate_label,
          analysisJdSlug: a.jd_slug,
        }) !== "none"
      ) {
        events += 1;
      }
    }
  }

  const submissionIds = entries.map((e) => e.dev_submission_id).filter((v): v is string => !!v);
  if (submissionIds.length > 0) {
    for (const idsChunk of chunk(submissionIds, SQL_IN_CHUNK)) {
      const p = idsChunk.map(() => "?").join(", ");
      const subs = db
        .prepare(`SELECT COUNT(*) AS n FROM dev_submissions WHERE workspace_id = ? AND id IN (${p})`)
        .get(workspaceId, ...idsChunk) as { n: number };
      const sess = db
        .prepare(`SELECT COUNT(*) AS n FROM dev_sessions WHERE workspace_id = ? AND submission_id IN (${p})`)
        .get(workspaceId, ...idsChunk) as { n: number };
      events += Number(subs?.n ?? 0) + Number(sess?.n ?? 0);
    }
  }

  return { roles: roles.size, columns: entries.length, events };
}

/** ONE candidate's column, resolved by entry id. Null when the entry is unknown or
 *  belongs to another team — the route answers the same way for both, so a
 *  cross-tenant probe learns nothing an unknown id would not tell it. */
export function journeyColumn(entryId: string, workspaceId: string): JourneyColumn | null {
  const view = journeyEntryView(entryId, workspaceId);
  return view ? view.column : null;
}

/** The column PLUS the second detail layer for every row on it, in one read — the
 *  shape `GET /api/journeys/[entryId]` serves, so the board opens a candidate with a
 *  single request rather than one per row. */
export function journeyEntryView(
  entryId: string,
  workspaceId: string
): { column: JourneyColumn; sharedEvents: JourneyEvent[]; sharedEventsUnlinked: boolean; details: JourneyEventDetail[] } | null {
  const [entry] = readEntries(workspaceId, { entryId });
  if (!entry) return null;
  const analysesByLabel = readAnalysesByLabel(workspaceId);
  const sources = readSources([entry], workspaceId, analysesByLabel).get(entry.id) ?? EMPTY_SOURCES;
  const band = readSharedBand(entry.job_id, entry.job_title, workspaceId);
  const column = projectColumn(entry, sources, band.events, chainStatus(workspaceId), workspaceId);
  const withheld = consentWithholdsPii({
    givenAt: entry.consent_given_at,
    expiresAt: entry.consent_expires_at,
    anonymizedAt: entry.anonymized_at,
  });
  const details = column.events.map((event) => eventDetail(event, sources, withheld));
  return { column, sharedEvents: band.events, sharedEventsUnlinked: band.unlinked, details };
}

export function journeyEventDetail(entryId: string, eventId: string, workspaceId: string): JourneyEventDetail | null {
  const view = journeyEntryView(entryId, workspaceId);
  return view?.details.find((d) => d.eventId === eventId) ?? null;
}

/**
 * The two detail layers for one row.
 *
 *   `card`   — the fact card: the row's own facts plus the things the board's
 *              `journey.detail.*` labels name (actor, both clocks, phase, topic).
 *   `source` — the underlying evidence, OMITTED when the source row carries none.
 *
 * CONSENT GATE. A transcript excerpt is the most sensitive thing on this surface, so
 * it is withheld for an entry whose consent has lapsed or been anonymized — the same
 * `consentWithholdsPii` read-time control `candidate-timeline.ts:316-343` applies to
 * the interview outcome. The row itself stays; only the verbatim evidence goes.
 */
function eventDetail(event: JourneyEvent, sources: ColumnSources, consentWithheld: boolean): JourneyEventDetail {
  const card: Record<string, JourneyFactValue> = {
    actor: event.actor,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    phase: event.phase,
    ...(event.topicCode ? { topic: event.topicCode } : {}),
    ...(event.confidence ? { confidence: event.confidence } : {}),
    ...event.facts,
  };
  const source = eventSource(event, sources, consentWithheld);
  return { eventId: event.id, card, ...(source ? { source } : {}) };
}

function eventSource(
  event: JourneyEvent,
  sources: ColumnSources,
  consentWithheld: boolean
): JourneyEventDetail["source"] {
  const id = event.sourceRef.id;
  switch (event.sourceRef.table) {
    case "decision_records": {
      const record = sources.decisions.find((d) => String(d.seq) === id);
      const excerpt = bounded(record?.rationale, EXCERPT_MAX);
      return excerpt ? { labelKey: "detail.sourceDecision", excerpt } : undefined;
    }
    case "analyses": {
      const analysis = sources.analyses.find((a) => a.slug === id);
      const excerpt = bounded(analysis?.decision_note, EXCERPT_MAX);
      return excerpt ? { labelKey: "detail.sourceAnalysis", excerpt } : undefined;
    }
    case "interview_sessions": {
      if (consentWithheld) return undefined;
      const session = sources.interviews.find((s) => s.id === id);
      if (!session?.transcript_json) return undefined;
      const turns = safeRowParse<{ role?: string; text?: string }[]>(session.transcript_json, "journey.transcript", id);
      if (!Array.isArray(turns) || turns.length === 0) return undefined;
      // The FIRST exchange, never the whole transcript: the board's second layer is an
      // excerpt with a way through to the real thing, not a transcript viewer.
      const opening = turns.find((t) => t.role === "interviewer" && t.text)?.text;
      const reply = turns.find((t) => t.role === "candidate" && t.text)?.text;
      const excerpt = bounded(opening ?? reply, EXCERPT_MAX);
      if (!excerpt) return undefined;
      const replyExcerpt = opening ? bounded(reply, EXCERPT_MAX) : undefined;
      return { labelKey: "detail.sourceTranscript", excerpt, ...(replyExcerpt ? { reply: replyExcerpt } : {}) };
    }
    default:
      // pipeline_events, consent_events, dev_* and intake_events carry no evidence
      // BEYOND the facts already on the card. `journey.detail.noSource` is what the
      // board says here, and saying nothing further was stored is the honest answer.
      return undefined;
  }
}
