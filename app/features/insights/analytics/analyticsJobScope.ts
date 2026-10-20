// The Analytics tab's ROLE axis, client half (challenge r04 analytics-dashboard/B).
//
// Pure: the route, AnalyticsTab and analyticsViewUrl share `parseJobParam`, and the
// header renders the store's withheld list (db/analytics.ts JOB_SCOPE_WITHHELD — a
// type-only import, so no server code reaches the bundle). The rule it serves
// (registry: small-sample-honesty-in-hiring-analytics, not-measurable-versus-zero): a
// figure the store cannot split by role is withheld BY NAME with its reason, never
// divided by one role's hires and never rendered as a silent zero.
import type { JobScope, JobScopeFigure, JobScopeReason } from "@/app/_lib/db/analytics";

export type { JobScope, JobScopeFigure, JobScopeReason };

/** Longest accepted `?job=`. Job ids are short opaque strings. */
export const JOB_PARAM_MAX = 128;

/** `?job=` → the job id to scope to, or null for the whole workspace. Blank, over-long
 *  or control-character values are refused; the payload then echoes `jobId: null` and
 *  the header shows no role chip, so a refused scope is visible as its absence. */
export function parseJobParam(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > JOB_PARAM_MAX) return null;
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  return v;
}

/** Catalog keys (analytics namespace). Records, so a vocabulary entry the store adds
 *  without its line here fails tsc rather than rendering a raw key. */
export const JOB_SCOPE_FIGURE_KEY: Record<JobScopeFigure, `jobScopeFigure.${JobScopeFigure}`> = {
  bySource: "jobScopeFigure.bySource",
  channelDecisionTime: "jobScopeFigure.channelDecisionTime",
  channelSpend: "jobScopeFigure.channelSpend",
  costPerHire: "jobScopeFigure.costPerHire",
  computeCostPerHire: "jobScopeFigure.computeCostPerHire",
  koDeclined: "jobScopeFigure.koDeclined",
};
/** Also the render order of the reasons. */
export const JOB_SCOPE_REASON_KEY: Record<JobScopeReason, `jobScopeReason.${JobScopeReason}`> = {
  workspaceOnly: "jobScopeReason.workspaceOnly",
  workspaceSpend: "jobScopeReason.workspaceSpend",
  accountLedger: "jobScopeReason.accountLedger",
  noEntry: "jobScopeReason.noEntry",
};

/** The header's withheld lines: grouped by reason so a shared reason is stated once. */
export function withheldByReason(scope: JobScope | null | undefined): { reason: JobScopeReason; figures: JobScopeFigure[] }[] {
  if (!scope) return [];
  return (Object.keys(JOB_SCOPE_REASON_KEY) as JobScopeReason[]).flatMap((reason) => {
    const figures = scope.withheld.filter((w) => w.reason === reason).map((w) => w.figure);
    return figures.length ? [{ reason, figures }] : [];
  });
}

/** The tab's fetch URL for a (window, role) pair; absent params = all time, workspace. */
export function analyticsFetchUrl(days: number | null, job: string | null): string {
  const params = new URLSearchParams();
  if (days) params.set("days", String(days));
  const j = parseJobParam(job);
  if (j) params.set("job", j);
  const qs = params.toString();
  return qs ? `/api/analytics?${qs}` : "/api/analytics";
}
