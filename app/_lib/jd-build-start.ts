import { insertAnalyzingJd, markJdAnalyzing, setJdAnalysisTask, type JdBuildIntent } from "./db/jobs";
import { startTask } from "./tasks";
import { type JdBuildOptions } from "./jd-build-run";

// THE ONE DOOR into a backgrounded `jd_build`.
//
// Starting a build is a three-step contract that must not drift between callers:
//   1. insert the placeholder JD row so it appears in the Ledger as "Analyzing"
//      immediately (and, on a retry, reset the existing row instead);
//   2. start the detached task, stamped with the SAME workspace as the row — a
//      mismatch files the build's matchable `jd-<slug>` opening into another
//      team's corpus, so the team that ran the build never finds their opening;
//   3. link row → task so the Ledger can show live progress and offer a retry.
//
// Four doors used to hand-roll those three steps: POST /api/jds/generate,
// POST /api/jds/[slug]/retry-analysis, the companion's `draft_jd` action and
// POST /api/intake/[id]/promote. Four copies of a spend-bearing sequence is how a
// rule lands on three of them — which is exactly what happened with the tenant
// stamp, and what the throttles would have repeated. `jd-build-start.test.ts`
// forbids a fifth copy at the source.

/** What every door supplies. `params` is the task payload minus the parts this
 *  seam owns (`title`, `jdSlug`, `options`), so a caller cannot start a build whose
 *  task is stamped for a different row or a different checklist than the row it
 *  just created. */
export type StartJdBuildInput = {
  title: string;
  options: JdBuildOptions;
  /** Persisted on the JD row (build_input_json) so Duplicate re-seeds the PROMPT
   *  and Retry can replay after the task row is pruned. */
  buildInput: JdBuildIntent;
  params: Record<string, unknown>;
  workspaceId?: string;
};

/** Create the placeholder JD and start its build. Returns the minted slug + task id. */
export function startJdBuild(input: StartJdBuildInput): { slug: string; taskId: string } {
  const { slug } = insertAnalyzingJd(
    { title: input.title, options: input.options, buildInput: input.buildInput },
    input.workspaceId
  );
  const task = startTask(
    "jd_build",
    { ...input.params, title: input.title, jdSlug: slug, options: input.options },
    input.workspaceId
  );
  setJdAnalysisTask(slug, task.id);
  return { slug, taskId: task.id };
}

/** Replay a build into an EXISTING row (the Ledger's retry). The row is reset to
 *  'analyzing' first so the Ledger reflects the re-run before the replayed build
 *  lands, and `jdSlug` is forced even for legacy params so the replay re-fills THIS
 *  row rather than minting a second one. */
export function restartJdBuild(
  slug: string,
  params: Record<string, unknown>,
  workspaceId?: string
): { taskId: string } {
  markJdAnalyzing(slug);
  const task = startTask("jd_build", { ...params, jdSlug: slug }, workspaceId);
  setJdAnalysisTask(slug, task.id);
  return { taskId: task.id };
}
