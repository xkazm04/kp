import type { ApprovalKind } from "../approval-kinds";
import { isTerminalEntryStatus, TERMINAL_ENTRY_STATUSES } from "../pipeline-status";
import { normalizeApplicantName, normalizeContact } from "../apply-intake";
import { chunk, SQL_IN_CHUNK } from "../entries-param";
import { coerceGithubEvidenceSummary, type GithubEvidenceSummary } from "../github-summary";
import { recordPipelineOutcome } from "../dev-outcomes";
import { recordAudit } from "../dev-control";
import { ensureDb, recordEvent, type PipelineEntry } from "./core";
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
  return { sql: ` WHERE kind IN (${bounded.map(() => "?").join(", ")})`, params: [...bounded] };
}

export function listPipelineEvents(limit = 40, offset = 0, kinds?: readonly string[]): PipelineEvent[] {
  const db = ensureDb();
  const filter = eventKindClause(kinds);
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
       FROM pipeline_events${filter.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...filter.params, limit, offset) as Array<{
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
export function listPipelineEventsForEntry(entryId: string, limit = 50): PipelineEvent[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
       FROM pipeline_events WHERE entry_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`
    )
    .all(entryId, limit) as Array<{
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
export function listPipelineEventsSince(sinceId: number, limit = 200): PipelineEvent[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
       FROM pipeline_events WHERE id > ? ORDER BY id ASC LIMIT ?`
    )
    .all(sinceId, limit) as Array<{
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
export function countPipelineEvents(kinds?: readonly string[]): number {
  const db = ensureDb();
  const filter = eventKindClause(kinds);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM pipeline_events${filter.sql}`).get(...filter.params) as {
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
  source_channel?: string | null;
  source_campaign?: string | null;
  source_variant?: string | null;
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
    sourceChannel: r.source_channel ?? null,
    sourceCampaign: r.source_campaign ?? null,
    sourceVariant: r.source_variant ?? null,
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

export function listPipeline(): PipelineEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      // Exclude BOTH terminal states (recruiter `rejected` and candidate
      // `declined`) from the active pipeline view — this used to be a bare
      // `status != 'rejected'`, which leaked declined entries back into the board.
      `SELECT id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
              stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at,
              intake_degraded, intake_degraded_reason
       FROM pipeline_entries WHERE status NOT IN ${TERMINAL_STATUS_SQL_LIST}
       ORDER BY job_title, match_score DESC`
    )
    .all() as PipelineRow[];
  return rows.map(rowToEntry);
}

// Prior pipeline outcomes per candidate — used by talent rediscovery to spot
// "silver medalists" (rejected/closed elsewhere) who fit a different role.
export type CandidateOutcome = { jobId: string | null; jobTitle: string | null; stage: string; status: string };

export function candidateOutcomes(): Map<string, CandidateOutcome[]> {
  const rows = ensureDb()
    .prepare(`SELECT candidate_id, job_id, job_title, stage, status FROM pipeline_entries WHERE candidate_id IS NOT NULL`)
    .all() as { candidate_id: string; job_id: string | null; job_title: string | null; stage: string; status: string }[];
  const m = new Map<string, CandidateOutcome[]>();
  for (const r of rows) {
    const arr = m.get(r.candidate_id) ?? [];
    arr.push({ jobId: r.job_id, jobTitle: r.job_title, stage: r.stage, status: r.status });
    m.set(r.candidate_id, arr);
  }
  return m;
}

/** Which of these entries carry an event of `kind` (W8-5 — e.g. the durable
 *  outreach_sent markers backing the sourcing ranking's persisted state).
 *  Chunked IN query under the SQLite variable limit. */
export function entryIdsWithEvent(entryIds: string[], kind: string): Set<string> {
  const out = new Set<string>();
  if (entryIds.length === 0) return out;
  const db = ensureDb();
  for (const ids of chunk(entryIds, SQL_IN_CHUNK)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT DISTINCT entry_id FROM pipeline_events WHERE kind = ? AND entry_id IN (${placeholders})`)
      .all(kind, ...ids) as { entry_id: string }[];
    for (const r of rows) out.add(r.entry_id);
  }
  return out;
}

/** All pipeline entries filed under a job (PREP1 — the compare grid unions the
 *  voice-interviewed cohort with human-scorecard-only entries from here). */
export function listEntriesForJob(jobId: string): PipelineEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM pipeline_entries WHERE job_id = ? ORDER BY created_at ASC, id ASC`)
    .all(jobId) as PipelineRow[];
  return rows.map(rowToEntry);
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
  // Applicant's locale from inbound apply (SIM3); drives downstream comm
  // language. Omitted by recruiter/Match adds ⇒ NULL ⇒ "en" at dispatch.
  locale?: string | null;
  // Compact GitHub evidence summary (GH2) as validated JSON — the caller (the
  // pipeline POST route) coerces the shape before stringifying. Backfilled onto
  // an existing entry only when the column is still empty (evidence is additive;
  // a re-add must never silently overwrite earlier evidence).
  githubJson?: string | null;
};

// Idempotent: a (candidate, job) pair maps to one entry, so re-adding from Match
// or the recruiter view returns the existing row rather than duplicating it. When
// the caller supplies a `dedupeKey` (the apply flow does — candidateId is a fresh
// per-submission profile id there), the id keys on that stable value instead, so
// repeat applications dedup rather than piling up. Returns created:false when an
// entry already existed, letting the caller surface the repeat.
export function createPipelineEntry(input: CreatePipelineInput): { entry: PipelineEntry; created: boolean } {
  const db = ensureDb();
  const keySource = input.dedupeKey || input.candidateId;
  const id = `m-${keySource}-${input.jobId}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 90);
  const existing = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  if (existing) {
    // A re-add carrying GitHub evidence backfills an entry that has none —
    // additive only, never an overwrite of evidence already attached.
    if (input.githubJson && !existing.github_json) {
      db.prepare(`UPDATE pipeline_entries SET github_json=?, updated_at=? WHERE id=?`).run(
        input.githubJson,
        new Date().toISOString(),
        id
      );
    }
    // re-surface a previously-closed candidate if a recruiter re-adds them —
    // either a company reject OR a candidate decline (both terminal; a re-add
    // means "let's reconsider them", which applies equally to a past decline).
    if (isTerminalEntryStatus(existing.status)) {
      db.prepare(`UPDATE pipeline_entries SET status='active', updated_at=? WHERE id=?`).run(
        new Date().toISOString(),
        id
      );
    }
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
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
        intake_degraded, intake_degraded_reason, contact, locale, github_json, source_channel,
        source_campaign, source_variant)
     VALUES (@id, @candidate_id, @candidate_label, @archetype, @role_family, @job_id, @job_title,
        @stage, @match_score, 'active', NULL, '', @now, @now, @now,
        @intake_degraded, @intake_degraded_reason, @contact, @locale, @github_json, @source_channel,
        @source_campaign, @source_variant)`
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
    now,
    intake_degraded: intakeDegraded,
    intake_degraded_reason: intakeDegradedReason,
    contact: input.contact ?? null,
    locale: input.locale ?? null,
    github_json: input.githubJson ?? null,
    source_channel: input.sourceChannel ?? null,
    source_campaign: input.sourceCampaign ?? null,
    source_variant: input.sourceVariant ?? null,
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
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
  return { entry: rowToEntry(row), created: true };
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
export function findApplicationByApplicant(jobId: string, name: string, email?: string | null): PipelineEntry | null {
  const emailKey = normalizeContact(email);
  const nameKey = normalizeApplicantName(name);
  // Nothing to key on (anonymous, no email) — never merge.
  if (!emailKey && !nameKey) return null;
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM pipeline_entries WHERE job_id = ? ORDER BY created_at ASC, id ASC`)
    .all(jobId) as PipelineRow[];
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
//     applicant per findApplicationByApplicant).
//   - candidateId re-points the entry at a rebuilt profile and clears the
//     intake-degraded flag (the rebuild succeeding IS the recovery); archetype
//     refreshes alongside when the rebuild produced one.
// Records NO event — the caller logs ONE `re_applied` event whose detail says
// what merged, so the feed shows a single line per repeat. Returns the updated
// entry, or null when the id is unknown.
export function mergeReapplication(
  id: string,
  updates: { contact?: string | null; candidateId?: string | null; archetype?: string | null }
): PipelineEntry | null {
  const db = ensureDb();
  const now = new Date().toISOString();
  if (updates.contact) {
    db.prepare(
      `UPDATE pipeline_entries SET contact = ?, updated_at = ? WHERE id = ? AND (contact IS NULL OR contact = '')`
    ).run(updates.contact, now, id);
  }
  if (updates.candidateId) {
    db.prepare(
      `UPDATE pipeline_entries
         SET candidate_id = ?, archetype = COALESCE(?, archetype),
             intake_degraded = 0, intake_degraded_reason = NULL, updated_at = ?
       WHERE id = ?`
    ).run(updates.candidateId, updates.archetype ?? null, now, id);
  }
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  return row ? rowToEntry(row) : null;
}

