import type Database from "better-sqlite3";
import type { ApprovalKind } from "../approval-kinds";
import { isTerminalEntryStatus, TERMINAL_ENTRY_STATUSES } from "../pipeline-status";
import { normalizeApplicantName, normalizeContact } from "../apply-intake";
import { chunk, SQL_IN_CHUNK } from "../entries-param";
import { randomToken } from "../random-id";
import { CONSENT_TTL_DAYS, consentExpiresAt, consentWithholdsPii, maskCandidateName, scrubPiiFromPayload } from "../consent";
import { anonymizeProfile } from "./profiles";
import { coerceGithubEvidenceSummary, type GithubEvidenceSummary } from "../github-summary";
import { recordPipelineOutcome } from "../dev-outcomes";
import { recordAudit } from "../dev-control";
import { ensureDb, recordEvent, type PipelineEntry } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { revokeOpenInterviewSessions } from "./interviews";

// ---- Hiring pipeline (Phase 10) -------------------------------------------

// The canonical stage axis + the archetype-fairness predicate live in the pure,
// DB-free pipeline-stages module (so the metric is unit-testable). Re-exported here
// so existing `import { PIPELINE_STAGES } from "./db"` call sites keep working.
import {
  PIPELINE_STAGES,
  FUNNEL_STAGES,
  SCREENING_STAGES,
  hasAdvancedPastScreening,
  isScreeningStage,
  screenStageOutcome,
  type PipelineStage,
  type FunnelStage,
  type ScreeningStage,
} from "../pipeline-stages";

export { PIPELINE_STAGES, FUNNEL_STAGES, SCREENING_STAGES, hasAdvancedPastScreening, isScreeningStage, screenStageOutcome };
export type { PipelineStage, FunnelStage, ScreeningStage };

// Canonical shape of a /api/pipeline row. That endpoint returns listPipeline()
// (PipelineEntry[]) verbatim, so this IS the client-facing view contract. Client
// consumers (SimulationProvider, ChannelsTab) import this with `import type`
// instead of re-declaring divergent, partial local row types — those drift
// silently from the server the moment a field is renamed. (`import type` is
// erased at compile time, so no server code enters the client bundle.)
export type PipelineEntryView = PipelineEntry;

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
};

// ANA5 — optional kind narrowing for the decision log. The IN-list binds every
// value as a parameter (never interpolated) and is bounded so a hostile query
// string can't balloon the statement; the route resolves an `attribution`
// filter to its kind set through the shared decision-attribution map.
const EVENT_KIND_FILTER_MAX = 64;
function eventKindClause(kinds?: readonly string[]): { sql: string; params: string[] } {
  if (!kinds || kinds.length === 0) return { sql: "", params: [] };
  const bounded = kinds.slice(0, EVENT_KIND_FILTER_MAX);
  // AND-clause — the caller always prepends `WHERE workspace_id = ?` (P1 tenant scope).
  return { sql: ` AND kind IN (${bounded.map(() => "?").join(", ")})`, params: [...bounded] };
}

/** The columns the decision log may order by, mapped to real SQL.
 *
 *  An ALLOWLIST, not a passthrough: the sort column reaches this from a query
 *  param, and interpolating a caller-supplied string into ORDER BY is a SQL
 *  injection even though better-sqlite3 parameterizes everything else here —
 *  bindings cannot stand in for an identifier, so the safety has to come from
 *  the value never being caller-controlled in the first place.
 *
 *  `id DESC` is appended to every ordering as a stable tiebreak. Without it two
 *  events sharing a timestamp can swap places between two pages of the SAME
 *  query, so a row is shown twice and another never at all — the classic
 *  unstable-pagination bug, and worse here than usual because this is the audit
 *  trail. */
const EVENT_SORT_COLUMNS = {
  createdAt: "created_at",
  candidateLabel: "candidate_label",
  jobTitle: "job_title",
  kind: "kind",
} as const;

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
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
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
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
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
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
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

type PipelineRow = {
  id: string;
  candidate_id: string | null;
  candidate_label: string;
  archetype: string | null;
  role_family: string | null;
  job_id: string | null;
  job_title: string | null;
  stage: string;
  match_score: number | null;
  status: string;
  approval_kind: string | null;
  approval_detail: string | null;
  created_at: string | null;
  stage_changed_at: string | null;
  intake_degraded: number | null;
  intake_degraded_reason: string | null;
  contact: string | null;
  locale?: string | null;
  github_json?: string | null;
  github_handle?: string | null;
  source_channel?: string | null;
  source_campaign?: string | null;
  source_variant?: string | null;
  // Persistent recruiter note (drawer autosave); absent on SELECTs that omit it.
  notes?: string | null;
  // Lead enrichment hand-off columns. Deliberately NOT mapped onto PipelineEntry:
  // that type IS the /api/pipeline client view contract, and a capability token
  // must never ride a list payload into the browser. Read via findEntryByLeadToken.
  lead_token?: string | null;
  lead_passed_ko_json?: string | null;
  // Recorded unmet-checklist gaps for this entry's profile — read through
  // findEntryByLeadToken (candidate follow-up) and entryProfileGaps (server-side),
  // not mapped onto the PipelineEntry client view.
  profile_gaps_json?: string | null;
  // GDPR consent lifecycle (consent.ts). The 4 dated fields map onto PipelineEntry;
  // erasure_token does NOT (capability token, internal-only, like lead_token).
  consent_given_at?: string | null;
  consent_expires_at?: string | null;
  consent_source?: string | null;
  anonymized_at?: string | null;
  erasure_token?: string | null;
  // Present on every row (all reads are SELECT *); mapped onto PipelineEntry so a
  // caller holding an entry never has to be told its tenant separately.
  workspace_id?: string | null;
};

function rowToEntry(r: PipelineRow): PipelineEntry {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    candidateLabel: r.candidate_label,
    archetype: r.archetype,
    roleFamily: r.role_family,
    jobId: r.job_id,
    jobTitle: r.job_title,
    stage: r.stage,
    matchScore: r.match_score,
    status: r.status,
    // DB column is free-form TEXT (also written by the Python seed); narrow to the
    // documented union at the read boundary.
    approvalKind: r.approval_kind as ApprovalKind | null,
    approvalDetail: r.approval_detail,
    createdAt: r.created_at,
    stageChangedAt: r.stage_changed_at,
    // Stored as 0/1 (and absent on a SELECT that omits the column) — coerce to bool.
    intakeDegraded: r.intake_degraded === 1,
    intakeDegradedReason: r.intake_degraded_reason ?? null,
    contact: r.contact ?? null,
    locale: r.locale ?? null,
    githubEvidence: parseGithubEvidence(r.github_json, r.id),
    githubHandle: r.github_handle ?? null,
    sourceChannel: r.source_channel ?? null,
    sourceCampaign: r.source_campaign ?? null,
    sourceVariant: r.source_variant ?? null,
    notes: r.notes ?? null,
    consentGivenAt: r.consent_given_at ?? null,
    consentExpiresAt: r.consent_expires_at ?? null,
    consentSource: r.consent_source ?? null,
    anonymizedAt: r.anonymized_at ?? null,
    // CONTRACT: every query that feeds rowToEntry must SELECT workspace_id. Most
    // are `SELECT *` and get it free; the two explicit column lists in this file
    // (listPipeline, listReconsiderQueue) name it deliberately. Omitting it does
    // not fail — it silently reports the DEFAULT team for a row that belongs to
    // another, which is worse than the missing field this replaced, because the
    // value now looks authoritative. devcase-source-promote-tenancy.test.ts
    // catches it behaviourally; a source-level check would not.
    workspaceId: r.workspace_id ?? DEFAULT_WORKSPACE_ID,
  };
}

// GH2 — revive the per-entry GitHub evidence at the read boundary. Re-coerced
// on every read (same validator the POST boundary uses) so a corrupt or
// legacy-shaped column degrades to null, never an unbounded blob on the board
// payload. NULL column (the overwhelmingly common case) costs nothing.
function parseGithubEvidence(githubJson: string | null | undefined, entryId: string): GithubEvidenceSummary | null {
  if (!githubJson) return null;
  try {
    return coerceGithubEvidenceSummary(JSON.parse(githubJson));
  } catch (error) {
    console.error(`[db] corrupt github_json on pipeline entry "${entryId}"`, error);
    return null;
  }
}

// SQL list literal of the terminal statuses, e.g. ('rejected', 'declined'),
// derived from the taxonomy const so the active-pipeline filters can't drift from
// it. The values are trusted compile-time literals (never user input), so inlining
// them into the statement is injection-safe.
const TERMINAL_STATUS_SQL_LIST = `(${TERMINAL_ENTRY_STATUSES.map((s) => `'${s}'`).join(", ")})`;

// Calibration of the ACTING score (REC-02). The analytics reliability curve used
// to measure ONLY `analyses.score × recruiter disposition` — a pair nothing in
// the pipeline flow ever writes (live n=0 with a full pipeline on disk) — while
// the score that actually gates candidates (`pipeline_entries.match_score`: the
// screen-wave threshold, advance-top-N, the policy pass) was never calibrated.
// This produces (prediction, outcome) pairs from the pipeline itself:
//
//   prediction — the entry's stored match_score (the number the screen gate
//     thresholds; see the canonical producer map in app/_lib/match-score.ts).
//   outcome 1  — the entry advanced beyond the screen gate (stage Interview/
//     Offer/Hired), whatever happened later: a candidate rejected AT interview
//     or declining an offer still validated "this score advances past screening".
//   outcome 0  — closed out as `rejected` while still at Accepted/Screened
//     (recruiter or auto-reject — the adverse decision the score fed).
//   excluded   — still pending at Accepted/Screened, and the non-merit terminal
//     statuses there (declined/role_closed/rematched): not a screen verdict.
//     Unscored entries never enter (no fabricated 0 — the REC-03 policy).
//
// Tenant scope (P1): the calibration curve is a per-team reliability metric.
// `at` carries the entry's created_at so the calibration engine can bucket pairs
// into drift cohorts (Direction 1). `entryId`/`label`/`live` ride the band-drill
// producer (Direction 2) so a mis-calibrated bin can be opened to the exact
// candidates behind it — never on the aggregate pair (it would bloat every curve).
export type PipelineCalibrationPair = { score: number; outcome: 0 | 1; roleFamily: string | null; at: string };

export type CalibrationBandCandidate = {
  entryId: string;
  label: string;
  score: number;
  outcome: 0 | 1;
  roleFamily: string | null;
  // Openable in the board when the entry is still active; a rejected (outcome 0)
  // entry is terminal, so it's listed but not linked (records outlive the board).
  live: boolean;
};

const CALIBRATION_ADVANCED_STAGES = new Set(["Interview", "Offer", "Hired"]);

