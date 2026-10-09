// Cohort Studio (Analyze v2): the stored run sheet -> the CohortView the wire carries.
//
// Assembled at READ time (GET /api/analyze/cohort/[id]) and by the runner before its
// comparative pass, from three things only: members_json, each member's saved analysis
// (loadAnalysis, under the same consent scrub as /api/analyses/[slug]) and the stored
// reorder-surviving comments. The comparison itself is the pure engine's
// (cohortProject.ts / cohortClaims.ts): this module feeds it and never re-decides a claim.
//
// BLIND: a blind cohort's label is "Candidate A".."T" by neutral order BEFORE the engine
// sees it, so the name never enters a projected member, and it is re-asserted after
// assembly; the CV payload's own name is redacted by the engine. A member whose consent
// expired is projected from the scrubbed payload and carries the masked label.

import { analysisSchema, type Analysis } from "./schemas";
import { APP_CURRENCY } from "./format";
import type { JobRecord } from "./db/core";
import { loadAnalysis, parseStoredGithubAnalysis, type AnalysisRow } from "./db/analyses";
import type { AnalysisCohortRecord } from "./db/analysis-cohorts";
import { getTask, type TaskStatus } from "./db/tasks";
import { candidateLabelWithholdsPii } from "./db/pipeline";
import { maskCandidateName, scrubPiiFromPayload } from "./consent";
import type { CohortComments, CohortStatus, CohortSummary, CohortView, RoleBand } from "../features/tools/analyze/cohort/cohortTypes";
import { assembleCohortView, projectCohortMember, type ProjectInput, type ProjectedMember } from "../features/tools/analyze/cohort/cohortProject";
import { neutralOrder } from "../features/tools/analyze/cohort/cohortClaims";
import { displayMemberLabel, uniqueDisplayLabels, type ProposalContext } from "./analyze-cohort-proposal";

/** The engine seams, injectable so a test can run without the pure engine. */
export type CohortEngine = {
  projectCohortMember: (input: ProjectInput) => ProjectedMember;
  assembleCohortView: (
    base: Omit<CohortView, "members" | "claims" | "narrative" | "progress" | "criteria" | "roleBand">,
    members: ProjectedMember[],
    comments: CohortComments | null
  ) => CohortView;
  neutralOrder: (cohortId: string, memberIds: string[]) => string[];
};

export type ViewDeps = {
  engine: CohortEngine;
  loadAnalysis: (slug: string, workspaceId: string) => { row: AnalysisRow; payload: unknown } | null;
  parseStoredGithub: (githubJson: string | null | undefined, slug: string) => unknown;
  withholdsPii: (label: string, workspaceId: string) => boolean;
  scrubPii: (payload: unknown) => unknown;
  maskName: (label: string) => string;
  /** The status of the run's task row, or null when there is none / it is gone. */
  taskStatus: (taskId: string, workspaceId: string) => TaskStatus | null;
};

/** "Candidate A".."Z", then "Candidate 27"… — the blind label for a neutral position. */
export function blindMemberLabel(neutralIndex: number): string {
  return neutralIndex >= 0 && neutralIndex < 26 ? `Candidate ${String.fromCharCode(65 + neutralIndex)}` : `Candidate ${neutralIndex + 1}`;
}

/** The role's salary band as the engine reads it. jobs.salaryBand is always denominated
 *  in the app currency per month (salary-band.ts; pipeline/jobfit/jobs.py) — the stated
 *  salaryCurrency/salaryPeriod are the ad's RAW statement, not the band's unit. A band
 *  the ingest stamped from the market anchor (defaultedFields "salary_band") is not the
 *  role's, so it is no band at all. */
export function cohortRoleBand(job: JobRecord | null): RoleBand | null {
  if (!job || !Array.isArray(job.salaryBand) || job.salaryBand.length < 2) return null;
  if ((job.defaultedFields ?? []).includes("salary_band")) return null;
  const [lo, hi] = job.salaryBand;
  const min = Number.isFinite(lo) && lo > 0 ? lo : null;
  const max = Number.isFinite(hi) && hi > 0 ? hi : null;
  if (min === null && max === null) return null;
  return { currency: APP_CURRENCY, period: "month", min, max };
}

/** A run whose task ended without the runner closing the row (cancelled while queued, a
 *  restart, the reaper) reads as failed, never as a run still in progress. */
export function effectiveCohortStatus(stored: CohortStatus, taskStatus: TaskStatus | null): CohortStatus {
  if (stored !== "queued" && stored !== "running") return stored;
  if (taskStatus === "failed" || taskStatus === "canceled" || taskStatus === "interrupted") return "failed";
  return stored;
}

/** The saved analysis behind a member, consent-gated exactly like /api/analyses/[slug],
 *  with the stored GitHub deep-dive folded in where the engine reads it. */
