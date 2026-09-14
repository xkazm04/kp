import { ensureDb, coerceSlatePopulation, type SlatePopulation } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { getActiveRubric, getRubricVersion, type StoredRubric } from "./role-rubrics";
import { evaluateAgainstRubric, type CandidateEvidence, type RubricEvaluation } from "../role-rubric";

// ADR-0009 — the role's SLATE: one list, both populations, one evaluation.
//
// The thing that is genuinely new here is not the query. It is that an AI-agent
// candidate and a person are read out of the SAME table, projected into the
// SAME shape, and judged by the SAME frozen rubric through the SAME function.
// Before this, people were pipeline_entries scored by match_score while agents
// lived in their own Agents workforce tab judged by a coverage ratio — two
// funnels, two standards, no comparison a recruiter could defend.
//
// Tenant scope: every query filters workspace_id. A job id is not an authority
// to read another team's slate.

export type SlateMember = {
  entryId: string;
  population: SlatePopulation;
  label: string;
  stage: string;
  status: string;
  /** The evaluation against the role's frozen rubric, or null when this member
   *  has never been evaluated against one. Null is DISPLAYED as "not yet
   *  evaluated" — never as a zero, which would rank an unjudged candidate below
   *  a judged-and-weak one on a board a human makes decisions from. */
  evaluation: RubricEvaluation | null;
  /** The rubric version the stored evaluation was produced against (the entry's
   *  own `rubric_version`), independent of which version is active now. When it
   *  is behind `activeVersion`, the member is STALE and the board must say so
   *  rather than implying the score reflects the current standard. */
  evaluatedAgainstVersion: number | null;
};

export type RoleSlate = {
  jobId: string;
  workspaceId: string;
  /** The role's active rubric, or null when the role has never frozen one. */
  rubric: StoredRubric | null;
  members: SlateMember[];
  /** Members whose evaluation predates the active rubric version (or has none).
   *  ADR-0009's re-score trigger: freezing a new version does NOT silently
   *  re-attribute old scores, so somebody has to be told which ones are stale. */
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

/** How a member's covered skills are sourced. Both producers already exist in
 *  the codebase; this module deliberately does NOT call them — a slate read must
 *  not trigger scoring. The caller supplies the evidence it already holds, which
 *  also keeps this function pure enough to test against a hand-built map. */
export type SlateEvidence = Map<string, CandidateEvidence>;

/** Read the role's slate: every active candidate on the job, both populations,
 *  each carrying the same evaluation fields.
 *
 *  `evidence` maps entry id → what that candidate demonstrably covers. An entry
 *  with no evidence entry gets `evaluation: null` rather than an empty-covered
 *  evaluation, because "nobody assessed this candidate" and "this candidate met
 *  nothing" are different facts and only one of them is a judgement. */
export function readRoleSlate(
  jobId: string,
  evidence: SlateEvidence = new Map(),
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleSlate {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, candidate_label, stage, status, population, rubric_version
         FROM pipeline_entries
        WHERE workspace_id = ? AND job_id = ? AND status = 'active'
        ORDER BY population, candidate_label`
    )
    .all(workspaceId, jobId) as SlateRow[];
  const active = getActiveRubric(jobId, workspaceId);
  const members: SlateMember[] = rows.map((r) => {
    const population = coerceSlatePopulation(r.population);
    const found = evidence.get(r.id);
    // Judge against the version the entry was stamped with when it has one, so
    // a stale score is re-read against ITS OWN criteria; fall back to the active
    // rubric for a candidate being evaluated now for the first time.
    const against =
      r.rubric_version != null ? getRubricVersion(jobId, r.rubric_version, workspaceId) ?? active : active;
    return {
      entryId: r.id,
      population,
      label: r.candidate_label,
      stage: r.stage,
      status: r.status,
      evaluation: found && against ? evaluateAgainstRubric(against, found) : null,
      evaluatedAgainstVersion: r.rubric_version ?? null,
    };
  });
  const staleMemberIds = active
    ? members.filter((m) => m.evaluatedAgainstVersion !== active.version).map((m) => m.entryId)
    : [];
  return { jobId, workspaceId, rubric: active, members, staleMemberIds };
}

/** Stamp the rubric version an entry's evaluation was produced against.
 *
 *  Separate from the evaluation itself on purpose: the SCORE lives with its
 *  producer (match_score, the scorecard, the agent coverage assessment), and
 *  what this column adds is the answer to "under which standard?". Scoped so a
 *  job id from another tenant cannot stamp a row here. */
export function stampEntryRubricVersion(
  entryId: string,
  version: number,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const db = ensureDb();
  const info = db
    .prepare(`UPDATE pipeline_entries SET rubric_version = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(version, new Date().toISOString(), entryId, workspaceId);
  return info.changes === 1;
}

/** Slate members of one population — the projection the board's population
 *  filter chip reads. Kept here rather than filtered at the call site so the
 *  workspace scope cannot be dropped on the way. */
export function slateByPopulation(slate: RoleSlate, population: SlatePopulation): SlateMember[] {
  return slate.members.filter((m) => m.population === population);
}