export function pipelineCalibrationPairs(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  // CALIBRATION HOLDOUT (UAT KAT-L1-001). When present, restrict the pairs to this
  // set of entry ids — the calibration CLEAN ARM. The screening wave spares a small
  // random sample of would-be auto-rejects; their eventual advance/reject is a HUMAN
  // decision, not one the score mechanically produced, so a curve over just these
  // entries breaks the label leakage that makes the default (all-pairs) curve
  // circular. The inclusion rule is IDENTICAL to the contaminated curve's — the only
  // difference is which entries are eligible — so the two are directly comparable.
  opts?: { onlyEntryIds?: ReadonlySet<string> }
): PipelineCalibrationPair[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, match_score AS score, stage, status, role_family, created_at FROM pipeline_entries
       WHERE match_score IS NOT NULL AND workspace_id = ?`
    )
    .all(workspaceId) as { id: string; score: number; stage: string; status: string; role_family: string | null; created_at: string }[];
  const only = opts?.onlyEntryIds;
  const pairs: PipelineCalibrationPair[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.score)) continue; // bad migration/manual edit — never NaN into the math
    if (only && !only.has(r.id)) continue; // clean-arm filter (holdout source only)
    if (CALIBRATION_ADVANCED_STAGES.has(r.stage)) {
      pairs.push({ score: r.score, outcome: 1, roleFamily: r.role_family, at: r.created_at });
    } else if (r.status === "rejected") {
      pairs.push({ score: r.score, outcome: 0, roleFamily: r.role_family, at: r.created_at });
    }
  }
  return pairs;
}

// Direction 2 — the candidates behind ONE calibration score band, workspace-scoped.
// Applies the SAME inclusion rule as pipelineCalibrationPairs (advanced past the
// screen gate = 1, rejected there = 0; pending/unscored/non-merit-terminal
// excluded) so a bin's drilldown can never show a candidate the curve didn't
// count. Score band is [loPct, hiPct); the top bin includes 100 (inclusiveHi).
export function pipelineCalibrationBandCandidates(
  loPct: number,
  hiPct: number,
  inclusiveHi: boolean,
  roleFamily: string | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): CalibrationBandCandidate[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, candidate_label, match_score AS score, stage, status, role_family FROM pipeline_entries
       WHERE match_score IS NOT NULL AND workspace_id = ?
         AND match_score >= ? AND (match_score < ? ${inclusiveHi ? "OR match_score = ?" : ""})
       ORDER BY match_score DESC, candidate_label ASC`
    )
    .all(...(inclusiveHi ? [workspaceId, loPct, hiPct, hiPct] : [workspaceId, loPct, hiPct])) as {
    id: string;
    candidate_label: string;
    score: number;
    stage: string;
    status: string;
    role_family: string | null;
  }[];
  const out: CalibrationBandCandidate[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.score)) continue;
    if (roleFamily && r.role_family !== roleFamily) continue;
    let outcome: 0 | 1;
    if (CALIBRATION_ADVANCED_STAGES.has(r.stage)) outcome = 1;
    else if (r.status === "rejected") outcome = 0;
    else continue; // pending / non-merit terminal — not part of the calibration set
    out.push({
      entryId: r.id,
      label: r.candidate_label,
      score: r.score,
      outcome,
      roleFamily: r.role_family,
      live: !isTerminalEntryStatus(r.status),
    });
  }
  return out;
}

export function listPipeline(workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      // Exclude BOTH terminal states (recruiter `rejected` and candidate
      // `declined`) from the active pipeline view — this used to be a bare
      // `status != 'rejected'`, which leaked declined entries back into the board.
      // github_json / github_handle ride the board payload so the drawer can
      // render attached evidence and offer the on-demand deep-dive for an
      // inbound applicant who shared a handle at apply (both bounded at the
      // rowToEntry read boundary). notes rides it too — the drawer's persistent
      // scratchpad hydrates from the entry it was opened with. source_channel /
      // source_campaign / source_variant ride it so the drawer's origin line renders
      // the channel AND its campaign/creative attribution (variant-reaches-the-drawer)
      // straight from the board-opened entry — the [id] GET already carried them via
      // SELECT *, so this closes the gap for the primary (board) open path.
      `SELECT id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
              stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at,
              intake_degraded, intake_degraded_reason, github_json, github_handle, notes,
              source_channel, source_campaign, source_variant, workspace_id
       FROM pipeline_entries WHERE status NOT IN ${TERMINAL_STATUS_SQL_LIST} AND workspace_id = ?
       ORDER BY job_title, match_score DESC`
    )
    .all(workspaceId) as PipelineRow[];
  return rows.map(rowToEntry);
}

/** JOB2 — when a recruiter closes a role, withdraw its still-IN-FLIGHT candidates so a
 *  filled role stops being chased and stops inflating the active funnel. Marks every
 *  `active`, non-Hired entry for the job `role_closed` (a DISTINCT terminal status — they
 *  cleared the bar but lost the role to timing, NOT a merit reject, so reject-rate stays
 *  honest and they resurface as rediscovery silver medalists), records a `role_closed`
 *  event per entry for the timeline, and returns how many were withdrawn. The Hired entry
 *  (the candidate the role was filled with) keeps status 'active' and is left untouched.
 *  Atomic: the select + per-row update + event all run in one synchronous transaction. */
export function closeEntriesByJobId(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const db = ensureDb();
  const now = new Date().toISOString();
  const tx = db.transaction((): number => {
    const rows = db
      .prepare(
        `SELECT id, candidate_label, job_title, archetype, stage
           FROM pipeline_entries WHERE job_id = ? AND status = 'active' AND stage != 'Hired' AND workspace_id = ?`
      )
      .all(jobId, workspaceId) as { id: string; candidate_label: string; job_title: string | null; archetype: string; stage: string }[];
    for (const r of rows) {
      db.prepare(`UPDATE pipeline_entries SET status='role_closed', approval_kind=NULL, updated_at=? WHERE id=? AND workspace_id=?`).run(now, r.id, workspaceId);
      recordEvent(db, {
        entryId: r.id,
        candidateLabel: r.candidate_label,
        jobTitle: r.job_title,
        archetype: r.archetype,
        kind: "role_closed",
        fromStage: r.stage,
        toStage: r.stage,
        detail: "Role closed — candidate withdrawn from the pipeline.",
      });
    }
    return rows.length;
  });
  return tx();
}

/** Explicit inverse of closeEntriesByJobId (JOB2) — the reopen transition for a
 *  CLOSED role. Restores every entry THIS role's close withdrew (status
 *  `role_closed` → `active`) and records a `role_reopened` event per entry, ALL in
 *  one synchronous transaction. Returns how many were restored.
 *
 *  Why it's a first-class transition and not a side effect of re-sourcing
 *  (job-postings-lifecycle #1): reopen used to be "publish again and let sourcing
 *  incidentally un-terminal whatever the matcher re-selects". That left the
 *  pipeline half-resurrected — candidates the matcher no longer returned (or ALL of
 *  them when sourcing errored/matched nobody) stayed stranded in `role_closed` with
 *  a lying timeline, and there was NO audit event. Doing the restore here, up front
 *  and independent of sourcing, makes the reopen deterministic and complete.
 *
 *  Scoping is the safety property: `role_closed` is a DISTINCT terminal status
 *  written ONLY by closeEntriesByJobId, so `status='role_closed'` selects exactly
 *  the entries this close withdrew and NOTHING else — a candidate a recruiter
 *  `rejected`/`declined`/`rematched` on merit BEFORE the close carries a different
 *  terminal status and is deliberately left closed (a reopen must never un-do a
 *  human's merit reject). The close never touched `stage` (only `status`), so
 *  restoring `status` alone returns each candidate to their exact pre-close stage.
 *  The `AND status='role_closed'` guard on the UPDATE makes a lost race to a
 *  concurrent writer a no-op (no double-restore, no spurious event). */
export function reopenEntriesByJobId(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const db = ensureDb();
  const now = new Date().toISOString();
  const tx = db.transaction((): number => {
    const rows = db
      .prepare(
        `SELECT id, candidate_label, job_title, archetype, stage
           FROM pipeline_entries WHERE job_id = ? AND status = 'role_closed' AND workspace_id = ?`
      )
      .all(jobId, workspaceId) as { id: string; candidate_label: string; job_title: string | null; archetype: string; stage: string }[];
    let restored = 0;
    for (const r of rows) {
      const res = db
        .prepare(`UPDATE pipeline_entries SET status='active', updated_at=? WHERE id=? AND status='role_closed' AND workspace_id=?`)
        .run(now, r.id, workspaceId);
      if (res.changes === 0) continue; // lost the flip to a concurrent writer
      recordEvent(db, {
        entryId: r.id,
        candidateLabel: r.candidate_label,
        jobTitle: r.job_title,
        archetype: r.archetype,
        kind: "role_reopened",
        fromStage: r.stage,
        toStage: r.stage,
        detail: "Role reopened — candidate restored to the pipeline.",
      });
      restored += 1;
    }
    return restored;
  });
  return tx();
}

// Prior pipeline outcomes per candidate — used by talent rediscovery to spot
// "silver medalists" (rejected/closed elsewhere) who fit a different role.
export type CandidateOutcome = { jobId: string | null; jobTitle: string | null; stage: string; status: string };

export function candidateOutcomes(workspaceId: string = DEFAULT_WORKSPACE_ID): Map<string, CandidateOutcome[]> {
  const rows = ensureDb()
    .prepare(`SELECT candidate_id, job_id, job_title, stage, status FROM pipeline_entries WHERE candidate_id IS NOT NULL AND workspace_id = ?`)
    .all(workspaceId) as { candidate_id: string; job_id: string | null; job_title: string | null; stage: string; status: string }[];
  const m = new Map<string, CandidateOutcome[]>();
  for (const r of rows) {
    const arr = m.get(r.candidate_id) ?? [];
    arr.push({ jobId: r.job_id, jobTitle: r.job_title, stage: r.stage, status: r.status });
    m.set(r.candidate_id, arr);
  }
  return m;
}

/** The candidate's TERMINAL pipeline entries in OTHER roles — the qualifying priors
 *  a manual rediscovery reach-out links to the freshly-minted target entry (the
 *  `rematched` re-engagement case). Only merit/timing terminals qualify:
 *  rejected (company passed), declined (candidate passed), role_closed (role filled
 *  out from under them) — exactly the silver-medalist statuses pickPrior surfaces.
 *  DELIBERATELY excludes any ACTIVE entry (a Hired candidate stays status='active',
 *  so it's excluded here too) — a re-engagement must never close a live application —
 *  and 'rematched' (already redirected; re-linking would just accrete duplicate
 *  links). SCOPED to workspaceId (direction 1): priors are read in the same tenant
 *  the reach-out runs in. Returns id + jobId so the caller can drive rematchSourceEntry. */