// Recruiter resolution of a degraded-intake stub: once the profile has been
// captured manually the flag is cleared and an event logged, so the audit trail
// shows the gap was recovered rather than the entry silently slipping through.
// Returns the updated entry, or null when the id is unknown or wasn't degraded.
export function clearIntakeDegraded(id: string): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  if (!row || row.intake_degraded !== 1) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE pipeline_entries SET intake_degraded=0, intake_degraded_reason=NULL, updated_at=? WHERE id=?`
  ).run(now, id);
  recordEvent(db, {
    entryId: id,
    candidateLabel: row.candidate_label,
    jobTitle: row.job_title,
    archetype: row.archetype,
    kind: "intake_resolved",
    toStage: row.stage,
    detail: "intake captured manually",
  });
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
  return rowToEntry(updated);
}

// ---- Automation helpers (Phase 15) ----------------------------------------

// SINGLE SOURCE for the "don't stomp a fresh screening decision" window. Task 7
// (the policy pass) must never override a screening decision made within this many
// hours; `recentScreening` below flags entries with a `screening_*` event newer than
// the cutoff so the pass skips them. The Python boundary (automation.evaluate_entry)
// only receives the opaque `recentScreening` boolean and documents this contract —
// it cannot see the number — so this constant is the one place the window is defined.
export const SCREENING_OVERRIDE_GUARD_HOURS = 24;

export type AutomationEntry = PipelineEntry & { daysInStage: number; recentScreening: boolean };

export function getPipelineEntry(id: string): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  return row ? rowToEntry(row) : null;
}

/** Active entries enriched with daysInStage + whether a screening decision is newer than
 *  SCREENING_OVERRIDE_GUARD_HOURS (the recentScreening guard, Task 7 input). */
export function listActiveEntriesForAutomation(): AutomationEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
              stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at,
              intake_degraded, intake_degraded_reason
       FROM pipeline_entries WHERE status = 'active'`
    )
    .all() as PipelineRow[];
  const cutoff = new Date(Date.now() - SCREENING_OVERRIDE_GUARD_HOURS * 3600 * 1000).toISOString();
  const recent = new Set(
    (
      db
        .prepare(`SELECT DISTINCT entry_id FROM pipeline_events WHERE kind LIKE 'screening%' AND created_at > ?`)
        .all(cutoff) as { entry_id: string }[]
    ).map((r) => r.entry_id)
  );
  return rows.map((r) => {
    const days = r.stage_changed_at ? Math.floor((Date.now() - Date.parse(r.stage_changed_at)) / 86_400_000) : 0;
    return { ...rowToEntry(r), daysInStage: days, recentScreening: recent.has(r.id) };
  });
}

