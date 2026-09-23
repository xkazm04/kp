// The Analyze surface's place-restoration layers, declared in one place
// (challenge-r02 analyze-engine/B). The Workspace unmounts the Analyze tab on every
// sidebar switch and on every New/History peek, so each layer states its key, its
// lifetime and what invalidates it:
//
//   run     kp.analyzeTaskId (sessionStorage, the task id)   — a still-running task;
//           re-attached on mount; cleared when the task lands, fails or is stopped.
//   result  kp.analyzeLastResult (sessionStorage, the SAVED ROW'S SLUG, no PII) — the
//           landed report; rebuilt on mount from GET /api/analyses/[slug]; cleared by
//           reset, by a new submit, and by a 404/corrupt answer (another workspace,
//           a deleted row). A running task always outranks it.
//   draft   kp.analyzeDraft (sessionStorage, typed text + two flags) — analyzeDraft.ts.
//   files   module memory only — analyzeAttachmentStore.ts. CV bytes are candidate
//           PII and never reach browser storage; a reload is their end of life.
//
// Pure: no React, no storage access, no fetch — the hook owns those and this module
// owns every decision, so the rules are testable without a renderer.

import { analysisSchema, githubAnalysisSchema, type Analysis, type GithubAnalysis } from "@/app/_lib/schemas";

export const ANALYZE_LAST_RESULT_KEY = "kp.analyzeLastResult";

export type AnalyzeRestoreDecision =
  | { kind: "resume-task"; taskId: string }
  | { kind: "reload-result"; slug: string }
  | { kind: "none" };

/** Which layer comes back on mount. A running task outranks a landed result. */
export function decideAnalyzeRestore(crumbs: {
  storedTaskId: string | null | undefined;
  lastSlug: string | null | undefined;
}): AnalyzeRestoreDecision {
  if (crumbs.storedTaskId) return { kind: "resume-task", taskId: crumbs.storedTaskId };
  if (crumbs.lastSlug) return { kind: "reload-result", slug: crumbs.lastSlug };
  return { kind: "none" };
}

export type RestoredAnalysis = { analysis: Analysis; githubAnalysis: GithubAnalysis | null };

/**
 * GET /api/analyses/[slug] body -> the live result panel's inputs, or null.
 *
 * The persisted payload carries no save receipt (persistAnalysis writes it before
 * the receipt exists), so the receipt is rebuilt from the row's own columns — without
 * it the live panel falls to the "unsaved" disabled Add-to-pipeline. The deep-dive is
 * the row's github_json, validated on its own: a corrupt one is dropped and the CV
 * report kept. A body that does not clear analysisSchema restores NOTHING — there is
 * no half-restored panel.
 */
export function liveAnalysisFromSavedRow(body: unknown): RestoredAnalysis | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (typeof row.slug !== "string" || !row.slug || typeof row.createdAt !== "string") return null;
  const parsed = analysisSchema.safeParse(row.analysis);
  if (!parsed.success) return null;

  const gh = row.githubAnalysis == null ? null : githubAnalysisSchema.safeParse(row.githubAnalysis);
  const githubAnalysis = gh?.success ? gh.data : null;

  const analysis: Analysis = {
    ...parsed.data,
    persistence: {
      slug: row.slug,
      createdAt: row.createdAt,
      candidateLabel: typeof row.candidateLabel === "string" ? row.candidateLabel : null,
      jdSlug: typeof row.jdSlug === "string" ? row.jdSlug : null,
    },
    // "Served from cache" describes a delivery; a restore delivered nothing.
    servedFromCache: null,
    // Shaped as the task result's deep-dive stage so the hook populates the panel
    // through the one applyGithubDeepDive path a live run uses.
    githubDeepDive: githubAnalysis ? { status: "done", analysis: githubAnalysis } : null,
  };
  return { analysis, githubAnalysis };
}

export type AnalyzeRestoreOutcome =
  | ({ kind: "restored" } & RestoredAnalysis)
  | { kind: "none"; dropCrumb: boolean };

/**
 * The fetch's answer -> what the hook does. A 4xx (the row is gone, belongs to
 * another workspace, or the seat lost read) and a 2xx that does not validate both
 * drop the crumb: retrying them on every visit can only fail again. A 5xx is
 * transient, so the crumb is kept for the next mount.
 */
export function settleAnalyzeRestore(httpStatus: number, body: unknown): AnalyzeRestoreOutcome {
  if (httpStatus >= 500) return { kind: "none", dropCrumb: false };
  if (httpStatus < 200 || httpStatus >= 300) return { kind: "none", dropCrumb: true };
  const restored = liveAnalysisFromSavedRow(body);
  return restored ? { kind: "restored", ...restored } : { kind: "none", dropCrumb: true };
}