export function terminalPriorEntriesForCandidate(
  candidateId: string,
  excludeJobId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { id: string; jobId: string | null }[] {
  const key = (candidateId ?? "").trim();
  if (!key) return [];
  const rows = ensureDb()
    .prepare(
      `SELECT id, job_id FROM pipeline_entries
        WHERE candidate_id = ? AND workspace_id = ? AND (job_id IS NULL OR job_id != ?)
          AND status IN ('rejected', 'declined', 'role_closed')`
    )
    .all(key, workspaceId, excludeJobId) as { id: string; job_id: string | null }[];
  return rows.map((r) => ({ id: r.id, jobId: r.job_id }));
}

/** Which of these entries carry an event of `kind` (W8-5 — e.g. the durable
 *  outreach_sent markers backing the sourcing ranking's persisted state).
 *  Chunked IN query under the SQLite variable limit. */
export function entryIdsWithEvent(entryIds: string[], kind: string, workspaceId: string = DEFAULT_WORKSPACE_ID): Set<string> {
  const out = new Set<string>();
  if (entryIds.length === 0) return out;
  const db = ensureDb();
  for (const ids of chunk(entryIds, SQL_IN_CHUNK)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT DISTINCT entry_id FROM pipeline_events WHERE kind = ? AND entry_id IN (${placeholders}) AND workspace_id = ?`)
      .all(kind, ...ids, workspaceId) as { entry_id: string }[];
    for (const r of rows) out.add(r.entry_id);
  }
  return out;
}

/** All pipeline entries filed under a job (PREP1 — the compare grid unions the
 *  voice-interviewed cohort with human-scorecard-only entries from here). */
export function listEntriesForJob(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM pipeline_entries WHERE job_id = ? AND workspace_id = ? ORDER BY created_at ASC, id ASC`)
    .all(jobId, workspaceId) as PipelineRow[];
  return rows.map(rowToEntry);
}

/** Per-job pipeline rollup: how many candidates a role holds, how many cleared
 *  screening, and how many were hired. One GROUP BY for every job, so the JD
 *  library can show each role's pipeline state without N queries or pulling the
 *  whole analytics payload (the same "one query for all rows" shape as
 *  listJobStatuses / listJobRoleMeta / countAnalysesByJd, which the JD list route
 *  already composes).
 *
 *  Keyed by `job_id`, not by title: the library joins on jdJobId(slug), and two
 *  roles can legitimately share a title. The analytics `byJob` table groups by
 *  TITLE because it reports on roles as the recruiter names them; this reports on
 *  a specific JD's linked job, which is a different question with a different key.
 *
 *  The "reached interview" threshold is hasAdvancedPastScreening, the single
 *  source analytics uses for byJob — so the two surfaces cannot drift apart and
 *  report different numbers for the same role. */
export function listJobPipelineStats(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Record<string, { total: number; reachedInterview: number; hired: number }> {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT job_id, stage, COUNT(*) AS n
         FROM pipeline_entries
        WHERE job_id IS NOT NULL AND workspace_id = ?
        GROUP BY job_id, stage`
    )
    .all(workspaceId) as { job_id: string; stage: string; n: number }[];
  const out: Record<string, { total: number; reachedInterview: number; hired: number }> = {};
  for (const r of rows) {
    const m = (out[r.job_id] ??= { total: 0, reachedInterview: 0, hired: 0 });
    m.total += r.n;
    if (hasAdvancedPastScreening(r.stage)) m.reachedInterview += r.n;
    if (r.stage === "Hired") m.hired += r.n;
  }
  return out;
}

/** How many ACTIVE candidates sit on each stage, keyed by the stored stage value.
 *
 *  The question Settings → Hiring asks before letting a column be removed:
 *  "who is standing here?". Deliberately over the raw `stage` column rather than
 *  the resolved axis, so it also reports occupants of stages the axis no longer
 *  declares — those are exactly the people a migration has to account for, and a
 *  count that quietly omitted them would make an unsafe edit look safe.
 *
 *  Terminal rows (`rejected` / `declined`) are excluded to match `listPipeline`:
 *  the board does not show them, so removing their column strands nobody. */
export function countPipelineByStage(workspaceId: string = DEFAULT_WORKSPACE_ID): Record<string, number> {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT stage, COUNT(*) AS n
         FROM pipeline_entries
        WHERE workspace_id = ? AND status NOT IN ('rejected', 'declined')
        GROUP BY stage`
    )
    .all(workspaceId) as { stage: string; n: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.stage] = r.n;
  return out;
}

// --- Human re-review of auto-rejections (idea-e43fa801) ----------------------
//
// The screening wave auto-rejects the bottom cohort and the rejection is
// terminal — no undo path, and the candidate already got a (queued) rejection
// email. A recruiter who spots a borderline case (just under the threshold, a
// comms failure, a stale skip) needs a safety valve to put them back. These two
// functions back the "Reconsider" queue + one-click reinstate.

export type ReconsiderItem = { entry: PipelineEntry; rejectedAt: string | null };

/** The auto-rejected cohort still in a rejected state, newest rejection first.
 *  Only entries carrying an `auto_rejected` event surface here — a manual human
 *  reject is a deliberate decision, not a queue item. GROUP BY e.id dedups an
 *  entry that was auto-rejected more than once; MAX(created_at) is its latest. */
export function listReconsiderQueue(limit = 50, workspaceId: string = DEFAULT_WORKSPACE_ID): ReconsiderItem[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT e.id, e.candidate_id, e.candidate_label, e.archetype, e.role_family, e.job_id, e.job_title,
              e.stage, e.match_score, e.status, e.approval_kind, e.approval_detail, e.created_at, e.stage_changed_at,
              e.intake_degraded, e.intake_degraded_reason, e.workspace_id,
              MAX(ev.created_at) AS rejected_at
         FROM pipeline_entries e
         JOIN pipeline_events ev ON ev.entry_id = e.id AND ev.kind = 'auto_rejected'
        WHERE e.status = 'rejected' AND e.workspace_id = ?
        GROUP BY e.id
        ORDER BY rejected_at DESC
        LIMIT ?`
    )
    .all(workspaceId, Math.min(Math.max(limit, 1), 200)) as (PipelineRow & { rejected_at: string | null })[];
  return rows.map((r) => ({ entry: rowToEntry(r), rejectedAt: r.rejected_at ?? null }));
}

/** Reverse an auto-rejection: put the entry back to active at Screened for a
 *  fresh look, clearing any approval and recording a `reinstated` reversal event
 *  for the audit trail. Guarded to entries that are actually `rejected` (never a
 *  candidate-side `declined`/`rematched`), so a double-click or stale view is a
 *  no-op. Returns the reinstated entry, or null if it wasn't reinstatable. NB: the
 *  candidate already received a rejection note — re-notifying them is a deliberate
 *  recruiter follow-up, not auto-sent here. */
export function reinstatePipelineEntry(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEntry | null {
  const db = ensureDb();
  const tx = db.transaction((): PipelineEntry | null => {
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow | undefined;
    if (!row || row.status !== "rejected") return null;
    const now = new Date().toISOString();
    const res = db
      .prepare(
        `UPDATE pipeline_entries
            SET status='active', stage='Screened', approval_kind=NULL, approval_detail=NULL,
                stage_changed_at=?, updated_at=?
          WHERE id=? AND status='rejected' AND workspace_id=?`
      )
      .run(now, now, id, workspaceId);
    if (res.changes === 0) return null; // lost a race to another writer
    recordEvent(db, {
      entryId: id,
      candidateLabel: row.candidate_label,
      jobTitle: row.job_title,
      archetype: row.archetype,
      kind: "reinstated",
      fromStage: row.stage,
      toStage: "Screened",
      detail: "Auto-rejection reversed for re-review.",
    });
    return getPipelineEntry(id, workspaceId);
  });
  return tx();
}

export type CreatePipelineInput = {
  candidateId: string;
  candidateLabel: string;
  archetype?: string | null;
  roleFamily?: string | null;
  jobId: string;
  jobTitle: string;
  matchScore?: number | null;
  stage?: string;
  // Mark a label-only stub created because intake normalization failed, with a
  // short human-readable reason. Defaults to not-degraded for normal additions.
  intakeDegraded?: boolean;
  intakeDegradedReason?: string | null;
  // Optional stable identity to key idempotency on when `candidateId` itself is
  // NOT stable across submissions. The conversational apply flow mints a fresh
  // profile id per submission, so keying the entry id on candidateId would let
  // the same person spawn unlimited Accepted rows for one role. When set, the
  // entry's primary key derives from this instead (the candidate_id column still
  // stores the real profile id), so repeat applies collapse onto one row. See
  // `applyDedupeKey` in apply-intake.ts. Recruiter/Match adds omit it and keep
  // the historical candidateId-keyed behavior.
  dedupeKey?: string | null;
  // Candidate contact (email/phone) from inbound apply; stored so downstream comms
  // are deliverable. Omitted by recruiter/Match adds (they carry no address).
  contact?: string | null;
  // E3 — inbound source attribution ('apply' | 'quick-apply' | webhook channel id).
  // Omitted by recruiter/Match adds.
  sourceChannel?: string | null;
  // E5 — campaign/creative attribution captured at intake (bounded by callers).
  sourceCampaign?: string | null;
  sourceVariant?: string | null;
  // shortlist-to-group-eval — file the new entry as a pending KEY DECISION
  // (Decisions tab cohort, same gate the seeded rows carry). "decision" is the
  // only kind an add may request: the review kinds are minted by automation
  // after the fact, never at creation. Omitted (the default) leaves the entry
  // ungated — every non-Match add path is byte-identical to before.
  approvalKind?: "decision" | null;
  // Applicant's locale from inbound apply (SIM3); drives downstream comm
  // language. Omitted by recruiter/Match adds ⇒ NULL ⇒ "en" at dispatch.
  locale?: string | null;
  // Compact GitHub evidence summary (GH2) as validated JSON — the caller (the
  // pipeline POST route) coerces the shape before stringifying. Backfilled onto
  // an existing entry only when the column is still empty (evidence is additive;
  // a re-add must never silently overwrite earlier evidence).
  githubJson?: string | null;
  // Self-reported GitHub handle from inbound apply (already normalized by the
  // coerceGithubHandle trust-boundary gate). Backfilled onto an existing entry
  // only when the column is still empty — same FILL-ONLY discipline as githubJson.
  githubHandle?: string | null;
  // Tenant (P2) the entry belongs to. Defaults to the single default workspace; the
  // analysis→board chip + disposition echo scope on it. Recruiter/Match/inbound adds
  // omit it today (single-tenant); a multi-tenant enable threads currentWorkspace() here.
  workspaceId?: string;
};

// Idempotent: a (candidate, job) pair maps to one entry, so re-adding from Match
// or the recruiter view returns the existing row rather than duplicating it. When
// the caller supplies a `dedupeKey` (the apply flow does — candidateId is a fresh
// per-submission profile id there), the id keys on that stable value instead, so
// repeat applications dedup rather than piling up. Returns created:false when an
// entry already existed, letting the caller surface the repeat.
export function createPipelineEntry(input: CreatePipelineInput): { entry: PipelineEntry; created: boolean } {
  const db = ensureDb();
  // Tenant scope (P1): stamp + scope every by-id lookup to the owning team.
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const keySource = input.dedupeKey || input.candidateId;
  // The entry id is a GLOBAL PK. The DEFAULT workspace keeps the historical `m-<key>-<job>`
  // scheme so existing entries stay idempotent (a re-apply regenerates the SAME id and
  // merges); a non-default team prefixes its workspace so two teams sourcing the same
  // candidate→job can't collide on the shared PK once KP_MULTI_WORKSPACE is on. Fully
  // behavior-identical under the single-tenant lock — every id uses the default scheme.
  const idPrefix = workspaceId === DEFAULT_WORKSPACE_ID ? "" : `${workspaceId}-`;
  const id = `m-${idPrefix}${keySource}-${input.jobId}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 90);
  const existing = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow | undefined;
  if (existing) {
    // A re-add carrying GitHub evidence backfills an entry that has none —
    // additive only, never an overwrite of evidence already attached.
    if (input.githubJson && !existing.github_json) {
      db.prepare(`UPDATE pipeline_entries SET github_json=?, updated_at=? WHERE id=? AND workspace_id=?`).run(
        input.githubJson,
        new Date().toISOString(),
        id,
        workspaceId
      );
    }
    // Same additive discipline for the self-reported handle: a repeat that
    // brings one fills an entry that has none, never overwrites one on file.
    if (input.githubHandle && !existing.github_handle) {
      db.prepare(`UPDATE pipeline_entries SET github_handle=?, updated_at=? WHERE id=? AND workspace_id=?`).run(
        input.githubHandle,
        new Date().toISOString(),
        id,
        workspaceId
      );
    }
    // re-surface a previously-closed candidate if a recruiter re-adds them —
    // either a company reject OR a candidate decline (both terminal; a re-add
    // means "let's reconsider them", which applies equally to a past decline).
    if (isTerminalEntryStatus(existing.status)) {
      db.prepare(`UPDATE pipeline_entries SET status='active', updated_at=? WHERE id=? AND workspace_id=?`).run(
        new Date().toISOString(),
        id,
        workspaceId
      );
    }
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow;
    return { entry: rowToEntry(row), created: false };
  }
  const now = new Date().toISOString();
  const stage = input.stage ?? "Screened";
  const intakeDegraded = input.intakeDegraded ? 1 : 0;
  const intakeDegradedReason = input.intakeDegraded ? input.intakeDegradedReason ?? "intake normalization failed" : null;
  db.prepare(
    `INSERT INTO pipeline_entries
       (id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
        stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at, updated_at,
        intake_degraded, intake_degraded_reason, contact, locale, github_json, github_handle, source_channel,
        source_campaign, source_variant, workspace_id)
     VALUES (@id, @candidate_id, @candidate_label, @archetype, @role_family, @job_id, @job_title,
        @stage, @match_score, 'active', @approval_kind, NULL, @now, @now, @now,
        @intake_degraded, @intake_degraded_reason, @contact, @locale, @github_json, @github_handle, @source_channel,
        @source_campaign, @source_variant, @workspace_id)`
  ).run({
    id,
    candidate_id: input.candidateId,
    candidate_label: input.candidateLabel,
    archetype: input.archetype ?? null,
    role_family: input.roleFamily ?? null,
    job_id: input.jobId,
    job_title: input.jobTitle,
    stage,
    match_score: input.matchScore ?? null,
    approval_kind: input.approvalKind ?? null,
    now,
    intake_degraded: intakeDegraded,
    intake_degraded_reason: intakeDegradedReason,
    contact: input.contact ?? null,
    locale: input.locale ?? null,
    github_json: input.githubJson ?? null,
    github_handle: input.githubHandle ?? null,
    source_channel: input.sourceChannel ?? null,
    source_campaign: input.sourceCampaign ?? null,
    source_variant: input.sourceVariant ?? null,
    workspace_id: workspaceId,
  });
  recordEvent(db, {
    entryId: id,
    candidateLabel: input.candidateLabel,
    jobTitle: input.jobTitle,
    archetype: input.archetype,
    kind: intakeDegraded ? "intake_degraded" : "added",
    toStage: stage,
    detail: intakeDegraded ? intakeDegradedReason : "added to pipeline",
  });
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow;
  return { entry: rowToEntry(row), created: true };
}