/** Fill an entry's missing match score (AUTO1 — the auto-score sweep). FILL-ONLY:
 *  the WHERE clause refuses to clobber a score already present (entry creation,
 *  a recruiter's re-file), so the sweep can never overwrite a human-era value. */
export function setEntryMatchScore(entryId: string, score: number): boolean {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE pipeline_entries SET match_score=?, updated_at=? WHERE id=? AND match_score IS NULL`)
    .run(score, new Date().toISOString(), entryId);
  return res.changes > 0;
}

/** Set/clear a pending approval without a stage change (Task 1 hold, Task 5 scorecard gate). */
export function setApproval(entryId: string, approvalKind: ApprovalKind | null, approvalDetail: string): void {
  const db = ensureDb();
  db.prepare(`UPDATE pipeline_entries SET approval_kind=?, approval_detail=?, updated_at=? WHERE id=?`).run(
    approvalKind,
    approvalDetail,
    new Date().toISOString(),
    entryId
  );
}

export function recordAutomationEvent(entryId: string, kind: string, detail?: string): void {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT candidate_label, job_title, archetype, stage FROM pipeline_entries WHERE id = ?`)
    .get(entryId) as { candidate_label: string; job_title: string | null; archetype: string | null; stage: string } | undefined;
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
const KO_DECLINE_DETAIL_MAX = 200;
export function recordKnockoutDecline(input: {
  candidateLabel: string | null;
  jobTitle: string | null;
  channel: string;
  failedKoIds: readonly string[];
}): void {
  const db = ensureDb();
  const detail = `knockout declined via ${input.channel} — failed: ${input.failedKoIds.join(", ")}`;
  recordEvent(db, {
    entryId: null,
    candidateLabel: (input.candidateLabel ?? "").trim() || null,
    jobTitle: input.jobTitle,
    kind: "ko_declined",
    detail: detail.length > KO_DECLINE_DETAIL_MAX ? `${detail.slice(0, KO_DECLINE_DETAIL_MAX - 1)}…` : detail,
  });
}

