// ---- PRIVATE internal helpers — NOT re-exported from the pipeline.ts barrel ----
// Import this module only from sibling pipeline-*.ts files, never from outside the db/ layer.

import type { ApprovalKind } from "../approval-kinds";
import { TERMINAL_ENTRY_STATUSES } from "../pipeline-status";
import { coerceGithubEvidenceSummary, type GithubEvidenceSummary } from "../github-summary";
import type { PipelineEntry } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { screeningGateIndex, stagesWithRole, stageIndex, type StageDef } from "../pipeline-stages";

export type PipelineRow = {
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
  // ONE THREAD — the assignment / submission this entry came out of (see PipelineEntry).
  dev_case_id?: string | null;
  dev_submission_id?: string | null;
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
  // erasure_token and optout_token do NOT (capability tokens, internal-only, like
  // lead_token) — they leave this process only inside a link in the candidate's own mail.
  consent_given_at?: string | null;
  consent_expires_at?: string | null;
  consent_source?: string | null;
  anonymized_at?: string | null;
  erasure_token?: string | null;
  optout_token?: string | null;
  // Present on every row (all reads are SELECT *); mapped onto PipelineEntry so a
  // caller holding an entry never has to be told its tenant separately.
  workspace_id?: string | null;
};

export function rowToEntry(r: PipelineRow): PipelineEntry {
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
    devCaseId: r.dev_case_id ?? null,
    devSubmissionId: r.dev_submission_id ?? null,
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
export const TERMINAL_STATUS_SQL_LIST = `(${TERMINAL_ENTRY_STATUSES.map((s) => `'${s}'`).join(", ")})`;

// ANA5 — optional kind narrowing for the decision log. The IN-list binds every
// value as a parameter (never interpolated) and is bounded so a hostile query
// string can't balloon the statement; the route resolves an `attribution`
// filter to its kind set through the shared decision-attribution map.
export const EVENT_KIND_FILTER_MAX = 64;
export function eventKindClause(kinds?: readonly string[]): { sql: string; params: string[] } {
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
export const EVENT_SORT_COLUMNS = {
  createdAt: "created_at",
  candidateLabel: "candidate_label",
  jobTitle: "job_title",
  kind: "kind",
} as const;

/** "Advanced" for calibration = at or past the evaluation gate. Derived per axis
 *  rather than a frozen name set, so a renamed or split interview column still
 *  counts the same candidates. */
export const calibrationAdvancedStages = (axis: readonly StageDef[]) =>
  new Set(axis.slice(screeningGateIndex(axis)).map((s) => s.id));

// UAT KAT-L1-003 (recurrence 2) — the HIRE label. Kateřina's question is „did the
// 90 %-match candidates actually get HIRED, or just get an interview?", and with
// only `calibrationAdvancedStages` in existence Interview, Offer and Hired were
// one indistinguishable success. This is the second positive label, and it needs
// nothing the pipeline does not already record: a stage carrying the TERMINAL
// role. Role-derived, never the literal "Hired" (G8) — rename the column and the
// same people still count.
export const calibrationHiredStages = (axis: readonly StageDef[]) => new Set(stagesWithRole("terminal", axis));

/** The column an advance lands on: the NEXT one along THIS workspace's board.
 *
 *  Every advance used to walk the compile-time PIPELINE_STAGES, which answers a
 *  different question the moment a workspace composes its own axis (Settings →
 *  Hiring): a candidate standing on a column that list does not contain indexed to
 *  -1, and `PIPELINE_STAGES[min(-1 + 1, 4)]` is the FIRST canonical stage — so
 *  "advance" walked them BACKWARD to the front of the funnel and wrote an
 *  `advanced` event naming a column their board may not even draw.
 *
 *  An off-axis stage (a retired column, a legacy row) has no "next" to resolve, so
 *  the entry stays put and the caller's no-move branch handles it: we never guess a
 *  destination for somebody nobody has re-classified yet (the roleOf doctrine). */
export function nextStageOnAxis(stage: string, axis: readonly StageDef[]): string {
  const i = stageIndex(stage, axis);
  if (i < 0) return stage;
  return axis[Math.min(i + 1, axis.length - 1)]?.id ?? stage;
}

// Per-day alert dedup is bucketed by the BUSINESS timezone, not UTC: kp serves the
// Czech market (CET/CEST), and bucketing by UTC midnight reset "once per day" at
// ~01:00–02:00 local, so an aging/stale/fairness alert could fire twice in a single
// local evening. Intl handles DST. Override the zone with BUSINESS_TZ.
export const BUSINESS_TZ = process.env.BUSINESS_TZ || "Europe/Prague";
export function businessDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
