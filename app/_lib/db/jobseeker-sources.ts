import {
  PAUSE_REASONS,
  SOURCE_RUN_OUTCOMES,
  isSourceAdapterName,
  type ExtractionRule,
  type JobseekerSource,
  type PauseReason,
  type SourceKind,
  type SourceRunOutcome,
  type SourceTier,
} from "../jobseeker/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// Job-seeker acquisition sources (app/_lib/jobseeker/types.ts): the owner-confirmed
// list of feeds, ATS boards and job boards a scan may fetch from.
//
// Tenancy: every statement binds `workspace_id = ?`, point reads included
// (jobseeker-sources-tenancy.test.ts). No carve-out.
//
// Two state machines live here and the store keeps them honest at the write:
//  - enabled ⇄ acknowledged: a tier-B board is enabled ONLY together with an
//    acknowledgement (setSourceEnabled writes both in one statement); a tier-A feed
//    passes `ack: null` and the acknowledgement columns stay untouched.
//  - paused_reason: written by pauseSource, cleared ONLY by resumeSource. A scan that
//    finds a source paused skips it; it never un-pauses (`blocked` in particular is the
//    owner's decision to lift, types.ts).

type SourceRow = {
  id: string;
  workspace_id: string;
  kind: string;
  adapter: string;
  tier: string;
  host: string;
  config_json: string;
  enabled: number;
  acknowledged_at: string | null;
  acknowledged_terms_hash: string | null;
  paused_reason: string | null;
  paused_at: string | null;
  rules_json: string | null;
  rules_baseline_json: string | null;
  last_run_at: string | null;
  last_outcome: string | null;
  created_at: string;
  updated_at: string;
};

function coercePauseReason(value: string | null): PauseReason | null {
  return value !== null && (PAUSE_REASONS as readonly string[]).includes(value) ? (value as PauseReason) : null;
}

function coerceOutcome(value: string | null): SourceRunOutcome | null {
  return value !== null && (SOURCE_RUN_OUTCOMES as readonly string[]).includes(value) ? (value as SourceRunOutcome) : null;
}

function fromRow(row: SourceRow): JobseekerSource {
  const config = safeRowParse<Record<string, unknown>>(row.config_json, "jobseekerSource.config", row.id);
  const rules = safeRowParse<ExtractionRule[]>(row.rules_json, "jobseekerSource.rules", row.id);
  const baseline = safeRowParse<Record<string, number>>(row.rules_baseline_json, "jobseekerSource.rulesBaseline", row.id);
  return {
    id: row.id,
    // kind/tier are CHECK-constrained at the DDL, so the cast is over a value SQLite
    // already refused to store outside the vocabulary.
    kind: row.kind as SourceKind,
    // A row whose adapter was retired from the vocabulary still needs to render (so the
    // owner can delete it); `board_rules` is the generic fallback the UI knows.
    adapter: isSourceAdapterName(row.adapter) ? row.adapter : "board_rules",
    tier: row.tier as SourceTier,
    host: row.host,
    config: config && typeof config === "object" ? config : {},
    enabled: row.enabled === 1,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedTermsHash: row.acknowledged_terms_hash,
    pausedReason: coercePauseReason(row.paused_reason),
    pausedAt: row.paused_at,
    rules: Array.isArray(rules) ? rules : null,
    rulesBaseline: baseline && typeof baseline === "object" ? baseline : null,
    lastRunAt: row.last_run_at,
    lastOutcome: coerceOutcome(row.last_outcome),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listJobseekerSources(workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerSource[] {
  const rows = ensureDb()
    .prepare(`SELECT * FROM jobseeker_sources WHERE workspace_id = ? ORDER BY created_at ASC, id ASC`)
    .all(workspaceId) as SourceRow[];
  return rows.map(fromRow);
}

export function getJobseekerSource(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerSource | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM jobseeker_sources WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as SourceRow | undefined;
  return row ? fromRow(row) : null;
}

export type JobseekerSourceInput = Omit<
  JobseekerSource,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "enabled"
  | "acknowledgedAt"
  | "acknowledgedTermsHash"
  | "pausedReason"
  | "pausedAt"
  | "lastRunAt"
  | "lastOutcome"
  | "rules"
  | "rulesBaseline"
> &
  Partial<Pick<JobseekerSource, "rules" | "rulesBaseline">>;

/** A new source starts DISABLED whatever its tier: enabling is the owner's act
 *  (setSourceEnabled), and for tier B it carries the acknowledgement. */
export function createJobseekerSource(input: JobseekerSourceInput, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerSource {
  const d = ensureDb();
  const id = randomId("jss");
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO jobseeker_sources
       (id, workspace_id, kind, adapter, tier, host, config_json, enabled, rules_json, rules_baseline_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
  ).run(
    id,
    workspaceId,
    input.kind,
    input.adapter,
    input.tier,
    input.host.trim().toLowerCase().slice(0, 253),
    JSON.stringify(input.config ?? {}),
    input.rules ? JSON.stringify(input.rules) : null,
    input.rulesBaseline ? JSON.stringify(input.rulesBaseline) : null,
    now,
    now
  );
  return fromRow(d.prepare(`SELECT * FROM jobseeker_sources WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as SourceRow);
}

/** Flip `enabled`. With `ack`, the acknowledgement (time + the hash of the terms the
 *  owner saw) lands in the SAME statement, so there is no row that is enabled on a
 *  tier-B board without a recorded acknowledgement. Without it the acknowledgement
 *  columns are left as they are (a tier-A toggle, or a disable). */
export function setSourceEnabled(
  id: string,
  enabled: boolean,
  ack: { termsHash: string } | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(
      `UPDATE jobseeker_sources
       SET enabled = ?,
           acknowledged_at = CASE WHEN ? THEN ? ELSE acknowledged_at END,
           acknowledged_terms_hash = CASE WHEN ? THEN ? ELSE acknowledged_terms_hash END,
           updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(enabled ? 1 : 0, ack ? 1 : 0, now, ack ? 1 : 0, ack?.termsHash ?? null, now, id, workspaceId);
  return res.changes > 0;
}

export function pauseSource(id: string, reason: PauseReason, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(`UPDATE jobseeker_sources SET paused_reason = ?, paused_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(reason, now, now, id, workspaceId);
  return res.changes > 0;
}

/** The OWNER lifts a pause — the only path that clears paused_reason. */
export function resumeSource(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const res = ensureDb()
    .prepare(
      `UPDATE jobseeker_sources SET paused_reason = NULL, paused_at = NULL, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}

/** Persist extraction rules with the baseline their dry-run preview measured — the
 *  pair is written together because a rule set without its baseline has no collapse
 *  detection, and a baseline for other rules is noise. */
export function setSourceRules(
  id: string,
  rules: ExtractionRule[],
  baseline: Record<string, number>,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const res = ensureDb()
    .prepare(
      `UPDATE jobseeker_sources SET rules_json = ?, rules_baseline_json = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(JSON.stringify(rules), JSON.stringify(baseline), new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}

/** One scan's outcome for this source. Deliberately does NOT touch paused_reason:
 *  the scan runner calls pauseSource separately for `blocked`/`collapsed`, and a later
 *  `skipped` must not read as a recovery. */
export function recordSourceRun(id: string, outcome: SourceRunOutcome, at: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const res = ensureDb()
    .prepare(`UPDATE jobseeker_sources SET last_run_at = ?, last_outcome = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(at, outcome, new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}
