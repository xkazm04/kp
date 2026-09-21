import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { eventKindClause, EVENT_SORT_COLUMNS } from "./pipeline-core";

export type PipelineEvent = {
  id: number;
  entryId: string | null;
  candidateLabel: string | null;
  jobTitle: string | null;
  archetype: string | null;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
  // UAT LUC-ANA-4 — WHO took the action, in the decision-chain actor vocabulary
  // ("human:Petra Nováková" / "human:recruiter" / "auto:screen-wave"). null on legacy
  // rows and on any writer that cannot name an actor; parse it with parseEventActor
  // (decision-attribution.ts), which reports that state as "not identified" rather than
  // defaulting it to a person or to the machine.
  //
  // OPTIONAL rather than required only so pre-existing test fixtures that build this
  // shape by hand keep compiling — every real producer (the three list functions below)
  // always sets it, and absent reads exactly like null at every consumer. NOT on the
  // public activity feed: toPublicPipelineEvent's allowlist deliberately omits it, so an
  // unauthenticated reader never learns which staff member decided what.
  actor?: string | null;
};

export type PipelineEventSortColumn = keyof typeof EVENT_SORT_COLUMNS;

export function isPipelineEventSortColumn(value: string | null | undefined): value is PipelineEventSortColumn {
  return value != null && Object.prototype.hasOwnProperty.call(EVENT_SORT_COLUMNS, value);
}

export function listPipelineEvents(
  limit = 40,
  offset = 0,
  kinds?: readonly string[],
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  sort?: { col: PipelineEventSortColumn; dir: "asc" | "desc" }
): PipelineEvent[] {
  const db = ensureDb();
  const filter = eventKindClause(kinds);
  // Resolved through the allowlist above, never interpolated from the caller.
  const col = EVENT_SORT_COLUMNS[sort?.col ?? "createdAt"];
  const dir = sort?.dir === "asc" ? "ASC" : "DESC";
  // NULLS: candidate_label / job_title are null on board-level events. SQLite
  // sorts NULL first ascending, which would open the table with a page of rows
  // that have nothing in the column being sorted. Push them last in BOTH
  // directions — the same rule the client-side useTableSort comparator keeps, so
  // the two halves of the table kit cannot disagree about what "missing" means.
  const orderBy = `(${col} IS NULL) ASC, ${col} ${dir}, id DESC`;
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at, actor
       FROM pipeline_events WHERE workspace_id = ?${filter.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .all(workspaceId, ...filter.params, limit, offset) as Array<{
    id: number;
    entry_id: string | null;
    candidate_label: string | null;
    job_title: string | null;
    archetype: string | null;
    kind: string;
    from_stage: string | null;
    to_stage: string | null;
    detail: string | null;
    created_at: string;
    actor: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    candidateLabel: r.candidate_label,
    jobTitle: r.job_title,
    archetype: r.archetype,
    kind: r.kind,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    detail: r.detail,
    createdAt: r.created_at,
    actor: r.actor,
  }));
}

/** Every event for ONE entry, OLDEST-FIRST — the candidate's story (applied →
 *  screened → advanced → scheduled → …) for the drawer's per-candidate history
 *  (PIPE3). Full detail (kind/from-to stage/detail), unlike the anonymized public
 *  activity feed: this is keyed by the internal entry id a recruiter surface
 *  already holds, so it's the same recruiter-data posture as /api/interview/by-entry. */