// d95fed6d — the label join between the analysis store and the board. Analyses
// are keyed by candidate label (not entry id), so exact case-insensitive label
// match is the honest link: fuzzier matching would invent history for
// same-named strangers. Active entries only — closed candidates don't need
// disposition echoes. SCOPED to `workspaceId` (P2): the analysis row is already
// workspace-scoped, so the board it links to / writes onto must be too — without
// this, two tenants with a same-named candidate cross-link (chip leaks the other
// tenant's job/stage; the disposition echo writes onto a stranger's entry).
export function findActiveEntriesByCandidateLabel(candidateLabel: string, workspaceId: string): PipelineEntry[] {
  const key = candidateLabel.trim().toLowerCase();
  if (!key) return [];
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM pipeline_entries WHERE workspace_id = ? AND status = 'active' AND LOWER(TRIM(candidate_label)) = ?`)
    .all(workspaceId, key) as PipelineRow[];
  return rows.map(rowToEntry);
}

// d95fed6d — note a practice (simulator) interview transcript on a candidate's
// record. Recruiter-initiated and annotation-only by design: the sim's "demo
// sessions move nothing in the pipeline" contract holds — this records an event
// for the drawer history, it does NOT link the session or touch stage/approval.
export function recordSimTranscriptAttached(entryId: string, detail: string | null, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(entryId, workspaceId) as PipelineRow | undefined;
  if (!row) return false;
  // bug-ui-scan-2026-07-09 (interview-simulation-comparison #5) — idempotency: a
  // retried/duplicated attach (a re-POST, or reopening the flow) must not spam the
  // drawer with identical "practice interview attached" entries. No-op when a
  // sim_attached annotation with the SAME detail already exists on this entry —
  // `detail` (jobTitle · completed) is exactly the drawer line, so two attaches a
  // recruiter couldn't tell apart collapse to one. (Keyed on detail, not the raw
  // session token, so an interview-portal credential never leaks into an
  // audit-event string a recruiter can read.) `detail IS ?` is SQLite's null-safe
  // equality. Returns true either way — the annotation IS present, so the route
  // still reports success on a duplicate.
  const dup = db
    .prepare(`SELECT 1 FROM pipeline_events WHERE workspace_id = ? AND entry_id = ? AND kind = 'sim_attached' AND detail IS ? LIMIT 1`)
    .get(workspaceId, row.id, detail);
  if (dup) return true;
  recordEvent(db, {
    entryId: row.id,
    candidateLabel: row.candidate_label,
    jobTitle: row.job_title,
    archetype: row.archetype,
    kind: "sim_attached",
    toStage: row.stage,
    detail,
  });
  return true;
}

// d95fed6d — echo a recruiter's analysis disposition (RES5 advance/hold/pass,
// recorded on /history/[slug]) onto the candidate's pipeline record. The
// disposition used to live ONLY on the analysis row — invisible from the board
// and the drawer. Returns how many entries were annotated (0 = no active entry
// matches the analyzed label; the disposition still saves on the analysis).
export function recordAnalysisDispositionEvents(
  candidateLabel: string,
  disposition: string,
  workspaceId: string,
  note?: string | null
): number {
  const db = ensureDb();
  const entries = findActiveEntriesByCandidateLabel(candidateLabel, workspaceId);
  const trimmedNote = note?.trim();
  const detail = trimmedNote ? `${disposition} — ${trimmedNote}` : disposition;
  for (const e of entries) {
    recordEvent(db, {
      entryId: e.id,
      candidateLabel: e.candidateLabel,
      jobTitle: e.jobTitle,
      archetype: e.archetype,
      kind: "disposition_set",
      toStage: e.stage,
      detail,
    });
  }
  return entries.length;
}

// Duplicate-application policy lookup for the conversational apply flow: returns
// the EXISTING pipeline entry if this applicant has already applied to this role,
// else null. The flow captures no contact field, so a repeat is identified by
// (jobId + normalized applicant name) — the only stable signal we have. Matching
// is intentionally name-based and status-agnostic (an already-rejected or
// already-hired applicant re-applying is still a repeat to surface, not a new
// row): two genuinely distinct people who share a name applying to one role is an
// accepted, documented limitation of having no contact field.
//
// The earliest matching entry is returned so a repeat attaches its `re_applied`
// event to the original application (the canonical row). A blank name yields null
// — anonymous applicants can't be told apart, so they aren't merged. This is the
// primary, pre-build check the POST handler runs to avoid both a duplicate
// pipeline row AND a wasted profile build; createPipelineEntry's `dedupeKey`
// backstops the rare concurrent-submission race.
export function findApplicationByApplicant(jobId: string, name: string, email?: string | null, workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEntry | null {
  const emailKey = normalizeContact(email);
  const nameKey = normalizeApplicantName(name);
  // Nothing to key on (anonymous, no email) — never merge.
  if (!emailKey && !nameKey) return null;
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM pipeline_entries WHERE job_id = ? AND workspace_id = ? ORDER BY created_at ASC, id ASC`)
    .all(jobId, workspaceId) as PipelineRow[];
  // When the applicant gave an email, identity is the EMAIL: a repeat is an entry
  // sharing that contact. A row holding a DIFFERENT address is never matched —
  // two real people who share a name but gave different addresses are different
  // applicants (the exact merge the old name-only match got wrong). When no email
  // was captured, fall back to the legacy (jobId + normalized name) match.
  //
  // W8-6 (APP1) upgrade path: when the email lookup misses, a same-named entry
  // with NO contact on file is still this applicant — their first application
  // simply predates their address (no-email applies are name-keyed). Without
  // this fallback the re-apply-with-email minted a SECOND row for the person who
  // was trying to become reachable. Restricted to contactless rows only, so the
  // different-address doctrine above is untouched.
  const match = emailKey
    ? rows.find((r) => normalizeContact(r.contact) === emailKey) ??
      (nameKey
        ? rows.find((r) => !normalizeContact(r.contact) && normalizeApplicantName(r.candidate_label) === nameKey)
        : undefined)
    : rows.find((r) => normalizeApplicantName(r.candidate_label) === nameKey);
  return match ? rowToEntry(match) : null;
}

