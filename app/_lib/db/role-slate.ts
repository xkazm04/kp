import { ensureDb, coerceSlatePopulation, type SlatePopulation } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { freezeRoleRubric, getRoleRubric, mintRoleRubric, type RoleRubric } from "./role-rubrics";
import {
  deriveRoleRubric,
  evaluateAgainstRubric,
  sameRubricAxes,
  type CandidateEvidence,
  type RubricEvaluation,
} from "../role-rubric";
import type { RoleBrief } from "../rolespec";

// ADR-0012 §1/§3 — the role's SLATE: one list, both populations, one evaluation.
//
// An AI-agent candidate and a person are read out of the SAME table
// (pipeline_entries, told apart only by `population`), projected into the SAME
// shape, and judged by the SAME frozen rubric (db/role-rubrics.ts) through the SAME
// function (role-rubric.ts evaluateAgainstRubric). Only the evidence adapter differs.
//
// Tenant scope: every query binds workspace_id. A job id is not an authority to
// read another team's slate.

export type SlateMember = {
  entryId: string;
  population: SlatePopulation;
  label: string;
  stage: string;
  status: string;
  /** The evaluation against the rubric version this entry was stamped with (or the
   *  latest, for a first evaluation), or null when there is no evidence to weigh.
   *  Null is DISPLAYED as "not yet evaluated" — never as a zero. */
  evaluation: RubricEvaluation | null;
  /** The entry's own `rubric_version`, independent of which version is latest. */
  evaluatedAgainstVersion: number | null;
};

export type RoleSlate = {
  jobId: string;
  workspaceId: string;
  /** The role's latest rubric version, or null when the role has none. */
  rubric: RoleRubric | null;
  members: SlateMember[];
  /** Members whose evaluation predates the latest rubric version (or has none). A
   *  new version does NOT silently re-attribute old scores. */
  staleMemberIds: string[];
};

type SlateRow = {
  id: string;
  candidate_label: string;
  stage: string;
  status: string;
  population: string | null;
  rubric_version: number | null;
};

/** entry id → the evidence the caller already holds. The slate read never calls a
 *  producer itself: opening a board must not trigger scoring. */
export type SlateEvidence = Map<string, CandidateEvidence>;

export function readRoleSlate(
  jobId: string,
  evidence: SlateEvidence = new Map(),
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleSlate {
  const rows = ensureDb()
    .prepare(
      `SELECT id, candidate_label, stage, status, population, rubric_version
         FROM pipeline_entries
        WHERE workspace_id = ? AND job_id = ? AND status = 'active'
        ORDER BY population, candidate_label`
    )
    .all(workspaceId, jobId) as SlateRow[];
  const latest = getRoleRubric(jobId, workspaceId);
  const members: SlateMember[] = rows.map((r) => {
    const found = evidence.get(r.id);
    // Judge against the version the entry was stamped with, so a stale score is
    // re-read against ITS OWN axes; fall back to the latest for a first evaluation.
    const against = r.rubric_version != null ? getRoleRubric(jobId, workspaceId, r.rubric_version) ?? latest : latest;
    return {
      entryId: r.id,
      population: coerceSlatePopulation(r.population),
      label: r.candidate_label,
      stage: r.stage,
      status: r.status,
      evaluation:
        found && against?.axes ? evaluateAgainstRubric({ version: against.version, axes: against.axes }, found) : null,
      evaluatedAgainstVersion: r.rubric_version ?? null,
    };
  });
  const staleMemberIds = latest
    ? members.filter((m) => m.evaluatedAgainstVersion !== latest.version).map((m) => m.entryId)
    : [];
  return { jobId, workspaceId, rubric: latest, members, staleMemberIds };
}

/** Stamp the rubric version an entry's evaluation was produced against. Scoped, so
 *  an entry id from another tenant stamps nothing. */
export function stampEntryRubricVersion(
  entryId: string,
  version: number,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const info = ensureDb()
    .prepare(`UPDATE pipeline_entries SET rubric_version = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(version, new Date().toISOString(), entryId, workspaceId);
  return info.changes === 1;
}

export function slateByPopulation(slate: RoleSlate, population: SlatePopulation): SlateMember[] {
  return slate.members.filter((m) => m.population === population);
}

export type FreezeBriefRubricResult =
  | { ok: true; minted: boolean; rubric: RoleRubric }
  | { ok: false; reason: string; detail: string };

/** Freeze the role's rubric from its brief at promotion (ADR-0012 §2), on top of
 *  the append-only store. Idempotent ON CONTENT: when the latest version already
 *  carries exactly the axes this brief derives, no version is minted (a prose-only
 *  edit must not re-score the board) — it is only frozen if it was still a draft.
 *  A changed requirement mints the next version and freezes it.
 *
 *  Not transactional across mint→freeze on purpose: both are single statements
 *  with their own guards (mint is IMMEDIATE; freeze is first-writer-wins in its
 *  WHERE), and a concurrent duplicate costs at worst one extra identical version. */
export function freezeRubricFromBrief(
  jobId: string,
  brief: RoleBrief,
  opts: { intakeId?: string | null; workspaceId?: string } = {}
): FreezeBriefRubricResult {
  const workspaceId = opts.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const axes = deriveRoleRubric(brief);
  const latest = getRoleRubric(jobId, workspaceId);
  if (latest?.axes && axes.length > 0 && sameRubricAxes(latest.axes, axes)) {
    const frozen = latest.frozenAt ? latest : freezeRoleRubric(jobId, latest.version, workspaceId).rubric ?? latest;
    return { ok: true, minted: false, rubric: frozen };
  }
  const minted = mintRoleRubric({ jobId, intakeId: opts.intakeId ?? null, axes, source: "brief" }, workspaceId);
  if (!minted.ok) return minted;
  const { rubric } = freezeRoleRubric(jobId, minted.rubric.version, workspaceId);
  return { ok: true, minted: true, rubric: rubric ?? minted.rubric };
}