/** True if an event of this kind was EVER logged for the entry (unbounded). Used
 *  to make a real-world side effect idempotent across a multi-day window — e.g. a
 *  cached outreach draft (7-day prompt-cache TTL) must not re-deliver, where the
 *  per-day hasEventToday would let a resend slip through after midnight. */
export function hasEvent(entryId: string, kind: string): boolean {
  const db = ensureDb();
  return !!db
    .prepare(`SELECT 1 FROM pipeline_events WHERE entry_id=? AND kind=? LIMIT 1`)
    .get(entryId, kind);
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
export function hasEventToday(entryId: string, kind: string): boolean {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT created_at FROM pipeline_events WHERE entry_id=? AND kind=? ORDER BY created_at DESC LIMIT 1`)
    .get(entryId, kind) as { created_at: string } | undefined;
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
  opts?: { expectedStage?: string }
): PipelineEntry | null {
  const db = ensureDb();
  const tx = db.transaction((): PipelineEntry | null => {
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  if (!row) return null;
  if (opts?.expectedStage !== undefined && row.stage !== opts.expectedStage) {
    console.warn(
      `[pipeline:act] skipped stale ${action} for entry ${id}: decided at stage '${opts.expectedStage}', row is now '${row.stage}'.`
    );
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
  if (action === "reject") {
    db.prepare(`UPDATE pipeline_entries SET status='rejected', approval_kind=NULL, updated_at=? WHERE id=?`).run(now, id);
    recordEvent(db, { ...meta, kind: "rejected", toStage: row.stage, detail: decisionNote });
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
        `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail='', stage_changed_at=?, updated_at=? WHERE id=?`
      ).run(toStage, now, now, id);
    } else {
      // Reschedule / already past Interview: clear the approval but leave
      // stage_changed_at untouched so time-in-stage and time-to-hire stay honest.
      db.prepare(
        `UPDATE pipeline_entries SET approval_kind=NULL, approval_detail='', updated_at=? WHERE id=?`
      ).run(now, id);
    }
    recordEvent(db, { ...meta, kind: "scheduled", toStage, detail: slot });
  } else if (row.approval_kind === "screening_review") {
    // Accepting an AI screening flows the candidate into interview scheduling:
    // advance a stage AND queue them on the calendar (Schedule tab) with a
    // default proposed slot, so the interviewer can pick a time + open the prep.
    const idx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const next = PIPELINE_STAGES[Math.min(idx + 1, PIPELINE_STAGES.length - 1)];
    db.prepare(
      `UPDATE pipeline_entries SET stage=?, approval_kind='calendar', approval_detail=?, stage_changed_at=?, updated_at=? WHERE id=?`
    ).run(next, "Tue 14:00", now, now, id);
    recordEvent(db, { ...meta, kind: "advanced", toStage: next, detail: decisionNote });
  } else {
    // accept: advance one stage, clear any pending approval
    const idx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const next = PIPELINE_STAGES[Math.min(idx + 1, PIPELINE_STAGES.length - 1)];
    if (next !== row.stage) {
      db.prepare(
        `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail='', stage_changed_at=?, updated_at=? WHERE id=?`
      ).run(next, now, now, id);
      recordEvent(db, { ...meta, kind: "advanced", toStage: next, detail: decisionNote });
    } else {
      // Already at the terminal stage (Hired): clear the approval but don't bump
      // stage_changed_at — that timestamp anchors time-to-hire and must not move.
      db.prepare(
        `UPDATE pipeline_entries SET approval_kind=NULL, approval_detail='', updated_at=? WHERE id=?`
      ).run(now, id);
    }
  }
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
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
  opts?: { expectedStage?: string }
): PipelineEntry | null {
  if (!(PIPELINE_STAGES as readonly string[]).includes(toStage)) return null;
  const db = ensureDb();
  const tx = db.transaction((): PipelineEntry | null => {
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
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
      `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail='', stage_changed_at=?, updated_at=? WHERE id=?`
    ).run(toStage, now, now, id);
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
    const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
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
  targetJobId: string
): RematchSourceResult {
  const db = ensureDb();
  const hiredStage = PIPELINE_STAGES[PIPELINE_STAGES.length - 1]; // terminal STAGE ("Hired")
  const tx = db.transaction((): RematchSourceResult => {
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(sourceId) as PipelineRow | undefined;
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
      `UPDATE pipeline_entries SET status='rematched', approval_kind=NULL, approval_detail='', updated_at=? WHERE id=?`
    ).run(now, sourceId);
    recordEvent(db, { ...meta, kind: "rematched", toStage: row.stage, detail: linkDetail });
    return { closed: true, outcome: "closed" };
  });
  // IMMEDIATE: lock at BEGIN so the re-read can't race a concurrent move/close.
  return tx.immediate();
}