export function listPipelineEventsForEntry(entryId: string, limit = 50, workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEvent[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at, actor
       FROM pipeline_events WHERE entry_id = ? AND workspace_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`
    )
    .all(entryId, workspaceId, limit) as Array<{
    id: number;
    entry_id: string | null;
    candidate_label: string | null;
    job_title: string | null;
    archetype: string | null;
    kind: string;
    from_stage: string | null;
    to_stage: string | null;
    detail: string | null;
    created_at: string;
    actor: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    candidateLabel: r.candidate_label,
    jobTitle: r.job_title,
    archetype: r.archetype,
    kind: r.kind,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    detail: r.detail,
    createdAt: r.created_at,
    actor: r.actor,
  }));
}

/** Events strictly newer than `sinceId`, OLDEST-FIRST (idea-85f043ea). The
 *  AUTOINCREMENT primary key is the cursor — monotonic, gap-tolerant, immune to
 *  same-millisecond created_at ties. Oldest-first with a bounded LIMIT is the
 *  loss-free contract: when a burst outruns the limit, the caller still gets
 *  the OLDEST pending events and advances its cursor to the last id returned,
 *  catching up across polls — a newest-first LIMIT would silently drop the
 *  middle of the burst, which is exactly the bug this replaces. */
export function listPipelineEventsSince(sinceId: number, limit = 200, workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEvent[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at, actor
       FROM pipeline_events WHERE id > ? AND workspace_id = ? ORDER BY id ASC LIMIT ?`
    )
    .all(sinceId, workspaceId, limit) as Array<{
    id: number;
    entry_id: string | null;
    candidate_label: string | null;
    job_title: string | null;
    archetype: string | null;
    kind: string;
    from_stage: string | null;
    to_stage: string | null;
    detail: string | null;
    created_at: string;
    actor: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    candidateLabel: r.candidate_label,
    jobTitle: r.job_title,
    archetype: r.archetype,
    kind: r.kind,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    detail: r.detail,
    createdAt: r.created_at,
    actor: r.actor,
  }));
}

// Total recorded events — lets the decision-log endpoint compute `hasMore`
// without over-fetching, so the UI can page through the full audit trail.
export function countPipelineEvents(kinds?: readonly string[], workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const db = ensureDb();
  const filter = eventKindClause(kinds);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM pipeline_events WHERE workspace_id = ?${filter.sql}`).get(workspaceId, ...filter.params) as {
    n: number;
  };
  return row.n;
}

// ---- Coded event details --------------------------------------------------------
//
// The record-vs-screen split automation-run.ts already runs for its own events: the
// STORE writes a machine token, the SCREEN resolves it in the reader's language. Six
// of this file's `recordEvent` calls used to store an English SENTENCE as the detail
// ("Role closed — candidate withdrawn from the pipeline."), which the activity feed
// then painted verbatim — so a Czech or German recruiter read the localized verb
// followed by an English explanation of it.
//
// The vocabulary is a literal array + derived union + a Record-typed rendering pin,
// the closed-vocabulary idiom this repo uses for tabs.ts and EVENT_KINDS: a code with
// no catalog entry in all four locales fails pipeline-event-reasons.test.ts.
//
// LEGACY ROWS STILL RENDER. useEventVerb only takes the coded branch when the detail
// matches `reason:<letters>`; every row written before this change is English prose or
// a machine handle and falls through to the existing rendering untouched. Nothing is
// migrated, and nothing needs to be.
export const PIPELINE_REASON_CODES = [
  // closeEntriesByJobId / reopenEntriesByJobId — the JOB2 role-lifecycle pair.
  "roleClosedWithdrawn",
  "roleReopenedRestored",
  // reinstatePipelineEntry — a human overruling the machine's auto-reject.
  "autoRejectionReversed",
  // mergeReapplication — a degraded intake resolved by hand.
  "intakeCapturedManually",
  // setEntryGithubEvidence — the drawer's on-demand deep dive.
  "githubDeepDiveFromDrawer",
  // setPipelineEntryStage — a recruiter dragging a card, as opposed to the
  // automation pass's `auto_advanced`.
  "manualStageMove",
  // createPipelineEntry — the plain, non-degraded add. The degraded branch beside it
  // keeps its free-text reason: that one is a real diagnostic, not a fixed sentence.
  "addedToPipeline",
] as const;
export type PipelineReasonCode = (typeof PIPELINE_REASON_CODES)[number];

/** Wire prefix for a coded event detail. Duplicated from automation-run.ts rather
 *  than imported, for the reason stated there: the renderer that parses it
 *  (pipelineEventCatalog.ts `useEventVerb`) is a client component and cannot import
 *  a module that opens SQLite, so the prefix lives at each end and is pinned from
 *  both sides by a test. */
export const PIPELINE_REASON_PREFIX = "reason:";
/** The detail string to STORE for a coded reason. */
export function pipelineReasonDetail(code: PipelineReasonCode): string {
  return `${PIPELINE_REASON_PREFIX}${code}`;
}