// W8-6 (APP1) — fold a re-application's fresh signals onto the applicant's
// ORIGINAL entry instead of discarding them. Two independent, guarded updates:
//   - contact is BACKFILL-ONLY (SQL-guarded, same FILL-ONLY discipline as
//     setEntryMatchScore): an entry that already has an address keeps it — a
//     repeat with a different address never reaches here anyway (it's a new
//     applicant per findApplicationByApplicant). The GitHub handle follows the
//     same fill-only rule — a repeat (or a lead's enrichment walk) that shares
//     one fills a handle-less entry and never overwrites one on file.
//   - candidateId re-points the entry at a rebuilt profile and clears the
//     intake-degraded flag (the rebuild succeeding IS the recovery); archetype
//     refreshes alongside when the rebuild produced one.
// Records NO event — the caller logs ONE `re_applied` event whose detail says
// what merged, so the feed shows a single line per repeat. Returns the updated
// entry, or null when the id is unknown.
export function mergeReapplication(
  id: string,
  updates: { contact?: string | null; candidateId?: string | null; archetype?: string | null; githubHandle?: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): PipelineEntry | null {
  const db = ensureDb();
  const now = new Date().toISOString();
  if (updates.contact) {
    db.prepare(
      `UPDATE pipeline_entries SET contact = ?, updated_at = ? WHERE id = ? AND (contact IS NULL OR contact = '') AND workspace_id = ?`
    ).run(updates.contact, now, id, workspaceId);
  }
  if (updates.githubHandle) {
    db.prepare(
      `UPDATE pipeline_entries SET github_handle = ?, updated_at = ? WHERE id = ? AND (github_handle IS NULL OR github_handle = '') AND workspace_id = ?`
    ).run(updates.githubHandle, now, id, workspaceId);
  }
  if (updates.candidateId) {
    db.prepare(
      `UPDATE pipeline_entries
         SET candidate_id = ?, archetype = COALESCE(?, archetype),
             intake_degraded = 0, intake_degraded_reason = NULL, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    ).run(updates.candidateId, updates.archetype ?? null, now, id, workspaceId);
  }
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow | undefined;
  return row ? rowToEntry(row) : null;
}

// Recruiter resolution of a degraded-intake stub: once the profile has been
// captured manually the flag is cleared and an event logged, so the audit trail
// shows the gap was recovered rather than the entry silently slipping through.
// Returns the updated entry, or null when the id is unknown or wasn't degraded.
export function clearIntakeDegraded(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow | undefined;
  if (!row || row.intake_degraded !== 1) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE pipeline_entries SET intake_degraded=0, intake_degraded_reason=NULL, updated_at=? WHERE id=? AND workspace_id=?`
  ).run(now, id, workspaceId);
  recordEvent(db, {
    entryId: id,
    candidateLabel: row.candidate_label,
    jobTitle: row.job_title,
    archetype: row.archetype,
    kind: "intake_resolved",
    toStage: row.stage,
    detail: "intake captured manually",
  });
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow;
  return rowToEntry(updated);
}

// Lead enrichment hand-off — bound the recorded pass-state at write AND read so
// a corrupt column can never balloon a payload or seed a fabricated gate.
const LEAD_PASSED_KO_MAX_IDS = 12;

// Mint (or return) the entry's opaque lead-enrichment token: the capability the
// ack email's "complete your profile" link carries so the conversational apply
// opens knowing WHO is enriching and the merge targets this exact entry — never
// the raw entry id (an internal IDOR handle, per the schedule/offer-token
// doctrine), so it comes from randomToken (CSPRNG), never randomId.
//   - the token is FILL-ONLY (SQL-COALESCE-guarded): the link already emailed to
//     the candidate must stay valid across repeat applications;
//   - `passedKoIds` REFRESHES whenever provided — the caller just re-verified
//     those gates, so the newest verdict is the truthful one.
// Returns the canonical token, or null when the entry id is unknown.
export function ensureLeadEnrichToken(entryId: string, passedKoIds?: readonly string[], workspaceId: string = DEFAULT_WORKSPACE_ID): string | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT lead_token FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(entryId, workspaceId) as
    | { lead_token: string | null }
    | undefined;
  if (!row) return null;
  const passedJson = passedKoIds ? JSON.stringify(passedKoIds.slice(0, LEAD_PASSED_KO_MAX_IDS)) : null;
  if (row.lead_token && !passedJson) return row.lead_token;
  db.prepare(
    `UPDATE pipeline_entries
        SET lead_token = COALESCE(lead_token, ?),
            lead_passed_ko_json = COALESCE(?, lead_passed_ko_json),
            updated_at = ?
      WHERE id = ? AND workspace_id = ?`
  ).run(row.lead_token ?? randomToken("ld"), passedJson, new Date().toISOString(), entryId, workspaceId);
  // Re-read so a concurrent mint race returns the COALESCE winner, not our loser.
  const after = db.prepare(`SELECT lead_token FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(entryId, workspaceId) as
    | { lead_token: string | null }
    | undefined;
  return after?.lead_token ?? null;
}

export type LeadEnrichTarget = {
  entry: PipelineEntry;
  /** KO step ids the lead EXPLICITLY answered true at intake — recorded
   *  pass-state, never derived. Empty when nothing was verified. */
  passedKoIds: string[];
  /** The archetype checklist's still-unmet items for this entry's profile
   *  (profile_cli `missingGaps`) — what the candidate can still be asked. Empty
   *  when nothing was recorded, or when every recorded gap has been answered. */
  profileGaps: EntryProfileGap[];
};

/** One recorded, still-unmet checklist item. Structurally the pure module's
 *  CompletenessGap; re-declared here so the DB layer stays import-free of app
 *  logic (the two are asserted compatible at every call site by the compiler). */
export type EntryProfileGap = { check: string; label: string };

// Bounds on the recorded gap list, applied at write AND read — it rides a public
// candidate payload, so a corrupt column can never balloon a response.
const PROFILE_GAPS_MAX = 12;
const PROFILE_GAP_CHECK_MAX = 64;
const PROFILE_GAP_LABEL_MAX = 160;

// Record (REPLACE) the entry's still-unmet checklist gaps. Rewritten wholesale
// rather than merged: the list is always the authoritative output of the profile
// build (or of the re-normalization after a gap answer merged), so appending
// would resurrect gaps the candidate has already closed. An empty list clears the
// column — "nothing left to ask". Best-effort by contract: the caller's
// application/merge has already succeeded, so a failure here is logged upstream,
// never fatal. Returns true when a row was touched.
export function setEntryProfileGaps(
  entryId: string,
  gaps: readonly EntryProfileGap[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const db = ensureDb();
  const bounded = gaps
    .filter((g) => typeof g?.check === "string" && g.check.length > 0 && g.check.length <= PROFILE_GAP_CHECK_MAX)
    .slice(0, PROFILE_GAPS_MAX)
    .map((g) => ({ check: g.check, label: String(g.label ?? "").slice(0, PROFILE_GAP_LABEL_MAX) }));
  const info = db
    .prepare(`UPDATE pipeline_entries SET profile_gaps_json = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(bounded.length ? JSON.stringify(bounded) : null, new Date().toISOString(), entryId, workspaceId);
  return Number(info.changes) > 0;
}

// Read the recorded gaps for an entry (server-side; the candidate path reads them
// through findEntryByLeadToken's capability lookup instead).
export function entryProfileGaps(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): EntryProfileGap[] {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT profile_gaps_json FROM pipeline_entries WHERE id = ? AND workspace_id = ?`)
    .get(entryId, workspaceId) as { profile_gaps_json: string | null } | undefined;
  return row ? parseProfileGaps(row.profile_gaps_json, entryId) : [];
}

// Revive the recorded gaps at the read boundary, same degrade-to-safe discipline
// as parseLeadPassedKo: corrupt or mis-shaped JSON yields [] — the candidate is
// simply asked nothing — never a fabricated question.
function parseProfileGaps(json: string | null | undefined, entryId: string): EntryProfileGap[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const out: EntryProfileGap[] = [];
    for (const item of parsed) {
      if (out.length >= PROFILE_GAPS_MAX) break;
      if (!item || typeof item !== "object") continue;
      const check = (item as { check?: unknown }).check;
      const label = (item as { label?: unknown }).label;
      if (typeof check !== "string" || !check || check.length > PROFILE_GAP_CHECK_MAX) continue;
      out.push({ check, label: typeof label === "string" ? label.slice(0, PROFILE_GAP_LABEL_MAX) : "" });
    }
    return out;
  } catch (error) {
    console.error(`[db] corrupt profile_gaps_json on pipeline entry "${entryId}"`, error);
    return [];
  }
}

// Resolve a lead-enrichment token back to its entry (+ recorded KO pass-state).
// The caller-facing contract is deliberately soft: unknown/blank tokens return
// null and the apply surface degrades to the first-time flow — the emailed link
// must never be worse than no token. Callers MUST still check entry.jobId
// against the page's job before trusting the match.
export function findEntryByLeadToken(token: string): LeadEnrichTarget | null {
  const key = token.trim();
  if (!key) return null;
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE lead_token = ?`).get(key) as PipelineRow | undefined;
  if (!row) return null;
  return {
    entry: rowToEntry(row),
    passedKoIds: parseLeadPassedKo(row.lead_passed_ko_json, row.id),
    profileGaps: parseProfileGaps(row.profile_gaps_json, row.id),
  };
}

// Revive the recorded KO pass-state at the read boundary (same degrade-to-safe
// discipline as parseGithubEvidence): corrupt or mis-shaped JSON yields [] — the
// enrichment chat just asks every gate again — never a fabricated pass.
function parseLeadPassedKo(json: string | null | undefined, entryId: string): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64)
      .slice(0, LEAD_PASSED_KO_MAX_IDS);
  } catch (error) {
    console.error(`[db] corrupt lead_passed_ko_json on pipeline entry "${entryId}"`, error);
    return [];
  }
}

// Attach a GitHub deep-dive summary to an entry AFTER creation — the drawer's
// on-demand run for an inbound applicant who shared a handle at apply (the
// add-to-pipeline POST is the only other writer). FILL-ONLY, same additive
// discipline as the createPipelineEntry backfill: evidence already attached is
// never silently overwritten, so a concurrent double-run keeps the first
// result. `githubJson` is the JSON of an ALREADY-COERCED GithubEvidenceSummary
// (the route validates via coerceGithubEvidenceSummary before stringifying);
// an event is logged on a real attach so the candidate's history shows where
// the evidence came from. Returns the fresh entry, or null for an unknown id.
export function setEntryGithubEvidence(id: string, githubJson: string, workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow | undefined;
  if (!row) return null;
  const res = db
    .prepare(
      `UPDATE pipeline_entries SET github_json = ?, updated_at = ? WHERE id = ? AND (github_json IS NULL OR github_json = '') AND workspace_id = ?`
    )
    .run(githubJson, new Date().toISOString(), id, workspaceId);
  if (res.changes > 0) {
    recordEvent(db, {
      entryId: id,
      candidateLabel: row.candidate_label,
      jobTitle: row.job_title,
      archetype: row.archetype,
      kind: "github_evidence_attached",
      toStage: row.stage,
      detail: "GitHub deep-dive run from the drawer",
    });
  }
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow;
  return rowToEntry(updated);
}