export function loadCohortMemberAnalysis(
  slug: string,
  workspaceId: string,
  deps: Pick<ViewDeps, "loadAnalysis" | "parseStoredGithub" | "withholdsPii" | "scrubPii">
): { analysis: Analysis | null; withheld: boolean } {
  const found = deps.loadAnalysis(slug, workspaceId);
  if (!found) return { analysis: null, withheld: false };
  const withheld = deps.withholdsPii(found.row.candidate_label, workspaceId);
  const payload = withheld ? deps.scrubPii(found.payload) : found.payload;
  const github = withheld ? null : deps.parseStoredGithub(found.row.github_json, slug);
  const withGithub =
    github && payload && typeof payload === "object"
      ? { ...(payload as Record<string, unknown>), githubDeepDive: { status: "done", analysis: github } }
      : payload;
  const parsed = analysisSchema.safeParse(withGithub);
  return { analysis: parsed.success ? parsed.data : null, withheld };
}

/** Project every member of a stored cohort (pending members project as pending). */
export function projectAnalysisCohortMembers(
  rec: AnalysisCohortRecord,
  job: JobRecord | null,
  deps: ViewDeps
): ProjectedMember[] {
  const order = deps.engine.neutralOrder(rec.id, rec.members.map((m) => m.memberId));
  const roleBand = cohortRoleBand(job);
  const loadedAll = rec.members.map((m) =>
    m.analysisSlug ? loadCohortMemberAnalysis(m.analysisSlug, rec.workspaceId, deps) : { analysis: null, withheld: false }
  );
  // The person's name (older rows store "Name → Role"), distinct within the cohort; a
  // withheld payload's name is scrubbed, so its mask is built from the stored label.
  const shownAll = uniqueDisplayLabels(
    rec.members.map((m, i) => ({
      displayLabel: displayMemberLabel(loadedAll[i].withheld ? null : loadedAll[i].analysis?.candidate?.name, m.label),
      label: m.label,
    }))
  );
  return rec.members.map((m, i) => {
    const loaded = loadedAll[i];
    const shown = shownAll[i];
    const label = rec.blind
      ? blindMemberLabel(order.indexOf(m.memberId))
      : loaded.withheld || deps.withholdsPii(m.label, rec.workspaceId)
        ? deps.maskName(shown)
        : shown;
    return deps.engine.projectCohortMember({
      memberId: m.memberId,
      label,
      membership: m.membership,
      runState: m.runState,
      analysisSlug: m.analysisSlug,
      analysis: loaded.analysis,
      blind: rec.blind,
      roleBand,
    });
  });
}

/** The whole CohortView for a stored cohort. `comments` defaults to the stored ones; the
 *  runner passes null to build the comparative pass's input before any comment exists. */
export function assembleAnalysisCohortView(
  rec: AnalysisCohortRecord,
  ctx: ProposalContext,
  deps: ViewDeps,
  comments: CohortComments | null = rec.comments
): CohortView {
  const members = projectAnalysisCohortMembers(rec, ctx.job, deps);
  const status = effectiveCohortStatus(rec.status, rec.taskId ? deps.taskStatus(rec.taskId, rec.workspaceId) : null);
  const view = deps.engine.assembleCohortView(
    {
      cohortId: rec.id,
      status,
      jdSlug: rec.jdSlug,
      jdTitle: ctx.jdTitle,
      orgName: ctx.orgName,
      blind: rec.blind,
      reportLang: rec.reportLang,
      createdAt: rec.createdAt,
      finishedAt: rec.finishedAt,
    },
    members,
    comments
  );
  // Re-asserted, whatever the engine did: a blind cohort's label is its neutral letter.
  if (rec.blind) view.members = view.members.map((m) => ({ ...m, label: blindMemberLabel(m.neutralIndex) }));
  return view;
}

/** The recent-cohorts strip row. `view` is passed only for a finished cohort (the leader
 *  is a claim, and an unfinished run has none to name). */
export function summarizeAnalysisCohort(rec: AnalysisCohortRecord, jdTitle: string, status: CohortStatus, view: CohortView | null): CohortSummary {
  const leaderId = view?.claims.overall.separation === "clears" ? view.claims.overall.leader : null;
  return {
    cohortId: rec.id,
    jdSlug: rec.jdSlug,
    jdTitle,
    status,
    memberCount: rec.members.length,
    leaderLabel: leaderId ? (view?.members.find((m) => m.memberId === leaderId)?.label ?? null) : null,
    createdAt: rec.createdAt,
  };
}

/** The production wiring: the real stores, the consent gate and the pure engine. */
export function cohortViewDeps(): ViewDeps {
  return {
    engine: { projectCohortMember, assembleCohortView, neutralOrder },
    loadAnalysis: (slug, workspaceId) => loadAnalysis(slug, workspaceId),
    parseStoredGithub: parseStoredGithubAnalysis,
    withholdsPii: (label, workspaceId) => candidateLabelWithholdsPii(label, workspaceId),
    scrubPii: scrubPiiFromPayload,
    maskName: maskCandidateName,
    taskStatus: (taskId, workspaceId) => getTask(taskId, workspaceId)?.status ?? null,
  };
}
