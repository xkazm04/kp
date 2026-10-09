// The Cohort Studio store (Analyze v2, spark analyze-v2-cohort): `analysis_cohorts`.
//
// One row is one comparison of up to COHORT_CAP candidates against ONE JD. The members'
// analyses are ordinary `analyses` rows (History keeps them, the cohort only points at
// them); this table holds the run sheet (members_json), the reorder-surviving model
// comments (comments_json) and the run's status.
//
// TENANCY: every statement binds `workspace_id = ?`, point reads included, and no export
// takes a defaulted workspace — a cohort id travels through the task runner (whose params
// are replayable) and through the URL, so an unscoped by-id read would hand one team
// another team's shortlist. analysis-cohorts-tenancy.test.ts pins it.
//
// The `...AnalysisCohort...` names are load-bearing: the route-layer tenancy ratchet
// (app/api/route-tenancy-coverage.test.ts) and the tenancy pins match store functions by
// TEXT.
//
// The three read helpers at the bottom (`listAnalysisCohortCvFacts`,
// `listAnalysisCohortProfileFacts`, `listAnalysisCohortReuseRows`) read `analyses` /
// `profiles` NARROWLY for the proposal and the run: identity, lineage and whether a CV
// text exists — never payload_json or the CV text itself, so nothing here can put
// either on the wire by accident.

import { randomId } from "../random-id";
import { ensureDb } from "./core";
import {
  COHORT_STATUSES,
  MEMBER_RUN_STATES,
  MEMBERSHIPS,
  type CohortComments,
  type CohortStatus,
  type MemberRunState,
  type MemberSource,
  type Membership,
} from "../../features/tools/analyze/cohort/cohortTypes";

/** One member on the run sheet, exactly as members_json stores it. */
export type AnalysisCohortMemberRecord = {
  memberId: string;
  label: string;
  membership: Membership;
  source: MemberSource;
  runState: MemberRunState;
  /** The analyses row behind this member once it is known (reused or freshly saved). */
  analysisSlug: string | null;
  /** A failure CODE (never engine text) when runState is "failed". */
  error: string | null;
};

export type AnalysisCohortRecord = {
  id: string;
  workspaceId: string;
  jdSlug: string;
  status: CohortStatus;
  blind: boolean;
  reportLang: string;
  orderSeed: string;
  members: AnalysisCohortMemberRecord[];
  comments: CohortComments | null;
  taskId: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type Row = {
  id: string;
  workspace_id: string;
  jd_slug: string;
  status: string;
  blind: number;
  report_lang: string;
  order_seed: string;
  members_json: string;
  comments_json: string | null;
  task_id: string | null;
  created_at: string;
  finished_at: string | null;
};

const isStatus = (v: unknown): v is CohortStatus => typeof v === "string" && (COHORT_STATUSES as readonly string[]).includes(v);
const isRunState = (v: unknown): v is MemberRunState =>
  typeof v === "string" && (MEMBER_RUN_STATES as readonly string[]).includes(v);
const isMembership = (v: unknown): v is Membership => typeof v === "string" && (MEMBERSHIPS as readonly string[]).includes(v);

function parseSource(v: unknown): MemberSource | null {
  const s = v as { kind?: unknown; slug?: unknown; id?: unknown } | null;
  if (s?.kind === "analysis" && typeof s.slug === "string") return { kind: "analysis", slug: s.slug };
  if (s?.kind === "profile" && typeof s.id === "string") return { kind: "profile", id: s.id };
  return null;
}

/** Defensive revive of members_json: a malformed member is dropped (and logged), never a 500. */
export function parseAnalysisCohortMembers(json: string, cohortId: string): AnalysisCohortMemberRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    console.error(`[db:analysis-cohorts] corrupt members_json on "${cohortId}"`, error);
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: AnalysisCohortMemberRecord[] = [];
  for (const m of raw as Record<string, unknown>[]) {
    const source = parseSource(m?.source);
    if (!m || typeof m.memberId !== "string" || typeof m.label !== "string" || !source || !isMembership(m.membership)) continue;
    out.push({
      memberId: m.memberId,
      label: m.label,
      membership: m.membership,
      source,
      runState: isRunState(m.runState) ? m.runState : "queued",
      analysisSlug: typeof m.analysisSlug === "string" ? m.analysisSlug : null,
      error: typeof m.error === "string" ? m.error : null,
    });
  }
  return out;
}

function parseComments(json: string | null, cohortId: string): CohortComments | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json) as CohortComments;
    return c && typeof c === "object" && Array.isArray(c.cells) ? c : null;
  } catch (error) {
    console.error(`[db:analysis-cohorts] corrupt comments_json on "${cohortId}"`, error);
    return null;
  }
}