// Persistent per-candidate recruiter note — the drawer's debounce-autosaved
// scratchpad, so call facts ("wants 80k, available August, hybrid") survive
// closing the drawer. OVERWRITE semantics (unlike the fill-only evidence
// above): the note is recruiter-owned free text and the latest autosave is the
// truth; null clears it. `notes` arrives trimmed and length-bounded by the
// route (set_notes). No event — a per-pause autosave would spam the candidate's
// history. Returns the fresh entry, or null for an unknown id.
export function setEntryNotes(id: string, notes: string | null, workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEntry | null {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE pipeline_entries SET notes = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(notes, new Date().toISOString(), id, workspaceId);
  if (res.changes === 0) return null;
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow;
  return rowToEntry(updated);
}

// ---- GDPR consent lifecycle (consent.ts) ----------------------------------
// Capture data-processing consent at apply, sweep it on expiry, and anonymize
// the candidate while RETAINING the non-identifying scoring artifacts so talent
// rediscovery can re-surface a re-consenting candidate (Recruitis pattern, see
// docs/_archive/GDPR_AND_HIRING_EXTENSIONS.md — read the DPO note before enabling in prod).

export type ConsentEventKind =
  | "granted"
  | "renewed"
  | "expiring_notified"
  | "expired"
  | "anonymized"
  | "erasure_requested"
  | "erased";

/** Append one row to the consent audit trail. Internal helper (takes the open
 *  db/transaction handle) so a transition + its audit row commit atomically. */
function logConsentEvent(
  db: Database.Database,
  entryId: string,
  kind: ConsentEventKind,
  detail?: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): void {
  db.prepare(`INSERT INTO consent_events (entry_id, kind, detail, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)`).run(
    entryId,
    kind,
    detail ?? null,
    new Date().toISOString(),
    workspaceId
  );
}

export type ConsentEvent = { id: number; kind: string; detail: string | null; createdAt: string };

/** The audit trail for one entry, newest-first (drawer "Data & consent" panel). */
export function listConsentEvents(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): ConsentEvent[] {
  return ensureDb()
    .prepare(`SELECT id, kind, detail, created_at FROM consent_events WHERE entry_id = ? AND workspace_id = ? ORDER BY id DESC`)
    .all(entryId, workspaceId)
    .map((r) => {
      const row = r as { id: number; kind: string; detail: string | null; created_at: string };
      return { id: row.id, kind: row.kind, detail: row.detail, createdAt: row.created_at };
    });
}

/** Record (or refresh, on re-apply) an entry's data-processing consent: stamps
 *  given_at = now, expires_at = now + ttl, source, and audits it. A re-apply
 *  RENEWS (the candidate re-agreed), so given_at moves forward — that's the
 *  truthful latest grant. Returns the fresh entry, or null for an unknown id. */
export function recordEntryConsent(
  entryId: string,
  source: string,
  ttlDays: number = CONSENT_TTL_DAYS,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): PipelineEntry | null {
  const db = ensureDb();
  const now = new Date();
  const tx = db.transaction((): PipelineEntry | null => {
    const existing = db.prepare(`SELECT consent_given_at FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(entryId, workspaceId) as
      | { consent_given_at: string | null }
      | undefined;
    if (!existing) return null;
    db.prepare(
      `UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ?, consent_source = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`
    ).run(now.toISOString(), consentExpiresAt(now.getTime(), ttlDays), source, now.toISOString(), entryId, workspaceId);
    logConsentEvent(db, entryId, existing.consent_given_at ? "renewed" : "granted", `via ${source}`, workspaceId);
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(entryId, workspaceId) as PipelineRow;
    return rowToEntry(row);
  });
  return tx();
}

/** Mint (or return) the entry's opaque self-service erasure token — the
 *  capability the "manage your data" email footer carries to the public
 *  /data/[token] page. FILL-ONLY (COALESCE-guarded) so the link already emailed
 *  stays valid; CSPRNG (randomToken), never the raw entry id. Null for unknown id. */
export function ensureErasureToken(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): string | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT erasure_token FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(entryId, workspaceId) as
    | { erasure_token: string | null }
    | undefined;
  if (!row) return null;
  if (row.erasure_token) return row.erasure_token;
  db.prepare(
    `UPDATE pipeline_entries SET erasure_token = COALESCE(erasure_token, ?), updated_at = ? WHERE id = ? AND workspace_id = ?`
  ).run(randomToken("er"), new Date().toISOString(), entryId, workspaceId);
  const after = db.prepare(`SELECT erasure_token FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(entryId, workspaceId) as
    | { erasure_token: string | null }
    | undefined;
  return after?.erasure_token ?? null;
}

/** Resolve an erasure token to its entry (public /data/[token] page). Soft
 *  contract: blank/unknown tokens return null (the page shows "link expired"),
 *  never throws. */
export function findEntryByErasureToken(token: string): PipelineEntry | null {
  const key = token.trim();
  if (!key) return null;
  const row = ensureDb().prepare(`SELECT * FROM pipeline_entries WHERE erasure_token = ?`).get(key) as
    | PipelineRow
    | undefined;
  return row ? rowToEntry(row) : null;
}

/** Erase this candidate's PII from every OTHER table that holds it keyed to the entry
 *  — the surfaces the entry/profile/analyses scrub in anonymizeEntry does NOT reach:
 *  the voice-interview transcript + scorecard, the outbound comms outbox, and the
 *  downstream recruitment artifacts (offer, interview prep, schedule invite, onboarding,
 *  rediscovery alert). Runs on the SAME `db` connection inside anonymizeEntry's
 *  transaction (every isolated store opens the same kp.sqlite file — see db-path.ts — so
 *  a raw UPDATE here reaches its rows and rolls back with the rest on failure) and stays
 *  SYNCHRONOUS: a stray await would silently break the transaction's atomicity. Tables a
 *  fresh DB file never materialized are skipped. erasure-full-scrub.test.ts fails if any
 *  of these survives, so a newly-added PII table can't quietly opt out.
 *
 *  DELIBERATELY NOT scrubbed — `decision_records`: a tamper-evident hash chain kept for
 *  adverse-action defensibility (the GDPR Art.17(3)(b)/(e) legal-claims / compliance
 *  exemption). Editing a row would BREAK the very chain it exists to prove, so we retain
 *  it and disclose the retention on /data rather than over-promising its deletion. */
function scrubEntryLinkedPii(db: Database.Database, entryId: string, candidateId: string | null, masked: string): void {
  const tables = new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name)
  );
  // Voice interview: transcript_json is the candidate's verbatim spoken answers (raw
  // PII → dropped to []) and scorecard_json is a free-text synthesis quoting them (→
  // NULL). The assessment DECISION survives on the entry/events, not on this row.
  if (tables.has("interview_sessions")) {
    db.prepare(
      `UPDATE interview_sessions SET candidate_label = ?, transcript_json = '[]', scorecard_json = NULL WHERE entry_id = ?`
    ).run(masked, entryId);
  }
  // Outbound comms outbox (ref = entry id): recipient is the candidate's email when it
  // was captured; subject/body are personalized (name + details). Blank all three; the
  // kind/status/created_at columns stay as the "a message was sent" delivery audit.
  if (tables.has("dev_outbox")) {
    db.prepare(`UPDATE dev_outbox SET recipient = NULL, subject = NULL, body = NULL WHERE ref = ?`).run(entryId);
  }
  // Self-scheduling invite: the label + the timezone captured at confirm.
  if (tables.has("schedule_invites")) {
    db.prepare(`UPDATE schedule_invites SET candidate_label = ?, candidate_tz = NULL WHERE entry_id = ?`).run(masked, entryId);
  }
  // Offer: the label + the offer-letter payload (may embed name/free-text terms). The
  // salary/currency columns are non-identifying numbers and stay as the retained record.
  if (tables.has("offers")) {
    db.prepare(`UPDATE offers SET candidate_label = ?, payload_json = NULL WHERE entry_id = ?`).run(masked, entryId);
  }
  // Interview-prep dossier: the label + the free-text prep payload that quotes the CV.
  if (tables.has("interview_preps")) {
    db.prepare(`UPDATE interview_preps SET candidate_label = ?, payload_json = '{}' WHERE entry_id = ?`).run(masked, entryId);
  }
  // Onboarding (post-hire): the run label, the pre-boarding questionnaire answers, and
  // the e-signature signer identity. Child rows key off the run id.
  if (tables.has("onboarding_runs")) {
    const runs = db.prepare(`SELECT id FROM onboarding_runs WHERE entry_id = ?`).all(entryId) as { id: string }[];
    db.prepare(`UPDATE onboarding_runs SET candidate_label = ? WHERE entry_id = ?`).run(masked, entryId);
    for (const { id: runId } of runs) {
      if (tables.has("onboarding_intake")) db.prepare(`UPDATE onboarding_intake SET answers_json = '{}' WHERE run_id = ?`).run(runId);
      if (tables.has("onboarding_signatures")) db.prepare(`UPDATE onboarding_signatures SET signer = NULL WHERE run_id = ?`).run(runId);
    }
  }
  // Rediscovery alerts are keyed by candidate_id (a rejected candidate resurfaced for a
  // new role), not entry_id — mask BOTH the candidate_label and the prior-decision label
  // snapshot (prior_label also carries the full name).
  if (candidateId && tables.has("rediscovery_alerts")) {
    db.prepare(`UPDATE rediscovery_alerts SET candidate_label = ?, prior_label = ? WHERE candidate_id = ?`).run(masked, masked, candidateId);
  }
}

/** Anonymize one entry in place: mask the candidate label to "First L.", null the
 *  directly-identifying columns (contact, github handle/evidence, recruiter notes),
 *  mask the label snapshot on every audit event, deep-scrub the linked profile's CV
 *  payload AND the saved analyses, and — via scrubEntryLinkedPii — erase the interview
 *  transcript/scorecard, the comms outbox, and the offer/prep/schedule/onboarding/
 *  rediscovery artifacts, all inside ONE transaction. KEEPS match_score, stage, events
 *  and the tamper-evident decision_records chain (retained for adverse-action defense).
 *  Stamps anonymized_at and audits it. Idempotent (a second run is a no-op via the
 *  anonymized_at guard). `reason` distinguishes the consent-expiry sweep from a
 *  candidate erasure request in the audit trail. Returns the entry, or null. */
export function anonymizeEntry(entryId: string, reason: "expiry" | "erasure" = "expiry", workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEntry | null {
  const db = ensureDb();
  const tx = db.transaction((): PipelineEntry | null => {
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(entryId, workspaceId) as PipelineRow | undefined;
    if (!row) return null;
    if (row.anonymized_at) return rowToEntry(row); // already scrubbed — no-op
    const now = new Date().toISOString();
    const masked = maskCandidateName(row.candidate_label);
    db.prepare(
      `UPDATE pipeline_entries
          SET candidate_label = ?, contact = NULL, github_handle = NULL, github_json = NULL,
              notes = NULL, erasure_token = NULL, anonymized_at = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?`
    ).run(masked, now, now, entryId, workspaceId);
    // The label is snapshotted onto every audit event — mask those too so the
    // activity feed can't reconstruct the name after the row is scrubbed.
    db.prepare(`UPDATE pipeline_events SET candidate_label = ? WHERE entry_id = ? AND workspace_id = ?`).run(masked, entryId, workspaceId);
    // Scrub the linked CV profile (PII out, scores kept). Best-effort: a missing
    // profile (recruiter stub) just means there was no CV blob to scrub.
    //
    // SCOPED — every other statement in this transaction already is, and this one
    // being bare is why erasure was only half-done outside the default team:
    // anonymizeProfile starts with getProfileRecord(id, workspaceId) and returns
    // false on a miss, so the entry was masked and stamped anonymized_at while the
    // candidate's CV payload — the largest PII blob in the system — survived intact
    // and the caller was told the erasure succeeded. `profiles` is workspace-scoped
    // with no by-id exemption, so the id alone was never enough.
    if (row.candidate_id) anonymizeProfile(row.candidate_id, workspaceId);
    // GDPR Art. 17: the saved `analyses` rows hold the FULL CV payload (rawText,
    // name, email, phone, verbatim evidence) + a github_json dossier. They have no
    // FK back to the entry, so match on the NORMALIZED candidate_label — LOWER(TRIM(...))
    // on BOTH sides, mirroring findActiveEntriesByCandidateLabel (the app's canonical
    // candidate↔entry link), so a padded/differently-cased label saved at another intake
    // (e.g. "jan novák " vs "Jan Novák") is still caught. The old raw `= candidate_label`
    // silently MISSED those, leaving the CV readable in History and via /api/analyses/[slug]
    // (finding #2). SCOPED to the entry's workspace so a same-named candidate in ANOTHER
    // tenant is never over-scrubbed. analyses carries no entry_id/candidate_id FK, so within
    // ONE workspace an exact-label namesake still collides — over-scrubbing the SAME tenant's
    // row is the documented safe direction; a real per-candidate FK is the durable fix.
    // Runs inside this transaction (same db connection), so a failure rolls the whole
    // erasure back rather than half-scrubbing.
    const labelKey = (row.candidate_label ?? "").trim().toLowerCase();
    const linkedAnalyses = labelKey
      ? (db
          .prepare(`SELECT slug, payload_json FROM analyses WHERE LOWER(TRIM(candidate_label)) = ? AND workspace_id = ?`)
          .all(labelKey, workspaceId) as { slug: string; payload_json: string }[])
      : [];
    if (linkedAnalyses.length > 0) {
      const scrubAnalysis = db.prepare(
        `UPDATE analyses SET candidate_label = ?, payload_json = ?, github_json = NULL WHERE slug = ?`
      );
      for (const a of linkedAnalyses) {
        let scrubbedPayload: string;
        try {
          scrubbedPayload = JSON.stringify(scrubPiiFromPayload(JSON.parse(a.payload_json)));
        } catch {
          // A corrupt payload can't be selectively scrubbed — drop it wholesale to
          // an empty object rather than leave un-scrubbed PII or abort the erasure.
          scrubbedPayload = "{}";
        }
        scrubAnalysis.run(masked, scrubbedPayload, a.slug);
      }
    }
    // Erase the candidate's PII from every OTHER entry-linked table (interview
    // transcript/scorecard, comms outbox, offer/prep/schedule/onboarding/rediscovery),
    // in this same transaction — the class of PII surfaces the block above never reached.
    scrubEntryLinkedPii(db, entryId, row.candidate_id, masked);
    logConsentEvent(db, entryId, reason === "erasure" ? "erased" : "anonymized", `reason: ${reason}`, workspaceId);
    const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(entryId, workspaceId) as PipelineRow;
    return rowToEntry(updated);
  });
  return tx();
}

/** Sweep: anonymize every entry whose consent has lapsed (expires_at in the past)
 *  and isn't already scrubbed. Runs from the instrumentation heartbeat. Best-
 *  effort per row so one failure never stalls the sweep; returns the count
 *  anonymized. Terminal-status rows are NOT exempt — an expired consent on a
 *  rejected candidate must still be honored. */
export function anonymizeExpiredConsents(nowIso: string = new Date().toISOString()): number {
  const db = ensureDb();
  // GLOBAL GDPR sweep — process EVERY tenant's expired consents (deliberately not
  // filtered by workspace); thread each entry's workspace_id to the scoped anonymizeEntry.
  const due = db
    .prepare(
      `SELECT id, workspace_id FROM pipeline_entries
        WHERE consent_expires_at IS NOT NULL AND consent_expires_at <= ? AND anonymized_at IS NULL`
    )
    .all(nowIso) as { id: string; workspace_id: string }[];
  let count = 0;
  for (const { id, workspace_id } of due) {
    try {
      if (anonymizeEntry(id, "expiry", workspace_id)) count += 1;
    } catch (error) {
      console.error(`[consent] anonymize sweep failed for entry ${id}`, error);
    }
  }
  return count;
}

// ---- Automation helpers (Phase 15) ----------------------------------------

// SINGLE SOURCE for the "don't stomp a fresh screening decision" window. Task 7
// (the policy pass) must never override a screening decision made within this many
// hours; `recentScreening` below flags entries with a `screening_*` event newer than
// the cutoff so the pass skips them. The Python boundary (automation.evaluate_entry)
// only receives the opaque `recentScreening` boolean and documents this contract —
// it cannot see the number — so this constant is the one place the window is defined.
export const SCREENING_OVERRIDE_GUARD_HOURS = 24;

// `workspaceId` used to be widened in here because PipelineEntry didn't carry it —
// that local workaround is what proved the base type should. It now comes from
// PipelineEntry itself; this type only adds the two automation-pass derivations.
export type AutomationEntry = PipelineEntry & { daysInStage: number; recentScreening: boolean };

export function getPipelineEntry(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow | undefined;
  return row ? rowToEntry(row) : null;
}

/** Read-time consent gate for a candidate's saved-analysis PII (bug-ui-scan-2026-07-09
 *  privacy-consent-provenance #3): does the pipeline entry linked to this candidate_label
 *  currently WITHHOLD PII (consent expired, or already anonymized)? Matched on the
 *  NORMALIZED label (LOWER(TRIM(...)), workspace-scoped) — the exact canonical linkage
 *  anonymizeEntry uses to scrub analyses — so /api/analyses/[slug] can scrub the CV
 *  payload SYNCHRONOUSLY in the window between consent-expiry and the deferred sweep,
 *  rather than serving the full CV until the sweep happens to run. Withholds if ANY
 *  linked entry withholds: the same GDPR-safe over-scrub direction finding #2 documents
 *  for the exact-label same-tenant namesake collision (read-time hiding is non-destructive
 *  and reversible, unlike an over-scrub write). No linked entry ⇒ false (a recruiter-
 *  uploaded analysis carries no pipeline consent lifecycle to enforce). */
export function candidateLabelWithholdsPii(
  candidateLabel: string | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  nowMs: number = Date.now(),
): boolean {
  const labelKey = (candidateLabel ?? "").trim().toLowerCase();
  if (!labelKey) return false;
  const rows = ensureDb()
    .prepare(
      `SELECT consent_given_at, consent_expires_at, anonymized_at
         FROM pipeline_entries WHERE LOWER(TRIM(candidate_label)) = ? AND workspace_id = ?`
    )
    .all(labelKey, workspaceId) as { consent_given_at: string | null; consent_expires_at: string | null; anonymized_at: string | null }[];
  if (rows.length === 0) return false;
  return rows.some((r) =>
    consentWithholdsPii({ givenAt: r.consent_given_at, expiresAt: r.consent_expires_at, anonymizedAt: r.anonymized_at }, nowMs)
  );
}

/** The owning team of an entry — a by-id point read on a globally-unique PK. Lets a
 *  token-driven flow with no session workspace (the interview-complete scorecard, resolved
 *  by the session's CSPRNG token) derive the entry's tenant to scope its own writes. */
export function getEntryWorkspace(id: string): string {
  const row = ensureDb().prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(id) as { workspace_id?: string } | undefined;
  return row?.workspace_id ?? DEFAULT_WORKSPACE_ID;
}

/** Active entries enriched with daysInStage + whether a screening decision is newer than
 *  SCREENING_OVERRIDE_GUARD_HOURS (the recentScreening guard, Task 7 input). */
// GLOBAL sweep: the ONE automation engine processes EVERY team's active entries in a
// single pass (like the tasks runner + reminder/GDPR sweeps). Each entry carries its
// workspace_id so the caller's per-entry writes (actOnPipelineEntry/setApproval/… taking
// entry.workspaceId) stay tenant-scoped; the enumeration itself must span teams, so both
// reads are tagged `-- tenancy:global` (exempted in pipeline-{tenancy,events-tenancy}.test).
export function listActiveEntriesForAutomation(): AutomationEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
              stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at,
              intake_degraded, intake_degraded_reason, workspace_id
       FROM pipeline_entries WHERE status = 'active' -- tenancy:global`
    )
    .all() as (PipelineRow & { workspace_id: string })[];
  const cutoff = new Date(Date.now() - SCREENING_OVERRIDE_GUARD_HOURS * 3600 * 1000).toISOString();
  const recent = new Set(
    (
      db
        .prepare(`SELECT DISTINCT entry_id FROM pipeline_events WHERE kind LIKE 'screening%' AND created_at > ? -- tenancy:global`)
        .all(cutoff) as { entry_id: string }[]
    ).map((r) => r.entry_id)
  );
  return rows.map((r) => {
    const days = r.stage_changed_at ? Math.floor((Date.now() - Date.parse(r.stage_changed_at)) / 86_400_000) : 0;
    // workspaceId comes from rowToEntry now — it used to be re-read here because
    // PipelineEntry didn't carry it.
    return { ...rowToEntry(r), daysInStage: days, recentScreening: recent.has(r.id) };
  });
}

/** Fill an entry's missing match score (AUTO1 — the auto-score sweep). FILL-ONLY:
 *  the WHERE clause refuses to clobber a score already present (entry creation,
 *  a recruiter's re-file), so the sweep can never overwrite a human-era value. */
export function setEntryMatchScore(entryId: string, score: number, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE pipeline_entries SET match_score=?, updated_at=? WHERE id=? AND match_score IS NULL AND workspace_id=?`)
    .run(score, new Date().toISOString(), entryId, workspaceId);
  return res.changes > 0;
}

/** Set/clear a pending approval without a stage change (Task 1 hold, Task 5 scorecard gate). */
export function setApproval(entryId: string, approvalKind: ApprovalKind | null, approvalDetail: string, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  const db = ensureDb();
  db.prepare(`UPDATE pipeline_entries SET approval_kind=?, approval_detail=?, updated_at=? WHERE id=? AND workspace_id=?`).run(
    approvalKind,
    approvalDetail,
    new Date().toISOString(),
    entryId,
    workspaceId
  );
}

export function recordAutomationEvent(entryId: string, kind: string, detail?: string, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT candidate_label, job_title, archetype, stage FROM pipeline_entries WHERE id = ? AND workspace_id = ?`)
    .get(entryId, workspaceId) as { candidate_label: string; job_title: string | null; archetype: string | null; stage: string } | undefined;
  recordEvent(db, {
    entryId,
    candidateLabel: row?.candidate_label ?? null,
    jobTitle: row?.job_title ?? null,
    archetype: row?.archetype ?? null,
    kind,
    toStage: row?.stage ?? null,
    detail: detail ?? null,
  });
}

// E2 (Erika gap) — auditable knockout discards. A KO-failed application creates
// NO pipeline entry (deliberate: a mis-tapped eligibility toggle must not mint a
// terminal row the candidate can never retry past), so without this the discard
// vanished without a trace — the exact silent auto-discard the fairness story
// forbids. Logged as an entry-less `ko_declined` pipeline event carrying the
// applicant's display name, the role, and WHICH gates failed, so the decision log
// and per-channel funnel analytics can count and inspect every discard. The
// contact address is deliberately NOT recorded — no entry was created, so no
// deliverable identity should be retained for a declined applicant.
//
// Tenant (P1): `workspaceId` is REQUIRED, deliberately un-defaulted. This event is
// entry-less, so recordEvent's usual "derive the tenant from the linked entry"
// fallback cannot fire and an omitted tenant would silently land in the DEFAULT
// workspace — which both zeroes every other team's "turned away at the gate"
// metric (the analytics read IS workspace-scoped) and bleeds their applicants'
// names + role titles into the default team's activity feed. Callers hold the
// opening's workspace already; make them pass it.
const KO_DECLINE_DETAIL_MAX = 200;
export function recordKnockoutDecline(input: {
  candidateLabel: string | null;
  jobTitle: string | null;
  channel: string;
  failedKoIds: readonly string[];
  workspaceId: string;
}): void {
  const db = ensureDb();
  const detail = `knockout declined via ${input.channel} — failed: ${input.failedKoIds.join(", ")}`;
  recordEvent(db, {
    entryId: null,
    candidateLabel: (input.candidateLabel ?? "").trim() || null,
    jobTitle: input.jobTitle,
    kind: "ko_declined",
    detail: detail.length > KO_DECLINE_DETAIL_MAX ? `${detail.slice(0, KO_DECLINE_DETAIL_MAX - 1)}…` : detail,
    workspaceId: input.workspaceId,
  });
}

/** True if an event of this kind was EVER logged for the entry (unbounded). Used
 *  to make a real-world side effect idempotent across a multi-day window — e.g. a
 *  cached outreach draft (7-day prompt-cache TTL) must not re-deliver, where the
 *  per-day hasEventToday would let a resend slip through after midnight. */
export function hasEvent(entryId: string, kind: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  return !!db
    .prepare(`SELECT 1 FROM pipeline_events WHERE entry_id=? AND kind=? AND workspace_id=? LIMIT 1`)
    .get(entryId, kind, workspaceId);
}

// Per-day alert dedup is bucketed by the BUSINESS timezone, not UTC: kp serves the
// Czech market (CET/CEST), and bucketing by UTC midnight reset "once per day" at
// ~01:00–02:00 local, so an aging/stale/fairness alert could fire twice in a single
// local evening. Intl handles DST. Override the zone with BUSINESS_TZ.
const BUSINESS_TZ = process.env.BUSINESS_TZ || "Europe/Prague";
function businessDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** True if an event of this kind for the entry was already logged today (in the
 *  business timezone, BUSINESS_TZ) — alert dedup. Compares the local-date of the
 *  most recent matching event to today's local-date, so the once-per-day window
 *  aligns with the operator's day rather than UTC midnight. */
export function hasEventToday(entryId: string, kind: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT created_at FROM pipeline_events WHERE entry_id=? AND kind=? AND workspace_id=? ORDER BY created_at DESC LIMIT 1`)
    .get(entryId, kind, workspaceId) as { created_at: string } | undefined;
  return !!row && businessDay(row.created_at) === businessDay(new Date().toISOString());
}