function toRecord(r: Row): AnalysisCohortRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    jdSlug: r.jd_slug,
    // An unknown stored status reads as failed: never as a run still in progress.
    status: isStatus(r.status) ? r.status : "failed",
    blind: r.blind === 1,
    reportLang: r.report_lang,
    orderSeed: r.order_seed,
    members: parseAnalysisCohortMembers(r.members_json, r.id),
    comments: parseComments(r.comments_json, r.id),
    taskId: r.task_id,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

export type CreateAnalysisCohortInput = {
  jdSlug: string;
  blind: boolean;
  reportLang: string;
  members: Array<Pick<AnalysisCohortMemberRecord, "memberId" | "label" | "membership" | "source">>;
};

/** Insert a queued cohort. The order seed IS the id (neutralOrder keys on it). */
export function createAnalysisCohort(input: CreateAnalysisCohortInput, workspaceId: string): AnalysisCohortRecord {
  const db = ensureDb();
  const id = randomId("coh");
  const createdAt = new Date().toISOString();
  const members: AnalysisCohortMemberRecord[] = input.members.map((m) => ({
    memberId: m.memberId,
    label: m.label,
    membership: m.membership,
    source: m.source,
    runState: "queued",
    analysisSlug: null,
    error: null,
  }));
  db.prepare(
    `INSERT INTO analysis_cohorts
      (id, workspace_id, jd_slug, status, blind, report_lang, order_seed, members_json, comments_json, task_id, created_at, finished_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, NULL, NULL, ?, NULL)`
  ).run(id, workspaceId, input.jdSlug, input.blind ? 1 : 0, input.reportLang, id, JSON.stringify(members), createdAt);
  return {
    id,
    workspaceId,
    jdSlug: input.jdSlug,
    status: "queued",
    blind: input.blind,
    reportLang: input.reportLang,
    orderSeed: id,
    members,
    comments: null,
    taskId: null,
    createdAt,
    finishedAt: null,
  };
}

export function getAnalysisCohort(id: string, workspaceId: string): AnalysisCohortRecord | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM analysis_cohorts WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as Row | undefined;
  return row ? toRecord(row) : null;
}

/** The recent-cohorts strip, newest first. */
export function listRecentAnalysisCohorts(workspaceId: string, limit = 12): AnalysisCohortRecord[] {
  const rows = ensureDb()
    .prepare(`SELECT * FROM analysis_cohorts WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(workspaceId, Math.max(1, Math.min(50, Math.floor(limit)))) as Row[];
  return rows.map(toRecord);
}

export function setAnalysisCohortTask(id: string, taskId: string, workspaceId: string): boolean {
  return ensureDb().prepare(`UPDATE analysis_cohorts SET task_id = ? WHERE id = ? AND workspace_id = ?`).run(taskId, id, workspaceId).changes > 0;
}

/** Move the run's status. A terminal status stamps finished_at; queued/running clear it. */
export function setAnalysisCohortStatus(id: string, status: CohortStatus, workspaceId: string): boolean {
  const finishedAt = status === "done" || status === "failed" ? new Date().toISOString() : null;
  return (
    ensureDb()
      .prepare(`UPDATE analysis_cohorts SET status = ?, finished_at = ? WHERE id = ? AND workspace_id = ?`)
      .run(status, finishedAt, id, workspaceId).changes > 0
  );
}

export function setAnalysisCohortComments(id: string, comments: CohortComments | null, workspaceId: string): boolean {
  return (
    ensureDb()
      .prepare(`UPDATE analysis_cohorts SET comments_json = ? WHERE id = ? AND workspace_id = ?`)
      .run(comments ? JSON.stringify(comments) : null, id, workspaceId).changes > 0
  );
}

/** Rounds a member update re-reads before it gives up (three runners write the same row). */
const MEMBER_CAS_ATTEMPTS = 8;

/**
 * Patch ONE member's run state. Read -> compute -> write is a compare-and-swap on the
 * whole members_json the read saw: up to three member runners (and the erasure scrub)
 * write this row concurrently, so a blind UPDATE would lose a sibling's state. A row
 * that moved in between is re-read and re-patched; no await sits inside any of it.
 * Returns false for an unknown cohort/member (or one that kept moving).
 */
export function updateAnalysisCohortMember(
  id: string,
  memberId: string,
  patch: Partial<Pick<AnalysisCohortMemberRecord, "runState" | "analysisSlug" | "error">>,
  workspaceId: string
): boolean {
  const db = ensureDb();
  for (let attempt = 0; attempt < MEMBER_CAS_ATTEMPTS; attempt += 1) {
    const row = db
      .prepare(`SELECT members_json FROM analysis_cohorts WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId) as { members_json: string } | undefined;
    if (!row) return false;
    const members = parseAnalysisCohortMembers(row.members_json, id);
    const i = members.findIndex((m) => m.memberId === memberId);
    if (i < 0) return false;
    members[i] = { ...members[i], ...patch };
    const res = db
      .prepare(`UPDATE analysis_cohorts SET members_json = ? WHERE id = ? AND workspace_id = ? AND members_json = ?`)
      .run(JSON.stringify(members), id, workspaceId, row.members_json);
    if (res.changes > 0) return true;
  }
  console.error(`[db:analysis-cohorts] member "${memberId}" of "${id}" kept moving across ${MEMBER_CAS_ATTEMPTS} attempts`);
  return false;
}