export type PipelineAction = "accept" | "reject" | "approve_event";

/** Apply a pipeline action. The read→compute→write runs inside an IMMEDIATE
 *  transaction (idea-b6310b92): the write lock is taken at BEGIN, so a write
 *  from another connection (offers-store, schedule-store, a second process)
 *  cannot land between the SELECT and the UPDATE — the classic lost-update
 *  where a stale automated 'advance' clobbers a human correction.
 *
 *  `opts.expectedStage` is the optimistic-CAS half for callers whose DECISION
 *  is older than the write (the automation pass snapshots entries, spawns
 *  Python for seconds, then applies): when the row's stage no longer matches
 *  what the decision was computed from, the action is SKIPPED and null is
 *  returned — a policy verdict about a stage the entry is no longer in must
 *  not be applied to whatever stage it is in now. */
export function actOnPipelineEntry(
  id: string,
  action: PipelineAction,
  detail?: string,
  // `actor` drives audit attribution: a policy/automation caller passes "system"
  // so the event kind records auto_advanced/auto_rejected; the human routes
  // default to "human" and keep advanced/rejected. Before this split every
  // advance — recruiter click included — landed as one kind the analytics
  // attributed to automation, and policy rejects wrote BOTH rejected (human)
  // and auto_rejected (auto), double-counting in momentum and the rollup.
  opts?: { expectedStage?: string; expectedApprovalKind?: ApprovalKind | null; actor?: "human" | "system" },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): PipelineEntry | null {
  const db = ensureDb();
  const tx = db.transaction((): PipelineEntry | null => {
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow | undefined;
  if (!row) return null;
  if (opts?.expectedStage !== undefined && row.stage !== opts.expectedStage) {
    console.warn(
      `[pipeline:act] skipped stale ${action} for entry ${id}: decided at stage '${opts.expectedStage}', row is now '${row.stage}'.`
    );
    return null;
  }
  // CAS half #2 (idea-b6310b92 / bug-ui-scan §hiring-automation #1): the automation
  // snapshot also captured approval_kind, but the stage-only guard above misses a
  // human who QUEUES a review DURING the seconds-long Python hop — that changes
  // approval_kind WITHOUT changing stage, so a stale system decision waves through
  // and either clears the fresh gate to NULL or (screening_review) auto-consumes it
  // into the calendar. Fail closed: if the approval state moved under a stale
  // decision, skip and yield to the human. `undefined` = the caller didn't snapshot
  // it (human routes) → not checked; `null` is a real expectation ("no pending
  // approval when I decided") that a mid-hop approval must not be allowed to violate.
  if (opts?.expectedApprovalKind !== undefined && (row.approval_kind ?? null) !== opts.expectedApprovalKind) {
    console.warn(
      `[pipeline:act] skipped ${action} for entry ${id}: approval changed under a stale decision (decided at '${opts.expectedApprovalKind ?? "none"}', row is now '${row.approval_kind ?? "none"}').`
    );
    return null;
  }
  // An accept must never RESURRECT a terminal candidate (rejected/declined/rematched)
  // by advancing their stage: a stale/duplicate offer link, a reused schedule link, or
  // a decision on a since-closed entry would otherwise flip them to Hired — and fire
  // onboarding — while their status stays terminal. reject is idempotent and
  // approve_event has its own terminal guard above; this closes the accept path.
  // (Hired keeps status 'active', so a legitimate re-accept of a Hired entry still
  // reaches the "already at terminal stage" no-op below.)
  if (action === "accept" && isTerminalEntryStatus(row.status)) {
    console.warn(`[pipeline:act] skipped accept for terminal entry ${id} (status '${row.status}').`);
    return null;
  }
  const now = new Date().toISOString();
  const meta = {
    entryId: id,
    candidateLabel: row.candidate_label,
    jobTitle: row.job_title,
    archetype: row.archetype,
    fromStage: row.stage,
  };

  // A human decision may carry a free-text reason (DEC4). The detail/display
  // plumbing already existed end-to-end (route forwards body.detail; DecisionLog
  // renders d.detail) — accept/reject just never recorded it, so every human
  // advance/reject landed in the auditable log with a blank reason. Now the
  // optional reason rides the event. (approve_event keeps using detail as the slot.)
  const decisionNote = detail && detail.trim() ? detail.trim() : null;
  const auto = opts?.actor === "system";
  if (action === "reject") {
    db.prepare(`UPDATE pipeline_entries SET status='rejected', approval_kind=NULL, updated_at=? WHERE id=? AND workspace_id=?`).run(now, id, workspaceId);
    recordEvent(db, { ...meta, kind: auto ? "auto_rejected" : "rejected", toStage: row.stage, detail: decisionNote });
  } else if (action === "approve_event") {
    // A rejected/declined entry is terminal — a stale/reused schedule token must not
    // re-activate its approval or write a 'scheduled' event for a closed-out
    // candidate. (Hired keeps status 'active', so a legitimate reschedule still works.)
    if (isTerminalEntryStatus(row.status)) return null;
    // Honor a slot override (the shared calendar lets you move a candidate's
    // proposed time); fall back to the originally-proposed slot.
    const slot = detail && detail.trim() ? detail.trim() : row.approval_detail;
    // Scheduling advances Screening → Interview, but must never move backward: a
    // stale or reused schedule link confirmed after the candidate already reached
    // Offer/Hired records the slot without regressing their stage.
    const interviewIdx = PIPELINE_STAGES.indexOf("Interview");
    const curIdx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const toStage = curIdx > interviewIdx ? row.stage : "Interview";
    if (toStage !== row.stage) {
      db.prepare(
        `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail=NULL, stage_changed_at=?, updated_at=? WHERE id=? AND workspace_id=?`
      ).run(toStage, now, now, id, workspaceId);
    } else {
      // Reschedule / already past Interview: clear the approval but leave
      // stage_changed_at untouched so time-in-stage and time-to-hire stay honest.
      db.prepare(
        `UPDATE pipeline_entries SET approval_kind=NULL, approval_detail=NULL, updated_at=? WHERE id=? AND workspace_id=?`
      ).run(now, id, workspaceId);
    }
    recordEvent(db, { ...meta, kind: "scheduled", toStage, detail: slot });
  } else if (row.approval_kind === "screening_review") {
    // Accepting an AI screening flows the candidate into interview scheduling:
    // advance a stage AND queue them on the calendar (Schedule tab) with a
    // default proposed slot, so the interviewer can pick a time + open the prep.
    const idx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const next = PIPELINE_STAGES[Math.min(idx + 1, PIPELINE_STAGES.length - 1)];
    db.prepare(
      `UPDATE pipeline_entries SET stage=?, approval_kind='calendar', approval_detail=?, stage_changed_at=?, updated_at=? WHERE id=? AND workspace_id=?`
    ).run(next, "Tue 14:00", now, now, id, workspaceId);
    recordEvent(db, { ...meta, kind: auto ? "auto_advanced" : "advanced", toStage: next, detail: decisionNote });
  } else {
    // accept: advance one stage, clear any pending approval
    const idx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const next = PIPELINE_STAGES[Math.min(idx + 1, PIPELINE_STAGES.length - 1)];
    if (next !== row.stage) {
      db.prepare(
        `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail=NULL, stage_changed_at=?, updated_at=? WHERE id=? AND workspace_id=?`
      ).run(next, now, now, id, workspaceId);
      recordEvent(db, { ...meta, kind: auto ? "auto_advanced" : "advanced", toStage: next, detail: decisionNote });
    } else {
      // Already at the terminal stage (Hired): clear the approval but don't bump
      // stage_changed_at — that timestamp anchors time-to-hire and must not move.
      db.prepare(
        `UPDATE pipeline_entries SET approval_kind=NULL, approval_detail=NULL, updated_at=? WHERE id=? AND workspace_id=?`
      ).run(now, id, workspaceId);
    }
  }
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow;
  return rowToEntry(updated);
  });
  // IMMEDIATE: take the write lock at BEGIN (not at first write), so the SELECT
  // above can never read a row another connection is about to change under us.
  const result = tx.immediate();
  // W5-2 (DEVO2) — a rejected "ds-" (promoted-submission) entry auto-feeds the
  // dev-case calibration loop with the ground truth the control room asked a
  // human to re-type. AFTER the transaction (dev_outcomes lives on its own
  // connection) and best-effort: calibration must never fail a reject.
  if (action === "reject" && result && result.status === "rejected") {
    try {
      if (recordPipelineOutcome(result, "rejected")) {
        recordAudit({
          actor: "system",
          action: "outcome_auto_recorded",
          reason: `${result.candidateLabel}: rejected (predicted ${result.matchScore ?? "—"})`,
        });
      }
    } catch (error) {
      console.error("[pipeline:act] outcome auto-record failed", error);
    }
    // W6-4 (VOX1) — a rejected candidate must not keep a live AI-interview
    // credential in their inbox. Best-effort; /connect's terminal-entry guard
    // is the backstop for paths that don't run through here (e.g. decline).
    try {
      revokeOpenInterviewSessions(result.id);
    } catch (error) {
      console.error("[pipeline:act] interview-link revoke failed", error);
    }
  }
  return result;
}

/** Manually set a pipeline entry's stage — the recruiter override the AI-driven
 *  accept/reject can't express: move BACKWARD (Interview → Screened after a
 *  no-show), skip a stage, or fix a miscategorized entry. Same IMMEDIATE-tx +
 *  optional expectedStage CAS as actOnPipelineEntry, so a hand move can't clobber
 *  (or be clobbered by) a concurrent automated write. Clears any pending approval
 *  (the context it was drafted for is gone) and stamps stage_changed_at on a real
 *  move so time-in-stage stays honest; a no-op (toStage === current) returns the
 *  entry unchanged. Records a `moved` event so the override is auditable in the
 *  activity feed and the candidate's history. Returns null on a missing row, a CAS
 *  miss, a terminal entry (a closed-out candidate isn't reopened by a stage nudge),
 *  or an unknown toStage. */
export function setPipelineEntryStage(
  id: string,
  toStage: string,
  opts?: { expectedStage?: string },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): PipelineEntry | null {
  if (!(PIPELINE_STAGES as readonly string[]).includes(toStage)) return null;
  const db = ensureDb();
  const tx = db.transaction((): PipelineEntry | null => {
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow | undefined;
    if (!row) return null;
    if (opts?.expectedStage !== undefined && row.stage !== opts.expectedStage) {
      console.warn(
        `[pipeline:set_stage] skipped stale move for entry ${id}: expected '${opts.expectedStage}', row is now '${row.stage}'.`
      );
      return null;
    }
    // A rejected / declined / rematched entry is terminal — moving its stage would
    // imply a reopen this surface doesn't model (status, not stage, closes a
    // candidate). The board only lists active entries, so this is belt-and-braces.
    if (isTerminalEntryStatus(row.status)) return null;
    if (row.stage === toStage) return rowToEntry(row); // no-op: already there
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail=NULL, stage_changed_at=?, updated_at=? WHERE id=? AND workspace_id=?`
    ).run(toStage, now, now, id, workspaceId);
    recordEvent(db, {
      entryId: id,
      candidateLabel: row.candidate_label,
      jobTitle: row.job_title,
      archetype: row.archetype,
      fromStage: row.stage,
      kind: "moved",
      toStage,
      detail: "manual",
    });
    const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as PipelineRow;
    return rowToEntry(updated);
  });
  return tx.immediate();
}

// What `rematchSourceEntry` did to the source entry, so the caller can label the
// AutomationResult and tests can pin each branch. `closed` is true ONLY when this
// call flipped a live source to the terminal `rematched` status.
export type RematchSourceResult = {
  closed: boolean;
  outcome: "closed" | "already_terminal" | "hired" | "missing";
};

/** Resolve the SOURCE entry of a rematch (idea-9ad8a777). Rematch REDIRECTS a
 *  candidate to a better-fit open role by opening a TARGET entry for another job;
 *  this closes out the source so the same person is never live + automatable in two
 *  funnels at once (which would let the policy pass advance / reject / email them
 *  twice and double-count them in the active funnel).
 *
 *  Atomic + CAS-guarded: the rematch decision came from a seconds-long LLM/Python
 *  hop, so the source may have moved or closed meanwhile — we re-read it inside the
 *  tx and branch on its CURRENT state, never the stale snapshot:
 *    - active & not Hired → close to the dedicated terminal `rematched` status
 *      (distinct from a company `reject` / candidate `decline` so the funnel counts
 *      stay honest), clearing any pending approval. closed=true.
 *    - already terminal (rejected / declined) → the documented rejected/idle
 *      re-engagement case: leave the status, just stamp the link. closed=false.
 *    - Hired (placed; status stays 'active', stage 'Hired') → never redirected,
 *      and crucially never linked, so a placed candidate can't be pulled into a
 *      second funnel. closed=false. (runAutomationTask also guards Hired up front.)
 *    - missing → no-op.
 *  In every reachable non-Hired case the `rematched` source→target link event is
 *  recorded, so the redirect is traceable from the source side (Activity log,
 *  candidateOutcomes). The symmetric `rematched_from` back-link on the target is
 *  recorded by the caller, which owns the target row. */
export function rematchSourceEntry(
  sourceId: string,
  targetEntryId: string,
  targetJobId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RematchSourceResult {
  const db = ensureDb();
  const hiredStage = PIPELINE_STAGES[PIPELINE_STAGES.length - 1]; // terminal STAGE ("Hired")
  const tx = db.transaction((): RematchSourceResult => {
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ? AND workspace_id = ?`).get(sourceId, workspaceId) as PipelineRow | undefined;
    if (!row) return { closed: false, outcome: "missing" };
    // A placed candidate (Hired keeps status='active') is never redirected — and
    // is left entirely untouched so no rematch link attaches to a hire.
    if (row.status === "active" && row.stage === hiredStage) return { closed: false, outcome: "hired" };
    const meta = {
      entryId: sourceId,
      candidateLabel: row.candidate_label,
      jobTitle: row.job_title,
      archetype: row.archetype,
    };
    // Stamp the concrete source→target link (job ids + target entry id) regardless
    // of whether we also flip the status, so the redirect is always auditable.
    const linkDetail = `${row.job_id ?? "?"} -> ${targetJobId} (${targetEntryId})`;
    if (isTerminalEntryStatus(row.status)) {
      recordEvent(db, { ...meta, kind: "rematched", toStage: row.stage, detail: linkDetail });
      return { closed: false, outcome: "already_terminal" };
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE pipeline_entries SET status='rematched', approval_kind=NULL, approval_detail=NULL, updated_at=? WHERE id=?  AND workspace_id=?`
    ).run(now, sourceId, workspaceId);
    recordEvent(db, { ...meta, kind: "rematched", toStage: row.stage, detail: linkDetail });
    return { closed: true, outcome: "closed" };
  });
  // IMMEDIATE: lock at BEGIN so the re-read can't race a concurrent move/close.
  return tx.immediate();
}