// ---- narrow reads over the candidate stores (proposal + run) ------------------------

/** One saved analysis as the cohort needs it: identity, lineage and whether it holds CV text. */
export type AnalysisCohortCvFact = {
  slug: string;
  label: string;
  jdSlug: string | null;
  cvHash: string | null;
  roleFamily: string | null;
  seniority: string | null;
  createdAt: string;
  /** The payload carries a non-empty candidate.rawText (an erased or legacy row does not). */
  hasCvText: boolean;
};

const SLUG_CHUNK = 400;

/** Facts for the given analysis slugs in this workspace (unknown slugs are simply absent). */
export function listAnalysisCohortCvFacts(slugs: readonly string[], workspaceId: string): Map<string, AnalysisCohortCvFact> {
  const out = new Map<string, AnalysisCohortCvFact>();
  const unique = [...new Set(slugs.filter((s) => typeof s === "string" && s))];
  const db = ensureDb();
  for (let i = 0; i < unique.length; i += SLUG_CHUNK) {
    const chunk = unique.slice(i, i + SLUG_CHUNK);
    const slots = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT slug, candidate_label, jd_slug, cv_hash, role_family, seniority, created_at,
                CASE WHEN json_valid(payload_json)
                     THEN length(COALESCE(json_extract(payload_json, '$.candidate.rawText'), ''))
                     ELSE 0 END AS raw_len
           FROM analyses WHERE workspace_id = ? AND slug IN (${slots})`
      )
      .all(workspaceId, ...chunk) as Array<{
      slug: string;
      candidate_label: string;
      jd_slug: string | null;
      cv_hash: string | null;
      role_family: string | null;
      seniority: string | null;
      created_at: string;
      raw_len: number | null;
    }>;
    for (const r of rows) {
      out.set(r.slug, {
        slug: r.slug,
        label: r.candidate_label,
        jdSlug: r.jd_slug,
        cvHash: r.cv_hash,
        roleFamily: r.role_family,
        seniority: r.seniority,
        createdAt: r.created_at,
        hasCvText: (r.raw_len ?? 0) > 0,
      });
    }
  }
  return out;
}

/** A profile as the cohort needs it: identity and the analysis (CV) it was built from. */
export type AnalysisCohortProfileFact = {
  id: string;
  label: string;
  roleFamily: string | null;
  sourceAnalysisSlug: string | null;
  sourceCvHash: string | null;
};

export function listAnalysisCohortProfileFacts(ids: readonly string[], workspaceId: string): Map<string, AnalysisCohortProfileFact> {
  const out = new Map<string, AnalysisCohortProfileFact>();
  const unique = [...new Set(ids.filter((s) => typeof s === "string" && s))];
  const db = ensureDb();
  for (let i = 0; i < unique.length; i += SLUG_CHUNK) {
    const chunk = unique.slice(i, i + SLUG_CHUNK);
    const slots = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT id, label, role_family, source_analysis_slug, source_cv_hash
           FROM profiles WHERE workspace_id = ? AND id IN (${slots})`
      )
      .all(workspaceId, ...chunk) as Array<{
      id: string;
      label: string;
      role_family: string | null;
      source_analysis_slug: string | null;
      source_cv_hash: string | null;
    }>;
    for (const r of rows) {
      out.set(r.id, {
        id: r.id,
        label: r.label,
        roleFamily: r.role_family,
        sourceAnalysisSlug: r.source_analysis_slug,
        sourceCvHash: r.source_cv_hash,
      });
    }
  }
  return out;
}

/** Every analysis already filed against this JD in this workspace, newest first — the
 *  reuse candidates (analyze-cohort-proposal.ts `findReusableAnalysis` decides). */
export type AnalysisCohortReuseRow = { slug: string; label: string; cvHash: string | null; createdAt: string };

export function listAnalysisCohortReuseRows(jdSlug: string, workspaceId: string): AnalysisCohortReuseRow[] {
  const rows = ensureDb()
    .prepare(
      `SELECT slug, candidate_label, cv_hash, created_at FROM analyses
        WHERE jd_slug = ? AND workspace_id = ? ORDER BY created_at DESC, slug DESC`
    )
    .all(jdSlug, workspaceId) as Array<{ slug: string; candidate_label: string; cv_hash: string | null; created_at: string }>;
  return rows.map((r) => ({ slug: r.slug, label: r.candidate_label, cvHash: r.cv_hash, createdAt: r.created_at }));
}
